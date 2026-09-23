// src/controllers/trainingController.ts
import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import { pasanganTeks } from '../utils/richText';
import {
  decideRegistrationStatus,
  evaluateTraining,
  assessCompliance,
  addMonths,
  SEAT_HOLDING_STATUSES,
} from '../utils/trainingRules';
import type {
  CreateProgramInput,
  UpdateProgramInput,
  ListProgramQuery,
  CreateSessionInput,
  ChangeSessionStatusInput,
  ListSessionQuery,
  RegisterInput,
  RecordAttendanceInput,
  EvaluateInput,
  ListRegistrationQuery,
  ComplianceQuery,
} from '../schemas/trainingSchema';

const isHr = (role: Role) => role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;
const num = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());
const dec = (v: number | null | undefined) => (v == null ? null : new Prisma.Decimal(v));

// ============ Program ============

const programDTO = (p: {
  passingScore: Prisma.Decimal | null;
  durationHours: Prisma.Decimal | null;
  [k: string]: unknown;
}) => ({ ...p, passingScore: num(p.passingScore), durationHours: num(p.durationHours) });

export const createProgram = async (req: Request, res: Response) => {
  const input = req.body as CreateProgramInput;

  if (input.targetPositionId) {
    const posisi = await prisma.position.findUnique({
      where: { id: input.targetPositionId },
      select: { id: true },
    });
    if (!posisi) return res.status(404).json({ error: 'Jabatan sasaran tidak ditemukan' });
  }
  if (input.targetDepartmentId) {
    const dept = await prisma.department.findUnique({
      where: { id: input.targetDepartmentId },
      select: { id: true },
    });
    if (!dept) return res.status(404).json({ error: 'Departemen sasaran tidak ditemukan' });
  }

  try {
    const isi = pasanganTeks(input.descriptionHtml, input.description);
    const program = await prisma.trainingProgram.create({
      data: {
        id: generateULID(),
        ...input,
        description: isi?.teks ?? input.description,
        descriptionHtml: isi?.html ?? null,
        passingScore: dec(input.passingScore),
        durationHours: dec(input.durationHours),
      },
    });
    res.status(201).json(programDTO(program));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: `Kode program "${input.code}" sudah dipakai` });
    }
    throw error;
  }
};

export const getAllPrograms = async (req: Request, res: Response) => {
  const { page, limit, category, isMandatory, includeInactive } =
    req.query as unknown as ListProgramQuery;

  const where: Prisma.TrainingProgramWhereInput = {
    ...(includeInactive ? {} : { isActive: true }),
    ...(category ? { category } : {}),
    ...(isMandatory !== undefined ? { isMandatory } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.trainingProgram.count({ where }),
    prisma.trainingProgram.findMany({
      where,
      orderBy: [{ isMandatory: 'desc' }, { name: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data: rows.map(programDTO),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
};

export const updateProgram = async (req: Request, res: Response) => {
  const input = req.body as UpdateProgramInput;

  if (input.targetPositionId) {
    const posisi = await prisma.position.findUnique({ where: { id: input.targetPositionId }, select: { id: true } });
    if (!posisi) return res.status(404).json({ error: 'Jabatan sasaran tidak ditemukan' });
  }
  if (input.targetDepartmentId) {
    const dept = await prisma.department.findUnique({ where: { id: input.targetDepartmentId }, select: { id: true } });
    if (!dept) return res.status(404).json({ error: 'Departemen sasaran tidak ditemukan' });
  }

  const { targetPositionId, targetDepartmentId, ...sisa } = input;
  const data: Prisma.TrainingProgramUpdateInput = { ...sisa };
  const isi = pasanganTeks(input.descriptionHtml, input.description);
  if (isi) {
    data.description = isi.teks;
    data.descriptionHtml = isi.html;
  }
  if (input.passingScore !== undefined) data.passingScore = dec(input.passingScore);
  if (input.durationHours !== undefined) data.durationHours = dec(input.durationHours);
  // null berarti lepaskan sasaran; string berarti pindahkan.
  if (targetPositionId !== undefined) data.targetPosition = targetPositionId ? { connect: { id: targetPositionId } } : { disconnect: true };
  if (targetDepartmentId !== undefined) data.targetDepartment = targetDepartmentId ? { connect: { id: targetDepartmentId } } : { disconnect: true };

  try {
    const program = await prisma.trainingProgram.update({ where: { id: req.params.id }, data });
    res.json(programDTO(program));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({ error: 'Program pelatihan tidak ditemukan' });
    }
    throw error;
  }
};

// ============ Sesi ============

const sessionSelect = {
  id: true,
  programId: true,
  title: true,
  description: true,
  trainer: true,
  startDateTime: true,
  endDateTime: true,
  location: true,
  maxParticipants: true,
  registrationDeadline: true,
  cost: true,
  status: true,
  createdAt: true,
  program: {
    select: { id: true, code: true, name: true, isMandatory: true, passingScore: true },
  },
  _count: { select: { registrations: true } },
} satisfies Prisma.TrainingSessionSelect;

type SessionRow = Prisma.TrainingSessionGetPayload<{ select: typeof sessionSelect }>;

const sessionDTO = (row: SessionRow) => ({
  ...row,
  cost: num(row.cost),
  program: { ...row.program, passingScore: num(row.program.passingScore) },
  registrationCount: row._count.registrations,
  _count: undefined,
});

export const createSession = async (req: Request, res: Response) => {
  const input = req.body as CreateSessionInput;

  const program = await prisma.trainingProgram.findUnique({
    where: { id: input.programId },
    select: { id: true, isActive: true },
  });

  if (!program || !program.isActive) {
    return res.status(404).json({ error: 'Program pelatihan tidak ditemukan atau tidak aktif' });
  }

  const sesi = await prisma.trainingSession.create({
    data: {
      id: generateULID(),
      programId: input.programId,
      title: input.title,
      description: input.description,
      trainer: input.trainer,
      startDateTime: input.startDateTime,
      endDateTime: input.endDateTime,
      location: input.location,
      maxParticipants: input.maxParticipants ?? null,
      registrationDeadline: input.registrationDeadline ?? null,
      cost: dec(input.cost),
    },
    select: sessionSelect,
  });

  res.status(201).json(sessionDTO(sesi));
};

export const getAllSessions = async (req: Request, res: Response) => {
  const { page, limit, programId, status, startDate, endDate } =
    req.query as unknown as ListSessionQuery;

  const where: Prisma.TrainingSessionWhereInput = {
    ...(programId ? { programId } : {}),
    ...(status ? { status } : {}),
  };

  if (startDate || endDate) {
    where.startDateTime = {
      ...(startDate ? { gte: startDate } : {}),
      ...(endDate ? { lt: new Date(endDate.getTime() + 24 * 60 * 60 * 1000) } : {}),
    };
  }

  const [total, rows] = await Promise.all([
    prisma.trainingSession.count({ where }),
    prisma.trainingSession.findMany({
      where,
      select: sessionSelect,
      orderBy: { startDateTime: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data: rows.map(sessionDTO),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
};

/**
 * Mengubah status sesi.
 *
 * Membatalkan sesi ikut membatalkan seluruh pendaftaran yang belum selesai —
 * kalau tidak, pendaftaran menggantung pada sesi yang tidak pernah terjadi,
 * dan laporan kepatuhan menganggap orangnya masih terjadwal.
 */
export const changeSessionStatus = async (req: Request, res: Response) => {
  const { status, note } = req.body as ChangeSessionStatusInput;

  const sesi = await prisma.trainingSession.findUnique({
    where: { id: req.params.id },
    select: { id: true, status: true },
  });
  if (!sesi) return res.status(404).json({ error: 'Sesi pelatihan tidak ditemukan' });

  if (sesi.status === status) {
    return res.status(409).json({ error: `Sesi sudah berstatus "${status}"` });
  }
  if (sesi.status === 'completed' || sesi.status === 'cancelled') {
    return res.status(409).json({ error: `Sesi berstatus "${sesi.status}" tidak bisa diubah lagi` });
  }

  const hasil = await prisma.$transaction(async (tx) => {
    if (status === 'cancelled') {
      await tx.trainingRegistration.updateMany({
        where: {
          trainingSessionId: sesi.id,
          status: { in: ['registered', 'waitlisted', 'attended'] },
        },
        data: { status: 'cancelled', note: note ?? 'Sesi dibatalkan' },
      });
    }

    return tx.trainingSession.update({
      where: { id: sesi.id },
      data: { status },
      select: sessionSelect,
    });
  });

  res.json(sessionDTO(hasil));
};

// ============ Pendaftaran ============

const registrationSelect = {
  id: true,
  employeeId: true,
  trainingSessionId: true,
  registrationDate: true,
  status: true,
  attendanceStatus: true,
  evaluationScore: true,
  passed: true,
  completedAt: true,
  certificateUrl: true,
  expiresAt: true,
  note: true,
  employee: { select: { id: true, nik: true, name: true, departmentId: true } },
  trainingSession: {
    select: {
      id: true,
      title: true,
      startDateTime: true,
      status: true,
      program: { select: { id: true, code: true, name: true } },
    },
  },
} satisfies Prisma.TrainingRegistrationSelect;

type RegistrationRow = Prisma.TrainingRegistrationGetPayload<{ select: typeof registrationSelect }>;

const registrationDTO = (row: RegistrationRow) => ({
  ...row,
  evaluationScore: num(row.evaluationScore),
});

export const register = async (req: Request, res: Response) => {
  const input = req.body as RegisterInput;
  const actor = req.user!;

  const employeeId = input.employeeId ?? actor.id;

  // Mendaftarkan orang lain adalah wewenang HR; karyawan hanya mendaftar sendiri.
  if (employeeId !== actor.id && !isHr(actor.role)) {
    return res.status(403).json({ error: 'Anda hanya bisa mendaftarkan diri sendiri' });
  }

  const sesi = await prisma.trainingSession.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      status: true,
      maxParticipants: true,
      registrationDeadline: true,
      startDateTime: true,
    },
  });
  if (!sesi) return res.status(404).json({ error: 'Sesi pelatihan tidak ditemukan' });

  if (sesi.status !== 'scheduled') {
    return res.status(409).json({
      error: `Sesi berstatus "${sesi.status}" tidak menerima pendaftaran`,
    });
  }

  const batas = sesi.registrationDeadline ?? sesi.startDateTime;
  if (batas.getTime() < Date.now()) {
    return res.status(409).json({ error: 'Batas pendaftaran sudah lewat' });
  }

  const karyawan = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true },
  });
  if (!karyawan) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });

  const terisi = await prisma.trainingRegistration.count({
    where: { trainingSessionId: sesi.id, status: { in: SEAT_HOLDING_STATUSES } },
  });

  const status = decideRegistrationStatus({
    maxParticipants: sesi.maxParticipants,
    occupiedSeats: terisi,
  });

  try {
    const pendaftaran = await prisma.trainingRegistration.create({
      data: {
        id: generateULID(),
        employeeId,
        trainingSessionId: sesi.id,
        status,
        note: input.note,
      },
      select: registrationSelect,
    });

    res.status(201).json(registrationDTO(pendaftaran));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'Karyawan ini sudah terdaftar di sesi tersebut' });
    }
    throw error;
  }
};

/**
 * Membatalkan pendaftaran.
 *
 * Kursi yang lepas langsung diisi pendaftar daftar tunggu paling awal —
 * itulah gunanya daftar tunggu, dan tanpa promosi otomatis HR harus
 * memantaunya manual.
 */
export const cancelRegistration = async (req: Request, res: Response) => {
  const actor = req.user!;

  const pendaftaran = await prisma.trainingRegistration.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      employeeId: true,
      status: true,
      trainingSessionId: true,
      trainingSession: { select: { maxParticipants: true } },
    },
  });
  if (!pendaftaran) return res.status(404).json({ error: 'Pendaftaran tidak ditemukan' });

  if (pendaftaran.employeeId !== actor.id && !isHr(actor.role)) {
    return res.status(403).json({ error: 'Anda tidak punya akses membatalkan pendaftaran ini' });
  }

  if (!['registered', 'waitlisted'].includes(pendaftaran.status)) {
    return res.status(409).json({
      error: `Pendaftaran berstatus "${pendaftaran.status}" tidak bisa dibatalkan`,
    });
  }

  const dipromosikan = await prisma.$transaction(async (tx) => {
    await tx.trainingRegistration.update({
      where: { id: pendaftaran.id },
      data: { status: 'cancelled' },
    });

    if (pendaftaran.status !== 'registered' || pendaftaran.trainingSession.maxParticipants === null) {
      return null;
    }

    const terisi = await tx.trainingRegistration.count({
      where: {
        trainingSessionId: pendaftaran.trainingSessionId,
        status: { in: SEAT_HOLDING_STATUSES },
      },
    });

    if (terisi >= pendaftaran.trainingSession.maxParticipants) return null;

    const antrean = await tx.trainingRegistration.findFirst({
      where: { trainingSessionId: pendaftaran.trainingSessionId, status: 'waitlisted' },
      orderBy: { registrationDate: 'asc' },
      select: { id: true },
    });

    if (!antrean) return null;

    return tx.trainingRegistration.update({
      where: { id: antrean.id },
      data: { status: 'registered' },
      select: registrationSelect,
    });
  });

  res.json({
    message: 'Pendaftaran dibatalkan',
    promotedFromWaitlist: dipromosikan ? registrationDTO(dipromosikan) : null,
  });
};

export const recordAttendance = async (req: Request, res: Response) => {
  const { entries } = req.body as RecordAttendanceInput;

  const sesi = await prisma.trainingSession.findUnique({
    where: { id: req.params.id },
    select: { id: true, status: true },
  });
  if (!sesi) return res.status(404).json({ error: 'Sesi pelatihan tidak ditemukan' });

  if (sesi.status === 'cancelled') {
    return res.status(409).json({ error: 'Sesi yang dibatalkan tidak punya kehadiran' });
  }

  const ids = entries.map((e) => e.registrationId);
  const terdaftar = await prisma.trainingRegistration.findMany({
    where: { id: { in: ids }, trainingSessionId: sesi.id },
    select: { id: true },
  });

  const dikenal = new Set(terdaftar.map((r) => r.id));
  const asing = ids.filter((id) => !dikenal.has(id));

  if (asing.length > 0) {
    return res.status(400).json({
      error: 'Ada pendaftaran yang bukan milik sesi ini',
      unknownRegistrationIds: asing,
    });
  }

  await prisma.$transaction(
    entries.map((e) =>
      prisma.trainingRegistration.update({
        where: { id: e.registrationId },
        data: {
          status: e.attended ? 'attended' : 'no_show',
          attendanceStatus: e.attended ? 'attended' : 'absent',
        },
      })
    )
  );

  res.json({ message: 'Kehadiran dicatat', updated: entries.length });
};

/**
 * Mencatat hasil evaluasi pasca-pelatihan.
 *
 * Kelulusan dan masa berlakunya dihitung server dari aturan program, bukan
 * diterima dari klien — kalau tidak, ambang kelulusan program kehilangan arti.
 */
export const evaluate = async (req: Request, res: Response) => {
  const input = req.body as EvaluateInput;

  const pendaftaran = await prisma.trainingRegistration.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      status: true,
      employeeId: true,
      trainingSession: {
        select: {
          program: {
            select: {
              id: true,
              passingScore: true,
              validityMonths: true,
              // Jenis sertifikasi yang terbit otomatis dari kelulusan program ini.
              certificationTypes: { where: { isActive: true } },
            },
          },
        },
      },
    },
  });
  if (!pendaftaran) return res.status(404).json({ error: 'Pendaftaran tidak ditemukan' });

  // Hanya yang hadir yang bisa dievaluasi: menilai orang yang tidak datang
  // membuat riwayat pelatihannya tidak bisa dipercaya.
  if (pendaftaran.status !== 'attended') {
    return res.status(409).json({
      error: `Hanya peserta berstatus "attended" yang bisa dievaluasi, ini "${pendaftaran.status}"`,
    });
  }

  const program = pendaftaran.trainingSession.program;
  const selesai = new Date();

  const hasil = evaluateTraining({
    score: input.score ?? null,
    passingScore: num(program.passingScore),
    validityMonths: program.validityMonths,
    completedAt: selesai,
  });

  const { diperbarui, sertifikat } = await prisma.$transaction(async (tx) => {
    const baris = await tx.trainingRegistration.update({
      where: { id: pendaftaran.id },
      data: {
        status: hasil.status,
        passed: hasil.passed,
        evaluationScore: dec(input.score),
        completedAt: selesai,
        expiresAt: hasil.expiresAt,
        certificateUrl: input.certificateUrl,
        note: input.note,
      },
      select: registrationSelect,
    });

    if (!hasil.passed) return { diperbarui: baris, sertifikat: [] };

    // Kelulusan menerbitkan sertifikat untuk tiap jenis yang terikat program
    // ini. Tanpa otomatisasi, HR harus menerbitkannya satu per satu untuk
    // setiap peserta yang lulus — pekerjaan berulang yang mudah terlewat.
    const diterbitkan = [];
    for (const jenis of program.certificationTypes) {
      const kedaluwarsa =
        jenis.validityMonths !== null ? addMonths(selesai, jenis.validityMonths) : null;

      diterbitkan.push(
        await tx.certificationRecord.create({
          data: {
            id: generateULID(),
            employeeId: pendaftaran.employeeId,
            certificationTypeId: jenis.id,
            // Disalin saat terbit: sertifikat yang sudah keluar tidak boleh
            // berubah namanya karena master datanya disunting kemudian.
            certificationName: jenis.name,
            issuingOrganization: jenis.issuingOrganization ?? 'Internal',
            issueDate: selesai,
            expiryDate: kedaluwarsa,
            certificateUrl: input.certificateUrl,
            trainingRegistrationId: pendaftaran.id,
          },
          select: { id: true, certificationName: true, issueDate: true, expiryDate: true },
        })
      );
    }

    return { diperbarui: baris, sertifikat: diterbitkan };
  });

  res.json({ ...registrationDTO(diperbarui), issuedCertifications: sertifikat });
};

export const getAllRegistrations = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListRegistrationQuery;
  const actor = req.user!;

  const where: Prisma.TrainingRegistrationWhereInput = {
    ...(query.trainingSessionId ? { trainingSessionId: query.trainingSessionId } : {}),
    ...(query.status ? { status: query.status } : {}),
  };

  // Yang bukan HR hanya melihat riwayat pelatihannya sendiri.
  where.employeeId = isHr(actor.role) ? (query.employeeId ?? undefined) : actor.id;

  const [total, rows] = await Promise.all([
    prisma.trainingRegistration.count({ where }),
    prisma.trainingRegistration.findMany({
      where,
      select: registrationSelect,
      orderBy: { registrationDate: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  res.json({
    data: rows.map(registrationDTO),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit) || 1,
    },
  });
};

/**
 * Laporan kepatuhan pelatihan wajib.
 *
 * Menjawab pertanyaan yang tidak bisa dijawab tabel pendaftaran: siapa yang
 * belum pernah ikut, dan siapa yang sertifikatnya akan mati. Kewajiban hanya
 * dinilai untuk karyawan yang memang disasar program tersebut.
 */
export const getComplianceReport = async (req: Request, res: Response) => {
  const query = req.query as unknown as ComplianceQuery;

  const programs = await prisma.trainingProgram.findMany({
    where: {
      isMandatory: true,
      isActive: true,
      ...(query.programId ? { id: query.programId } : {}),
    },
  });

  if (programs.length === 0) {
    return res.json({ warningDays: query.warningDays, programs: [] });
  }

  const employees = await prisma.employee.findMany({
    where: {
      status: { notIn: ['resign', 'terminated', 'inactive'] },
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    },
    select: { id: true, nik: true, name: true, departmentId: true, positionId: true },
    orderBy: { name: 'asc' },
  });

  const registrations = await prisma.trainingRegistration.findMany({
    where: {
      employeeId: { in: employees.map((e) => e.id) },
      trainingSession: { programId: { in: programs.map((p) => p.id) } },
    },
    select: {
      employeeId: true,
      passed: true,
      completedAt: true,
      expiresAt: true,
      trainingSession: { select: { programId: true } },
    },
  });

  const now = new Date();

  const hasil = programs.map((program) => {
    const wajibBagi = employees.filter((e) => {
      if (program.targetPositionId) return e.positionId === program.targetPositionId;
      if (program.targetDepartmentId) return e.departmentId === program.targetDepartmentId;
      return true;
    });

    const baris = wajibBagi.map((karyawan) => {
      const miliknya = registrations.filter(
        (r) => r.employeeId === karyawan.id && r.trainingSession.programId === program.id
      );

      const penilaian = assessCompliance(
        miliknya.map((r) => ({
          passed: r.passed ?? false,
          completedAt: r.completedAt,
          expiresAt: r.expiresAt,
        })),
        now,
        query.warningDays
      );

      return { employee: karyawan, ...penilaian };
    });

    const hitung = (state: string) => baris.filter((b) => b.state === state).length;

    return {
      program: { id: program.id, code: program.code, name: program.name },
      requiredFor: wajibBagi.length,
      summary: {
        compliant: hitung('compliant'),
        expiringSoon: hitung('expiring_soon'),
        expired: hitung('expired'),
        neverCompleted: hitung('never_completed'),
      },
      // Yang sudah patuh tidak perlu ditindaklanjuti; hanya yang bermasalah
      // yang dirinci, supaya laporannya bisa langsung dikerjakan.
      needsAction: baris.filter((b) => b.state !== 'compliant'),
    };
  });

  res.json({ warningDays: query.warningDays, programs: hasil });
};
