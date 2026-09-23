// src/controllers/shiftController.ts
import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { generateULID } from '../utils/generateULID';
import { resolveShiftWindow } from '../utils/shiftTime';
import {
  hitungRekapLibur,
  rentangBulan,
  jendelaRoster,
  BATAS_HARI_BERUNTUN,
} from '../utils/rosterRecap';
import { calendarKey } from '../utils/leaveDays';
import { INACTIVE_STATUSES } from './employeeController';
import type {
  CreateShiftInput,
  UpdateShiftInput,
  ListShiftQuery,
  ShiftRecapQuery,
} from '../schemas/shiftSchema';

const shiftSelect = {
  id: true,
  employeeId: true,
  date: true,
  startTime: true,
  endTime: true,
  breakDuration: true,
  status: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  employee: { select: { id: true, nik: true, name: true, departmentId: true } },
} satisfies Prisma.ShiftScheduleSelect;

type ShiftRow = Prisma.ShiftScheduleGetPayload<{ select: typeof shiftSelect }>;

const toDTO = (shift: ShiftRow) => {
  const window = resolveShiftWindow(shift.date, shift.startTime, shift.endTime, env.APP_TIMEZONE);
  return {
    ...shift,
    breakDuration: shift.breakDuration.toNumber(),
    // Waktu absolut ikut dikirim supaya klien mobile tidak perlu menebak
    // sendiri bahwa shift 22:00–06:00 berakhir keesokan harinya.
    startsAt: window.start,
    endsAt: window.end,
  };
};

const durationMinutes = (date: Date, startTime: string, endTime: string) => {
  const { start, end } = resolveShiftWindow(date, startTime, endTime, env.APP_TIMEZONE);
  return (end.getTime() - start.getTime()) / 60_000;
};

/**
 * Mencari shift lain milik karyawan yang bertabrakan waktunya.
 *
 * Split shift (pagi lalu malam di hari yang sama) lazim di F&B, jadi satu
 * karyawan boleh punya beberapa shift per tanggal — yang tidak boleh adalah
 * dua shift yang saling tumpang tindih.
 *
 * Tanggal di sekitarnya ikut diperiksa karena shift malam melewati tengah malam.
 */
const findOverlappingShift = async (params: {
  employeeId: string;
  date: Date;
  startTime: string;
  endTime: string;
  excludeShiftId?: string;
}) => {
  const target = resolveShiftWindow(
    params.date,
    params.startTime,
    params.endTime,
    env.APP_TIMEZONE
  );

  const sehari = 24 * 60 * 60 * 1000;
  const kandidat = await prisma.shiftSchedule.findMany({
    where: {
      employeeId: params.employeeId,
      status: { not: 'cancelled' },
      date: {
        gte: new Date(params.date.getTime() - sehari),
        lte: new Date(params.date.getTime() + sehari),
      },
      ...(params.excludeShiftId ? { id: { not: params.excludeShiftId } } : {}),
    },
  });

  return (
    kandidat.find((shift) => {
      const lain = resolveShiftWindow(
        shift.date,
        shift.startTime,
        shift.endTime,
        env.APP_TIMEZONE
      );
      return target.start < lain.end && lain.start < target.end;
    }) ?? null
  );
};

/** Manager hanya boleh menjadwalkan karyawan di departemennya sendiri. */
const assertCanScheduleEmployee = async (
  actor: { role: Role; departmentId: string | null },
  employeeId: string
): Promise<string | null> => {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, departmentId: true, status: true },
  });

  if (!employee) return 'Karyawan tidak ditemukan';

  if (actor.role === Role.MANAGER && employee.departmentId !== actor.departmentId) {
    return 'Anda hanya bisa menjadwalkan karyawan di departemen sendiri';
  }
  return null;
};

const validateShiftTimes = (input: {
  date: Date;
  startTime: string;
  endTime: string;
  breakDuration: number;
}): string | null => {
  const total = durationMinutes(input.date, input.startTime, input.endTime);

  if (input.breakDuration * 60 >= total) {
    return 'Durasi istirahat tidak boleh sama atau melebihi panjang shift';
  }
  return null;
};

export const createShift = async (req: Request, res: Response) => {
  const input = req.body as CreateShiftInput;
  const actor = req.user!;

  const aksesError = await assertCanScheduleEmployee(actor, input.employeeId);
  if (aksesError) {
    return res.status(aksesError === 'Karyawan tidak ditemukan' ? 404 : 403).json({ error: aksesError });
  }

  const waktuError = validateShiftTimes(input);
  if (waktuError) return res.status(400).json({ error: waktuError });

  const bentrok = await findOverlappingShift(input);
  if (bentrok) {
    return res.status(409).json({
      error: 'Jadwal bertabrakan dengan shift yang sudah ada',
      conflictingShiftId: bentrok.id,
    });
  }

  const shift = await prisma.shiftSchedule.create({
    data: {
      id: generateULID(),
      employeeId: input.employeeId,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      breakDuration: new Prisma.Decimal(input.breakDuration),
      status: input.status,
      notes: input.notes,
    },
    select: shiftSelect,
  });

  res.status(201).json(toDTO(shift));
};

/**
 * Membuat banyak shift sekaligus untuk menyusun roster mingguan.
 * Seluruh batch dibatalkan kalau ada satu saja yang bermasalah, supaya
 * roster tidak pernah tersimpan setengah jadi.
 */
export const bulkCreateShifts = async (req: Request, res: Response) => {
  const { shifts } = req.body as { shifts: CreateShiftInput[] };
  const actor = req.user!;

  const masalah: { index: number; error: string }[] = [];

  for (const [index, input] of shifts.entries()) {
    const aksesError = await assertCanScheduleEmployee(actor, input.employeeId);
    if (aksesError) {
      masalah.push({ index, error: aksesError });
      continue;
    }

    const waktuError = validateShiftTimes(input);
    if (waktuError) {
      masalah.push({ index, error: waktuError });
      continue;
    }

    const bentrok = await findOverlappingShift(input);
    if (bentrok) {
      masalah.push({ index, error: 'Bertabrakan dengan shift yang sudah ada' });
    }
  }

  // Tabrakan di dalam batch itu sendiri.
  for (let i = 0; i < shifts.length; i += 1) {
    for (let j = i + 1; j < shifts.length; j += 1) {
      if (shifts[i].employeeId !== shifts[j].employeeId) continue;

      const a = resolveShiftWindow(
        shifts[i].date,
        shifts[i].startTime,
        shifts[i].endTime,
        env.APP_TIMEZONE
      );
      const b = resolveShiftWindow(
        shifts[j].date,
        shifts[j].startTime,
        shifts[j].endTime,
        env.APP_TIMEZONE
      );

      if (a.start < b.end && b.start < a.end) {
        masalah.push({ index: j, error: `Bertabrakan dengan shift ke-${i} dalam permintaan ini` });
      }
    }
  }

  if (masalah.length > 0) {
    return res.status(400).json({ error: 'Sebagian jadwal tidak valid', details: masalah });
  }

  const dibuat = await prisma.shiftSchedule.createMany({
    data: shifts.map((input) => ({
      id: generateULID(),
      employeeId: input.employeeId,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      breakDuration: new Prisma.Decimal(input.breakDuration),
      status: input.status,
      notes: input.notes,
    })),
  });

  res.status(201).json({ created: dibuat.count });
};

const buildShiftWhere = (
  query: ListShiftQuery,
  actor: { role: Role; departmentId: string | null; id: string }
): Prisma.ShiftScheduleWhereInput | { forbidden: string } => {
  const where: Prisma.ShiftScheduleWhereInput = {};

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

  if (query.startDate || query.endDate) {
    where.date = {
      ...(query.startDate ? { gte: query.startDate } : {}),
      ...(query.endDate ? { lte: query.endDate } : {}),
    };
  }

  return where;
};

export const getAllShifts = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListShiftQuery;
  const actor = req.user!;

  const where = buildShiftWhere(query, actor);
  if ('forbidden' in where) {
    return res.status(403).json({ error: where.forbidden });
  }

  const [total, rows] = await Promise.all([
    prisma.shiftSchedule.count({ where }),
    prisma.shiftSchedule.findMany({
      where,
      select: shiftSelect,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
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

/**
 * Rekap hari libur sebulan, per karyawan.
 *
 * Jadwal shift disusun sepekan demi sepekan, jadi tidak ada satu layar pun
 * yang memperlihatkan apakah pembagian liburnya adil — atau apakah ada yang
 * dijadwalkan tujuh hari beruntun karena penyusunnya berganti di tengah
 * bulan. Rekap ini menjawab keduanya.
 */
export const getShiftRecap = async (req: Request, res: Response) => {
  const { month, departmentId } = req.query as unknown as ShiftRecapQuery;
  const actor = req.user!;

  let dept = departmentId;
  if (actor.role === Role.MANAGER) {
    if (departmentId && departmentId !== actor.departmentId) {
      return res.status(403).json({ error: 'Anda hanya bisa melihat departemen sendiri' });
    }
    dept = actor.departmentId ?? '__tanpa_departemen__';
  }

  const { monthStart, monthEnd } = rentangBulan(month);

  const karyawan = await prisma.employee.findMany({
    where: {
      status: { notIn: INACTIVE_STATUSES },
      ...(dept ? { departmentId: dept } : {}),
    },
    select: {
      id: true,
      nik: true,
      name: true,
      department: { select: { id: true, name: true } },
    },
    orderBy: { name: 'asc' },
    take: 300,
  });

  const shifts = await prisma.shiftSchedule.findMany({
    where: {
      employeeId: { in: karyawan.map((k) => k.id) },
      status: { not: 'cancelled' },
      date: jendelaRoster(monthStart, monthEnd),
    },
    select: { employeeId: true, date: true },
  });

  const perKaryawan = new Map<string, Set<string>>();
  for (const s of shifts) {
    const kunci = perKaryawan.get(s.employeeId) ?? new Set<string>();
    kunci.add(calendarKey(s.date));
    perKaryawan.set(s.employeeId, kunci);
  }

  const data = karyawan.map((k) => ({
    ...k,
    ...hitungRekapLibur({
      scheduledDateKeys: perKaryawan.get(k.id) ?? new Set<string>(),
      monthStart,
      monthEnd,
    }),
  }));

  res.json({
    month,
    startDate: monthStart,
    endDate: monthEnd,
    batasBeruntun: BATAS_HARI_BERUNTUN,
    data,
  });
};

/** Jadwal milik sendiri — dipakai layar "Jadwal Kerja" di aplikasi mobile. */
export const getMyShifts = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListShiftQuery;

  const where: Prisma.ShiftScheduleWhereInput = { employeeId: req.user!.id };
  if (query.startDate || query.endDate) {
    where.date = {
      ...(query.startDate ? { gte: query.startDate } : {}),
      ...(query.endDate ? { lte: query.endDate } : {}),
    };
  }

  const [total, rows] = await Promise.all([
    prisma.shiftSchedule.count({ where }),
    prisma.shiftSchedule.findMany({
      where,
      select: shiftSelect,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
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

export const updateShift = async (req: Request, res: Response) => {
  const input = req.body as UpdateShiftInput;
  const actor = req.user!;

  const existing = await prisma.shiftSchedule.findUnique({
    where: { id: req.params.id },
    select: { id: true, employeeId: true, date: true, startTime: true, endTime: true, breakDuration: true },
  });

  if (!existing) {
    return res.status(404).json({ error: 'Jadwal shift tidak ditemukan' });
  }

  const aksesError = await assertCanScheduleEmployee(actor, existing.employeeId);
  if (aksesError) return res.status(403).json({ error: aksesError });

  const gabungan = {
    date: input.date ?? existing.date,
    startTime: input.startTime ?? existing.startTime,
    endTime: input.endTime ?? existing.endTime,
    breakDuration: input.breakDuration ?? existing.breakDuration.toNumber(),
  };

  const waktuError = validateShiftTimes(gabungan);
  if (waktuError) return res.status(400).json({ error: waktuError });

  const bentrok = await findOverlappingShift({
    employeeId: existing.employeeId,
    ...gabungan,
    excludeShiftId: existing.id,
  });
  if (bentrok) {
    return res.status(409).json({
      error: 'Jadwal bertabrakan dengan shift yang sudah ada',
      conflictingShiftId: bentrok.id,
    });
  }

  const data: Prisma.ShiftScheduleUpdateInput = {};
  if (input.date !== undefined) data.date = input.date;
  if (input.startTime !== undefined) data.startTime = input.startTime;
  if (input.endTime !== undefined) data.endTime = input.endTime;
  if (input.breakDuration !== undefined) data.breakDuration = new Prisma.Decimal(input.breakDuration);
  if (input.status !== undefined) data.status = input.status;
  if (input.notes !== undefined) data.notes = input.notes;

  const shift = await prisma.shiftSchedule.update({
    where: { id: existing.id },
    data,
    select: shiftSelect,
  });

  res.json(toDTO(shift));
};

/**
 * Jadwal yang sudah dipakai presensi tidak dihapus, hanya dibatalkan —
 * menghapusnya akan memutus jejak audit presensi yang menunjuk ke sana.
 */
export const cancelShift = async (req: Request, res: Response) => {
  const actor = req.user!;

  const existing = await prisma.shiftSchedule.findUnique({
    where: { id: req.params.id },
    select: { id: true, employeeId: true, _count: { select: { attendances: true } } },
  });

  if (!existing) {
    return res.status(404).json({ error: 'Jadwal shift tidak ditemukan' });
  }

  const aksesError = await assertCanScheduleEmployee(actor, existing.employeeId);
  if (aksesError) return res.status(403).json({ error: aksesError });

  if (existing._count.attendances === 0) {
    await prisma.shiftSchedule.delete({ where: { id: existing.id } });
    return res.json({ message: 'Jadwal shift dihapus' });
  }

  const shift = await prisma.shiftSchedule.update({
    where: { id: existing.id },
    data: { status: 'cancelled' },
    select: shiftSelect,
  });

  res.json({ message: 'Jadwal shift dibatalkan (sudah ada presensi yang terkait)', shift: toDTO(shift) });
};
