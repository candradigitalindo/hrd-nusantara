// src/controllers/attendanceController.ts
import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { decryptBytes, encryptJson, decryptJson } from '../utils/fieldCrypto';
import { evaluateIntegrity, type PreviousFix } from '../utils/locationIntegrity';

type Koordinat = { lat: number; lng: number };

/** null bila salah satu tidak ada: setengah koordinat tidak berarti apa-apa. */
const koordinatTerenkripsi = (lat?: number, lng?: number): string | null =>
  lat !== undefined && lng !== undefined ? encryptJson({ lat, lng } satisfies Koordinat) : null;
import { env } from '../config/env';
import { generateULID } from '../utils/generateULID';
import { decodeBase64Image, saveImage } from '../utils/imageUpload';
import {
  extractForVerification,
  verifyAgainstEnrollments,
  bufferToEmbedding,
  FaceProcessingError,
} from '../services/face';
import { handleFaceError } from './faceEnrollmentController';
import { distanceInMeters } from '../utils/geo';
import {
  resolveShiftWindow,
  evaluateCheckIn,
  evaluateCheckOut,
  pickNearestShift,
  businessDayRange,
} from '../utils/shiftTime';
import type {
  CheckInInput,
  CheckOutInput,
  OvertimeDecisionInput,
  ListAttendanceQuery,
  AttendanceReportQuery,
} from '../schemas/attendanceSchema';

const attendanceSelect = {
  id: true,
  employeeId: true,
  checkInTime: true,
  checkOutTime: true,
  checkInLocation: true,
  checkOutLocation: true,
  checkInMethod: true,
  checkOutMethod: true,
  faceImageUrl: true,
  workLocationId: true,
  shiftScheduleId: true,
  lateMinutes: true,
  earlyLeaveMinutes: true,
  workedMinutes: true,
  overtimeHours: true,
  overtimeApproved: true,
  overtimeApprovedById: true,
  overtimeApprovedAt: true,
  faceVerified: true,
  faceMatchScore: true,
  livenessScore: true,
  integrityFlags: true,
  integrityReport: true,
  checkOutIntegrityReport: true,
  status: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  employee: { select: { id: true, nik: true, name: true, departmentId: true } },
  workLocation: { select: { id: true, name: true } },
  shiftSchedule: { select: { id: true, date: true, startTime: true, endTime: true } },
} satisfies Prisma.AttendanceSelect;

type AttendanceRow = Prisma.AttendanceGetPayload<{ select: typeof attendanceSelect }>;

const num = (value: Prisma.Decimal | null) => (value === null ? null : value.toNumber());

// qrCodeScanned sengaja tidak pernah dikembalikan: isinya token QR lokasi,
// dan membocorkannya lewat riwayat presensi sama saja membagikan kunci absen.
const toDTO = (row: AttendanceRow) => ({
  ...row,
  // Bentuk respons tidak berubah: klien tetap menerima lat/long sebagai angka.
  checkInLatitude: decryptJson<Koordinat>(row.checkInLocation)?.lat ?? null,
  checkInLongitude: decryptJson<Koordinat>(row.checkInLocation)?.lng ?? null,
  checkOutLatitude: decryptJson<Koordinat>(row.checkOutLocation)?.lat ?? null,
  checkOutLongitude: decryptJson<Koordinat>(row.checkOutLocation)?.lng ?? null,
  overtimeHours: row.overtimeHours.toNumber(),
});

/** Presensi yang belum di-check-out dan belum ditandai lupa check-out. */
/**
 * Titik lokasi terakhir yang diketahui dari presensi sebelumnya, untuk
 * memeriksa kecepatan perpindahan yang mustahil.
 */
const posisiTerakhir = async (employeeId: string, kecuali?: string): Promise<PreviousFix | null> => {
  const terakhir = await prisma.attendance.findFirst({
    where: { employeeId, ...(kecuali ? { id: { not: kecuali } } : {}) },
    orderBy: { checkInTime: 'desc' },
    select: { checkInTime: true, checkOutTime: true, checkInLocation: true, checkOutLocation: true },
  });
  if (!terakhir) return null;
  const keluar = decryptJson<Koordinat>(terakhir.checkOutLocation);
  if (keluar && terakhir.checkOutTime) return { latitude: keluar.lat, longitude: keluar.lng, at: terakhir.checkOutTime };
  const masuk = decryptJson<Koordinat>(terakhir.checkInLocation);
  if (masuk) return { latitude: masuk.lat, longitude: masuk.lng, at: terakhir.checkInTime };
  return null;
};

const tolakIntegritas = (res: Response, reason: string | null, flags: string[], aksi: string) => {
  res.locals.audit = {
    action: 'attendance.integrity.blocked',
    entity: 'Attendance',
    summary: `${aksi} ditolak: ${reason}`,
    metadata: { flags },
  };
  return res.status(422).json({ error: `Presensi ditolak. ${reason}.`, details: { integrityFlags: flags } });
};

const findOpenAttendance = (employeeId: string) =>
  prisma.attendance.findFirst({
    where: { employeeId, checkOutTime: null, status: { not: 'no_checkout' } },
    orderBy: { checkInTime: 'desc' },
  });

/**
 * Menentukan lokasi kerja dari metode presensi, sekaligus memverifikasinya.
 *
 * Untuk QR, lokasi disimpulkan dari token — klien tidak boleh menyebut sendiri
 * lokasinya, karena itu akan membuat token bisa dipakai di mana saja.
 */
const resolveAndVerifyLocation = async (input: {
  method: string;
  qrToken?: string;
  workLocationId?: string;
  latitude?: number;
  longitude?: number;
}): Promise<
  | { ok: true; workLocationId: string | null; qrCodeScanned: string | null }
  | { ok: false; status: number; error: string; details?: unknown }
> => {
  if (input.method === 'qr') {
    const location = await prisma.workLocation.findUnique({
      where: { qrSecret: input.qrToken! },
    });

    if (!location || !location.isActive) {
      return { ok: false, status: 400, error: 'QR tidak dikenali atau lokasinya sudah tidak aktif' };
    }

    // Kalau koordinat ikut dikirim, tetap diperiksa: QR bisa saja difoto
    // lalu dipindai dari rumah.
    if (input.latitude !== undefined && input.longitude !== undefined) {
      const jarak = distanceInMeters(
        { latitude: input.latitude, longitude: input.longitude },
        { latitude: location.latitude.toNumber(), longitude: location.longitude.toNumber() }
      );

      if (jarak > location.radiusMeters) {
        return {
          ok: false,
          status: 422,
          error: 'Anda berada di luar radius lokasi kerja',
          details: { jarakMeter: Math.round(jarak), radiusMeter: location.radiusMeters },
        };
      }
    }

    return { ok: true, workLocationId: location.id, qrCodeScanned: location.qrSecret };
  }

  // Metode gps dan face: lokasi disebut klien, lalu koordinatnya diverifikasi.
  const location = await prisma.workLocation.findUnique({
    where: { id: input.workLocationId! },
  });

  if (!location || !location.isActive) {
    return { ok: false, status: 400, error: 'Lokasi kerja tidak ditemukan atau tidak aktif' };
  }

  const jarak = distanceInMeters(
    { latitude: input.latitude!, longitude: input.longitude! },
    { latitude: location.latitude.toNumber(), longitude: location.longitude.toNumber() }
  );

  if (jarak > location.radiusMeters) {
    return {
      ok: false,
      status: 422,
      error: 'Anda berada di luar radius lokasi kerja',
      details: { jarakMeter: Math.round(jarak), radiusMeter: location.radiusMeters },
    };
  }

  return { ok: true, workLocationId: location.id, qrCodeScanned: null };
};

/**
 * Seberapa awal seseorang boleh dianggap datang untuk sebuah shift.
 *
 * Tanpa batas ini, check-in pagi hari akan tertaut ke shift malam yang baru
 * mulai belasan jam kemudian, lalu check-out-nya tercatat sebagai "pulang
 * cepat 1345 menit" di laporan HR.
 */
const BATAS_DATANG_AWAL_JAM = 4;

/** Mencari shift yang paling masuk akal untuk waktu check-in tertentu. */
const findShiftForCheckIn = async (employeeId: string, checkInTime: Date) => {
  const sehari = 24 * 60 * 60 * 1000;
  const tengahMalamUtc = new Date(
    Date.UTC(
      checkInTime.getUTCFullYear(),
      checkInTime.getUTCMonth(),
      checkInTime.getUTCDate()
    )
  );

  // Rentang sehari sebelum dan sesudah, karena shift malam melewati tengah
  // malam dan karyawan biasanya datang sebelum jam mulai.
  const kandidat = await prisma.shiftSchedule.findMany({
    where: {
      employeeId,
      status: { not: 'cancelled' },
      date: {
        gte: new Date(tengahMalamUtc.getTime() - sehari),
        lte: new Date(tengahMalamUtc.getTime() + sehari),
      },
    },
  });

  const berjendela = kandidat.map((shift) => ({
    shift,
    ...resolveShiftWindow(shift.date, shift.startTime, shift.endTime, env.APP_TIMEZONE),
  }));

  // Hanya shift yang waktunya benar-benar berdekatan dengan check-in.
  // Sisanya diperlakukan sebagai presensi di luar jadwal.
  const layak = berjendela.filter(
    ({ start, end }) =>
      checkInTime.getTime() >= start.getTime() - BATAS_DATANG_AWAL_JAM * 3_600_000 &&
      checkInTime.getTime() <= end.getTime()
  );

  return pickNearestShift(layak, checkInTime);
};

interface HasilVerifikasiWajah {
  faceVerified: boolean;
  faceMatchScore: number;
  livenessScore: number | null;
  imageUrl: string | null;
}

/**
 * Memverifikasi bahwa wajah di foto adalah karyawan pemilik token.
 *
 * Perbandingannya 1:1 — identitas yang diklaim sudah diketahui dari token,
 * jadi cukup dibandingkan dengan pendaftaran milik orang itu saja. Melempar
 * FaceProcessingError kalau wajahnya tidak cocok, sehingga presensi gagal
 * alih-alih tercatat tanpa verifikasi.
 */
const verifikasiWajah = async (
  employeeId: string,
  base64Image: string
): Promise<HasilVerifikasiWajah> => {
  const { buffer, extension } = decodeBase64Image(base64Image);
  const probe = await extractForVerification(buffer);

  const terdaftar = await prisma.faceEnrollment.findMany({
    where: { employeeId, isActive: true, modelName: probe.modelName },
    select: { id: true, embedding: true },
  });

  if (terdaftar.length === 0) {
    throw new FaceProcessingError(
      'not_enrolled',
      'Wajah Anda belum terdaftar untuk model yang aktif. Hubungi HR untuk pendaftaran.'
    );
  }

  const hasil = verifyAgainstEnrollments(
    probe.embedding,
    terdaftar.map((e) => ({ id: e.id, embedding: bufferToEmbedding(decryptBytes(e.embedding)) }))
  );

  if (!hasil.matched) {
    throw new FaceProcessingError('no_match', 'Wajah tidak cocok dengan data karyawan ini');
  }

  // Foto check-in tidak disimpan kecuali diminta lewat konfigurasi:
  // menyimpan selfie harian seluruh karyawan adalah timbunan data biometrik
  // yang manfaat auditnya sudah tercukupi oleh skor kemiripan.
  const imageUrl = env.FACE_STORE_CHECKIN_IMAGES
    ? await saveImage(buffer, extension, 'attendance-faces')
    : null;

  return {
    faceVerified: true,
    faceMatchScore: hasil.similarity,
    livenessScore: probe.livenessScore,
    imageUrl,
  };
};

export const checkIn = async (req: Request, res: Response) => {
  const input = req.body as CheckInInput;
  const employeeId = req.user!.id;
  const now = new Date();

  const terbuka = await findOpenAttendance(employeeId);

  if (terbuka) {
    const umurJam = (now.getTime() - terbuka.checkInTime.getTime()) / 3_600_000;

    if (umurJam < env.ATTENDANCE_MAX_SHIFT_HOURS) {
      return res.status(409).json({
        error: 'Anda sudah check-in dan belum check-out',
        attendanceId: terbuka.id,
        checkInTime: terbuka.checkInTime,
      });
    }

    // Shift kemarin yang tidak pernah ditutup. Ditandai supaya ketahuan di
    // laporan, lalu karyawan tetap boleh memulai shift hari ini.
    await prisma.attendance.update({
      where: { id: terbuka.id },
      data: { status: 'no_checkout' },
    });
  }

  const lokasi = await resolveAndVerifyLocation(input);
  if (!lokasi.ok) {
    return res.status(lokasi.status).json({ error: lokasi.error, details: lokasi.details });
  }

  // Deteksi lokasi palsu: sinyal dari ponsel + kecepatan perpindahan mustahil.
  const pakaiGps = input.method !== 'qr';
  const integritas = evaluateIntegrity({
    report: input.integrity,
    usesGps: pakaiGps,
    position: input.latitude !== undefined && input.longitude !== undefined ? { latitude: input.latitude, longitude: input.longitude } : undefined,
    previous: pakaiGps ? await posisiTerakhir(employeeId) : null,
    now,
  });
  if (integritas.blocked) return tolakIntegritas(res, integritas.reason, integritas.flags, 'Check-in');

  let wajah: HasilVerifikasiWajah = {
    faceVerified: false,
    faceMatchScore: 0,
    livenessScore: null,
    imageUrl: null,
  };

  if (input.method === 'face') {
    try {
      wajah = await verifikasiWajah(employeeId, input.faceImage!);
    } catch (error) {
      if (handleFaceError(error, res)) return;
      throw error;
    }
  }

  const shift = await findShiftForCheckIn(employeeId, now);

  const penilaian = shift
    ? evaluateCheckIn(shift.start, now, env.ATTENDANCE_LATE_TOLERANCE_MINUTES)
    : { lateMinutes: 0, status: 'present' as const };

  const attendance = await prisma.attendance.create({
    data: {
      id: generateULID(),
      employeeId,
      checkInTime: now,
      checkInMethod: input.method,
      // Koordinat disimpan terenkripsi; geofence sudah dihitung dari nilai
      // masukan di atas, jadi tidak ada yang membutuhkannya dalam bentuk terbuka.
      checkInLocation: koordinatTerenkripsi(input.latitude, input.longitude),
      faceImageUrl: wajah.imageUrl,
      faceVerified: wajah.faceVerified,
      faceMatchScore: input.method === 'face' ? wajah.faceMatchScore : null,
      livenessScore: wajah.livenessScore,
      qrCodeScanned: lokasi.qrCodeScanned,
      workLocationId: lokasi.workLocationId,
      shiftScheduleId: shift?.shift.id ?? null,
      lateMinutes: penilaian.lateMinutes,
      status: penilaian.status,
      notes: input.notes,
      integrityFlags: integritas.flags,
      integrityReport: input.integrity ?? undefined,
    },
    select: attendanceSelect,
  });

  res.status(201).json(toDTO(attendance));
};

export const checkOut = async (req: Request, res: Response) => {
  const input = req.body as CheckOutInput;
  const employeeId = req.user!.id;
  const now = new Date();

  const terbuka = await findOpenAttendance(employeeId);
  if (!terbuka) {
    return res.status(404).json({ error: 'Tidak ada presensi terbuka. Lakukan check-in dulu.' });
  }

  // Lokasi saat check-out mengikuti lokasi check-in kalau klien tidak
  // menyebutkannya lagi.
  const lokasi = await resolveAndVerifyLocation({
    ...input,
    workLocationId: input.workLocationId ?? terbuka.workLocationId ?? undefined,
  });
  if (!lokasi.ok) {
    return res.status(lokasi.status).json({ error: lokasi.error, details: lokasi.details });
  }

  const pakaiGpsKeluar = input.method !== 'qr';
  const masuk = decryptJson<Koordinat>(terbuka.checkInLocation);
  const integritasKeluar = evaluateIntegrity({
    report: input.integrity,
    usesGps: pakaiGpsKeluar,
    position: input.latitude !== undefined && input.longitude !== undefined ? { latitude: input.latitude, longitude: input.longitude } : undefined,
    previous: pakaiGpsKeluar && masuk ? { latitude: masuk.lat, longitude: masuk.lng, at: terbuka.checkInTime } : null,
    now,
  });
  if (integritasKeluar.blocked) return tolakIntegritas(res, integritasKeluar.reason, integritasKeluar.flags, 'Check-out');

  if (input.method === 'face') {
    try {
      await verifikasiWajah(employeeId, input.faceImage!);
    } catch (error) {
      if (handleFaceError(error, res)) return;
      throw error;
    }
  }

  const shift = terbuka.shiftScheduleId
    ? await prisma.shiftSchedule.findUnique({ where: { id: terbuka.shiftScheduleId } })
    : null;

  const window = shift
    ? resolveShiftWindow(shift.date, shift.startTime, shift.endTime, env.APP_TIMEZONE)
    : null;

  const penilaian = evaluateCheckOut({
    checkInTime: terbuka.checkInTime,
    checkOutTime: now,
    shiftEnd: window?.end ?? null,
    breakHours: shift ? shift.breakDuration.toNumber() : 0,
    toleranceMinutes: env.ATTENDANCE_LATE_TOLERANCE_MINUTES,
    minOvertimeMinutes: env.ATTENDANCE_MIN_OVERTIME_MINUTES,
  });

  const attendance = await prisma.attendance.update({
    where: { id: terbuka.id },
    data: {
      checkOutTime: now,
      checkOutMethod: input.method,
      checkOutLocation: koordinatTerenkripsi(input.latitude, input.longitude),
      workedMinutes: penilaian.workedMinutes,
      earlyLeaveMinutes: penilaian.earlyLeaveMinutes,
      // Lembur tercatat, tapi belum disetujui — payroll hanya menghitung
      // yang sudah diotorisasi atasan.
      overtimeHours: new Prisma.Decimal(penilaian.overtimeHours),
      ...(input.notes ? { notes: input.notes } : {}),
      // Penanda check-out digabung dengan penanda check-in, tanpa duplikat.
      integrityFlags: [...new Set([...terbuka.integrityFlags, ...integritasKeluar.flags])],
      checkOutIntegrityReport: input.integrity ?? undefined,
    },
    select: attendanceSelect,
  });

  res.json(toDTO(attendance));
};

const buildAttendanceWhere = (
  query: ListAttendanceQuery,
  actor: { role: Role; departmentId: string | null }
): Prisma.AttendanceWhereInput | { forbidden: string } => {
  const where: Prisma.AttendanceWhereInput = {};

  if (actor.role === Role.MANAGER) {
    if (query.departmentId && query.departmentId !== actor.departmentId) {
      return { forbidden: 'Anda hanya bisa melihat departemen sendiri' };
    }
    where.employee = { departmentId: actor.departmentId ?? '__tanpa_departemen__' };
  } else if (query.departmentId) {
    where.employee = { departmentId: query.departmentId };
  }

  if (query.employeeId) where.employeeId = query.employeeId;
  if (query.status) where.status = query.status;
  if (query.onlyPendingOvertime) {
    where.overtimeHours = { gt: 0 };
    where.overtimeApproved = false;
  }
  if (query.flaggedOnly) where.integrityFlags = { isEmpty: false };

  if (query.startDate || query.endDate) {
    const rentang = businessDayRange(
      query.startDate ?? query.endDate!,
      query.endDate ?? query.startDate!,
      env.APP_TIMEZONE
    );
    where.checkInTime = {
      ...(query.startDate ? { gte: rentang.gte } : {}),
      ...(query.endDate ? { lt: rentang.lt } : {}),
    };
  }

  return where;
};

export const getAllAttendance = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListAttendanceQuery;

  const where = buildAttendanceWhere(query, req.user!);
  if ('forbidden' in where) {
    return res.status(403).json({ error: where.forbidden });
  }

  const [total, rows] = await Promise.all([
    prisma.attendance.count({ where }),
    prisma.attendance.findMany({
      where,
      select: attendanceSelect,
      orderBy: { checkInTime: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  res.json({
    data: rows.map(toDTO),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit) || 1,
    },
  });
};

export const getMyAttendance = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListAttendanceQuery;

  const where: Prisma.AttendanceWhereInput = { employeeId: req.user!.id };
  if (query.startDate || query.endDate) {
    const rentang = businessDayRange(
      query.startDate ?? query.endDate!,
      query.endDate ?? query.startDate!,
      env.APP_TIMEZONE
    );
    where.checkInTime = {
      ...(query.startDate ? { gte: rentang.gte } : {}),
      ...(query.endDate ? { lt: rentang.lt } : {}),
    };
  }

  const [total, rows] = await Promise.all([
    prisma.attendance.count({ where }),
    prisma.attendance.findMany({
      where,
      select: attendanceSelect,
      orderBy: { checkInTime: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  res.json({
    data: rows.map(toDTO),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit) || 1,
    },
  });
};

export const getAttendanceById = async (req: Request, res: Response) => {
  const actor = req.user!;

  const attendance = await prisma.attendance.findUnique({
    where: { id: req.params.id },
    select: attendanceSelect,
  });

  if (!attendance) {
    return res.status(404).json({ error: 'Data presensi tidak ditemukan' });
  }

  const isSelf = attendance.employeeId === actor.id;
  const isHr = actor.role === Role.HR_ADMIN || actor.role === Role.SUPER_ADMIN;
  const isManagerOfDept =
    actor.role === Role.MANAGER &&
    actor.departmentId !== null &&
    actor.departmentId === attendance.employee.departmentId;

  if (!isSelf && !isHr && !isManagerOfDept) {
    return res.status(403).json({ error: 'Anda tidak punya akses ke data presensi ini' });
  }

  res.json(toDTO(attendance));
};

/**
 * Otorisasi lembur (hrd_features_doc.md bagian 2). Sampai disetujui, jam
 * lembur tercatat tapi tidak boleh ikut dihitung payroll.
 */
export const decideOvertime = async (req: Request, res: Response) => {
  const { approved, notes } = req.body as OvertimeDecisionInput;
  const actor = req.user!;

  const attendance = await prisma.attendance.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      employeeId: true,
      overtimeHours: true,
      employee: { select: { departmentId: true } },
    },
  });

  if (!attendance) {
    return res.status(404).json({ error: 'Data presensi tidak ditemukan' });
  }

  if (attendance.overtimeHours.toNumber() <= 0) {
    return res.status(400).json({ error: 'Presensi ini tidak mencatat jam lembur' });
  }

  // Tidak boleh menyetujui lembur sendiri.
  if (attendance.employeeId === actor.id) {
    return res.status(403).json({ error: 'Anda tidak bisa menyetujui lembur sendiri' });
  }

  if (
    actor.role === Role.MANAGER &&
    attendance.employee.departmentId !== actor.departmentId
  ) {
    return res.status(403).json({ error: 'Anda hanya bisa menyetujui lembur di departemen sendiri' });
  }

  const updated = await prisma.attendance.update({
    where: { id: attendance.id },
    data: {
      overtimeApproved: approved,
      overtimeApprovedById: actor.id,
      overtimeApprovedAt: new Date(),
      ...(notes ? { notes } : {}),
    },
    select: attendanceSelect,
  });

  res.json({
    message: approved ? 'Lembur disetujui' : 'Lembur ditolak',
    attendance: toDTO(updated),
  });
};

/**
 * Rekap presensi per karyawan untuk satu periode.
 *
 * "Absen" dihitung dari shift terjadwal yang tidak punya presensi sama sekali —
 * itulah definisi "absen tanpa izin" di dokumen fitur. Tanpa membandingkan ke
 * jadwal, ketidakhadiran tidak akan pernah terlihat karena memang tidak ada
 * barisnya di tabel presensi.
 */
export const getAttendanceReport = async (req: Request, res: Response) => {
  const query = req.query as unknown as AttendanceReportQuery;
  const actor = req.user!;

  if (query.endDate < query.startDate) {
    return res.status(400).json({ error: 'endDate tidak boleh lebih awal dari startDate' });
  }

  const employeeWhere: Prisma.EmployeeWhereInput = {};

  if (actor.role === Role.MANAGER) {
    if (query.departmentId && query.departmentId !== actor.departmentId) {
      return res.status(403).json({ error: 'Anda hanya bisa melihat departemen sendiri' });
    }
    employeeWhere.departmentId = actor.departmentId ?? '__tanpa_departemen__';
  } else if (query.departmentId) {
    employeeWhere.departmentId = query.departmentId;
  }

  if (query.employeeId) employeeWhere.id = query.employeeId;

  // Presensi adalah titik waktu absolut, jadi batasnya mengikuti hari kerja
  // di zona operasional. Sementara ShiftSchedule.date adalah kunci tanggal
  // kalender (tengah malam UTC), jadi dibandingkan apa adanya.
  const rentangPresensi = businessDayRange(query.startDate, query.endDate, env.APP_TIMEZONE);
  const akhirTanggalEksklusif = new Date(query.endDate.getTime() + 24 * 60 * 60 * 1000);

  const employees = await prisma.employee.findMany({
    where: employeeWhere,
    select: { id: true, nik: true, name: true, departmentId: true },
    orderBy: { name: 'asc' },
  });

  const employeeIds = employees.map((e) => e.id);

  if (employeeIds.length === 0) {
    return res.json({
      period: { startDate: query.startDate, endDate: query.endDate },
      data: [],
    });
  }

  const [presensi, shifts] = await Promise.all([
    prisma.attendance.findMany({
      where: {
        employeeId: { in: employeeIds },
        checkInTime: { gte: rentangPresensi.gte, lt: rentangPresensi.lt },
      },
      select: {
        employeeId: true,
        status: true,
        lateMinutes: true,
        earlyLeaveMinutes: true,
        workedMinutes: true,
        overtimeHours: true,
        overtimeApproved: true,
        shiftScheduleId: true,
      },
    }),
    prisma.shiftSchedule.findMany({
      where: {
        employeeId: { in: employeeIds },
        status: { not: 'cancelled' },
        date: { gte: query.startDate, lt: akhirTanggalEksklusif },
      },
      select: { id: true, employeeId: true, date: true },
    }),
  ]);

  const shiftTerpakai = new Set(
    presensi.map((p) => p.shiftScheduleId).filter((id): id is string => id !== null)
  );

  // Shift yang jatuh pada cuti yang sudah disetujui bukan mangkir. Tanpa
  // pengecekan ini, karyawan yang cutinya disetujui tetap tercatat "absen
  // tanpa izin" di laporan — dan itu bisa berujung pada potongan gaji.
  const cutiDisetujui = await prisma.leave.findMany({
    where: {
      employeeId: { in: employeeIds },
      status: 'approved',
      startDate: { lte: query.endDate },
      endDate: { gte: query.startDate },
    },
    select: { employeeId: true, startDate: true, endDate: true },
  });

  const sedangCuti = (employeeId: string, tanggal: Date) =>
    cutiDisetujui.some(
      (c) =>
        c.employeeId === employeeId &&
        tanggal.getTime() >= c.startDate.getTime() &&
        tanggal.getTime() <= c.endDate.getTime()
    );

  const data = employees.map((employee) => {
    const miliknya = presensi.filter((p) => p.employeeId === employee.id);
    const shiftnya = shifts.filter((s) => s.employeeId === employee.id);

    const shiftTanpaPresensi = shiftnya.filter(
      (s) => !shiftTerpakai.has(s.id) && !sedangCuti(employee.id, s.date)
    ).length;

    const shiftSaatCuti = shiftnya.filter((s) => sedangCuti(employee.id, s.date)).length;

    return {
      employee,
      scheduledShifts: shiftnya.length,
      totalAttendance: miliknya.length,
      present: miliknya.filter((p) => p.status === 'present').length,
      late: miliknya.filter((p) => p.status === 'late').length,
      missingCheckout: miliknya.filter((p) => p.status === 'no_checkout').length,
      absent: shiftTanpaPresensi,
      onApprovedLeave: shiftSaatCuti,
      totalLateMinutes: miliknya.reduce((sum, p) => sum + p.lateMinutes, 0),
      totalEarlyLeaveMinutes: miliknya.reduce((sum, p) => sum + p.earlyLeaveMinutes, 0),
      totalWorkedHours:
        Math.round((miliknya.reduce((sum, p) => sum + p.workedMinutes, 0) / 60) * 100) / 100,
      approvedOvertimeHours:
        Math.round(
          miliknya
            .filter((p) => p.overtimeApproved)
            .reduce((sum, p) => sum + p.overtimeHours.toNumber(), 0) * 100
        ) / 100,
      pendingOvertimeHours:
        Math.round(
          miliknya
            .filter((p) => !p.overtimeApproved)
            .reduce((sum, p) => sum + p.overtimeHours.toNumber(), 0) * 100
        ) / 100,
    };
  });

  res.json({
    period: { startDate: query.startDate, endDate: query.endDate },
    data,
  });
};
