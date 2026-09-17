// src/controllers/whatsappController.ts
import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import { normalizePhoneNumber, resolveScope } from '../utils/whatsappRules';
import { decryptField, tokenizeText, blindIndex } from '../utils/fieldCrypto';
import { retentionCutoff } from '../utils/whatsappRetention';
import { ingestMessage, applySessionEvent } from '../services/whatsapp/ingest';
import { connectAccount, disconnectAccount, getSession, getQrString } from '../services/whatsapp/session';
import { toDataURL } from 'qrcode';
import { env } from '../config/env';
import type {
  CreateAccountInput,
  UpdateAccountInput,
  ListAccountQuery,
  BellysWebhookInput,
  ListConversationQuery,
  ListSessionEventQuery,
  MarkNotifiedInput,
  PurgeInput,
  DisconnectInput,
} from '../schemas/whatsappSchema';

const isHr = (role: Role) => role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;

// ============ Nomor perusahaan ============

const accountSelect = {
  id: true,
  phoneNumber: true,
  label: true,
  description: true,
  assignedEmployeeId: true,
  departmentId: true,
  sessionStatus: true,
  lastConnectedAt: true,
  lastDisconnectedAt: true,
  isActive: true,
  createdAt: true,
  assignedEmployee: { select: { id: true, nik: true, name: true } },
  _count: { select: { conversations: true } },
} satisfies Prisma.WhatsAppAccountSelect;

export const createAccount = async (req: Request, res: Response) => {
  const input = req.body as CreateAccountInput;

  const nomor = normalizePhoneNumber(input.phoneNumber);
  if (!nomor) {
    return res.status(400).json({ error: 'Nomor WhatsApp tidak valid' });
  }

  if (input.assignedEmployeeId) {
    const karyawan = await prisma.employee.findUnique({
      where: { id: input.assignedEmployeeId },
      select: { id: true },
    });
    if (!karyawan) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });
  }

  try {
    const akun = await prisma.whatsAppAccount.create({
      data: {
        id: generateULID(),
        ...input,
        // Selalu disimpan dalam bentuk baku, apa pun cara HR menuliskannya.
        phoneNumber: nomor,
      },
      select: accountSelect,
    });
    res.status(201).json(akun);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'Nomor WhatsApp ini sudah terdaftar' });
    }
    throw error;
  }
};

export const getAllAccounts = async (req: Request, res: Response) => {
  const { page, limit, sessionStatus, includeInactive } =
    req.query as unknown as ListAccountQuery;

  const where: Prisma.WhatsAppAccountWhereInput = {
    ...(includeInactive ? {} : { isActive: true }),
    ...(sessionStatus ? { sessionStatus } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.whatsAppAccount.count({ where }),
    prisma.whatsAppAccount.findMany({
      where,
      select: accountSelect,
      orderBy: { label: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data: rows.map((r) => ({ ...r, conversationCount: r._count.conversations, _count: undefined })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
};

export const updateAccount = async (req: Request, res: Response) => {
  const input = req.body as UpdateAccountInput;

  try {
    const akun = await prisma.whatsAppAccount.update({
      where: { id: req.params.id },
      data: input,
      select: accountSelect,
    });
    res.json(akun);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({ error: 'Nomor WhatsApp tidak ditemukan' });
    }
    throw error;
  }
};

// ============ Webhook Belly's ============

/**
 * Menerima kiriman dari Belly's.
 *
 * Dua hal yang dijaga di sini:
 *
 * 1. Ruang lingkup. Pesan yang tidak melibatkan nomor perusahaan terdaftar
 *    DITOLAK dan tidak disimpan sama sekali. Ini yang membedakan pemantauan
 *    kanal kerja dari pengarsipan komunikasi pribadi karyawan.
 *
 * 2. Pengiriman ganda. Belly's mengirim ulang saat jaringan gagal, jadi
 *    messageId dipakai sebagai kunci unik; kiriman kedua dijawab 200 tanpa
 *    menggandakan arsip. Menjawab error justru memicu percobaan ulang tanpa
 *    henti.
 */
export const handleBellysWebhook = async (req: Request, res: Response) => {
  const payload = req.body as BellysWebhookInput;

  if (payload.event === 'session') {
    const hasil = await applySessionEvent({
      phoneNumber: payload.phoneNumber,
      status: payload.status,
      occurredAt: payload.timestamp,
      note: payload.note,
    });

    if (hasil.status === 'nomor_tidak_valid') {
      return res.status(400).json({ error: 'Nomor tidak valid' });
    }
    if (hasil.status === 'nomor_tidak_terdaftar') {
      return res.status(404).json({
        error: 'Nomor ini tidak terdaftar sebagai nomor perusahaan',
        reason: 'not_company_number',
      });
    }

    return res.json({ accepted: true, event: 'session', status: payload.status });
  }

  const hasil = await ingestMessage({
    externalMessageId: payload.messageId,
    from: payload.from,
    to: payload.to,
    body: payload.body,
    type: payload.type,
    timestamp: payload.timestamp,
  });

  if (hasil.status === 'ditolak') {
    // 202: kiriman diterima dan sengaja tidak diarsipkan. Menjawab error
    // akan membuat pengirimnya mengulang pesan yang memang di luar lingkup.
    return res.status(202).json({
      accepted: false,
      reason: hasil.alasan,
      message: 'Pesan di luar ruang lingkup pemantauan, tidak diarsipkan',
    });
  }

  if (hasil.status === 'duplikat') {
    return res.json({ accepted: true, duplicate: true, conversationId: hasil.conversationId });
  }

  res.status(201).json({
    accepted: true,
    conversationId: hasil.conversationId,
    direction: hasil.direction,
  });
};

// ============ Arsip percakapan ============

const conversationSelect = {
  id: true,
  accountId: true,
  externalMessageId: true,
  senderWhatsappNumber: true,
  receiverWhatsappNumber: true,
  contactNumber: true,
  messageBody: true,
  messageType: true,
  timestamp: true,
  direction: true,
  employeeId: true,
  conversationTopic: true,
  account: { select: { id: true, label: true, phoneNumber: true } },
  relatedEmployee: { select: { id: true, nik: true, name: true } },
} satisfies Prisma.WhatsAppConversationSelect;

export const getConversations = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListConversationQuery;

  const where: Prisma.WhatsAppConversationWhereInput = {
    ...(query.accountId ? { accountId: query.accountId } : {}),
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(query.direction ? { direction: query.direction } : {}),
  };

  // Pelacakan isu. Isi pesan terenkripsi, jadi LIKE tidak mungkin: kata yang
  // dicari diubah menjadi HMAC yang sama seperti saat pesan disimpan, lalu
  // dicocokkan pada indeks buta. Beberapa kata berarti DAN, bukan ATAU.
  if (query.search) {
    const token = tokenizeText(query.search).map(blindIndex);
    if (token.length === 0) {
      // Yang dicari habis oleh tanda baca (misalnya "??"). hasEvery dengan
      // array kosong cocok dengan SEMUA baris, jadi harus dicegat di sini —
      // kalau tidak, pencarian tak berarti justru membuka seluruh arsip.
      return res.json({
        data: [],
        pagination: { page: query.page, limit: query.limit, total: 0, totalPages: 1 },
      });
    }
    where.searchTokens = { hasEvery: token };
  }

  if (query.contactNumber) {
    const nomor = normalizePhoneNumber(query.contactNumber);
    if (!nomor) return res.status(400).json({ error: 'Nomor kontak tidak valid' });
    where.contactNumber = nomor;
  }

  if (query.startDate || query.endDate) {
    where.timestamp = {
      ...(query.startDate ? { gte: query.startDate } : {}),
      ...(query.endDate
        ? { lt: new Date(query.endDate.getTime() + 24 * 60 * 60 * 1000) }
        : {}),
    };
  }

  const [total, data] = await Promise.all([
    prisma.whatsAppConversation.count({ where }),
    prisma.whatsAppConversation.findMany({
      where,
      select: conversationSelect,
      orderBy: { timestamp: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  res.json({
    // Token pencarian tidak pernah ikut keluar: tidak berguna bagi pembaca
    // dan hanya memperbesar permukaan kalau responsnya bocor.
    data: data.map((row) => ({ ...row, messageBody: decryptField(row.messageBody) })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit) || 1,
    },
  });
};

// ============ Retensi ============

/**
 * Menghapus arsip yang sudah lewat masa simpan.
 *
 * Bawaannya dry run. Ini penghapusan permanen atas data yang tidak bisa
 * dipulihkan dari mana pun, jadi yang menjalankan harus menyatakan
 * dryRun: false secara eksplisit setelah melihat berapa yang akan hilang.
 */
export const purgeExpiredConversations = async (req: Request, res: Response) => {
  const { dryRun } = req.body as PurgeInput;

  const batas = retentionCutoff(new Date(), env.WHATSAPP_RETENTION_DAYS);
  if (!batas) {
    return res.status(400).json({
      error:
        'Kebijakan retensi belum diatur. Setel WHATSAPP_RETENTION_DAYS lebih dulu, ' +
        'baru arsip boleh dihapus.',
    });
  }

  const ringkasan = { retentionDays: env.WHATSAPP_RETENTION_DAYS, cutoff: batas };

  if (dryRun) {
    const [percakapan, kejadian] = await Promise.all([
      prisma.whatsAppConversation.count({ where: { timestamp: { lt: batas } } }),
      prisma.whatsAppSessionEvent.count({ where: { occurredAt: { lt: batas } } }),
    ]);
    return res.json({
      dryRun: true,
      ...ringkasan,
      wouldDeleteConversations: percakapan,
      wouldDeleteSessionEvents: kejadian,
    });
  }

  const [percakapan, kejadian] = await prisma.$transaction([
    prisma.whatsAppConversation.deleteMany({ where: { timestamp: { lt: batas } } }),
    prisma.whatsAppSessionEvent.deleteMany({ where: { occurredAt: { lt: batas } } }),
  ]);

  res.json({
    dryRun: false,
    ...ringkasan,
    deletedConversations: percakapan.count,
    deletedSessionEvents: kejadian.count,
  });
};

// ============ Kejadian sesi ============

/**
 * Kejadian sesi yang perlu diberitahukan ke aplikasi mobile.
 *
 * Yang dikembalikan hanya kejadian untuk nomor yang dipegang pengguna sendiri,
 * kecuali HR yang melihat semuanya — pemberitahuan "sesi terputus, mohon scan
 * ulang" hanya berguna bagi pemegang nomornya.
 */
export const getSessionEvents = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListSessionEventQuery;
  const actor = req.user!;

  const where: Prisma.WhatsAppSessionEventWhereInput = {
    ...(query.accountId ? { accountId: query.accountId } : {}),
    ...(query.eventType ? { eventType: query.eventType } : {}),
    ...(query.unnotifiedOnly ? { notifiedAt: null } : {}),
  };

  if (!isHr(actor.role)) {
    where.account = { assignedEmployeeId: actor.id };
  }

  const [total, data] = await Promise.all([
    prisma.whatsAppSessionEvent.count({ where }),
    prisma.whatsAppSessionEvent.findMany({
      where,
      include: {
        account: { select: { id: true, label: true, phoneNumber: true, assignedEmployeeId: true } },
      },
      orderBy: { occurredAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  res.json({
    data,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit) || 1,
    },
  });
};

/** Menandai kejadian sudah diberitahukan, supaya tidak dikirim berulang. */
export const markEventsNotified = async (req: Request, res: Response) => {
  const { eventIds } = req.body as MarkNotifiedInput;

  const hasil = await prisma.whatsAppSessionEvent.updateMany({
    where: { id: { in: eventIds }, notifiedAt: null },
    data: { notifiedAt: new Date() },
  });

  res.json({ marked: hasil.count });
};

// ============ Sesi Baileys ============

const akunUntukSesi = async (id: string) =>
  prisma.whatsAppAccount.findUnique({
    where: { id },
    select: { id: true, phoneNumber: true, label: true, isActive: true, assignedEmployeeId: true },
  });

const driverMati = (res: Response) =>
  res.status(503).json({
    error: 'Driver WhatsApp tidak aktif. Setel WHATSAPP_BAILEYS_ENABLED=true untuk menyalakannya.',
  });

/**
 * Menyambungkan nomor perusahaan ke WhatsApp.
 *
 * Tidak mengembalikan QR secara langsung: QR baru muncul beberapa saat
 * setelah koneksi dibuka, jadi pemanggilnya menyambung lalu menanyakan
 * GET .../session sampai QR-nya ada.
 */
export const connectWhatsAppAccount = async (req: Request, res: Response) => {
  if (!env.WHATSAPP_BAILEYS_ENABLED) return driverMati(res);

  const akun = await akunUntukSesi(req.params.id);
  if (!akun) return res.status(404).json({ error: 'Nomor WhatsApp tidak ditemukan' });
  if (!akun.isActive) {
    return res.status(409).json({ error: 'Nomor ini nonaktif. Aktifkan dulu sebelum disambungkan.' });
  }

  const sesi = await connectAccount(akun.id, akun.phoneNumber);
  res.status(202).json({ ...sesi, label: akun.label });
};

/**
 * Keadaan sesi berikut QR-nya kalau sedang menunggu scan.
 *
 * Boleh dilihat pemegang nomornya sendiri, bukan hanya HR: yang harus
 * memindai QR dengan ponsel perusahaan adalah dia.
 */
export const getWhatsAppSession = async (req: Request, res: Response) => {
  const actor = req.user!;

  const akun = await akunUntukSesi(req.params.id);
  if (!akun) return res.status(404).json({ error: 'Nomor WhatsApp tidak ditemukan' });

  if (!isHr(actor.role) && akun.assignedEmployeeId !== actor.id) {
    return res.status(403).json({ error: 'Anda bukan pemegang nomor ini' });
  }

  if (!env.WHATSAPP_BAILEYS_ENABLED) return driverMati(res);

  const sesi = getSession(akun.id);
  if (!sesi) {
    return res.json({
      accountId: akun.id,
      phoneNumber: akun.phoneNumber,
      label: akun.label,
      status: 'disconnected',
      qrTersedia: false,
      qr: null,
      catatan: 'Sesi belum pernah dibuka di proses ini.',
    });
  }

  const qr = getQrString(akun.id);

  res.json({
    ...sesi,
    label: akun.label,
    // QR dikirim sebagai gambar data URL supaya bisa langsung ditampilkan
    // di web maupun aplikasi mobile tanpa pustaka tambahan.
    qr: qr ? await toDataURL(qr) : null,
  });
};

export const disconnectWhatsAppAccount = async (req: Request, res: Response) => {
  if (!env.WHATSAPP_BAILEYS_ENABLED) return driverMati(res);

  const { logout } = req.body as DisconnectInput;

  const akun = await akunUntukSesi(req.params.id);
  if (!akun) return res.status(404).json({ error: 'Nomor WhatsApp tidak ditemukan' });

  const sesi = await disconnectAccount(akun.id, { logout });
  if (!sesi) return res.status(409).json({ error: 'Tidak ada sesi aktif untuk nomor ini' });

  res.json({ ...sesi, label: akun.label });
};
