// src/controllers/trainingController.ts
import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import { pasanganTeks } from '../utils/richText';
import { dalamLingkup, saringanLingkupKaryawan } from '../utils/lingkupData';
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

/**
 * Mengurus pendaftaran orang lain (mendaftarkan, membatalkan, termasuk setelah
 * sesi dimulai): pemegang pelatihan.ubah, atas karyawan dalam lingkup datanya.
 * Izin, bukan Role: HR yang izinnya dicabut lewat matriks Peran tidak lagi
 * mengurus pendaftaran orang lain; Super Admin selalu memegang semua izin.
 */
const urusPendaftaran = (
  actor: { id: string; role: Role; departmentId: string | null; permissions: string[] },
  karyawan: { id: string; departmentId: string | null }
) => actor.permissions.includes('pelatihan.ubah') && dalamLingkup(actor, karyawan);

/** Pengelola pelatihan (program, sesi, peserta): pelatihan.buat/ubah. */
const kelolaPelatihan = (actor: { permissions: string[] }) =>
  actor.permissions.includes('pelatihan.buat') || actor.permissions.includes('pelatihan.ubah');
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
  // Hanya pemegang kursi yang dihitung: pendaftaran yang dibatalkan dan
  // daftar tunggu dulu ikut terhitung, sehingga kuota tampak penuh dan
  // tombol "Daftar Tunggu" muncul padahal kursinya kosong.
  _count: { select: { registrations: { where: { status: { in: [...SEAT_HOLDING_STATUSES] } } } } },
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

  // Untuk dialog "Batalkan sesi": berapa pendaftaran aktif yang ikut batal,
  // termasuk daftar tunggu yang tidak terhitung sebagai pemegang kursi.
  const kelompok = rows.length
    ? await prisma.trainingRegistration.groupBy({
        by: ['trainingSessionId', 'status'],
        where: { trainingSessionId: { in: rows.map((r) => r.id) }, status: { in: ['registered', 'waitlisted', 'attended'] } },
        _count: { _all: true },
      })
    : [];
  const hitung = (sesiId: string, status?: string) =>
    kelompok.filter((k) => k.trainingSessionId === sesiId && (!status || k.status === status)).reduce((n, k) => n + k._count._all, 0);

  res.json({
    data: rows.map((r) => ({ ...sessionDTO(r), waitlistCount: hitung(r.id, 'waitlisted'), cancellableCount: hitung(r.id) })),
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
    // Sesi selesai: yang masih di daftar tunggu tidak pernah mendapat kursi.
    // Tanpa ini statusnya "daftar tunggu" selamanya pada pelatihan yang sudah
    // lewat, dan tidak ada jalur untuk membereskannya.
    if (status === 'completed') {
      await tx.trainingRegistration.updateMany({
        where: { trainingSessionId: sesi.id, status: 'waitlisted' },
        data: { status: 'cancelled', note: 'Sesi selesai; tidak mendapat kursi' },
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

  // Mendaftarkan orang lain adalah wewenang pengurus pelatihan dalam lingkupnya;
  // karyawan hanya mendaftar sendiri.
  if (employeeId !== actor.id) {
    const target = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, departmentId: true } });
    if (!target || !urusPendaftaran(actor, target)) {
      return res.status(403).json({ error: 'Anda hanya bisa mendaftarkan diri sendiri' });
    }
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

  // Satu baris per karyawan per sesi (unik di basis data). Pendaftaran yang
  // pernah dibatalkan dihidupkan lagi, bukan dibuat baru — dulu tertabrak
  // constraint unik dan dijawab "sudah terdaftar" padahal statusnya batal.
  const sebelumnya = await prisma.trainingRegistration.findUnique({
    where: { trainingSessionId_employeeId: { trainingSessionId: sesi.id, employeeId } },
    select: { id: true, status: true },
  });
  if (sebelumnya && sebelumnya.status !== 'cancelled') {
    return res.status(409).json({ error: 'Karyawan ini sudah terdaftar di sesi tersebut' });
  }
  if (sebelumnya) {
    const dihidupkan = await prisma.trainingRegistration.update({
      where: { id: sebelumnya.id },
      data: {
        status,
        registrationDate: new Date(),
        note: input.note ?? null,
        attendanceStatus: null,
        evaluationScore: null,
        passed: null,
        completedAt: null,
        expiresAt: null,
        certificateUrl: null,
      },
      select: registrationSelect,
    });
    return res.status(201).json(registrationDTO(dihidupkan));
  }

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
      trainingSession: { select: { maxParticipants: true, status: true, startDateTime: true } },
      employee: { select: { id: true, departmentId: true } },
    },
  });
  if (!pendaftaran) return res.status(404).json({ error: 'Pendaftaran tidak ditemukan' });

  const urus = urusPendaftaran(actor, pendaftaran.employee);
  if (pendaftaran.employeeId !== actor.id && !urus) {
    return res.status(403).json({ error: 'Anda tidak punya akses membatalkan pendaftaran ini' });
  }

  if (!['registered', 'waitlisted'].includes(pendaftaran.status)) {
    return res.status(409).json({
      error: `Pendaftaran berstatus "${pendaftaran.status}" tidak bisa dibatalkan`,
    });
  }

  // Sesi yang sudah berjalan: karyawan tidak bisa mundur sendiri (kehadirannya
  // yang menentukan); HR masih boleh membereskan pendaftaran yang keliru.
  // Sesi selesai atau batal tidak bisa disentuh siapa pun.
  const statusSesi = pendaftaran.trainingSession.status;
  if (statusSesi === 'completed' || statusSesi === 'cancelled') {
    return res.status(409).json({ error: `Sesi sudah ${statusSesi === 'completed' ? 'selesai' : 'dibatalkan'}; pendaftaran tidak bisa dibatalkan` });
  }
  // Jam mulai yang sudah lewat sama dengan "berlangsung" walau HR belum
  // menekan Mulai: pendaftaran ditutup pada jam yang sama, jadi mundur pun.
  const sudahMulai = statusSesi === 'ongoing' || pendaftaran.trainingSession.startDateTime.getTime() <= Date.now();
  if (sudahMulai && !urus) {
    return res.status(409).json({ error: 'Sesi sudah dimulai; hubungi HR bila tidak bisa hadir' });
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
    select: { id: true, status: true },
  });

  const dikenal = new Map(terdaftar.map((r) => [r.id, r.status]));
  const asing = ids.filter((id) => !dikenal.has(id));

  if (asing.length > 0) {
    return res.status(400).json({
      error: 'Ada pendaftaran yang bukan milik sesi ini',
      unknownRegistrationIds: asing,
    });
  }

  // Yang sudah dievaluasi (completed/failed) tidak disentuh: menyimpan ulang
  // kehadiran dulu menimpanya kembali menjadi "attended"/"no_show" dan
  // menghapus hasil evaluasinya dari riwayat. Daftar tunggu yang tidak
  // dicentang juga dibiarkan: mereka tidak pernah punya kursi, jadi bukan
  // "tidak hadir"; yang dicentang berarti datang dan diterima.
  const dilewati: { registrationId: string; status: string }[] = [];
  const diubah = entries.filter((e) => {
    const status = dikenal.get(e.registrationId)!;
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      dilewati.push({ registrationId: e.registrationId, status });
      return false;
    }
    if (status === 'waitlisted' && !e.attended) {
      dilewati.push({ registrationId: e.registrationId, status });
      return false;
    }
    return true;
  });

  await prisma.$transaction(
    diubah.map((e) =>
      prisma.trainingRegistration.update({
        where: { id: e.registrationId },
        data: {
          status: e.attended ? 'attended' : 'no_show',
          attendanceStatus: e.attended ? 'attended' : 'absent',
        },
      })
    )
  );

  res.json({ message: 'Kehadiran dicatat', updated: diubah.length, skipped: dilewati });
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
      completedAt: true,
      evaluationScore: true,
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
  // membuat riwayat pelatihannya tidak bisa dipercaya. Yang sudah dievaluasi
  // (lulus/tidak lulus) boleh DIKOREKSI — salah ketik nilai (9 untuk 90)
  // tidak boleh menjadi permanen di riwayat dan laporan kepatuhan.
  const koreksi = pendaftaran.status === 'completed' || pendaftaran.status === 'failed';
  if (pendaftaran.status !== 'attended' && !koreksi) {
    return res.status(409).json({
      error: `Hanya peserta berstatus "attended" yang bisa dievaluasi, ini "${pendaftaran.status}"`,
    });
  }

  const program = pendaftaran.trainingSession.program;
  // Koreksi mempertahankan tanggal selesai semula: masa berlaku tetap dihitung
  // dari pelatihan yang sebenarnya, bukan dari hari koreksinya.
  const selesai = koreksi && pendaftaran.completedAt ? pendaftaran.completedAt : new Date();

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

    // Sertifikat yang sudah terbit dari pendaftaran ini (evaluasi sebelumnya).
    const sudahTerbit = await tx.certificationRecord.findMany({
      where: { trainingRegistrationId: pendaftaran.id, revokedAt: null },
      select: { id: true, certificationTypeId: true },
    });

    if (!hasil.passed) {
      // Koreksi menjadi tidak lulus: sertifikat yang terbit karena kelulusan
      // lama dicabut, bukan dibiarkan berlaku.
      if (sudahTerbit.length > 0) {
        await tx.certificationRecord.updateMany({
          where: { id: { in: sudahTerbit.map((c) => c.id) } },
          data: { revokedAt: new Date(), revokedReason: 'Evaluasi pelatihan dikoreksi: tidak lulus' },
        });
      }
      return { diperbarui: baris, sertifikat: [] };
    }

    // Kelulusan menerbitkan sertifikat untuk tiap jenis yang terikat program
    // ini. Tanpa otomatisasi, HR harus menerbitkannya satu per satu untuk
    // setiap peserta yang lulus — pekerjaan berulang yang mudah terlewat.
    // Pada koreksi, jenis yang sertifikatnya sudah berlaku tidak diterbitkan dua kali.
    const jenisTerbit = new Set(sudahTerbit.map((c) => c.certificationTypeId));
    const diterbitkan = [];
    for (const jenis of program.certificationTypes.filter((j) => !jenisTerbit.has(j.id))) {
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

  if (koreksi) {
    res.locals.audit = {
      action: 'pelatihan.evaluasi.koreksi',
      entity: 'TrainingRegistration',
      entityId: pendaftaran.id,
      summary: `Mengoreksi evaluasi pelatihan (${pendaftaran.status} → ${hasil.status})`,
      metadata: { nilaiLama: num(pendaftaran.evaluationScore), nilaiBaru: input.score ?? null },
    };
  }
  res.json({ ...registrationDTO(diperbarui), issuedCertifications: sertifikat, corrected: koreksi });
};

export const getAllRegistrations = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListRegistrationQuery;
  const actor = req.user!;

  const where: Prisma.TrainingRegistrationWhereInput = {
    ...(query.trainingSessionId ? { trainingSessionId: query.trainingSessionId } : {}),
    ...(query.status ? { status: query.status } : {}),
  };

  const kelola = kelolaPelatihan(actor);

  // Kontrak:
  //   - tanpa saringan          → pendaftaran milik sendiri, untuk SIAPA PUN
  //                               (APK memakainya sebagai "riwayat saya", dan
  //                               tab Jadwal web sebagai status pendaftaran sendiri);
  //   - trainingSessionId       → peserta sesi itu: pengelola melihat semuanya
  //                               (kehadiran dicatat lintas departemen);
  //   - employeeId              → riwayat orang itu, bila dalam lingkup pengelola;
  //   - scope=semua             → riwayat semua karyawan dalam lingkup pengelola
  //                               (HR seluruh perusahaan, manajer departemennya).
  if (!kelola) {
    where.employeeId = actor.id;
  } else if (query.trainingSessionId) {
    if (query.employeeId) where.employeeId = query.employeeId;
  } else if (query.employeeId) {
    where.employeeId = query.employeeId;
    if (query.employeeId !== actor.id) where.employee = saringanLingkupKaryawan(actor) ?? { id: actor.id };
  } else if (query.scope === 'semua') {
    const lingkup = saringanLingkupKaryawan(actor) ?? { id: actor.id };
    if (Object.keys(lingkup).length > 0) where.OR = [{ employeeId: actor.id }, { employee: lingkup }];
  } else {
    where.employeeId = actor.id;
  }

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

  // Daftar siapa yang belum patuh adalah data per karyawan: manajer hanya
  // melihat departemennya sendiri.
  const lingkup = saringanLingkupKaryawan(req.user!, query.departmentId);
  if (!lingkup) return res.status(403).json({ error: 'Anda hanya bisa melihat departemen sendiri' });

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
      ...lingkup,
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
