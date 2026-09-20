// src/controllers/performanceController.ts
import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import {
  calculateReviewScore,
  summarize360,
  ScoringError,
  type ReviewerType,
} from '../utils/performanceScoring';
import type {
  CreateTemplateInput,
  ListTemplateQuery,
  CreateCycleInput,
  ChangeCycleStatusInput,
  ListCycleQuery,
  AssignReviewInput,
  SubmitReviewInput,
  AddDiscussionInput,
  ListReviewQuery,
  CreateFeedbackInput,
  ListFeedbackQuery,
} from '../schemas/performanceSchema';

const isHr = (role: Role) => role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;
const num = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());

// ============ Formulir penilaian ============

export const createTemplate = async (req: Request, res: Response) => {
  const input = req.body as CreateTemplateInput;

  if (input.positionId) {
    const posisi = await prisma.position.findUnique({
      where: { id: input.positionId },
      select: { id: true },
    });
    if (!posisi) return res.status(404).json({ error: 'Posisi tidak ditemukan' });
  }

  const template = await prisma.performanceFormTemplate.create({
    data: {
      id: generateULID(),
      name: input.name,
      description: input.description,
      positionId: input.positionId ?? null,
      criteria: {
        create: input.criteria.map((c, index) => ({
          id: generateULID(),
          code: c.code,
          name: c.name,
          description: c.description,
          category: c.category,
          weight: new Prisma.Decimal(c.weight),
          maxScore: c.maxScore,
          sortOrder: index,
        })),
      },
    },
    include: { criteria: { orderBy: { sortOrder: 'asc' } } },
  });

  res.status(201).json({
    ...template,
    criteria: template.criteria.map((c) => ({ ...c, weight: c.weight.toNumber() })),
  });
};

export const getAllTemplates = async (req: Request, res: Response) => {
  const { page, limit, positionId, includeInactive } =
    req.query as unknown as ListTemplateQuery;

  const where: Prisma.PerformanceFormTemplateWhereInput = {
    ...(includeInactive ? {} : { isActive: true }),
    ...(positionId ? { positionId } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.performanceFormTemplate.count({ where }),
    prisma.performanceFormTemplate.findMany({
      where,
      include: { criteria: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { name: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data: rows.map((t) => ({
      ...t,
      criteria: t.criteria.map((c) => ({ ...c, weight: c.weight.toNumber() })),
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
};

// ============ Siklus penilaian ============

export const createCycle = async (req: Request, res: Response) => {
  const input = req.body as CreateCycleInput;

  try {
    const siklus = await prisma.performanceCycle.create({
      data: { id: generateULID(), ...input },
    });
    res.status(201).json(siklus);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: `Kode siklus "${input.code}" sudah dipakai` });
    }
    throw error;
  }
};

export const changeCycleStatus = async (req: Request, res: Response) => {
  const { status, note } = req.body as ChangeCycleStatusInput;

  const siklus = await prisma.performanceCycle.findUnique({ where: { id: req.params.id } });
  if (!siklus) return res.status(404).json({ error: 'Siklus penilaian tidak ditemukan' });

  if (siklus.status === status) {
    return res.status(409).json({ error: `Siklus sudah berstatus "${status}"` });
  }

  if (siklus.status === 'closed') {
    return res.status(409).json({ error: 'Siklus yang sudah ditutup tidak bisa dibuka lagi' });
  }

  // Menutup siklus memfinalkan penilaian yang sudah terkirim atau diakui —
  // setelah ini tidak ada lagi yang bisa diubah. Draf yang belum diisi
  // dibiarkan sebagai draf: tidak ada skornya, jadi tidak ada yang final.
  const diperbarui = await prisma.$transaction(async (tx) => {
    if (status === 'closed') {
      await tx.performanceReview.updateMany({
        where: { cycleId: siklus.id, status: { in: ['submitted', 'acknowledged'] } },
        data: { status: 'finalized' },
      });
    }
    return tx.performanceCycle.update({
      where: { id: siklus.id },
      data: {
        status,
        note: note ?? siklus.note,
        ...(status === 'closed' ? { closedAt: new Date() } : {}),
      },
      include: { _count: { select: { reviews: true } } },
    });
  });

  res.json(diperbarui);
};

export const getAllCycles = async (req: Request, res: Response) => {
  const { page, limit, status } = req.query as unknown as ListCycleQuery;
  const where: Prisma.PerformanceCycleWhereInput = status ? { status } : {};

  const [total, data] = await Promise.all([
    prisma.performanceCycle.count({ where }),
    prisma.performanceCycle.findMany({
      where,
      include: { _count: { select: { reviews: true } } },
      orderBy: { periodStart: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
};

// ============ Penilaian ============

const reviewSelect = {
  id: true,
  cycleId: true,
  revieweeId: true,
  reviewerId: true,
  reviewerType: true,
  period: true,
  formTemplateId: true,
  totalScore: true,
  rating: true,
  feedback: true,
  status: true,
  submittedAt: true,
  createdAt: true,
  reviewee: { select: { id: true, nik: true, name: true, departmentId: true } },
  reviewer: { select: { id: true, nik: true, name: true } },
  scores: {
    select: {
      criterionId: true,
      score: true,
      comment: true,
      criterion: { select: { code: true, name: true, weight: true, maxScore: true } },
    },
  },
  discussions: {
    select: { id: true, authorId: true, note: true, createdAt: true },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.PerformanceReviewSelect;

type ReviewRow = Prisma.PerformanceReviewGetPayload<{ select: typeof reviewSelect }>;

const reviewDTO = (row: ReviewRow) => ({
  ...row,
  totalScore: num(row.totalScore),
  scores: row.scores.map((s) => ({
    ...s,
    score: s.score.toNumber(),
    criterion: { ...s.criterion, weight: s.criterion.weight.toNumber() },
  })),
});

/** Apakah pengguna boleh membuka penilaian ini. */
const bolehLihat = (
  review: { revieweeId: string; reviewerId: string },
  actor: { id: string; role: Role }
) => review.revieweeId === actor.id || review.reviewerId === actor.id || isHr(actor.role);

export const assignReview = async (req: Request, res: Response) => {
  const input = req.body as AssignReviewInput;

  const [siklus, dinilai, penilai, template] = await Promise.all([
    prisma.performanceCycle.findUnique({ where: { id: input.cycleId } }),
    prisma.employee.findUnique({ where: { id: input.revieweeId }, select: { id: true } }),
    prisma.employee.findUnique({ where: { id: input.reviewerId }, select: { id: true } }),
    prisma.performanceFormTemplate.findUnique({
      where: { id: input.formTemplateId },
      select: { id: true, isActive: true, _count: { select: { criteria: true } } },
    }),
  ]);

  if (!siklus) return res.status(404).json({ error: 'Siklus penilaian tidak ditemukan' });
  if (!dinilai) return res.status(404).json({ error: 'Karyawan yang dinilai tidak ditemukan' });
  if (!penilai) return res.status(404).json({ error: 'Penilai tidak ditemukan' });
  if (!template || !template.isActive) {
    return res.status(404).json({ error: 'Formulir penilaian tidak ditemukan atau tidak aktif' });
  }
  if (template._count.criteria === 0) {
    return res.status(400).json({ error: 'Formulir ini belum punya kriteria penilaian' });
  }

  if (siklus.status !== 'open') {
    return res.status(409).json({
      error: `Penugasan hanya bisa pada siklus berstatus "open", ini "${siklus.status}"`,
    });
  }

  try {
    const review = await prisma.performanceReview.create({
      data: {
        id: generateULID(),
        cycleId: input.cycleId,
        revieweeId: input.revieweeId,
        reviewerId: input.reviewerId,
        reviewerType: input.reviewerType,
        formTemplateId: input.formTemplateId,
        period: siklus.code,
      },
      select: reviewSelect,
    });

    res.status(201).json(reviewDTO(review));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({
        error: 'Penilai ini sudah ditugaskan menilai orang tersebut dari sudut pandang yang sama',
      });
    }
    throw error;
  }
};

/**
 * Mengisi dan mengirim penilaian.
 *
 * Nilai akhir dihitung di server dari bobot kriteria, bukan diterima dari
 * klien: kalau klien yang mengirim totalnya, angka itu tidak bisa dipercaya
 * dan bobot formulir kehilangan gunanya.
 */
export const submitReview = async (req: Request, res: Response) => {
  const input = req.body as SubmitReviewInput;
  const actor = req.user!;

  const review = await prisma.performanceReview.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      reviewerId: true,
      status: true,
      formTemplateId: true,
      cycle: { select: { status: true } },
    },
  });

  if (!review) return res.status(404).json({ error: 'Penilaian tidak ditemukan' });

  // Hanya penilai yang ditugaskan. HR pun tidak menggantikan penilaian orang —
  // yang tercatat harus benar-benar pendapat penilainya.
  if (review.reviewerId !== actor.id) {
    return res.status(403).json({ error: 'Hanya penilai yang ditugaskan yang bisa mengisi' });
  }

  if (review.status !== 'draft') {
    return res.status(409).json({ error: `Penilaian ini sudah berstatus "${review.status}"` });
  }

  if (review.cycle.status !== 'open') {
    return res.status(409).json({ error: 'Siklus penilaian sudah tidak terbuka' });
  }

  const kriteria = await prisma.performanceCriterion.findMany({
    where: { templateId: review.formTemplateId! },
    orderBy: { sortOrder: 'asc' },
  });

  let hasil;
  try {
    hasil = calculateReviewScore(
      kriteria.map((k) => ({
        id: k.id,
        code: k.code,
        name: k.name,
        weight: k.weight.toNumber(),
        maxScore: k.maxScore,
      })),
      input.scores.map((s) => ({ criterionId: s.criterionId, score: s.score }))
    );
  } catch (error) {
    if (error instanceof ScoringError) {
      return res.status(400).json({ error: error.message, reason: error.code });
    }
    throw error;
  }

  const komentar = new Map(input.scores.map((s) => [s.criterionId, s.comment]));

  const diperbarui = await prisma.$transaction(async (tx) => {
    await tx.performanceScore.deleteMany({ where: { reviewId: review.id } });

    await tx.performanceScore.createMany({
      data: input.scores.map((s) => ({
        id: generateULID(),
        reviewId: review.id,
        criterionId: s.criterionId,
        score: new Prisma.Decimal(s.score),
        comment: komentar.get(s.criterionId),
      })),
    });

    return tx.performanceReview.update({
      where: { id: review.id },
      data: {
        totalScore: new Prisma.Decimal(hasil.totalScore),
        rating: hasil.rating,
        feedback: input.feedback,
        status: 'submitted',
        submittedAt: new Date(),
      },
      select: reviewSelect,
    });
  });

  res.json({ ...reviewDTO(diperbarui), breakdown: hasil.breakdown });
};

/** Karyawan menyatakan sudah membaca penilaian atas dirinya. */
export const acknowledgeReview = async (req: Request, res: Response) => {
  const actor = req.user!;

  const review = await prisma.performanceReview.findUnique({
    where: { id: req.params.id },
    select: { id: true, revieweeId: true, status: true },
  });

  if (!review) return res.status(404).json({ error: 'Penilaian tidak ditemukan' });

  if (review.revieweeId !== actor.id) {
    return res.status(403).json({ error: 'Hanya karyawan yang dinilai yang bisa mengakui' });
  }

  if (review.status !== 'submitted') {
    return res.status(409).json({
      error: `Hanya penilaian berstatus "submitted" yang bisa diakui, ini "${review.status}"`,
    });
  }

  const diperbarui = await prisma.performanceReview.update({
    where: { id: review.id },
    data: { status: 'acknowledged' },
    select: reviewSelect,
  });

  res.json(reviewDTO(diperbarui));
};

export const getAllReviews = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListReviewQuery;
  const actor = req.user!;

  const where: Prisma.PerformanceReviewWhereInput = {
    ...(query.cycleId ? { cycleId: query.cycleId } : {}),
    ...(query.revieweeId ? { revieweeId: query.revieweeId } : {}),
    ...(query.reviewerId ? { reviewerId: query.reviewerId } : {}),
    ...(query.status ? { status: query.status } : {}),
  };

  // Yang bukan HR hanya melihat penilaian yang melibatkan dirinya, baik
  // sebagai penilai maupun yang dinilai.
  if (!isHr(actor.role)) {
    where.OR = [{ reviewerId: actor.id }, { revieweeId: actor.id }];
  }

  const [total, rows] = await Promise.all([
    prisma.performanceReview.count({ where }),
    prisma.performanceReview.findMany({
      where,
      select: reviewSelect,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  res.json({
    data: rows.map(reviewDTO),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit) || 1,
    },
  });
};

export const getReviewById = async (req: Request, res: Response) => {
  const actor = req.user!;

  const review = await prisma.performanceReview.findUnique({
    where: { id: req.params.id },
    select: reviewSelect,
  });

  if (!review) return res.status(404).json({ error: 'Penilaian tidak ditemukan' });

  if (!bolehLihat(review, actor)) {
    return res.status(403).json({ error: 'Anda tidak punya akses ke penilaian ini' });
  }

  // Kriteria ikut dikirim karena penilai bukan HR tidak boleh membuka daftar
  // formulir — tanpa ini draf yang belum berskor tidak punya apa-apa untuk diisi.
  const kriteria = await prisma.performanceCriterion.findMany({
    where: { templateId: review.formTemplateId! },
    orderBy: { sortOrder: 'asc' },
  });

  res.json({
    ...reviewDTO(review),
    criteria: kriteria.map((k) => ({ ...k, weight: k.weight.toNumber() })),
  });
};

export const addDiscussion = async (req: Request, res: Response) => {
  const { note } = req.body as AddDiscussionInput;
  const actor = req.user!;

  const review = await prisma.performanceReview.findUnique({
    where: { id: req.params.id },
    select: { id: true, revieweeId: true, reviewerId: true },
  });

  if (!review) return res.status(404).json({ error: 'Penilaian tidak ditemukan' });

  // Diskusi evaluasi melibatkan kedua pihak; HR boleh ikut mencatat.
  if (!bolehLihat(review, actor)) {
    return res.status(403).json({ error: 'Anda tidak terlibat dalam penilaian ini' });
  }

  const diskusi = await prisma.performanceDiscussion.create({
    data: { id: generateULID(), reviewId: review.id, authorId: actor.id, note },
  });

  res.status(201).json(diskusi);
};

/**
 * Rangkuman 360 derajat atas satu karyawan dalam satu siklus.
 * Hanya penilaian yang sudah dikirim yang dihitung.
 */
export const getReviewSummary = async (req: Request, res: Response) => {
  const actor = req.user!;
  const { employeeId, cycleId } = req.params;

  if (employeeId !== actor.id && !isHr(actor.role)) {
    return res.status(403).json({ error: 'Anda tidak punya akses ke rangkuman ini' });
  }

  const reviews = await prisma.performanceReview.findMany({
    where: {
      revieweeId: employeeId,
      cycleId,
      status: { in: ['submitted', 'acknowledged', 'finalized'] },
      totalScore: { not: null },
    },
    select: { reviewerType: true, totalScore: true, reviewerId: true, status: true },
  });

  const ringkasan = summarize360(
    reviews.map((r) => ({
      reviewerType: r.reviewerType as ReviewerType,
      totalScore: r.totalScore!.toNumber(),
    }))
  );

  const belumMengisi = await prisma.performanceReview.count({
    where: { revieweeId: employeeId, cycleId, status: 'draft' },
  });

  res.json({
    employeeId,
    cycleId,
    submittedReviews: reviews.length,
    pendingReviews: belumMengisi,
    ...ringkasan,
  });
};

// ============ Umpan balik berkelanjutan ============

export const createFeedback = async (req: Request, res: Response) => {
  const input = req.body as CreateFeedbackInput;
  const actor = req.user!;

  if (input.recipientId === actor.id) {
    return res.status(400).json({ error: 'Umpan balik tidak bisa ditujukan ke diri sendiri' });
  }

  const penerima = await prisma.employee.findUnique({
    where: { id: input.recipientId },
    select: { id: true },
  });
  if (!penerima) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });

  const umpanBalik = await prisma.continuousFeedback.create({
    data: { id: generateULID(), authorId: actor.id, ...input },
  });

  res.status(201).json(umpanBalik);
};

export const getFeedback = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListFeedbackQuery;
  const actor = req.user!;

  const recipientId = query.recipientId ?? actor.id;

  if (recipientId !== actor.id && !isHr(actor.role)) {
    return res.status(403).json({ error: 'Anda hanya bisa melihat umpan balik untuk diri sendiri' });
  }

  const where: Prisma.ContinuousFeedbackWhereInput = {
    recipientId,
    ...(query.type ? { type: query.type } : {}),
  };

  const [total, data] = await Promise.all([
    prisma.continuousFeedback.count({ where }),
    prisma.continuousFeedback.findMany({
      where,
      include: { author: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
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
