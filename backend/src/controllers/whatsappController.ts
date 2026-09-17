// src/controllers/whatsappController.ts
import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import { normalizePhoneNumber, resolveScope } from '../utils/whatsappRules';
import type {
  CreateAccountInput,
  UpdateAccountInput,
  ListAccountQuery,
  BellysWebhookInput,
  ListConversationQuery,
  ListSessionEventQuery,
  MarkNotifiedInput,
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
    const nomor = normalizePhoneNumber(payload.phoneNumber);
    if (!nomor) return res.status(400).json({ error: 'Nomor tidak valid' });

    const akun = await prisma.whatsAppAccount.findUnique({ where: { phoneNumber: nomor } });
    if (!akun) {
      return res.status(404).json({
        error: 'Nomor ini tidak terdaftar sebagai nomor perusahaan',
        reason: 'not_company_number',
      });
    }

    const waktu = payload.timestamp ?? new Date();

    await prisma.$transaction([
      prisma.whatsAppSessionEvent.create({
        data: {
          id: generateULID(),
          accountId: akun.id,
          eventType: payload.status,
          occurredAt: waktu,
          note: payload.note,
        },
      }),
      prisma.whatsAppAccount.update({
        where: { id: akun.id },
        data: {
          sessionStatus: payload.status === 'connected' ? 'connected' : payload.status === 'disconnected' ? 'disconnected' : 'pending_scan',
          ...(payload.status === 'connected' ? { lastConnectedAt: waktu } : {}),
          ...(payload.status === 'disconnected' ? { lastDisconnectedAt: waktu } : {}),
        },
      }),
    ]);

    return res.json({ accepted: true, event: 'session', status: payload.status });
  }

  // event === 'message'
  const akunAktif = await prisma.whatsAppAccount.findMany({
    where: { isActive: true },
    select: { id: true, phoneNumber: true, assignedEmployeeId: true },
  });

  const lingkup = resolveScope({
    from: payload.from,
    to: payload.to,
    companyNumbers: new Set(akunAktif.map((a) => a.phoneNumber)),
  });

  if (!lingkup.allowed) {
    // 202: kiriman diterima dan sengaja tidak diarsipkan. Menjawab error
    // akan membuat Belly's mengirim ulang pesan yang memang di luar lingkup.
    return res.status(202).json({
      accepted: false,
      reason: lingkup.rejection,
      message: 'Pesan di luar ruang lingkup pemantauan, tidak diarsipkan',
    });
  }

  const akun = akunAktif.find((a) => a.phoneNumber === lingkup.companyNumber)!;

  try {
    const percakapan = await prisma.whatsAppConversation.create({
      data: {
        id: generateULID(),
        accountId: akun.id,
        externalMessageId: payload.messageId,
        senderWhatsappNumber: normalizePhoneNumber(payload.from)!,
        receiverWhatsappNumber: normalizePhoneNumber(payload.to)!,
        contactNumber: lingkup.contactNumber!,
        messageBody: payload.body,
        messageType: payload.type,
        timestamp: payload.timestamp,
        direction: lingkup.direction!,
        // Disalin saat pesan masuk: nomor bisa berpindah tangan, dan arsip
        // lama harus tetap menunjuk pemegang yang benar saat itu.
        employeeId: akun.assignedEmployeeId,
      },
      select: { id: true, direction: true, timestamp: true },
    });

    res.status(201).json({ accepted: true, conversationId: percakapan.id, direction: percakapan.direction });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const ada = await prisma.whatsAppConversation.findUnique({
        where: { externalMessageId: payload.messageId },
        select: { id: true },
      });
      return res.json({ accepted: true, duplicate: true, conversationId: ada?.id });
    }
    throw error;
  }
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
    // Pelacakan isu: pencarian isi pesan.
    ...(query.search ? { messageBody: { contains: query.search, mode: 'insensitive' } } : {}),
  };

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
    data,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit) || 1,
    },
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
