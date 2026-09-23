// src/controllers/communicationController.ts
import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import { pasanganTeks } from '../utils/richText';
import {
  isTargeted,
  validateAnswers,
  aggregateAnswers,
  SurveyAnswerError,
  type QuestionSpec,
  type QuestionType,
} from '../utils/communicationRules';
import type {
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
  ChangeAnnouncementStatusInput,
  ListAnnouncementQuery,
  MarkReadInput,
  CreateSurveyInput,
  ChangeSurveyStatusInput,
  SubmitSurveyInput,
  ListSurveyQuery,
  CreateRoomInput,
  AddMemberInput,
  SendMessageInput,
  ListMessageQuery,
} from '../schemas/communicationSchema';

const isHr = (role: Role) => role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;

// ============ Pengumuman ============

const announcementSelect = {
  id: true,
  title: true,
  content: true,
  contentHtml: true,
  authorId: true,
  status: true,
  priority: true,
  publishDate: true,
  publishedAt: true,
  expiresAt: true,
  targetDepartmentId: true,
  requiresAcknowledgment: true,
  createdAt: true,
  author: { select: { id: true, name: true } },
  _count: { select: { reads: true } },
} satisfies Prisma.AnnouncementSelect;

export const createAnnouncement = async (req: Request, res: Response) => {
  const input = req.body as CreateAnnouncementInput;

  if (input.targetDepartmentId) {
    const dept = await prisma.department.findUnique({
      where: { id: input.targetDepartmentId },
      select: { id: true },
    });
    if (!dept) return res.status(404).json({ error: 'Departemen sasaran tidak ditemukan' });
  }

  const isi = pasanganTeks(input.contentHtml, input.content);
  if (!isi || isi.teks.trim() === '') return res.status(400).json({ error: 'Isi pengumuman wajib diisi' });

  const pengumuman = await prisma.announcement.create({
    data: {
      id: generateULID(),
      ...input,
      content: isi.teks,
      contentHtml: isi.html,
      targetDepartmentId: input.targetDepartmentId ?? null,
      expiresAt: input.expiresAt ?? null,
      authorId: req.user!.id,
      // Draft dulu: menyimpan tidak sama dengan menayangkan.
      status: 'draft',
    },
    select: announcementSelect,
  });

  res.status(201).json(pengumuman);
};

export const updateAnnouncement = async (req: Request, res: Response) => {
  const input = req.body as UpdateAnnouncementInput;

  const pengumuman = await prisma.announcement.findUnique({
    where: { id: req.params.id },
    select: { id: true, status: true },
  });
  if (!pengumuman) return res.status(404).json({ error: 'Pengumuman tidak ditemukan' });

  // Pengumuman yang sudah tayang tidak disunting diam-diam: karyawan yang
  // sudah membacanya akan menyimpan isi yang berbeda dari yang tercatat.
  if (pengumuman.status !== 'draft') {
    return res.status(409).json({
      error: `Pengumuman berstatus "${pengumuman.status}" tidak bisa disunting. Arsipkan lalu buat yang baru.`,
    });
  }

  const isi = pasanganTeks(input.contentHtml, input.content);

  const diperbarui = await prisma.announcement.update({
    where: { id: pengumuman.id },
    data: { ...input, ...(isi && { content: isi.teks, contentHtml: isi.html }) },
    select: announcementSelect,
  });

  res.json(diperbarui);
};

export const changeAnnouncementStatus = async (req: Request, res: Response) => {
  const { status } = req.body as ChangeAnnouncementStatusInput;

  const pengumuman = await prisma.announcement.findUnique({
    where: { id: req.params.id },
    select: { id: true, status: true },
  });
  if (!pengumuman) return res.status(404).json({ error: 'Pengumuman tidak ditemukan' });

  if (pengumuman.status === status) {
    return res.status(409).json({ error: `Pengumuman sudah berstatus "${status}"` });
  }
  if (pengumuman.status === 'archived') {
    return res.status(409).json({ error: 'Pengumuman yang diarsipkan tidak bisa ditayangkan lagi' });
  }

  const diperbarui = await prisma.announcement.update({
    where: { id: pengumuman.id },
    data: {
      status,
      ...(status === 'published' ? { publishedAt: new Date() } : {}),
    },
    select: announcementSelect,
  });

  res.json(diperbarui);
};

export const getAllAnnouncements = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListAnnouncementQuery;
  const actor = req.user!;

  const where: Prisma.AnnouncementWhereInput = {
    ...(query.priority ? { priority: query.priority } : {}),
  };

  if (isHr(actor.role)) {
    if (query.status) where.status = query.status;
  } else {
    // Karyawan hanya melihat yang sudah tayang, belum kedaluwarsa, dan
    // memang ditujukan kepadanya.
    where.status = 'published';
    where.OR = [{ expiresAt: null }, { expiresAt: { gt: new Date() } }];
    where.AND = [
      { OR: [{ targetDepartmentId: null }, { targetDepartmentId: actor.departmentId }] },
    ];
  }

  const rows = await prisma.announcement.findMany({
    where,
    select: {
      ...announcementSelect,
      reads: {
        where: { employeeId: actor.id },
        select: { readAt: true, acknowledgedAt: true },
      },
    },
    // Yang mendesak naik ke atas; papan yang semuanya setara membuat
    // pengumuman penting tenggelam.
    orderBy: [{ priority: 'asc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
  });

  const urutanPrioritas: Record<string, number> = { urgent: 0, important: 1, normal: 2 };

  const denganStatusBaca = rows
    .map((r) => ({
      ...r,
      readCount: r._count.reads,
      isRead: r.reads.length > 0,
      acknowledgedAt: r.reads[0]?.acknowledgedAt ?? null,
      _count: undefined,
      reads: undefined,
    }))
    .sort((a, b) => {
      const p = (urutanPrioritas[a.priority] ?? 9) - (urutanPrioritas[b.priority] ?? 9);
      if (p !== 0) return p;
      return (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
    });

  const tersaring = query.unreadOnly
    ? denganStatusBaca.filter((r) => !r.isRead)
    : denganStatusBaca;

  const mulai = (query.page - 1) * query.limit;

  res.json({
    data: tersaring.slice(mulai, mulai + query.limit),
    pagination: {
      page: query.page,
      limit: query.limit,
      total: tersaring.length,
      totalPages: Math.ceil(tersaring.length / query.limit) || 1,
    },
  });
};

/**
 * Menandai pengumuman sudah dibaca.
 *
 * Membuka dan menyatakan sudah paham adalah dua hal berbeda: yang pertama
 * cukup untuk pengumuman biasa, yang kedua diperlukan untuk perubahan SOP
 * keselamatan yang menuntut bukti bahwa isinya benar-benar diterima.
 */
export const markAnnouncementRead = async (req: Request, res: Response) => {
  const { acknowledge } = req.body as MarkReadInput;
  const actor = req.user!;

  const pengumuman = await prisma.announcement.findUnique({
    where: { id: req.params.id },
    select: { id: true, status: true, requiresAcknowledgment: true, targetDepartmentId: true },
  });
  if (!pengumuman) return res.status(404).json({ error: 'Pengumuman tidak ditemukan' });

  if (pengumuman.status !== 'published') {
    return res.status(409).json({ error: 'Pengumuman ini belum tayang' });
  }

  if (!isTargeted(pengumuman, actor)) {
    return res.status(403).json({ error: 'Pengumuman ini tidak ditujukan untuk Anda' });
  }

  if (acknowledge && !pengumuman.requiresAcknowledgment) {
    return res.status(400).json({
      error: 'Pengumuman ini tidak menuntut pernyataan sudah dibaca',
    });
  }

  const catatan = await prisma.announcementRead.upsert({
    where: {
      announcementId_employeeId: { announcementId: pengumuman.id, employeeId: actor.id },
    },
    update: acknowledge ? { acknowledgedAt: new Date() } : {},
    create: {
      id: generateULID(),
      announcementId: pengumuman.id,
      employeeId: actor.id,
      acknowledgedAt: acknowledge ? new Date() : null,
    },
  });

  res.json(catatan);
};

/** Siapa yang sudah dan belum membaca sebuah pengumuman. */
export const getAnnouncementReadReport = async (req: Request, res: Response) => {
  const pengumuman = await prisma.announcement.findUnique({
    where: { id: req.params.id },
    select: { id: true, title: true, targetDepartmentId: true, requiresAcknowledgment: true },
  });
  if (!pengumuman) return res.status(404).json({ error: 'Pengumuman tidak ditemukan' });

  const [karyawan, dibaca] = await Promise.all([
    prisma.employee.findMany({
      where: { status: { notIn: ['resign', 'terminated', 'inactive'] } },
      select: { id: true, nik: true, name: true, departmentId: true },
      orderBy: { name: 'asc' },
    }),
    prisma.announcementRead.findMany({
      where: { announcementId: pengumuman.id },
      select: { employeeId: true, readAt: true, acknowledgedAt: true },
    }),
  ]);

  const sasaran = karyawan.filter((k) => isTargeted(pengumuman, k));
  const perId = new Map(dibaca.map((d) => [d.employeeId, d]));

  const baris = sasaran.map((k) => {
    const catatan = perId.get(k.id);
    return {
      employee: k,
      readAt: catatan?.readAt ?? null,
      acknowledgedAt: catatan?.acknowledgedAt ?? null,
    };
  });

  res.json({
    announcement: { id: pengumuman.id, title: pengumuman.title },
    targetCount: sasaran.length,
    readCount: baris.filter((b) => b.readAt !== null).length,
    acknowledgedCount: baris.filter((b) => b.acknowledgedAt !== null).length,
    // Yang belum membaca itulah yang perlu ditindaklanjuti.
    notRead: baris.filter((b) => b.readAt === null),
    ...(pengumuman.requiresAcknowledgment
      ? { notAcknowledged: baris.filter((b) => b.acknowledgedAt === null) }
      : {}),
  });
};

// ============ Survei ============

const surveySelect = {
  id: true,
  title: true,
  description: true,
  isAnonymous: true,
  targetDepartmentId: true,
  startDate: true,
  endDate: true,
  status: true,
  createdById: true,
  createdAt: true,
  questions: {
    select: {
      id: true,
      code: true,
      text: true,
      type: true,
      options: true,
      minScale: true,
      maxScale: true,
      isRequired: true,
      sortOrder: true,
    },
    orderBy: { sortOrder: 'asc' as const },
  },
  _count: { select: { participations: true } },
} satisfies Prisma.SurveySelect;

export const createSurvey = async (req: Request, res: Response) => {
  const input = req.body as CreateSurveyInput;

  if (input.targetDepartmentId) {
    const dept = await prisma.department.findUnique({
      where: { id: input.targetDepartmentId },
      select: { id: true },
    });
    if (!dept) return res.status(404).json({ error: 'Departemen sasaran tidak ditemukan' });
  }

  const survei = await prisma.survey.create({
    data: {
      id: generateULID(),
      title: input.title,
      description: input.description,
      isAnonymous: input.isAnonymous,
      targetDepartmentId: input.targetDepartmentId ?? null,
      startDate: input.startDate,
      endDate: input.endDate,
      createdById: req.user!.id,
      questions: {
        create: input.questions.map((q, index) => ({
          id: generateULID(),
          code: q.code,
          text: q.text,
          type: q.type,
          options: (q.options ?? undefined) as Prisma.InputJsonValue | undefined,
          minScale: q.type === 'scale' ? (q.minScale ?? 1) : null,
          maxScale: q.type === 'scale' ? (q.maxScale ?? 5) : null,
          isRequired: q.isRequired,
          sortOrder: index,
        })),
      },
    },
    select: surveySelect,
  });

  res.status(201).json(survei);
};

export const changeSurveyStatus = async (req: Request, res: Response) => {
  const { status } = req.body as ChangeSurveyStatusInput;

  const survei = await prisma.survey.findUnique({
    where: { id: req.params.id },
    select: { id: true, status: true },
  });
  if (!survei) return res.status(404).json({ error: 'Survei tidak ditemukan' });

  if (survei.status === status) {
    return res.status(409).json({ error: `Survei sudah berstatus "${status}"` });
  }
  if (survei.status === 'closed') {
    return res.status(409).json({ error: 'Survei yang sudah ditutup tidak bisa dibuka lagi' });
  }

  const diperbarui = await prisma.survey.update({
    where: { id: survei.id },
    data: { status },
    select: surveySelect,
  });

  res.json(diperbarui);
};

export const getAllSurveys = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListSurveyQuery;
  const actor = req.user!;

  const where: Prisma.SurveyWhereInput = {};

  if (isHr(actor.role)) {
    if (query.status) where.status = query.status;
  } else {
    where.status = 'published';
    where.OR = [{ targetDepartmentId: null }, { targetDepartmentId: actor.departmentId }];
  }

  const [total, rows] = await Promise.all([
    prisma.survey.count({ where }),
    prisma.survey.findMany({
      where,
      select: surveySelect,
      orderBy: { startDate: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  // Apakah pengguna sudah mengisi — dibaca dari partisipasi, bukan dari
  // jawabannya, sehingga tetap berfungsi pada survei anonim.
  const partisipasi = await prisma.surveyParticipation.findMany({
    where: { employeeId: actor.id, surveyId: { in: rows.map((r) => r.id) } },
    select: { surveyId: true },
  });
  const sudah = new Set(partisipasi.map((p) => p.surveyId));

  res.json({
    data: rows.map((r) => ({
      ...r,
      participationCount: r._count.participations,
      hasSubmitted: sudah.has(r.id),
      _count: undefined,
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit) || 1,
    },
  });
};

/**
 * Mengirim jawaban survei.
 *
 * Pada survei anonim, baris jawaban disimpan tanpa identitas, sementara
 * partisipasi dicatat terpisah. Keduanya dibuat dalam satu transaksi: kalau
 * terpisah, kegagalan di tengah bisa menghasilkan jawaban tanpa catatan
 * partisipasi — dan orangnya bisa mengisi lagi.
 */
export const submitSurvey = async (req: Request, res: Response) => {
  const input = req.body as SubmitSurveyInput;
  const actor = req.user!;

  const survei = await prisma.survey.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      status: true,
      isAnonymous: true,
      startDate: true,
      endDate: true,
      targetDepartmentId: true,
      questions: true,
    },
  });
  if (!survei) return res.status(404).json({ error: 'Survei tidak ditemukan' });

  if (survei.status !== 'published') {
    return res.status(409).json({ error: `Survei berstatus "${survei.status}" tidak menerima jawaban` });
  }

  const now = new Date();
  if (now < survei.startDate) {
    return res.status(409).json({ error: 'Survei belum dibuka' });
  }
  if (now > survei.endDate) {
    return res.status(409).json({ error: 'Masa pengisian survei sudah berakhir' });
  }

  if (!isTargeted(survei, actor)) {
    return res.status(403).json({ error: 'Survei ini tidak ditujukan untuk Anda' });
  }

  const sudah = await prisma.surveyParticipation.findUnique({
    where: { surveyId_employeeId: { surveyId: survei.id, employeeId: actor.id } },
  });
  if (sudah) {
    return res.status(409).json({ error: 'Anda sudah mengisi survei ini' });
  }

  const spec: QuestionSpec[] = survei.questions.map((q) => ({
    id: q.id,
    code: q.code,
    text: q.text,
    type: q.type as QuestionType,
    options: (q.options as string[] | null) ?? null,
    minScale: q.minScale,
    maxScale: q.maxScale,
    isRequired: q.isRequired,
  }));

  try {
    validateAnswers(spec, input.answers);
  } catch (error) {
    if (error instanceof SurveyAnswerError) {
      return res.status(400).json({ error: error.message, reason: error.code });
    }
    throw error;
  }

  await prisma.$transaction(async (tx) => {
    const jawaban = await tx.surveyResponse.create({
      data: {
        id: generateULID(),
        surveyId: survei.id,
        // Inilah inti anonimitasnya: baris jawaban tidak menyimpan identitas.
        respondentId: survei.isAnonymous ? null : actor.id,
      },
    });

    await tx.surveyAnswer.createMany({
      data: input.answers.map((a) => ({
        id: generateULID(),
        responseId: jawaban.id,
        questionId: a.questionId,
        scaleValue: a.scaleValue ?? null,
        textValue: a.textValue ?? null,
        choiceValue: a.choiceValue ?? null,
      })),
    });

    await tx.surveyParticipation.create({
      data: { id: generateULID(), surveyId: survei.id, employeeId: actor.id },
    });
  });

  res.status(201).json({ message: 'Jawaban survei tersimpan', anonymous: survei.isAnonymous });
};

/** Hasil agregat survei. Jawaban individual tidak pernah dikembalikan. */
export const getSurveyResults = async (req: Request, res: Response) => {
  const survei = await prisma.survey.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      title: true,
      isAnonymous: true,
      status: true,
      targetDepartmentId: true,
      questions: { orderBy: { sortOrder: 'asc' } },
      _count: { select: { participations: true, responses: true } },
    },
  });
  if (!survei) return res.status(404).json({ error: 'Survei tidak ditemukan' });

  const jawaban = await prisma.surveyAnswer.findMany({
    where: { response: { surveyId: survei.id } },
    select: { questionId: true, scaleValue: true, textValue: true, choiceValue: true },
  });

  const spec: QuestionSpec[] = survei.questions.map((q) => ({
    id: q.id,
    code: q.code,
    text: q.text,
    type: q.type as QuestionType,
    options: (q.options as string[] | null) ?? null,
    minScale: q.minScale,
    maxScale: q.maxScale,
    isRequired: q.isRequired,
  }));

  const karyawan = await prisma.employee.findMany({
    where: { status: { notIn: ['resign', 'terminated', 'inactive'] } },
    select: { id: true, departmentId: true },
  });
  const sasaran = karyawan.filter((k) => isTargeted(survei, k)).length;

  res.json({
    survey: { id: survei.id, title: survei.title, isAnonymous: survei.isAnonymous, status: survei.status },
    targetCount: sasaran,
    responseCount: survei._count.responses,
    responseRate: sasaran === 0 ? 0 : Math.round((survei._count.responses / sasaran) * 1000) / 10,
    questions: aggregateAnswers(spec, jawaban),
    // Jawaban teks dikembalikan tanpa identitas, sesuai sifat surveinya.
    textAnswers: spec
      .filter((q) => q.type === 'text')
      .map((q) => ({
        questionId: q.id,
        text: q.text,
        answers: jawaban
          .filter((a) => a.questionId === q.id && a.textValue !== null)
          .map((a) => a.textValue),
      })),
  });
};

// ============ Ruang obrolan ============

export const createRoom = async (req: Request, res: Response) => {
  const input = req.body as CreateRoomInput;
  const actor = req.user!;

  const anggota = [...new Set([actor.id, ...(input.memberIds ?? [])])];

  const ada = await prisma.employee.count({ where: { id: { in: anggota } } });
  if (ada !== anggota.length) {
    return res.status(404).json({ error: 'Ada karyawan yang tidak ditemukan' });
  }

  const ruang = await prisma.chatRoom.create({
    data: {
      id: generateULID(),
      name: input.name,
      description: input.description,
      type: input.type,
      isPrivate: input.isPrivate,
      members: {
        create: anggota.map((employeeId) => ({
          id: generateULID(),
          employeeId,
          // Pembuat ruang otomatis jadi moderator.
          role: employeeId === actor.id ? 'moderator' : 'member',
        })),
      },
    },
    include: { members: { select: { employeeId: true, role: true } } },
  });

  res.status(201).json(ruang);
};

const keanggotaan = (roomId: string, employeeId: string) =>
  prisma.chatRoomMember.findUnique({
    where: { roomId_employeeId: { roomId, employeeId } },
  });

export const getMyRooms = async (req: Request, res: Response) => {
  const rooms = await prisma.chatRoom.findMany({
    where: { isActive: true, members: { some: { employeeId: req.user!.id } } },
    include: {
      _count: { select: { members: true, messages: true } },
      // Peran saya di ruang ini menentukan tombol apa yang tampil di klien.
      members: { where: { employeeId: req.user!.id }, select: { role: true } },
      messages: {
        orderBy: { timestamp: 'desc' },
        take: 1,
        select: { message: true, timestamp: true, deletedAt: true, sender: { select: { name: true } } },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  res.json({
    data: rooms.map(({ members, messages, ...r }) => ({
      ...r,
      myRole: members[0]?.role ?? 'member',
      lastMessage: messages[0]
        ? {
            message: messages[0].deletedAt ? null : messages[0].message,
            timestamp: messages[0].timestamp,
            senderName: messages[0].sender.name,
            isDeleted: messages[0].deletedAt !== null,
          }
        : null,
    })),
  });
};

export const addRoomMember = async (req: Request, res: Response) => {
  const input = req.body as AddMemberInput;
  const actor = req.user!;

  const ruang = await prisma.chatRoom.findUnique({
    where: { id: req.params.id },
    select: { id: true, isActive: true },
  });
  if (!ruang || !ruang.isActive) {
    return res.status(404).json({ error: 'Ruang obrolan tidak ditemukan' });
  }

  const sayaAnggota = await keanggotaan(ruang.id, actor.id);

  // Hanya moderator ruang atau HR yang menambah anggota.
  if (!isHr(actor.role) && sayaAnggota?.role !== 'moderator') {
    return res.status(403).json({ error: 'Hanya moderator ruang yang bisa menambah anggota' });
  }

  const karyawan = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true },
  });
  if (!karyawan) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });

  try {
    const anggota = await prisma.chatRoomMember.create({
      data: {
        id: generateULID(),
        roomId: ruang.id,
        employeeId: input.employeeId,
        role: input.role,
      },
    });
    res.status(201).json(anggota);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'Karyawan ini sudah menjadi anggota ruang' });
    }
    throw error;
  }
};

export const sendMessage = async (req: Request, res: Response) => {
  const { message } = req.body as SendMessageInput;
  const actor = req.user!;

  const ruang = await prisma.chatRoom.findUnique({
    where: { id: req.params.id },
    select: { id: true, isActive: true },
  });
  if (!ruang || !ruang.isActive) {
    return res.status(404).json({ error: 'Ruang obrolan tidak ditemukan' });
  }

  // Keanggotaan diperiksa, bukan sekadar token yang sah: tanpa ini, ruang
  // "Kitchen" bisa dibaca dan diisi seluruh perusahaan.
  if (!(await keanggotaan(ruang.id, actor.id))) {
    return res.status(403).json({ error: 'Anda bukan anggota ruang ini' });
  }

  const pesan = await prisma.chatMessage.create({
    data: { id: generateULID(), roomId: ruang.id, senderId: actor.id, message },
    include: { sender: { select: { id: true, name: true } } },
  });

  await prisma.chatRoom.update({ where: { id: ruang.id }, data: { updatedAt: new Date() } });

  res.status(201).json(pesan);
};

export const getMessages = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListMessageQuery;
  const actor = req.user!;

  const ruang = await prisma.chatRoom.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });
  if (!ruang) return res.status(404).json({ error: 'Ruang obrolan tidak ditemukan' });

  if (!(await keanggotaan(ruang.id, actor.id))) {
    return res.status(403).json({ error: 'Anda bukan anggota ruang ini' });
  }

  const [total, rows] = await Promise.all([
    prisma.chatMessage.count({ where: { roomId: ruang.id } }),
    prisma.chatMessage.findMany({
      where: { roomId: ruang.id },
      include: { sender: { select: { id: true, name: true } } },
      orderBy: { timestamp: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  res.json({
    // Isi pesan yang dihapus tidak dikembalikan, tapi keberadaannya tetap
    // terlihat — lubang di tengah riwayat lebih menyulitkan saat audit.
    data: rows.map((m) => ({
      ...m,
      message: m.deletedAt ? null : m.message,
      isDeleted: m.deletedAt !== null,
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit) || 1,
    },
  });
};

export const deleteMessage = async (req: Request, res: Response) => {
  const actor = req.user!;

  const pesan = await prisma.chatMessage.findUnique({
    where: { id: req.params.id },
    select: { id: true, senderId: true, roomId: true, deletedAt: true },
  });
  if (!pesan) return res.status(404).json({ error: 'Pesan tidak ditemukan' });

  if (pesan.deletedAt) {
    return res.status(409).json({ error: 'Pesan ini sudah dihapus' });
  }

  const anggota = await keanggotaan(pesan.roomId, actor.id);
  const bolehHapus =
    pesan.senderId === actor.id || anggota?.role === 'moderator' || isHr(actor.role);

  if (!bolehHapus) {
    return res.status(403).json({ error: 'Anda hanya bisa menghapus pesan sendiri' });
  }

  await prisma.chatMessage.update({
    where: { id: pesan.id },
    data: { deletedAt: new Date() },
  });

  res.json({ message: 'Pesan dihapus' });
};
