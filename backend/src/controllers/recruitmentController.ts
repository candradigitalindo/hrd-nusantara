// src/controllers/recruitmentController.ts
import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import { pasanganTeks } from '../utils/richText';
import { kirimBerkas } from './karierController';
import {
  canTransition,
  canHire,
  FUNNEL_ORDER,
  type CandidateStage,
} from '../utils/recruitmentStages';
import type {
  CreateJobPostingInput,
  UpdateJobPostingInput,
  ChangeJobPostingStatusInput,
  ListJobPostingQuery,
  CreateCandidateInput,
  ChangeCandidateStageInput,
  HireCandidateInput,
  ListCandidateQuery,
  ScheduleInterviewInput,
  SubmitInterviewFeedbackInput,
  ListInterviewQuery,
  RecruitmentReportQuery,
} from '../schemas/recruitmentSchema';

const dec = (v: number | null | undefined) => (v == null ? null : new Prisma.Decimal(v));
const num = (v: Prisma.Decimal | null) => (v === null ? null : v.toNumber());

// ============ Lowongan ============

const jobPostingSelect = {
  id: true,
  title: true,
  description: true,
  descriptionHtml: true,
  requirements: true,
  requirementsHtml: true,
  positionId: true,
  openings: true,
  employmentType: true,
  salaryRangeMin: true,
  salaryRangeMax: true,
  location: true,
  recruitmentCost: true,
  postedDate: true,
  deadline: true,
  publishedAt: true,
  closedAt: true,
  status: true,
  createdById: true,
  createdAt: true,
  position: { select: { id: true, name: true, departmentId: true } },
  _count: { select: { candidates: true } },
} satisfies Prisma.JobPostingSelect;

type JobPostingRow = Prisma.JobPostingGetPayload<{ select: typeof jobPostingSelect }>;

const jobPostingDTO = (row: JobPostingRow) => ({
  ...row,
  salaryRangeMin: num(row.salaryRangeMin),
  salaryRangeMax: num(row.salaryRangeMax),
  recruitmentCost: num(row.recruitmentCost),
  candidateCount: row._count.candidates,
  _count: undefined,
});

export const createJobPosting = async (req: Request, res: Response) => {
  const input = req.body as CreateJobPostingInput;

  const posisi = await prisma.position.findUnique({
    where: { id: input.positionId },
    select: { id: true },
  });
  if (!posisi) return res.status(404).json({ error: 'Posisi tidak ditemukan' });

  const deskripsi = pasanganTeks(input.descriptionHtml, input.description);
  const syarat = pasanganTeks(input.requirementsHtml, input.requirements);
  if (!deskripsi || deskripsi.teks.trim() === '') return res.status(400).json({ error: 'Deskripsi pekerjaan wajib diisi' });
  if (!syarat || syarat.teks.trim() === '') return res.status(400).json({ error: 'Persyaratan wajib diisi' });

  const lowongan = await prisma.jobPosting.create({
    data: {
      id: generateULID(),
      title: input.title,
      description: deskripsi.teks,
      descriptionHtml: deskripsi.html,
      requirements: syarat.teks,
      requirementsHtml: syarat.html,
      positionId: input.positionId,
      openings: input.openings,
      employmentType: input.employmentType,
      salaryRangeMin: dec(input.salaryRangeMin),
      salaryRangeMax: dec(input.salaryRangeMax),
      location: input.location,
      recruitmentCost: dec(input.recruitmentCost),
      deadline: input.deadline ?? null,
      createdById: req.user!.id,
      // Dibuat sebagai draft: lowongan tidak langsung terbit begitu disimpan,
      // supaya bisa disunting dulu sebelum dilihat pelamar.
      status: 'draft',
    },
    select: jobPostingSelect,
  });

  res.status(201).json(jobPostingDTO(lowongan));
};

export const getAllJobPostings = async (req: Request, res: Response) => {
  const { page, limit, status, positionId, search } =
    req.query as unknown as ListJobPostingQuery;
  const actor = req.user!;

  const where: Prisma.JobPostingWhereInput = {
    ...(status ? { status } : {}),
    ...(positionId ? { positionId } : {}),
    ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}),
  };

  // Karyawan biasa hanya melihat lowongan yang sudah terbit — draft dan
  // lowongan yang dibatalkan adalah urusan internal HR.
  const isHr = actor.role === Role.HR_ADMIN || actor.role === Role.SUPER_ADMIN;
  if (!isHr) where.status = status && status !== 'draft' ? status : 'open';

  const [total, rows] = await Promise.all([
    prisma.jobPosting.count({ where }),
    prisma.jobPosting.findMany({
      where,
      select: jobPostingSelect,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data: rows.map(jobPostingDTO),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
};

export const updateJobPosting = async (req: Request, res: Response) => {
  const input = req.body as UpdateJobPostingInput;

  const data: Prisma.JobPostingUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  const deskripsi = pasanganTeks(input.descriptionHtml, input.description);
  if (deskripsi) {
    data.description = deskripsi.teks;
    data.descriptionHtml = deskripsi.html;
  }
  const syarat = pasanganTeks(input.requirementsHtml, input.requirements);
  if (syarat) {
    data.requirements = syarat.teks;
    data.requirementsHtml = syarat.html;
  }
  if (input.openings !== undefined) data.openings = input.openings;
  if (input.employmentType !== undefined) data.employmentType = input.employmentType;
  if (input.salaryRangeMin !== undefined) data.salaryRangeMin = dec(input.salaryRangeMin);
  if (input.salaryRangeMax !== undefined) data.salaryRangeMax = dec(input.salaryRangeMax);
  if (input.location !== undefined) data.location = input.location;
  if (input.deadline !== undefined) data.deadline = input.deadline;

  try {
    const lowongan = await prisma.jobPosting.update({
      where: { id: req.params.id },
      data,
      select: jobPostingSelect,
    });
    res.json(jobPostingDTO(lowongan));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({ error: 'Lowongan tidak ditemukan' });
    }
    throw error;
  }
};

export const changeJobPostingStatus = async (req: Request, res: Response) => {
  const { status } = req.body as ChangeJobPostingStatusInput;

  const lowongan = await prisma.jobPosting.findUnique({
    where: { id: req.params.id },
    select: { id: true, status: true },
  });
  if (!lowongan) return res.status(404).json({ error: 'Lowongan tidak ditemukan' });

  if (lowongan.status === status) {
    return res.status(409).json({ error: `Lowongan sudah berstatus "${status}"` });
  }

  const diperbarui = await prisma.jobPosting.update({
    where: { id: lowongan.id },
    data: {
      status,
      ...(status === 'open' ? { publishedAt: new Date() } : {}),
      ...(status === 'closed' || status === 'filled' || status === 'cancelled'
        ? { closedAt: new Date() }
        : {}),
    },
    select: jobPostingSelect,
  });

  res.json(jobPostingDTO(diperbarui));
};

// ============ Pelamar ============

const candidateSelect = {
  id: true,
  name: true,
  email: true,
  phoneNumber: true,
  status: true,
  appliedPositionId: true,
  applicationDate: true,
  cvUrl: true,
  coverLetterUrl: true,
  // Surat lamaran yang ditulis pelamar sendiri di portal karier. Tanpa ini
  // penyaringan berjalan tanpa satu-satunya hal yang ia tulis sendiri.
  coverLetter: true,
  source: true,
  expectedSalary: true,
  notes: true,
  rejectionReason: true,
  hiredEmployeeId: true,
  createdAt: true,
  appliedPosition: { select: { id: true, title: true, status: true } },
  stageHistory: {
    select: {
      fromStage: true,
      toStage: true,
      changedById: true,
      note: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' as const },
  },
  interviews: {
    select: {
      id: true,
      stage: true,
      round: true,
      scheduledDateTime: true,
      status: true,
      result: true,
      score: true,
      interviewerId: true,
    },
    orderBy: { scheduledDateTime: 'asc' as const },
  },
  accountId: true,
  // Hanya nama berkasnya, bukan lokasi penyimpanannya: HR mengunduh melalui
  // /candidates/:id/cv yang memeriksa izin dan mencatat jejak audit.
  account: { select: { cvFileName: true } },
} satisfies Prisma.CandidateSelect;

type CandidateRow = Prisma.CandidateGetPayload<{ select: typeof candidateSelect }>;

const candidateDTO = ({ account, ...row }: CandidateRow) => ({
  ...row,
  expectedSalary: num(row.expectedSalary),
  // Pelamar yang datang lewat portal karier — CV-nya berupa berkas tersimpan
  // dan tahapnya ikut terbaca di dasbor pelamar, berbeda dari pelamar yang
  // dicatat HR secara manual.
  dariPortal: row.accountId !== null,
  cvFileName: account?.cvFileName ?? null,
});

export const createCandidate = async (req: Request, res: Response) => {
  const input = req.body as CreateCandidateInput;

  const lowongan = await prisma.jobPosting.findUnique({
    where: { id: input.jobPostingId },
    select: { id: true, status: true },
  });

  if (!lowongan) return res.status(404).json({ error: 'Lowongan tidak ditemukan' });

  if (lowongan.status !== 'open') {
    return res.status(409).json({
      error: `Lowongan berstatus "${lowongan.status}" tidak menerima lamaran`,
    });
  }

  // Satu orang melamar dua kali ke lowongan yang sama hampir selalu tidak
  // disengaja, dan menghasilkan dua jalur seleksi paralel untuk orang yang sama.
  const sudahAda = await prisma.candidate.findFirst({
    where: { email: input.email, appliedPositionId: input.jobPostingId },
    select: { id: true, status: true },
  });

  if (sudahAda) {
    return res.status(409).json({
      error: 'Email ini sudah melamar untuk lowongan tersebut',
      candidateId: sudahAda.id,
      currentStage: sudahAda.status,
    });
  }

  const pelamar = await prisma.$transaction(async (tx) => {
    const dibuat = await tx.candidate.create({
      data: {
        id: generateULID(),
        name: input.name,
        email: input.email,
        phoneNumber: input.phoneNumber,
        appliedPositionId: input.jobPostingId,
        cvUrl: input.cvUrl,
        coverLetterUrl: input.coverLetterUrl,
        source: input.source,
        expectedSalary: dec(input.expectedSalary),
        notes: input.notes,
        status: 'applied',
      },
    });

    // Baris pertama riwayat, supaya corong rekrutmen punya titik awal.
    await tx.candidateStageHistory.create({
      data: {
        id: generateULID(),
        candidateId: dibuat.id,
        fromStage: null,
        toStage: 'applied',
        changedById: req.user!.id,
        note: 'Lamaran diterima',
      },
    });

    return tx.candidate.findUniqueOrThrow({
      where: { id: dibuat.id },
      select: candidateSelect,
    });
  });

  res.status(201).json(candidateDTO(pelamar));
};

export const getAllCandidates = async (req: Request, res: Response) => {
  const { page, limit, jobPostingId, stage, search, source } =
    req.query as unknown as ListCandidateQuery;

  const where: Prisma.CandidateWhereInput = {
    ...(jobPostingId ? { appliedPositionId: jobPostingId } : {}),
    ...(stage ? { status: stage } : {}),
    ...(source ? { source } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.candidate.count({ where }),
    prisma.candidate.findMany({
      where,
      select: candidateSelect,
      orderBy: { applicationDate: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data: rows.map(candidateDTO),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
};

export const getCandidateById = async (req: Request, res: Response) => {
  const pelamar = await prisma.candidate.findUnique({
    where: { id: req.params.id },
    select: candidateSelect,
  });

  if (!pelamar) return res.status(404).json({ error: 'Pelamar tidak ditemukan' });

  res.json(candidateDTO(pelamar));
};

export const changeCandidateStage = async (req: Request, res: Response) => {
  const { stage, note, rejectionReason } = req.body as ChangeCandidateStageInput;

  const pelamar = await prisma.candidate.findUnique({
    where: { id: req.params.id },
    select: { id: true, status: true },
  });
  if (!pelamar) return res.status(404).json({ error: 'Pelamar tidak ditemukan' });

  const cek = canTransition(pelamar.status as CandidateStage, stage);
  if (!cek.allowed) {
    return res.status(409).json({ error: cek.reason });
  }

  const hasil = await prisma.$transaction(async (tx) => {
    await tx.candidateStageHistory.create({
      data: {
        id: generateULID(),
        candidateId: pelamar.id,
        fromStage: pelamar.status,
        toStage: stage,
        changedById: req.user!.id,
        note: note ?? rejectionReason,
      },
    });

    return tx.candidate.update({
      where: { id: pelamar.id },
      data: {
        status: stage,
        ...(stage === 'rejected' ? { rejectionReason } : {}),
      },
      select: candidateSelect,
    });
  });

  res.json({ message: `Pelamar dipindahkan ke tahap "${stage}"`, candidate: candidateDTO(hasil) });
};

/**
 * Menerima pelamar menjadi karyawan.
 *
 * Pembuatan data karyawan dan perubahan tahap dilakukan dalam satu transaksi:
 * pelamar berstatus diterima tapi tanpa data karyawan adalah keadaan yang
 * tidak boleh ada, karena jejak rekrutmen jadi menggantung.
 */
export const hireCandidate = async (req: Request, res: Response) => {
  const input = req.body as HireCandidateInput;

  const pelamar = await prisma.candidate.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      name: true,
      email: true,
      phoneNumber: true,
      status: true,
      appliedPosition: { select: { id: true, positionId: true, openings: true } },
    },
  });
  if (!pelamar) return res.status(404).json({ error: 'Pelamar tidak ditemukan' });

  const cek = canHire(pelamar.status as CandidateStage);
  if (!cek.allowed) return res.status(409).json({ error: cek.reason });

  try {
    const hasil = await prisma.$transaction(async (tx) => {
      const karyawan = await tx.employee.create({
        data: {
          id: generateULID(),
          nik: input.nik,
          name: pelamar.name,
          email: pelamar.email,
          phoneNumber: pelamar.phoneNumber,
          status: input.employeeStatus,
          // Disimpan, bukan sekadar ditulis ke catatan: masa kerja dan
          // laporan perputaran karyawan bersandar pada tanggal ini.
          joinDate: input.joinDate,
          departmentId: input.departmentId ?? null,
          positionId: input.positionId ?? pelamar.appliedPosition.positionId,
          // Password belum diisi: akun diaktifkan terpisah oleh HR, bukan
          // dibuat otomatis dengan kata sandi tebakan.
          password: null,
        },
        select: { id: true, nik: true, name: true, email: true, status: true },
      });

      await tx.candidateStageHistory.create({
        data: {
          id: generateULID(),
          candidateId: pelamar.id,
          fromStage: pelamar.status,
          toStage: 'hired',
          changedById: req.user!.id,
          note: input.note ?? `Diterima sebagai karyawan, mulai ${input.joinDate.toISOString().slice(0, 10)}`,
        },
      });

      const diperbarui = await tx.candidate.update({
        where: { id: pelamar.id },
        data: { status: 'hired', hiredEmployeeId: karyawan.id },
        select: candidateSelect,
      });

      return { karyawan, pelamar: diperbarui };
    });

    // Lowongan ditutup otomatis ketika jumlah yang diterima sudah memenuhi
    // kuota, supaya tidak ada lamaran masuk untuk kursi yang sudah terisi.
    const diterima = await prisma.candidate.count({
      where: { appliedPositionId: pelamar.appliedPosition.id, status: 'hired' },
    });

    if (diterima >= pelamar.appliedPosition.openings) {
      await prisma.jobPosting.update({
        where: { id: pelamar.appliedPosition.id },
        data: { status: 'filled', closedAt: new Date() },
      });
    }

    res.status(201).json({
      message: 'Pelamar diterima dan data karyawannya dibuat',
      employee: hasil.karyawan,
      candidate: candidateDTO(hasil.pelamar),
      jobPostingFilled: diterima >= pelamar.appliedPosition.openings,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'NIK atau email';
      return res.status(409).json({ error: `${target} sudah terpakai oleh karyawan lain` });
    }
    throw error;
  }
};

// ============ Wawancara ============

const interviewSelect = {
  id: true,
  candidateId: true,
  interviewerId: true,
  stage: true,
  round: true,
  scheduledDateTime: true,
  durationMinutes: true,
  location: true,
  status: true,
  result: true,
  score: true,
  notes: true,
  feedback: true,
  createdAt: true,
  candidate: { select: { id: true, name: true, status: true } },
  interviewer: { select: { id: true, nik: true, name: true } },
} satisfies Prisma.InterviewSelect;

export const scheduleInterview = async (req: Request, res: Response) => {
  const input = req.body as ScheduleInterviewInput;

  const [pelamar, pewawancara] = await Promise.all([
    prisma.candidate.findUnique({
      where: { id: input.candidateId },
      select: { id: true, status: true },
    }),
    prisma.employee.findUnique({
      where: { id: input.interviewerId },
      select: { id: true, status: true },
    }),
  ]);

  if (!pelamar) return res.status(404).json({ error: 'Pelamar tidak ditemukan' });
  if (!pewawancara) return res.status(404).json({ error: 'Pewawancara tidak ditemukan' });

  if (['hired', 'rejected', 'withdrawn'].includes(pelamar.status)) {
    return res.status(409).json({
      error: `Pelamar berstatus "${pelamar.status}" tidak bisa dijadwalkan wawancara`,
    });
  }

  const wawancara = await prisma.interview.create({
    data: {
      id: generateULID(),
      candidateId: input.candidateId,
      interviewerId: input.interviewerId,
      stage: input.stage,
      round: input.round,
      scheduledDateTime: input.scheduledDateTime,
      durationMinutes: input.durationMinutes,
      location: input.location,
      notes: input.notes,
    },
    select: interviewSelect,
  });

  res.status(201).json(wawancara);
};

export const submitInterviewFeedback = async (req: Request, res: Response) => {
  const input = req.body as SubmitInterviewFeedbackInput;
  const actor = req.user!;

  const wawancara = await prisma.interview.findUnique({
    where: { id: req.params.id },
    select: { id: true, interviewerId: true, status: true },
  });
  if (!wawancara) return res.status(404).json({ error: 'Wawancara tidak ditemukan' });

  const isHr = actor.role === Role.HR_ADMIN || actor.role === Role.SUPER_ADMIN;

  // Penilaian hanya dari pewawancara yang bersangkutan, atau HR yang
  // membereskan catatan yang tertinggal.
  if (wawancara.interviewerId !== actor.id && !isHr) {
    return res.status(403).json({ error: 'Hanya pewawancara yang ditugaskan yang bisa menilai' });
  }

  if (wawancara.status === 'completed') {
    return res.status(409).json({ error: 'Wawancara ini sudah dinilai' });
  }

  const diperbarui = await prisma.interview.update({
    where: { id: wawancara.id },
    data: {
      status: input.status,
      result: input.result,
      score: input.score,
      notes: input.notes,
      feedback: input.feedback as Prisma.InputJsonValue | undefined,
    },
    select: interviewSelect,
  });

  res.json(diperbarui);
};

export const getAllInterviews = async (req: Request, res: Response) => {
  const { page, limit, candidateId, interviewerId, status } =
    req.query as unknown as ListInterviewQuery;
  const actor = req.user!;

  const isHr = actor.role === Role.HR_ADMIN || actor.role === Role.SUPER_ADMIN;

  const where: Prisma.InterviewWhereInput = {
    ...(candidateId ? { candidateId } : {}),
    ...(status ? { status } : {}),
    // Yang bukan HR hanya melihat wawancara yang ditugaskan kepadanya.
    ...(isHr ? (interviewerId ? { interviewerId } : {}) : { interviewerId: actor.id }),
  };

  const [total, data] = await Promise.all([
    prisma.interview.count({ where }),
    prisma.interview.findMany({
      where,
      select: interviewSelect,
      orderBy: { scheduledDateTime: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
};

// ============ Laporan ============

/**
 * Corong rekrutmen: berapa pelamar yang mencapai tiap tahap, dan berapa lama
 * prosesnya. Dihitung dari riwayat tahap, bukan dari status saat ini — status
 * hanya menunjukkan posisi terakhir, sedangkan corong butuh tahu siapa saja
 * yang PERNAH melewati tiap tahap.
 */
export const getRecruitmentFunnel = async (req: Request, res: Response) => {
  const query = req.query as unknown as RecruitmentReportQuery;

  if (query.endDate.getTime() < query.startDate.getTime()) {
    return res.status(400).json({ error: 'endDate tidak boleh lebih awal dari startDate' });
  }

  const akhirEksklusif = new Date(query.endDate.getTime() + 24 * 60 * 60 * 1000);

  const where: Prisma.CandidateWhereInput = {
    applicationDate: { gte: query.startDate, lt: akhirEksklusif },
    ...(query.jobPostingId ? { appliedPositionId: query.jobPostingId } : {}),
  };

  const pelamar = await prisma.candidate.findMany({
    where,
    select: {
      id: true,
      status: true,
      source: true,
      applicationDate: true,
      stageHistory: { select: { toStage: true, createdAt: true } },
    },
  });

  const funnel = FUNNEL_ORDER.map((tahap) => ({
    stage: tahap,
    reached: pelamar.filter((p) => p.stageHistory.some((h) => h.toStage === tahap)).length,
  }));

  const lamaProses = pelamar
    .map((p) => {
      const diterima = p.stageHistory
        .filter((h) => h.toStage === 'hired')
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
      if (!diterima) return null;
      return Math.max(
        0,
        Math.round(
          (diterima.createdAt.getTime() - p.applicationDate.getTime()) / (24 * 60 * 60 * 1000)
        )
      );
    })
    .filter((v): v is number => v !== null);

  const perSumber = new Map<string, { applied: number; hired: number }>();
  for (const p of pelamar) {
    const kunci = p.source ?? 'tidak dicatat';
    const baris = perSumber.get(kunci) ?? { applied: 0, hired: 0 };
    baris.applied += 1;
    if (p.status === 'hired') baris.hired += 1;
    perSumber.set(kunci, baris);
  }

  res.json({
    period: { startDate: query.startDate, endDate: query.endDate },
    totalCandidates: pelamar.length,
    funnel,
    rejected: pelamar.filter((p) => p.status === 'rejected').length,
    withdrawn: pelamar.filter((p) => p.status === 'withdrawn').length,
    averageDaysToHire:
      lamaProses.length > 0
        ? Math.round((lamaProses.reduce((s, v) => s + v, 0) / lamaProses.length) * 10) / 10
        : null,
    bySource: [...perSumber.entries()].map(([source, v]) => ({ source, ...v })),
  });
};

/**
 * Berkas CV yang diunggah pelamar lewat portal karier.
 *
 * Berkasnya tidak pernah bisa diambil langsung dari penyimpanan: jalurnya
 * hanya lewat sini, yang memeriksa izin rekrutmen lebih dulu.
 */
export const unduhCvPelamar = async (req: Request, res: Response) => {
  const pelamar = await prisma.candidate.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, account: { select: { cvPath: true, cvFileName: true } } },
  });
  if (!pelamar?.account?.cvPath) return res.status(404).json({ error: 'Pelamar ini tidak punya CV tersimpan' });

  res.locals.audit = {
    action: 'rekrutmen.cv.lihat',
    entity: 'Candidate',
    entityId: pelamar.id,
    summary: `Membuka CV ${pelamar.name}`,
  };
  await kirimBerkas(res, pelamar.account.cvPath, pelamar.account.cvFileName ?? 'cv.pdf');
};
