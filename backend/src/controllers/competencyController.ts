// src/controllers/competencyController.ts
import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import {
  certificationState,
  analyzeCompetencyGap,
  validateLevel,
  type CertificationState,
} from '../utils/competencyRules';
import { addMonths } from '../utils/trainingRules';
import { kelola } from '../utils/permissions';
import { dalamLingkup, lingkupHr as isHr, saringanLingkupKaryawan as saringanLingkup } from '../utils/lingkupData';
import type { AuthUser } from '../middleware/auth';
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
  CertificationComplianceQuery,
} from '../schemas/competencySchema';

/**
 * Pengelola kompetensi: pemegang kompetensi.buat/ubah/hapus. Penjaga rute
 * memakai izin, jadi pemeriksaan di sini juga — izin kompetensi.lihat saja
 * berarti "kompetensi dan sertifikat sendiri". Izin, bukan Role: HR yang
 * izinnya dicabut lewat matriks Peran tidak lagi membaca data orang lain.
 */
const bolehKelolaKompetensi = (u: Pick<AuthUser, 'permissions'>): boolean =>
  kelola('kompetensi').some((k) => u.permissions.includes(k));

// Lingkup data (atas siapa) ada di utils/lingkupData.ts, dipakai bersama
// modul Kinerja dan Pelatihan.

const STATUS_NONAKTIF = ['resign', 'terminated', 'inactive'];

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
  const actor = req.user!;

  const [karyawan, kompetensi] = await Promise.all([
    prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, departmentId: true } }),
    prisma.competency.findUnique({ where: { id: input.competencyId } }),
  ]);

  if (!karyawan) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });
  if (!dalamLingkup(actor, karyawan)) {
    return res.status(403).json({ error: 'Anda hanya bisa menilai karyawan di departemen sendiri' });
  }
  if (!kompetensi || !kompetensi.isActive) {
    return res.status(404).json({ error: 'Kompetensi tidak ditemukan atau tidak aktif' });
  }

  const cek = validateLevel(input.currentLevel, kompetensi.maxLevel);
  if (!cek.valid) return res.status(400).json({ error: cek.reason });

  // Penilaian baru menggantikan yang lama seutuhnya: catatan dan bukti
  // penilaian sebelumnya tidak boleh diam-diam menempel pada tingkat baru.
  const penilaian = await prisma.employeeCompetency.upsert({
    where: {
      employeeId_competencyId: { employeeId, competencyId: input.competencyId },
    },
    update: {
      currentLevel: input.currentLevel,
      assessedById: actor.id,
      assessedAt: new Date(),
      evidenceUrl: input.evidenceUrl ?? null,
      note: input.note ?? null,
    },
    create: {
      id: generateULID(),
      employeeId,
      competencyId: input.competencyId,
      currentLevel: input.currentLevel,
      assessedById: actor.id,
      evidenceUrl: input.evidenceUrl ?? null,
      note: input.note ?? null,
    },
    include: {
      competency: { select: { id: true, code: true, name: true, maxLevel: true } },
      assessedBy: { select: { id: true, name: true } },
    },
  });

  res.json(penilaian);
};

/**
 * Analisis kesenjangan kompetensi seorang karyawan terhadap jabatannya.
 */
export const getEmployeeGap = async (req: Request, res: Response) => {
  const actor = req.user!;
  const employeeId = req.params.id;

  const karyawan = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, nik: true, name: true, positionId: true, departmentId: true },
  });
  if (!karyawan) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });

  // Diri sendiri selalu boleh; orang lain hanya bagi pengelola kompetensi
  // yang karyawan itu ada dalam lingkup datanya.
  if (karyawan.id !== actor.id && !(bolehKelolaKompetensi(actor) && dalamLingkup(actor, karyawan))) {
    return res.status(403).json({ error: 'Anda tidak punya akses ke analisis ini' });
  }

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
      select: {
        competencyId: true,
        currentLevel: true,
        assessedAt: true,
        note: true,
        evidenceUrl: true,
        assessedBy: { select: { id: true, name: true } },
      },
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

  // Manajer hanya melihat departemennya sendiri, seperti daftar karyawan.
  const lingkup = saringanLingkup(req.user!, query.departmentId);
  if (!lingkup) return res.status(403).json({ error: 'Anda hanya bisa melihat departemen sendiri' });

  const employees = await prisma.employee.findMany({
    where: {
      status: { notIn: STATUS_NONAKTIF },
      positionId: query.positionId ?? { not: null },
      ...lingkup,
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
      // null bila jabatannya belum punya standar — bukan "100% siap".
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
  if (input.targetPositionId) {
    const posisi = await prisma.position.findUnique({
      where: { id: input.targetPositionId },
      select: { id: true },
    });
    if (!posisi) return res.status(404).json({ error: 'Jabatan tidak ditemukan' });
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
    // Rujukan yang hilang di antara pemeriksaan dan penyimpanan tetap 404,
    // bukan galat server.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return res.status(404).json({ error: 'Jabatan atau program pelatihan yang dirujuk tidak ditemukan' });
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
  const actor = req.user!;

  const karyawan = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, departmentId: true },
  });
  if (!karyawan) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });
  if (!dalamLingkup(actor, karyawan)) {
    return res.status(403).json({ error: 'Anda hanya bisa mencatat sertifikat karyawan di departemen sendiri' });
  }

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
  const actor = req.user!;

  const sertifikat = await prisma.certificationRecord.findUnique({
    where: { id: req.params.id },
    select: { id: true, revokedAt: true, employee: { select: { id: true, departmentId: true } } },
  });
  if (!sertifikat) return res.status(404).json({ error: 'Sertifikat tidak ditemukan' });
  if (!dalamLingkup(actor, sertifikat.employee)) {
    return res.status(403).json({ error: 'Anda hanya bisa mencabut sertifikat karyawan di departemen sendiri' });
  }

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

  // Pengelola kompetensi melihat sertifikat dalam lingkup datanya (HR semua
  // karyawan, manajer departemennya, selain itu dirinya); yang lain hanya
  // sertifikat sendiri — izin kompetensi.lihat saja berarti "sertifikat sendiri".
  if (bolehKelolaKompetensi(actor)) {
    if (query.employeeId) where.employeeId = query.employeeId;
    const lingkup = saringanLingkup(actor) ?? { id: actor.id };
    if (Object.keys(lingkup).length > 0) where.OR = [{ employeeId: actor.id }, { employee: lingkup }];
  } else {
    where.employeeId = actor.id;
  }

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

// ============ Kepatuhan sertifikat wajib ============

type StatusKepatuhan = 'valid' | 'expiring_soon' | 'expired' | 'missing';

/** Status mana yang "lebih baik": sertifikat terbaik yang dipegang menentukan status karyawan. */
const PERINGKAT_STATUS: Record<Exclude<CertificationState, 'revoked'>, number> = {
  valid: 0,
  expiring_soon: 1,
  expired: 2,
};

/**
 * Siapa yang belum punya, atau sertifikat wajibnya kedaluwarsa / akan mati.
 * Kewajiban hanya dinilai bagi karyawan aktif yang memang disasar jenisnya
 * (jabatan tertentu, atau semua bila tidak dibatasi). Sertifikat yang dicabut
 * dianggap tidak ada.
 */
export const getCertificationCompliance = async (req: Request, res: Response) => {
  const query = req.query as unknown as CertificationComplianceQuery;

  const lingkup = saringanLingkup(req.user!, query.departmentId);
  if (!lingkup) return res.status(403).json({ error: 'Anda hanya bisa melihat departemen sendiri' });

  const jenis = await prisma.certificationType.findMany({
    where: {
      isMandatory: true,
      isActive: true,
      ...(query.certificationTypeId ? { id: query.certificationTypeId } : {}),
    },
    select: { id: true, code: true, name: true, validityMonths: true, targetPositionId: true },
    orderBy: { name: 'asc' },
  });
  if (jenis.length === 0) return res.json({ warningDays: query.warningDays, types: [] });

  const employees = await prisma.employee.findMany({
    where: { status: { notIn: STATUS_NONAKTIF }, ...lingkup },
    select: { id: true, nik: true, name: true, departmentId: true, positionId: true },
    orderBy: { name: 'asc' },
  });

  const records = await prisma.certificationRecord.findMany({
    where: {
      employeeId: { in: employees.map((e) => e.id) },
      certificationTypeId: { in: jenis.map((j) => j.id) },
      revokedAt: null,
    },
    select: { id: true, employeeId: true, certificationTypeId: true, expiryDate: true, revokedAt: true },
  });

  const now = new Date();

  const types = jenis.map((j) => {
    const wajibBagi = employees.filter((e) => (j.targetPositionId ? e.positionId === j.targetPositionId : true));

    const baris = wajibBagi.map((karyawan) => {
      const miliknya = records
        .filter((r) => r.employeeId === karyawan.id && r.certificationTypeId === j.id)
        .map((r) => ({ r, state: certificationState(r, now, query.warningDays) }))
        .filter((x): x is { r: (typeof records)[number]; state: Exclude<CertificationState, 'revoked'> } => x.state !== 'revoked')
        .sort((a, b) => PERINGKAT_STATUS[a.state] - PERINGKAT_STATUS[b.state]);
      const terbaik = miliknya[0];
      const state: StatusKepatuhan = terbaik ? terbaik.state : 'missing';
      return {
        employee: karyawan,
        state,
        expiryDate: terbaik?.r.expiryDate ?? null,
        certificationId: terbaik?.r.id ?? null,
      };
    });

    const hitung = (state: StatusKepatuhan) => baris.filter((b) => b.state === state).length;

    return {
      type: j,
      requiredFor: wajibBagi.length,
      summary: {
        valid: hitung('valid'),
        expiringSoon: hitung('expiring_soon'),
        expired: hitung('expired'),
        missing: hitung('missing'),
      },
      // Yang sudah berlaku tidak perlu ditindaklanjuti; hanya yang bermasalah
      // yang dirinci, supaya daftarnya bisa langsung dikerjakan.
      needsAction: baris.filter((b) => b.state !== 'valid'),
    };
  });

  res.json({ warningDays: query.warningDays, types });
};
