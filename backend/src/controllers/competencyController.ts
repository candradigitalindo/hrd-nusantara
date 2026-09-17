// src/controllers/competencyController.ts
import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import {
  certificationState,
  analyzeCompetencyGap,
  validateLevel,
} from '../utils/competencyRules';
import { addMonths } from '../utils/trainingRules';
import type {
  CreateCompetencyInput,
  ListCompetencyQuery,
  SetStandardInput,
  AssessCompetencyInput,
  CreateCertificationTypeInput,
  ListCertificationTypeQuery,
  CreateCertificationInput,
  RevokeCertificationInput,
  ListCertificationQuery,
  GapQuery,
} from '../schemas/competencySchema';

const isHr = (role: Role) => role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;

// ============ Kamus kompetensi ============

export const createCompetency = async (req: Request, res: Response) => {
  const input = req.body as CreateCompetencyInput;

  try {
    const kompetensi = await prisma.competency.create({
      data: {
        id: generateULID(),
        ...input,
        levelLabels: input.levelLabels as Prisma.InputJsonValue | undefined,
      },
    });
    res.status(201).json(kompetensi);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: `Kode kompetensi "${input.code}" sudah dipakai` });
    }
    throw error;
  }
};

export const getAllCompetencies = async (req: Request, res: Response) => {
  const { page, limit, category, includeInactive } = req.query as unknown as ListCompetencyQuery;

  const where: Prisma.CompetencyWhereInput = {
    ...(includeInactive ? {} : { isActive: true }),
    ...(category ? { category } : {}),
  };

  const [total, data] = await Promise.all([
    prisma.competency.count({ where }),
    prisma.competency.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
};

// ============ Standar jabatan ============

export const setStandard = async (req: Request, res: Response) => {
  const input = req.body as SetStandardInput;
  const positionId = req.params.id;

  const [posisi, kompetensi] = await Promise.all([
    prisma.position.findUnique({ where: { id: positionId }, select: { id: true } }),
    prisma.competency.findUnique({ where: { id: input.competencyId } }),
  ]);

  if (!posisi) return res.status(404).json({ error: 'Jabatan tidak ditemukan' });
  if (!kompetensi || !kompetensi.isActive) {
    return res.status(404).json({ error: 'Kompetensi tidak ditemukan atau tidak aktif' });
  }

  const cek = validateLevel(input.requiredLevel, kompetensi.maxLevel);
  if (!cek.valid) return res.status(400).json({ error: cek.reason });

  // Upsert: menetapkan ulang syarat yang sama berarti memperbarui, bukan
  // menambah baris kedua yang saling bertentangan.
  const standar = await prisma.competencyStandard.upsert({
    where: { positionId_competencyId: { positionId, competencyId: input.competencyId } },
    update: { requiredLevel: input.requiredLevel, description: input.description },
    create: {
      id: generateULID(),
      positionId,
      competencyId: input.competencyId,
      requiredLevel: input.requiredLevel,
      description: input.description,
    },
    include: { competency: { select: { id: true, code: true, name: true, maxLevel: true } } },
  });

  res.json(standar);
};

export const getPositionStandards = async (req: Request, res: Response) => {
  const standar = await prisma.competencyStandard.findMany({
    where: { positionId: req.params.id },
    include: { competency: { select: { id: true, code: true, name: true, maxLevel: true } } },
    orderBy: { competency: { name: 'asc' } },
  });

  res.json({ data: standar });
};

export const removeStandard = async (req: Request, res: Response) => {
  try {
    await prisma.competencyStandard.delete({ where: { id: req.params.id } });
    res.json({ message: 'Standar kompetensi dihapus' });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({ error: 'Standar kompetensi tidak ditemukan' });
    }
    throw error;
  }
};

// ============ Penilaian kompetensi karyawan ============

export const assessCompetency = async (req: Request, res: Response) => {
  const input = req.body as AssessCompetencyInput;
  const employeeId = req.params.id;

  const [karyawan, kompetensi] = await Promise.all([
    prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } }),
    prisma.competency.findUnique({ where: { id: input.competencyId } }),
  ]);

  if (!karyawan) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });
  if (!kompetensi || !kompetensi.isActive) {
    return res.status(404).json({ error: 'Kompetensi tidak ditemukan atau tidak aktif' });
  }

  const cek = validateLevel(input.currentLevel, kompetensi.maxLevel);
  if (!cek.valid) return res.status(400).json({ error: cek.reason });

  const penilaian = await prisma.employeeCompetency.upsert({
    where: {
      employeeId_competencyId: { employeeId, competencyId: input.competencyId },
    },
    update: {
      currentLevel: input.currentLevel,
      assessedById: req.user!.id,
      assessedAt: new Date(),
      evidenceUrl: input.evidenceUrl,
      note: input.note,
    },
    create: {
      id: generateULID(),
      employeeId,
      competencyId: input.competencyId,
      currentLevel: input.currentLevel,
      assessedById: req.user!.id,
      evidenceUrl: input.evidenceUrl,
      note: input.note,
    },
    include: { competency: { select: { id: true, code: true, name: true, maxLevel: true } } },
  });

  res.json(penilaian);
};

/**
 * Analisis kesenjangan kompetensi seorang karyawan terhadap jabatannya.
 */
export const getEmployeeGap = async (req: Request, res: Response) => {
  const actor = req.user!;
  const employeeId = req.params.id;

  if (employeeId !== actor.id && !isHr(actor.role)) {
    return res.status(403).json({ error: 'Anda tidak punya akses ke analisis ini' });
  }

  const karyawan = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, nik: true, name: true, positionId: true },
  });
  if (!karyawan) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });

  if (!karyawan.positionId) {
    return res.status(400).json({
      error: 'Karyawan ini belum punya jabatan, sehingga tidak ada syarat kompetensi yang dibandingkan',
    });
  }

  const [standards, dimiliki] = await Promise.all([
    prisma.competencyStandard.findMany({
      where: { positionId: karyawan.positionId },
      include: { competency: { select: { id: true, code: true, name: true, maxLevel: true } } },
    }),
    prisma.employeeCompetency.findMany({
      where: { employeeId },
      select: { competencyId: true, currentLevel: true },
    }),
  ]);

  const analisis = analyzeCompetencyGap(
    standards.map((s) => ({
      competencyId: s.competencyId,
      competencyCode: s.competency.code,
      competencyName: s.competency.name,
      requiredLevel: s.requiredLevel,
      maxLevel: s.competency.maxLevel,
    })),
    dimiliki
  );

  res.json({ employee: karyawan, ...analisis });
};

/** Kesenjangan kompetensi seluruh karyawan, untuk merencanakan pelatihan. */
export const getGapReport = async (req: Request, res: Response) => {
  const query = req.query as unknown as GapQuery;

  const employees = await prisma.employee.findMany({
    where: {
      status: { notIn: ['resign', 'terminated', 'inactive'] },
      positionId: query.positionId ?? { not: null },
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    },
    select: { id: true, nik: true, name: true, positionId: true },
    orderBy: { name: 'asc' },
  });

  if (employees.length === 0) return res.json({ data: [] });

  const positionIds = [...new Set(employees.map((e) => e.positionId!))];

  const [standards, dimiliki] = await Promise.all([
    prisma.competencyStandard.findMany({
      where: { positionId: { in: positionIds } },
      include: { competency: { select: { id: true, code: true, name: true, maxLevel: true } } },
    }),
    prisma.employeeCompetency.findMany({
      where: { employeeId: { in: employees.map((e) => e.id) } },
      select: { employeeId: true, competencyId: true, currentLevel: true },
    }),
  ]);

  const data = employees.map((karyawan) => {
    const syarat = standards.filter((s) => s.positionId === karyawan.positionId);

    const analisis = analyzeCompetencyGap(
      syarat.map((s) => ({
        competencyId: s.competencyId,
        competencyCode: s.competency.code,
        competencyName: s.competency.name,
        requiredLevel: s.requiredLevel,
        maxLevel: s.competency.maxLevel,
      })),
      dimiliki.filter((d) => d.employeeId === karyawan.id)
    );

    return {
      employee: karyawan,
      totalRequired: analisis.totalRequired,
      totalMet: analisis.totalMet,
      readinessPercent: analisis.readinessPercent,
      // Hanya yang belum terpenuhi yang dirinci — itulah yang perlu dilatih.
      unmetCompetencies: analisis.gaps.filter((g) => !g.meets),
    };
  });

  res.json({ data });
};

// ============ Jenis sertifikasi ============

export const createCertificationType = async (req: Request, res: Response) => {
  const input = req.body as CreateCertificationTypeInput;

  if (input.trainingProgramId) {
    const program = await prisma.trainingProgram.findUnique({
      where: { id: input.trainingProgramId },
      select: { id: true },
    });
    if (!program) return res.status(404).json({ error: 'Program pelatihan tidak ditemukan' });
  }

  try {
    const jenis = await prisma.certificationType.create({
      data: { id: generateULID(), ...input },
    });
    res.status(201).json(jenis);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: `Kode sertifikasi "${input.code}" sudah dipakai` });
    }
    throw error;
  }
};

export const getAllCertificationTypes = async (req: Request, res: Response) => {
  const { page, limit, includeInactive } = req.query as unknown as ListCertificationTypeQuery;
  const where: Prisma.CertificationTypeWhereInput = includeInactive ? {} : { isActive: true };

  const [total, data] = await Promise.all([
    prisma.certificationType.count({ where }),
    prisma.certificationType.findMany({
      where,
      orderBy: [{ isMandatory: 'desc' }, { name: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
};

// ============ Catatan sertifikat ============

const certSelect = {
  id: true,
  employeeId: true,
  certificationTypeId: true,
  certificationName: true,
  issuingOrganization: true,
  issueDate: true,
  expiryDate: true,
  certificateUrl: true,
  trainingRegistrationId: true,
  revokedAt: true,
  revokedReason: true,
  note: true,
  createdAt: true,
  employee: { select: { id: true, nik: true, name: true, departmentId: true } },
} satisfies Prisma.CertificationRecordSelect;

export const createCertification = async (req: Request, res: Response) => {
  const input = req.body as CreateCertificationInput;

  const karyawan = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true },
  });
  if (!karyawan) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });

  let nama = input.certificationName;
  let penerbit = input.issuingOrganization;
  let kedaluwarsa = input.expiryDate ?? null;

  if (input.certificationTypeId) {
    const jenis = await prisma.certificationType.findUnique({
      where: { id: input.certificationTypeId },
    });
    if (!jenis) return res.status(404).json({ error: 'Jenis sertifikasi tidak ditemukan' });

    nama = nama ?? jenis.name;
    penerbit = penerbit ?? jenis.issuingOrganization ?? 'Tidak disebutkan';

    // Masa berlaku dihitung dari jenisnya bila tidak diisi manual.
    if (!kedaluwarsa && jenis.validityMonths !== null) {
      kedaluwarsa = addMonths(input.issueDate, jenis.validityMonths);
    }
  }

  const sertifikat = await prisma.certificationRecord.create({
    data: {
      id: generateULID(),
      employeeId: input.employeeId,
      certificationTypeId: input.certificationTypeId ?? null,
      certificationName: nama!,
      issuingOrganization: penerbit!,
      issueDate: input.issueDate,
      expiryDate: kedaluwarsa,
      certificateUrl: input.certificateUrl,
      note: input.note,
    },
    select: certSelect,
  });

  res.status(201).json(sertifikat);
};

export const revokeCertification = async (req: Request, res: Response) => {
  const { reason } = req.body as RevokeCertificationInput;

  const sertifikat = await prisma.certificationRecord.findUnique({
    where: { id: req.params.id },
    select: { id: true, revokedAt: true },
  });
  if (!sertifikat) return res.status(404).json({ error: 'Sertifikat tidak ditemukan' });

  if (sertifikat.revokedAt) {
    return res.status(409).json({ error: 'Sertifikat ini sudah dicabut' });
  }

  const dicabut = await prisma.certificationRecord.update({
    where: { id: sertifikat.id },
    data: { revokedAt: new Date(), revokedReason: reason },
    select: certSelect,
  });

  res.json(dicabut);
};

export const getAllCertifications = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListCertificationQuery;
  const actor = req.user!;

  const where: Prisma.CertificationRecordWhereInput = {
    ...(query.certificationTypeId ? { certificationTypeId: query.certificationTypeId } : {}),
  };

  // Yang bukan HR hanya melihat sertifikatnya sendiri.
  where.employeeId = isHr(actor.role) ? (query.employeeId ?? undefined) : actor.id;

  const rows = await prisma.certificationRecord.findMany({
    where,
    select: certSelect,
    orderBy: { issueDate: 'desc' },
  });

  const now = new Date();

  // Status dihitung, bukan dibaca dari kolom tersimpan yang bisa basi.
  const denganStatus = rows.map((r) => ({
    ...r,
    state: certificationState(
      { expiryDate: r.expiryDate, revokedAt: r.revokedAt },
      now,
      query.warningDays
    ),
  }));

  const tersaring = query.state
    ? denganStatus.filter((r) => r.state === query.state)
    : denganStatus;

  const mulai = (query.page - 1) * query.limit;

  res.json({
    data: tersaring.slice(mulai, mulai + query.limit),
    summary: {
      valid: denganStatus.filter((r) => r.state === 'valid').length,
      expiringSoon: denganStatus.filter((r) => r.state === 'expiring_soon').length,
      expired: denganStatus.filter((r) => r.state === 'expired').length,
      revoked: denganStatus.filter((r) => r.state === 'revoked').length,
    },
    pagination: {
      page: query.page,
      limit: query.limit,
      total: tersaring.length,
      totalPages: Math.ceil(tersaring.length / query.limit) || 1,
    },
  });
};
