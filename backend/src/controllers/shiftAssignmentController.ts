// src/controllers/shiftAssignmentController.ts
//
// "Tetapkan Shift": satu jenis shift untuk satu atau banyak karyawan, berlaku
// 1 hari / 1 minggu / 1 bulan / seterusnya / sampai tanggal tertentu — supaya
// roster tidak perlu diisi setiap hari. Penugasan berjangka dimaterialisasi
// menjadi baris ShiftSchedule biasa lewat services/shiftAssignment.ts.
import { Request, Response } from 'express';
import { DateTime } from 'luxon';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { generateULID } from '../utils/generateULID';
import { calendarKey } from '../utils/leaveDays';
import {
  HORIZON_HARI,
  hariIni,
  geserHari,
  materialisasi,
  type AlasanLewat,
  type Db,
} from '../services/shiftAssignment';
import {
  assertCanScheduleEmployee,
  cariJenisShiftUntukDipakai,
  findOverlappingShift,
  tolakManajerTanpaDepartemen,
  validateShiftTimes,
  type AktorJadwal,
} from './shiftController';
import { ACTIVE_STATUSES } from '../middleware/auth';
import type {
  CreateAssignmentInput,
  EndAssignmentInput,
  ListAssignmentQuery,
} from '../schemas/shiftSchema';

const assignmentSelect = {
  id: true,
  employeeId: true,
  employee: { select: { id: true, name: true, nik: true, departmentId: true } },
  template: { select: { id: true, name: true, code: true, color: true, startTime: true, endTime: true } },
  startDate: true,
  endDate: true,
  weekdays: true,
  skipPublicHolidays: true,
  status: true,
  notes: true,
  createdAt: true,
} satisfies Prisma.ShiftAssignmentSelect;

type AssignmentRow = Prisma.ShiftAssignmentGetPayload<{ select: typeof assignmentSelect }>;

/** Tanggal dikirim sebagai YYYY-MM-DD: penugasan berbicara dalam tanggal kalender, bukan waktu. */
const toAssignmentDTO = (a: AssignmentRow) => ({
  ...a,
  startDate: calendarKey(a.startDate),
  endDate: a.endDate ? calendarKey(a.endDate) : null,
  weekdays: [...a.weekdays].sort((x, y) => x - y),
});

const tanpaPresensi = { attendances: { none: {} } } satisfies Prisma.ShiftScheduleWhereInput;

/**
 * Tanggal akhir efektif sebuah durasi (inklusif); null = seterusnya.
 *
 * "1 bulan" dari 31 Januari berakhir 28/29 Februari, bukan 27 Februari:
 * luxon memangkas 31 Feb menjadi akhir Februari, dan hasil pangkasan itu
 * sudah merupakan hari terakhir rentangnya — tidak dikurangi sehari lagi.
 */
export const akhirDurasi = (input: Pick<CreateAssignmentInput, 'durasi' | 'startDate' | 'endDate'>): Date | null => {
  switch (input.durasi) {
    case 'hari':
      return input.startDate;
    case 'minggu':
      return geserHari(input.startDate, 6);
    case 'bulan': {
      const mulai = DateTime.fromJSDate(input.startDate, { zone: 'utc' });
      const sebulan = mulai.plus({ months: 1 });
      const akhir = sebulan.day === mulai.day ? sebulan.minus({ days: 1 }) : sebulan;
      return akhir.toJSDate();
    }
    case 'seterusnya':
      return null;
    case 'sampai':
      return input.endDate!;
  }
};

interface HasilKaryawan {
  employeeId: string;
  employeeName: string;
  assignmentId: string | null;
  created: number;
  skipped: { date: string; reason: AlasanLewat }[];
  replacedAssignments: number;
  /** Baris jadwal lama yang dihapus karena diganti (tambahan di luar kontrak awal). */
  replacedRows: number;
  error?: string;
}

/** Pratinjau dijalankan sungguhan lalu dibatalkan; hasilnya dibawa keluar lewat galat ini. */
class BatalkanPratinjau extends Error {
  constructor(public readonly hasil: HasilKaryawan) {
    super('pratinjau');
  }
}

/**
 * Penugasan lain yang rentangnya bertumpuk dengan penugasan baru diakhiri
 * sehari sebelum tanggal mulainya — atau dihapus bila baru mulai pada/sesudah
 * tanggal itu — lalu baris mereka mulai tanggal itu yang belum berpresensi
 * dan belum dikoreksi manual dihapus.
 */
const gantiPenugasanLain = async (tx: Db, employeeId: string, mulai: Date, akhir: Date | null) => {
  const lain = await tx.shiftAssignment.findMany({
    where: {
      employeeId,
      OR: [{ endDate: null }, { endDate: { gte: mulai } }],
      ...(akhir ? { startDate: { lte: akhir } } : {}),
    },
    select: { id: true, startDate: true },
  });
  if (lain.length === 0) return { replacedAssignments: 0, replacedRows: 0 };

  const hapus = await tx.shiftSchedule.deleteMany({
    where: { assignmentId: { in: lain.map((p) => p.id) }, date: { gte: mulai }, isOverride: false, ...tanpaPresensi },
  });

  const belumMulai = lain.filter((p) => p.startDate.getTime() >= mulai.getTime()).map((p) => p.id);
  const sudahMulai = lain.filter((p) => p.startDate.getTime() < mulai.getTime()).map((p) => p.id);
  if (belumMulai.length > 0) await tx.shiftAssignment.deleteMany({ where: { id: { in: belumMulai } } });
  if (sudahMulai.length > 0) {
    await tx.shiftAssignment.updateMany({ where: { id: { in: sudahMulai } }, data: { endDate: geserHari(mulai, -1) } });
  }

  return { replacedAssignments: lain.length, replacedRows: hapus.count };
};

/**
 * Durasi "1 hari" membuat satu baris jadwal biasa, tanpa penugasan: tidak
 * ada yang perlu diperpanjang, dan HR menyuntingnya seperti shift lain.
 * Dengan "ganti", shift lain orang itu di tanggal tersebut (yang belum
 * berpresensi) diganti — bukan penugasan berjangkanya yang diakhiri.
 */
const tetapkanSehari = async (
  tx: Db,
  input: CreateAssignmentInput,
  employeeId: string,
  jam: { startTime: string; endTime: string; breakDuration: number; templateId: string | null }
): Promise<Pick<HasilKaryawan, 'created' | 'skipped' | 'replacedRows'>> => {
  const tanggal = input.startDate;
  const kunci = calendarKey(tanggal);

  if (input.skipPublicHolidays && (await tx.holiday.findUnique({ where: { date: tanggal }, select: { id: true } }))) {
    return { created: 0, skipped: [{ date: kunci, reason: 'libur_nasional' }], replacedRows: 0 };
  }

  let replacedRows = 0;
  if (input.replaceExisting) {
    const hapus = await tx.shiftSchedule.deleteMany({
      where: { employeeId, date: tanggal, status: { not: 'cancelled' }, ...tanpaPresensi },
    });
    replacedRows = hapus.count;
  }

  const bentrok = await findOverlappingShift(
    { employeeId, date: tanggal, startTime: jam.startTime, endTime: jam.endTime },
    tx
  );
  if (bentrok) return { created: 0, skipped: [{ date: kunci, reason: 'bentrok' }], replacedRows };

  await tx.shiftSchedule.create({
    data: {
      id: generateULID(),
      employeeId,
      date: tanggal,
      startTime: jam.startTime,
      endTime: jam.endTime,
      breakDuration: new Prisma.Decimal(jam.breakDuration),
      status: input.status,
      notes: input.notes,
      templateId: jam.templateId,
    },
  });
  return { created: 1, skipped: [], replacedRows };
};

export const createAssignments = async (req: Request, res: Response) => {
  const input = req.body as CreateAssignmentInput;
  const actor = req.user!;

  const tanpaDept = tolakManajerTanpaDepartemen(actor);
  if (tanpaDept) return res.status(tanpaDept.status).json({ error: tanpaDept.error });

  // Jam yang akan dipakai: dari jenis shift, atau jam kustom untuk 1 hari.
  let jenis: { id: string; name: string; startTime: string; endTime: string; breakDuration: number } | null = null;
  if (input.templateId) {
    const cari = await cariJenisShiftUntukDipakai(actor, input.templateId);
    if (!cari.ok) return res.status(cari.status).json({ error: cari.error });
    jenis = { ...cari.template, breakDuration: cari.template.breakDuration.toNumber() };
  }
  const jam = jenis
    ? { startTime: jenis.startTime, endTime: jenis.endTime, breakDuration: jenis.breakDuration, templateId: jenis.id }
    : { startTime: input.startTime!, endTime: input.endTime!, breakDuration: input.breakDuration ?? 0, templateId: null };

  const waktuError = validateShiftTimes({ date: input.startDate, ...jam });
  if (waktuError) return res.status(400).json({ error: waktuError });

  // Hak akses diperiksa untuk SEMUA karyawan lebih dulu: satu orang di luar
  // departemen manajer menolak seluruh permintaan, bukan diam-diam dilewati.
  const karyawan = await prisma.employee.findMany({
    where: { id: { in: input.employeeIds } },
    select: { id: true, name: true, departmentId: true, status: true, flexibleHours: true },
  });
  if (karyawan.length !== input.employeeIds.length) {
    return res.status(404).json({ error: 'Sebagian karyawan tidak ditemukan' });
  }
  if (actor.role === Role.MANAGER && karyawan.some((k) => k.departmentId !== actor.departmentId)) {
    return res.status(403).json({ error: 'Anda hanya bisa menjadwalkan karyawan di departemen sendiri' });
  }
  const urut = input.employeeIds.map((id) => karyawan.find((k) => k.id === id)!);

  const endDate = akhirDurasi(input);
  // Cakrawala dihitung dari tanggal mulai bila itu masih di depan, supaya
  // penugasan yang baru mulai bulan depan langsung terlihat di roster dan di
  // pratinjau, bukan baru muncul saat perpanjangan berkala.
  const mulaiCakrawala = input.startDate.getTime() > hariIni().getTime() ? input.startDate : hariIni();
  const sampai = geserHari(mulaiCakrawala, HORIZON_HARI);

  const results: HasilKaryawan[] = [];
  for (const k of urut) {
    const dasar: HasilKaryawan = {
      employeeId: k.id,
      employeeName: k.name,
      assignmentId: null,
      created: 0,
      skipped: [],
      replacedAssignments: 0,
      replacedRows: 0,
    };
    if (k.flexibleHours) {
      results.push({ ...dasar, error: 'Memakai jam fleksibel — tidak memakai roster' });
      continue;
    }
    if (!ACTIVE_STATUSES.has(k.status)) {
      results.push({ ...dasar, error: 'Karyawan sudah tidak aktif' });
      continue;
    }

    // Satu transaksi per karyawan: kegagalan satu orang tidak membatalkan
    // yang lain, tapi jadwal satu orang tidak pernah tersimpan setengah.
    const kerjakan = async (tx: Db): Promise<HasilKaryawan> => {
      if (input.durasi === 'hari') {
        const hari = await tetapkanSehari(tx, input, k.id, jam);
        return { ...dasar, created: hari.created, skipped: hari.skipped, replacedRows: hari.replacedRows };
      }

      const ganti = input.replaceExisting
        ? await gantiPenugasanLain(tx, k.id, input.startDate, endDate)
        : { replacedAssignments: 0, replacedRows: 0 };

      const penugasan = await tx.shiftAssignment.create({
        data: {
          id: generateULID(),
          employeeId: k.id,
          templateId: jenis!.id,
          startDate: input.startDate,
          endDate,
          weekdays: input.weekdays!,
          skipPublicHolidays: input.skipPublicHolidays,
          status: input.status,
          notes: input.notes,
          createdById: actor.id,
        },
        select: { id: true },
      });
      const hasil = await materialisasi(penugasan.id, sampai, tx);

      return {
        ...dasar,
        assignmentId: penugasan.id,
        created: hasil.dibuat,
        skipped: hasil.dilewati.map((d) => ({ date: d.date, reason: d.alasan })),
        ...ganti,
      };
    };

    try {
      const hasil = await prisma.$transaction(
        async (tx) => {
          const h = await kerjakan(tx);
          if (input.preview) throw new BatalkanPratinjau(h);
          return h;
        },
        { timeout: 60_000, maxWait: 10_000 }
      );
      results.push(hasil);
    } catch (error) {
      if (error instanceof BatalkanPratinjau) {
        // Id penugasan pratinjau tidak pernah tersimpan; jangan sampai dipakai klien.
        results.push({ ...error.hasil, assignmentId: null });
        continue;
      }
      if (env.NODE_ENV !== 'test') console.warn('[shift] gagal menetapkan shift untuk', k.id, error);
      results.push({ ...dasar, error: 'Gagal menyimpan jadwal karyawan ini. Coba lagi.' });
    }
  }

  const totals = {
    created: results.reduce((s, r) => s + r.created, 0),
    skipped: results.reduce((s, r) => s + r.skipped.length, 0),
    employees: results.filter((r) => !r.error).length,
    failed: results.filter((r) => r.error).length,
  };

  const label = jenis ? jenis.name : `${jam.startTime}–${jam.endTime}`;
  res.locals.audit = {
    action: input.preview ? 'shift.assignment.preview' : 'shift.assignment.create',
    entity: 'ShiftAssignment',
    entityId: results.find((r) => r.assignmentId)?.assignmentId ?? undefined,
    summary: input.preview
      ? `Pratinjau penetapan shift ${label} untuk ${urut.length} karyawan`
      : `Menetapkan shift ${label} (${input.durasi}) mulai ${calendarKey(input.startDate)} untuk ${totals.employees} karyawan; ${totals.created} jadwal dibuat`,
    metadata: {
      durasi: input.durasi,
      startDate: calendarKey(input.startDate),
      endDate: endDate ? calendarKey(endDate) : null,
      templateId: jam.templateId,
      employeeIds: input.employeeIds,
      replaceExisting: input.replaceExisting,
      totals,
    },
  };

  res.status(input.preview ? 200 : 201).json({ results, totals });
};

export const listAssignments = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListAssignmentQuery;
  const actor = req.user!;

  const where: Prisma.ShiftAssignmentWhereInput = {};
  if (actor.role === Role.MANAGER) {
    if (query.departmentId && query.departmentId !== actor.departmentId) {
      return res.status(403).json({ error: 'Anda hanya bisa melihat departemen sendiri' });
    }
    where.employee = { departmentId: actor.departmentId ?? '__tanpa_departemen__' };
  } else if (query.departmentId) {
    where.employee = { departmentId: query.departmentId };
  }
  if (query.employeeId) where.employeeId = query.employeeId;
  if (query.active) where.OR = [{ endDate: null }, { endDate: { gte: hariIni() } }];

  const [total, rows] = await Promise.all([
    prisma.shiftAssignment.count({ where }),
    prisma.shiftAssignment.findMany({
      where,
      select: assignmentSelect,
      orderBy: [{ employee: { name: 'asc' } }, { startDate: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  res.json({
    data: rows.map(toAssignmentDTO),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit) || 1,
    },
  });
};

const cariPenugasan = async (actor: AktorJadwal, id: string) => {
  const penugasan = await prisma.shiftAssignment.findUnique({
    where: { id },
    select: { id: true, employeeId: true, startDate: true, endDate: true },
  });
  if (!penugasan) return { ok: false as const, status: 404, error: 'Penugasan shift tidak ditemukan' };

  // Karyawan yang sudah keluar tetap boleh diakhiri penugasannya.
  const akses = await assertCanScheduleEmployee(actor, penugasan.employeeId, { izinkanNonaktif: true });
  if (!akses.ok) return akses;
  return { ok: true as const, penugasan };
};

/** Baris penugasan sesudah tanggal akhir dihapus, kecuali yang berpresensi atau dikoreksi manual. */
const hapusBarisSesudah = (tx: Db, assignmentId: string, akhir: Date) =>
  tx.shiftSchedule.deleteMany({
    where: { assignmentId, date: { gt: akhir }, isOverride: false, ...tanpaPresensi },
  });

export const endAssignment = async (req: Request, res: Response) => {
  const { endDate } = req.body as EndAssignmentInput;
  const actor = req.user!;

  const cari = await cariPenugasan(actor, req.params.id);
  if (!cari.ok) return res.status(cari.status).json({ error: cari.error });
  const { penugasan } = cari;

  // Sehari sebelum mulai = penugasan dibatalkan seluruhnya tanpa dihapus.
  if (endDate.getTime() < geserHari(penugasan.startDate, -1).getTime()) {
    return res.status(422).json({ error: 'Tanggal akhir paling awal sehari sebelum tanggal mulai penugasan' });
  }
  if (penugasan.endDate && endDate.getTime() > penugasan.endDate.getTime()) {
    return res.status(422).json({
      error: `Penugasan ini sudah berakhir ${calendarKey(penugasan.endDate)}; tanggal akhir tidak bisa dimundurkan`,
    });
  }

  const { assignment, rowsDeleted } = await prisma.$transaction(async (tx) => {
    const assignment = await tx.shiftAssignment.update({
      where: { id: penugasan.id },
      data: { endDate },
      select: assignmentSelect,
    });
    const hapus = await hapusBarisSesudah(tx, penugasan.id, endDate);
    return { assignment, rowsDeleted: hapus.count };
  });

  res.locals.audit = {
    action: 'shift.assignment.end',
    entity: 'ShiftAssignment',
    entityId: penugasan.id,
    summary: `Mengakhiri penugasan shift ${assignment.template.name} ${assignment.employee.name} pada ${calendarKey(endDate)}; ${rowsDeleted} jadwal ke depan dihapus`,
    metadata: { endDate: calendarKey(endDate), rowsDeleted },
  };

  res.json({ assignment: toAssignmentDTO(assignment), rowsDeleted });
};

/**
 * Penugasan yang belum mulai dihapus seluruhnya. Yang sudah berjalan tidak
 * dihapus — jadwal lampaunya adalah riwayat yang dirujuk presensi — melainkan
 * diakhiri kemarin; shift hari ini yang sudah dipakai presensi tetap ada.
 */
export const deleteAssignment = async (req: Request, res: Response) => {
  const actor = req.user!;

  const cari = await cariPenugasan(actor, req.params.id);
  if (!cari.ok) return res.status(cari.status).json({ error: cari.error });
  const { penugasan } = cari;

  const hari = hariIni();
  const belumMulai = penugasan.startDate.getTime() > hari.getTime();

  const hasil = await prisma.$transaction(async (tx) => {
    if (belumMulai) {
      const hapus = await tx.shiftSchedule.deleteMany({
        where: { assignmentId: penugasan.id, isOverride: false, ...tanpaPresensi },
      });
      await tx.shiftAssignment.delete({ where: { id: penugasan.id } });
      return { rowsDeleted: hapus.count, deleted: true };
    }

    const kemarin = geserHari(hari, -1);
    const akhir = penugasan.endDate && penugasan.endDate.getTime() < kemarin.getTime() ? penugasan.endDate : kemarin;
    await tx.shiftAssignment.update({ where: { id: penugasan.id }, data: { endDate: akhir } });
    const hapus = await hapusBarisSesudah(tx, penugasan.id, akhir);
    return { rowsDeleted: hapus.count, deleted: false };
  });

  res.locals.audit = {
    action: 'shift.assignment.delete',
    entity: 'ShiftAssignment',
    entityId: penugasan.id,
    summary: hasil.deleted
      ? `Menghapus penugasan shift yang belum mulai; ${hasil.rowsDeleted} jadwal dihapus`
      : `Menghentikan penugasan shift mulai hari ini; ${hasil.rowsDeleted} jadwal ke depan dihapus`,
    metadata: hasil,
  };

  res.json(hasil);
};
