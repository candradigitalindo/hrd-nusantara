// src/controllers/whatsappController.ts
import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import { normalizePhoneNumber, resolveScope } from '../utils/whatsappRules';
import { decryptField, tokenizeText, blindIndex } from '../utils/fieldCrypto';
import { retentionCutoff } from '../utils/whatsappRetention';
import { lokasiMediaWhatsApp, namaUnduhanMedia, GalatMediaWhatsApp } from '../utils/whatsappMedia';
import fs from 'fs/promises';
import { DateTime } from 'luxon';
import { ingestMessage, applySessionEvent } from '../services/whatsapp/ingest';
import { connectAccount, disconnectAccount, getSession, getQrString, listGroups, statusEfektif, tarikRiwayat, GalatSesiWhatsApp } from '../services/whatsapp/session';
import { kirimKeKaryawan } from '../services/notification/push';
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
  TarikRiwayatInput,
  ListThreadQuery,
  ComplianceQuery,
  RemindInput,
  AttendanceGroupInput,
} from '../schemas/whatsappSchema';

const isHr = (role: Role) => role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;

// ============ Nomor perusahaan ============

const accountSelect = {
  id: true,
  phoneNumber: true,
  kind: true,
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
  const { page, limit, sessionStatus, includeInactive, kind } =
    req.query as unknown as ListAccountQuery;

  const where: Prisma.WhatsAppAccountWhereInput = {
    ...(includeInactive ? {} : { isActive: true }),
    ...(sessionStatus ? { sessionStatus } : {}),
    ...(kind ? { kind } : {}),
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
  groupJid: true,
  groupName: true,
  participantNumber: true,
  mediaPath: true,
  mediaMimeType: true,
  mediaSizeBytes: true,
  mediaFileName: true,
  mediaStatus: true,
  account: { select: { id: true, label: true, phoneNumber: true } },
  relatedEmployee: { select: { id: true, nik: true, name: true } },
} satisfies Prisma.WhatsAppConversationSelect;

type ConversationRow = Prisma.WhatsAppConversationGetPayload<{ select: typeof conversationSelect }>;

/**
 * Lokasi berkas tidak pernah ikut keluar — yang dikirim hanya penanda bahwa
 * berkasnya ada. Membukanya lewat GET /whatsapp/conversations/:id/media,
 * yang memeriksa peran dan mencatat siapa membuka apa.
 */
const conversationDTO = ({ mediaPath, messageBody, ...row }: ConversationRow) => ({
  ...row,
  messageBody: decryptField(messageBody),
  mediaTersedia: mediaPath !== null,
});

/**
 * Percakapan grup dan berkas medianya hanya untuk Super Admin.
 *
 * Grup memuat pesan orang-orang yang tidak memegang nomor perusahaan sama
 * sekali, dan berkas media memuat wajah serta suara mereka. Membukanya untuk
 * seluruh pemegang izin whatsapp.lihat berarti memperluas akses jauh melebihi
 * yang diputuskan; kalau HR memang perlu, itu keputusan tersendiri.
 */
const bolehSeluruhIsi = (role: Role) => role === Role.SUPER_ADMIN;

export const getConversations = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListConversationQuery;

  const where: Prisma.WhatsAppConversationWhereInput = {
    ...(query.accountId ? { accountId: query.accountId } : {}),
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(query.direction ? { direction: query.direction } : {}),
    ...(bolehSeluruhIsi(req.user!.role) ? {} : { groupJid: null }),
    ...(query.groupJid ? { groupJid: query.groupJid } : {}),
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

  // Arsip ini memuat percakapan pelanggan dan tamu yang tidak pernah menjadi
  // bagian dari perusahaan. Siapa membaca apa, dan dengan penyaring apa,
  // harus bisa dijawab saat diaudit — itu inti pertanggungjawaban UU PDP.
  res.locals.audit = {
    action: 'whatsapp.conversations.read',
    entity: 'WhatsAppConversation',
    summary: `Membaca ${data.length} percakapan dari ${total} hasil`,
    metadata: {
      penyaring: {
        accountId: query.accountId,
        employeeId: query.employeeId,
        contactNumber: query.contactNumber,
        direction: query.direction,
        pencarian: query.search,
        startDate: query.startDate,
        endDate: query.endDate,
      },
      total,
    },
  };

  res.json({
    // Token pencarian tidak pernah ikut keluar: tidak berguna bagi pembaca
    // dan hanya memperbesar permukaan kalau responsnya bocor.
    data: data.map(conversationDTO),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit) || 1,
    },
  });
};

// ============ Utas percakapan ============

/**
 * Pencarian satu kotak: yang tampak seperti nomor dicocokkan ke nomor kontak,
 * selain itu dicari sebagai kata di dalam isi pesan lewat indeks buta.
 * Mengembalikan null bila yang dicari habis oleh tanda baca — pencarian
 * seperti itu tidak boleh diam-diam berubah menjadi "tampilkan semua".
 */
const saringanCari = (q: string | undefined): Prisma.WhatsAppConversationWhereInput | null => {
  const teks = q?.trim();
  if (!teks) return {};

  const angka = teks.replace(/[\s+\-()]/g, '');
  if (/^\d{4,}$/.test(angka)) {
    // 0812… ditulis orang, 62812… yang tersimpan: keduanya harus ketemu.
    const inti = angka.startsWith('0') ? angka.slice(1) : angka.startsWith('62') ? angka.slice(2) : angka;
    return { contactNumber: { contains: inti } };
  }

  const token = tokenizeText(teks).map(blindIndex);
  if (token.length === 0) return null;
  return { searchTokens: { hasEvery: token } };
};

/**
 * Daftar utas: satu baris per lawan bicara atau grup, per nomor yang
 * dipantau, diurutkan dari yang paling baru bergerak.
 *
 * Arsip yang ditampilkan sebagai deretan pesan lepas sulit diikuti — pesan
 * dari lima pelanggan bercampur jadi satu. Utas mengembalikan bentuk yang
 * dikenal semua orang dari WhatsApp itu sendiri.
 */
export const getThreads = async (req: Request, res: Response) => {
  const { page, limit, accountId, q } = req.query as unknown as ListThreadQuery;

  const cari = saringanCari(q);
  if (cari === null) {
    return res.json({ data: [], pagination: { page, limit, total: 0, totalPages: 1 } });
  }

  const where: Prisma.WhatsAppConversationWhereInput = {
    ...(accountId ? { accountId } : {}),
    ...(bolehSeluruhIsi(req.user!.role) ? {} : { groupJid: null }),
    ...cari,
  };

  const semuaUtas = await prisma.whatsAppConversation.groupBy({
    by: ['accountId', 'contactNumber', 'groupJid'],
    where,
    _count: { _all: true },
    _max: { timestamp: true },
    orderBy: { _max: { timestamp: 'desc' } },
  });

  const halaman = semuaUtas.slice((page - 1) * limit, page * limit);

  const data = await Promise.all(
    halaman.map(async (u) => {
      const terakhir = await prisma.whatsAppConversation.findFirst({
        where: { ...where, accountId: u.accountId, contactNumber: u.contactNumber, groupJid: u.groupJid },
        orderBy: { timestamp: 'desc' },
        select: {
          messageBody: true,
          messageType: true,
          direction: true,
          timestamp: true,
          groupName: true,
          participantNumber: true,
          mediaPath: true,
          account: { select: { id: true, label: true, phoneNumber: true, kind: true } },
          relatedEmployee: { select: { id: true, nik: true, name: true } },
        },
      });

      const isi = terakhir ? decryptField(terakhir.messageBody) : '';
      return {
        kunci: `${u.accountId}:${u.groupJid ?? u.contactNumber}`,
        accountId: u.accountId,
        contactNumber: u.contactNumber,
        groupJid: u.groupJid,
        groupName: terakhir?.groupName ?? null,
        jumlahPesan: u._count._all,
        account: terakhir?.account ?? null,
        relatedEmployee: terakhir?.relatedEmployee ?? null,
        pesanTerakhir: terakhir
          ? {
              // Cuplikan, bukan isi utuh: daftar utas tidak perlu memuat
              // seluruh pesan panjang hanya untuk satu baris pratinjau.
              cuplikan: isi.length > 140 ? `${isi.slice(0, 140)}…` : isi,
              messageType: terakhir.messageType,
              direction: terakhir.direction,
              timestamp: terakhir.timestamp,
              participantNumber: terakhir.participantNumber,
              adaBerkas: terakhir.mediaPath !== null,
            }
          : null,
      };
    })
  );

  res.locals.audit = {
    action: 'whatsapp.threads.read',
    entity: 'WhatsAppConversation',
    summary: `Membaca daftar ${data.length} utas dari ${semuaUtas.length}`,
    metadata: { accountId, pencarian: q, total: semuaUtas.length },
  };

  res.json({
    data,
    pagination: { page, limit, total: semuaUtas.length, totalPages: Math.ceil(semuaUtas.length / limit) || 1 },
  });
};

/**
 * Angka ringkas untuk kepala halaman: seberapa aktif arsip ini sebenarnya.
 *
 * "Pesan terakhir" adalah angka yang paling cepat membuka masalah: nomor
 * yang tercatat tersambung tapi tidak menerima apa pun berhari-hari hampir
 * pasti sudah tidak benar-benar terpantau.
 */
export const getRingkasan = async (req: Request, res: Response) => {
  const gerbang: Prisma.WhatsAppConversationWhereInput = bolehSeluruhIsi(req.user!.role) ? {} : { groupJid: null };
  const awalHariIni = DateTime.now().setZone(env.APP_TIMEZONE).startOf('day').toJSDate();
  const tujuhHari = DateTime.now().setZone(env.APP_TIMEZONE).startOf('day').minus({ days: 6 }).toJSDate();

  const [hariIni, pekanIni, total, terakhir] = await Promise.all([
    prisma.whatsAppConversation.count({ where: { ...gerbang, timestamp: { gte: awalHariIni } } }),
    prisma.whatsAppConversation.count({ where: { ...gerbang, timestamp: { gte: tujuhHari } } }),
    prisma.whatsAppConversation.count({ where: gerbang }),
    prisma.whatsAppConversation.findFirst({ where: gerbang, orderBy: { timestamp: 'desc' }, select: { timestamp: true } }),
  ]);

  res.json({
    pesanHariIni: hariIni,
    pesanTujuhHari: pekanIni,
    totalPesan: total,
    pesanTerakhir: terakhir?.timestamp ?? null,
  });
};

/**
 * Tipe yang boleh disajikan apa adanya. Sisanya dikirim sebagai unduhan
 * biasa: berkas dari luar tidak boleh dijalankan peramban sebagai halaman.
 */
const TIPE_AMAN = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|3gpp|quicktime)|audio\/(ogg|opus|mpeg|mp4|aac|amr)|application\/pdf)$/;

/**
 * Membuka berkas media sebuah pesan: foto, video, pesan suara, dokumen.
 *
 * Hanya Super Admin, dan selalu tercatat — ini membuka isi komunikasi orang,
 * termasuk pihak ketiga yang tidak pernah bekerja di perusahaan ini.
 */
export const getConversationMedia = async (req: Request, res: Response) => {
  if (!bolehSeluruhIsi(req.user!.role)) {
    return res.status(403).json({ error: 'Hanya Super Admin yang bisa membuka berkas media' });
  }

  const pesan = await prisma.whatsAppConversation.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      mediaPath: true,
      mediaMimeType: true,
      mediaFileName: true,
      mediaStatus: true,
      messageType: true,
      timestamp: true,
      contactNumber: true,
      groupName: true,
    },
  });

  if (!pesan) return res.status(404).json({ error: 'Pesan tidak ditemukan' });
  if (!pesan.mediaPath) {
    // Dibedakan supaya yang membuka tahu ini bukan kesalahan sistem:
    // berkasnya memang tidak pernah tersimpan, dan alasannya disebut.
    const alasan =
      pesan.mediaStatus === 'terlalu_besar'
        ? 'Berkas melewati batas ukuran, jadi tidak ikut disimpan'
        : pesan.mediaStatus === 'gagal'
          ? 'Berkas gagal diunduh dari WhatsApp saat pesan ini tiba'
          : 'Pesan ini tidak punya berkas media';
    return res.status(404).json({ error: alasan, mediaStatus: pesan.mediaStatus });
  }

  let lokasi: string;
  try {
    lokasi = lokasiMediaWhatsApp(pesan.mediaPath);
    await fs.access(lokasi);
  } catch (error) {
    if (error instanceof GalatMediaWhatsApp) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Berkas tidak ditemukan di penyimpanan' });
  }

  res.locals.audit = {
    action: 'whatsapp.media.buka',
    entity: 'WhatsAppConversation',
    entityId: pesan.id,
    summary: `Membuka ${pesan.messageType} dari ${pesan.groupName ? `grup ${pesan.groupName}` : `+${pesan.contactNumber}`}`,
  };

  const tipe = (pesan.mediaMimeType ?? '').split(';')[0].trim().toLowerCase();
  const aman = TIPE_AMAN.test(tipe);
  const nama = namaUnduhanMedia(pesan.mediaFileName, pesan.mediaMimeType, pesan.timestamp);

  // sendFile, bukan send(buffer): video panjang perlu permintaan Range supaya
  // bisa digeser tanpa mengunduh ulang seluruh berkas.
  res.sendFile(lokasi, {
    headers: {
      'Content-Type': aman ? tipe : 'application/octet-stream',
      'Content-Disposition': `${aman ? 'inline' : 'attachment'}; filename="${nama}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
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
    res.locals.audit = {
      action: 'whatsapp.retention.purge',
      entity: 'WhatsAppConversation',
      summary: `Simulasi hapus: ${percakapan} percakapan akan terhapus`,
      metadata: { dryRun: true, ...ringkasan, akanTerhapus: percakapan },
    };

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

  // Penghapusan permanen atas data yang tidak bisa dipulihkan dari mana pun.
  // Kalau satu jejak saja harus ada di tabel ini, ini orangnya.
  res.locals.audit = {
    action: 'whatsapp.retention.purge',
    entity: 'WhatsAppConversation',
    summary: `MENGHAPUS PERMANEN ${percakapan.count} percakapan dan ${kejadian.count} kejadian sesi`,
    metadata: {
      dryRun: false,
      ...ringkasan,
      terhapusPercakapan: percakapan.count,
      terhapusKejadianSesi: kejadian.count,
    },
  };

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

  res.locals.audit = {
    action: 'whatsapp.session.connect',
    entity: 'WhatsAppAccount',
    entityId: akun.id,
    summary: `Membuka sesi WhatsApp untuk ${akun.label}`,
    metadata: { phoneNumber: akun.phoneNumber, status: sesi.status },
  };

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

  res.locals.audit = {
    action: 'whatsapp.session.disconnect',
    entity: 'WhatsAppAccount',
    entityId: akun.id,
    summary: logout
      ? `Logout sesi ${akun.label} — pemegang nomor harus scan QR ulang`
      : `Memutus sementara sesi ${akun.label}`,
    metadata: { phoneNumber: akun.phoneNumber, logout },
  };

  res.json({ ...sesi, label: akun.label });
};

/**
 * Menarik percakapan lama sebuah nomor, atas permintaan.
 *
 * WhatsApp tidak mengirimkan riwayat sebelum nomornya dipantau, dan itu
 * memang bawaannya di sini: yang diarsipkan hanya percakapan sejak
 * pemantauan berjalan. Kalau Super Admin menilai ada yang perlu ditarik,
 * ini pintunya — satu permintaan, untuk satu nomor, tercatat di jejak audit.
 */
export const tarikRiwayatAkun = async (req: Request, res: Response) => {
  if (!bolehSeluruhIsi(req.user!.role)) {
    return res.status(403).json({ error: 'Hanya Super Admin yang bisa menarik percakapan lama' });
  }
  if (!env.WHATSAPP_BAILEYS_ENABLED) return driverMati(res);

  const { jumlah, contactNumber } = req.body as TarikRiwayatInput;

  const akun = await akunUntukSesi(req.params.id);
  if (!akun) return res.status(404).json({ error: 'Nomor WhatsApp tidak ditemukan' });

  const nomor = contactNumber ? normalizePhoneNumber(contactNumber) : undefined;
  if (contactNumber && !nomor) return res.status(400).json({ error: 'Nomor kontak tidak valid' });

  try {
    const hasil = await tarikRiwayat(akun.id, { jumlah, contactNumber: nomor ?? undefined });

    res.locals.audit = {
      action: 'whatsapp.riwayat.tarik',
      entity: 'WhatsAppAccount',
      entityId: akun.id,
      summary: `Menarik ${jumlah} pesan lama dari ${hasil.percakapan} percakapan pada ${akun.label}`,
      metadata: { phoneNumber: akun.phoneNumber, jumlah, contactNumber: nomor ?? null },
    };

    res.json({
      ...hasil,
      label: akun.label,
      // Jawaban WhatsApp datang belakangan lewat koneksi yang sama, jadi
      // halaman arsip perlu dibuka lagi beberapa saat kemudian.
      catatan:
        'Permintaan terkirim. WhatsApp mengirim pesannya secara bertahap, jadi arsip terisi beberapa saat lagi. Berkas media yang sudah lama biasanya tidak bisa diunduh lagi.',
    });
  } catch (error) {
    if (error instanceof GalatSesiWhatsApp) {
      return res.status(409).json({ error: error.message, kode: error.kode });
    }
    throw error;
  }
};

// ============ WhatsApp pribadi karyawan (wajib) ============
//
// Dokumen fitur: "semua pesan teks WhatsApp dari karyawan yang terdaftar
// disinkronkan ke sistem pusat", dan bila sesinya putus karyawan wajib scan
// ulang di aplikasi. Karyawan menautkan nomornya sendiri dari aplikasi
// mobile; akunnya dibuat otomatis, nomornya diketahui setelah QR dipindai.

const STATUS_AKTIF_KARYAWAN = { notIn: ['resign', 'terminated', 'inactive'] };

const akunPribadi = (employeeId: string) =>
  prisma.whatsAppAccount.findFirst({
    where: { kind: 'personal', assignedEmployeeId: employeeId },
    orderBy: { createdAt: 'desc' },
  });

type AkunPribadi = NonNullable<Awaited<ReturnType<typeof akunPribadi>>>;

const ringkasSaya = async (akun: AkunPribadi | null) => {
  const driverAktif = env.WHATSAPP_BAILEYS_ENABLED;
  if (!akun) return { status: 'never_linked', driverAktif, account: null, session: null, qr: null, catatan: null };

  const sesi = driverAktif ? getSession(akun.id) : null;
  const qr = sesi?.qrTersedia ? getQrString(akun.id) : null;
  return {
    status: statusEfektif(akun, sesi),
    driverAktif,
    account: {
      id: akun.id,
      kind: akun.kind,
      label: akun.label,
      phoneNumber: akun.phoneNumber,
      sessionStatus: akun.sessionStatus,
      lastConnectedAt: akun.lastConnectedAt,
      lastDisconnectedAt: akun.lastDisconnectedAt,
      isActive: akun.isActive,
      attendanceGroup: akun.attendanceGroupJid ? { jid: akun.attendanceGroupJid, name: akun.attendanceGroupName } : null,
    },
    session: sesi,
    qr: qr ? await toDataURL(qr) : null,
    catatan: sesi?.catatan ?? null,
  };
};

/** Keadaan tautan WhatsApp milik pengguna yang login. */
export const getMyWhatsApp = async (req: Request, res: Response) => {
  res.json(await ringkasSaya(await akunPribadi(req.user!.id)));
};

/**
 * Karyawan menautkan (atau menautkan ulang) WhatsApp-nya sendiri.
 * Setelah 202, klien mem-poll GET /whatsapp/me sampai `qr` terisi, lalu
 * sampai status menjadi connected.
 */
export const connectMyWhatsApp = async (req: Request, res: Response) => {
  if (!env.WHATSAPP_BAILEYS_ENABLED) return driverMati(res);
  const actor = req.user!;

  let akun = await akunPribadi(actor.id);
  if (akun && !akun.isActive) {
    return res.status(409).json({ error: 'Tautan WhatsApp Anda dinonaktifkan oleh HR. Hubungi HR.' });
  }

  if (!akun) {
    const karyawan = await prisma.employee.findUnique({
      where: { id: actor.id },
      select: { name: true, departmentId: true },
    });
    akun = await prisma.whatsAppAccount.create({
      data: {
        id: generateULID(),
        kind: 'personal',
        label: karyawan?.name ?? 'Karyawan',
        phoneNumber: null,
        assignedEmployeeId: actor.id,
        departmentId: karyawan?.departmentId ?? null,
      },
    });
  }

  await connectAccount(akun.id, akun.phoneNumber);

  res.locals.audit = {
    action: 'whatsapp.session.connect',
    entity: 'WhatsAppAccount',
    entityId: akun.id,
    summary: `${akun.label} menautkan WhatsApp pribadinya`,
    metadata: { kind: 'personal', phoneNumber: akun.phoneNumber },
  };

  res.status(202).json(await ringkasSaya(akun));
};

const daftarKepatuhan = async (departmentId?: string) => {
  const karyawan = await prisma.employee.findMany({
    where: { status: STATUS_AKTIF_KARYAWAN, ...(departmentId ? { departmentId } : {}) },
    select: {
      id: true,
      nik: true,
      name: true,
      department: { select: { id: true, name: true } },
      whatsappAccounts: {
        where: { kind: 'personal', isActive: true },
        select: { id: true, phoneNumber: true, sessionStatus: true, lastConnectedAt: true, lastDisconnectedAt: true, attendanceGroupName: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { name: 'asc' },
  });

  return karyawan.map((k) => {
    const a = k.whatsappAccounts[0];
    return {
      employee: { id: k.id, nik: k.nik, name: k.name, department: k.department },
      // Kolom tersimpan bisa basi: 'pending_scan' yang tertinggal setelah
      // restart akan terhitung "menunggu scan" di ringkasan HR selamanya.
      status: a ? statusEfektif({ ...a, isActive: true }, getSession(a.id)) : 'never_linked',
      accountId: a?.id ?? null,
      phoneNumber: a?.phoneNumber ?? null,
      lastConnectedAt: a?.lastConnectedAt ?? null,
      lastDisconnectedAt: a?.lastDisconnectedAt ?? null,
      attendanceGroupName: a?.attendanceGroupName ?? null,
    };
  });
};

// ============ Grup tujuan foto absensi ============

const tanpaSesi = (res: Response, error: unknown) => {
  if (error instanceof GalatSesiWhatsApp) {
    return res.status(409).json({
      error:
        error.kode === 'tidak_tersambung'
          ? 'WhatsApp belum tersambung. Pindai QR dulu, lalu muat ulang daftar grup.'
          : error.message,
    });
  }
  throw error;
};

/** Grup yang diikuti WhatsApp pengguna, untuk memilih tujuan foto absensi. */
export const getMyGroups = async (req: Request, res: Response) => {
  if (!env.WHATSAPP_BAILEYS_ENABLED) return driverMati(res);
  const akun = await akunPribadi(req.user!.id);
  if (!akun) return res.status(409).json({ error: 'WhatsApp belum ditautkan' });
  try {
    res.json({ data: await listGroups(akun.id), terpilih: akun.attendanceGroupJid });
  } catch (error) {
    return tanpaSesi(res, error);
  }
};

/**
 * Memilih grup tujuan. Grupnya diperiksa benar-benar diikuti nomor ini —
 * JID yang diketik bebas bisa mengirim foto karyawan ke grup orang lain.
 */
export const setMyAttendanceGroup = async (req: Request, res: Response) => {
  const { jid } = req.body as AttendanceGroupInput;
  const actor = req.user!;
  const akun = await akunPribadi(actor.id);
  if (!akun) return res.status(409).json({ error: 'WhatsApp belum ditautkan' });

  let nama: string | null = null;
  if (jid !== null) {
    if (!env.WHATSAPP_BAILEYS_ENABLED) return driverMati(res);
    let grup;
    try {
      grup = await listGroups(akun.id);
    } catch (error) {
      return tanpaSesi(res, error);
    }
    const pilih = grup.find((g) => g.jid === jid);
    if (!pilih) return res.status(404).json({ error: 'Grup tidak ditemukan di WhatsApp Anda. Muat ulang daftar grup.' });
    nama = pilih.nama;
  }

  const diperbarui = await prisma.whatsAppAccount.update({
    where: { id: akun.id },
    data: { attendanceGroupJid: jid, attendanceGroupName: nama },
  });

  res.locals.audit = {
    action: 'whatsapp.attendance_group.set',
    entity: 'WhatsAppAccount',
    entityId: akun.id,
    summary: jid ? `Grup foto absensi: ${nama}` : 'Berhenti mengirim foto absensi ke grup',
    metadata: { jid, nama },
  };

  res.json(await ringkasSaya(diperbarui));
};

/** HR: siapa yang sudah, belum, atau putus — kewajiban ini harus terlihat, bukan diasumsikan. */
export const getCompliance = async (req: Request, res: Response) => {
  const { departmentId } = req.query as unknown as ComplianceQuery;
  const data = await daftarKepatuhan(departmentId);
  const hitung = (status: string) => data.filter((d) => d.status === status).length;

  res.json({
    data,
    summary: {
      total: data.length,
      connected: hitung('connected'),
      disconnected: hitung('disconnected'),
      pendingScan: hitung('pending_scan'),
      neverLinked: hitung('never_linked'),
    },
  });
};

/** HR: kirim pengingat push ke karyawan yang WhatsApp-nya belum tersambung. */
export const remindCompliance = async (req: Request, res: Response) => {
  const { employeeIds } = req.body as RemindInput;
  const semua = await daftarKepatuhan();
  const sasaran = semua.filter(
    (d) => d.status !== 'connected' && (!employeeIds || employeeIds.includes(d.employee.id))
  );

  let terkirim = 0;
  for (const d of sasaran) {
    const hasil = await kirimKeKaryawan(d.employee.id, {
      title: 'Sambungkan WhatsApp Anda',
      body:
        d.status === 'never_linked'
          ? 'Perusahaan mewajibkan WhatsApp tersambung ke aplikasi HRD. Buka menu WhatsApp dan pindai QR.'
          : 'Sesi WhatsApp Anda terputus. Buka menu WhatsApp dan pindai ulang QR.',
      data: { jenis: 'whatsapp_session', eventType: 'link_required' },
    });
    if (hasil.terkirim > 0) terkirim += 1;
  }

  res.locals.audit = {
    action: 'whatsapp.compliance.remind',
    entity: 'WhatsAppAccount',
    summary: `Mengingatkan ${sasaran.length} karyawan untuk menautkan WhatsApp`,
    metadata: { diminta: sasaran.length, terkirim },
  };

  res.json({ diminta: sasaran.length, terkirim });
};
