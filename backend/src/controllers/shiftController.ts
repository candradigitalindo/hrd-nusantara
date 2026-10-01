// src/controllers/shiftController.ts
import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from '../lib/prisma';
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
import { ACTIVE_STATUSES } from '../middleware/auth';
import { pastikanJadwalTerbit } from '../services/shiftAssignment';
import type {
  CreateShiftInput,
  BulkShiftItem,
  UpdateShiftInput,
  ListShiftQuery,
  ShiftRecapQuery,
} from '../schemas/shiftSchema';

export const shiftSelect = {
  id: true,
  employeeId: true,
  date: true,
  startTime: true,
  endTime: true,
  breakDuration: true,
  status: true,
  notes: true,
  templateId: true,
  template: { select: { id: true, name: true, code: true, color: true } },
  assignmentId: true,
  isOverride: true,
  createdAt: true,
  updatedAt: true,
  employee: { select: { id: true, nik: true, name: true, departmentId: true } },
} satisfies Prisma.ShiftScheduleSelect;

type ShiftRow = Prisma.ShiftScheduleGetPayload<{ select: typeof shiftSelect }>;

export const toDTO = (shift: ShiftRow) => {
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
export const findOverlappingShift = async (
  params: {
    employeeId: string;
    date: Date;
    startTime: string;
    endTime: string;
    excludeShiftId?: string;
  },
  db: PrismaTransactionClient = prisma
) => {
  const target = resolveShiftWindow(
    params.date,
    params.startTime,
    params.endTime,
    env.APP_TIMEZONE
  );

  const sehari = 24 * 60 * 60 * 1000;
  const kandidat = await db.shiftSchedule.findMany({
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

export interface AktorJadwal {
  id: string;
  role: Role;
  departmentId: string | null;
}

export type GagalAkses = { ok: false; status: number; error: string };

/**
 * Manajer tanpa departemen tidak boleh menjadwalkan siapa pun. Tanpa
 * pemeriksaan ini, perbandingan departemen null === null meloloskannya ke
 * semua karyawan yang juga belum punya departemen.
 */
export const tolakManajerTanpaDepartemen = (actor: AktorJadwal): GagalAkses | null =>
  actor.role === Role.MANAGER && !actor.departmentId
    ? { ok: false, status: 403, error: 'Akun manajer Anda belum terhubung ke departemen mana pun' }
    : null;

/** Pesan yang sama di semua jalur penjadwalan, supaya HR tahu apa yang harus dimatikan. */
export const pesanFleksibel = (nama: string) =>
  `${nama} memakai jam fleksibel; matikan dulu di detail karyawan`;

/**
 * Manager hanya boleh menjadwalkan karyawan di departemennya sendiri, dan
 * karyawan yang sudah keluar tidak dijadwalkan lagi.
 *
 * @param opsi.izinkanNonaktif untuk mengubah/menghapus jadwal yang sudah ada:
 *   sisa jadwal karyawan yang keluar tetap harus bisa dibereskan.
 */
export const assertCanScheduleEmployee = async (
  actor: AktorJadwal,
  employeeId: string,
  opsi: { izinkanNonaktif?: boolean } = {}
): Promise<
  | { ok: true; employee: { id: string; name: string; departmentId: string | null; flexibleHours: boolean } }
  | GagalAkses
> => {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, name: true, departmentId: true, status: true, flexibleHours: true },
  });

  if (!employee) return { ok: false, status: 404, error: 'Karyawan tidak ditemukan' };

  const tanpaDept = tolakManajerTanpaDepartemen(actor);
  if (tanpaDept) return tanpaDept;

  if (actor.role === Role.MANAGER && employee.departmentId !== actor.departmentId) {
    return { ok: false, status: 403, error: 'Anda hanya bisa menjadwalkan karyawan di departemen sendiri' };
  }
  if (!opsi.izinkanNonaktif && !ACTIVE_STATUSES.has(employee.status)) {
    return { ok: false, status: 422, error: `${employee.name} sudah tidak aktif` };
  }
  return { ok: true, employee };
};

/**
 * Jenis shift yang akan dipakai menjadwalkan: harus ada, masih aktif, dan —
 * untuk manajer — milik semua departemen atau departemennya sendiri.
 */
export const cariJenisShiftUntukDipakai = async (actor: AktorJadwal, templateId: string) => {
  const template = await prisma.shiftTemplate.findUnique({ where: { id: templateId } });
  if (!template) return { ok: false as const, status: 404, error: 'Jenis shift tidak ditemukan' };
  if (!template.isActive) {
    return { ok: false as const, status: 422, error: `Jenis shift "${template.name}" sudah dinonaktifkan` };
  }
  if (actor.role === Role.MANAGER && template.departmentId !== null && template.departmentId !== actor.departmentId) {
    return { ok: false as const, status: 403, error: 'Jenis shift ini milik departemen lain' };
  }
  return { ok: true as const, template };
};

export const validateShiftTimes = (input: {
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

  const akses = await assertCanScheduleEmployee(actor, input.employeeId);
  if (!akses.ok) return res.status(akses.status).json({ error: akses.error });
  if (akses.employee.flexibleHours) {
    return res.status(422).json({ error: pesanFleksibel(akses.employee.name) });
  }

  // Jam dari jenis shift dipakai hanya untuk yang tidak dikirim eksplisit,
  // jadi "Pagi tapi masuk 08:00 hari ini saja" tetap bisa.
  let templateId: string | null = null;
  let jam = { startTime: input.startTime, endTime: input.endTime, breakDuration: input.breakDuration };
  if (input.templateId) {
    const jenis = await cariJenisShiftUntukDipakai(actor, input.templateId);
    if (!jenis.ok) return res.status(jenis.status).json({ error: jenis.error });
    templateId = jenis.template.id;
    jam = {
      startTime: input.startTime ?? jenis.template.startTime,
      endTime: input.endTime ?? jenis.template.endTime,
      breakDuration: input.breakDuration ?? jenis.template.breakDuration.toNumber(),
    };
  }

  const lengkap = {
    employeeId: input.employeeId,
    date: input.date,
    // Skema menjamin jam ada bila templateId tidak dikirim.
    startTime: jam.startTime!,
    endTime: jam.endTime!,
    breakDuration: jam.breakDuration ?? 0,
  };

  const waktuError = validateShiftTimes(lengkap);
  if (waktuError) return res.status(400).json({ error: waktuError });

  const bentrok = await findOverlappingShift(lengkap);
  if (bentrok) {
    return res.status(409).json({
      error: 'Jadwal bertabrakan dengan shift yang sudah ada',
      conflictingShiftId: bentrok.id,
    });
  }

  const shift = await prisma.shiftSchedule.create({
    data: {
      id: generateULID(),
      employeeId: lengkap.employeeId,
      date: lengkap.date,
      startTime: lengkap.startTime,
      endTime: lengkap.endTime,
      breakDuration: new Prisma.Decimal(lengkap.breakDuration),
      status: input.status,
      notes: input.notes,
      templateId,
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
  const { shifts } = req.body as { shifts: BulkShiftItem[] };
  const actor = req.user!;

  // Karyawan berjam fleksibel ditolak lebih dulu dan terpisah (422): itu
  // bukan salah isi roster, melainkan pengaturan karyawan yang harus diubah.
  const fleksibel = await prisma.employee.findMany({
    where: { id: { in: [...new Set(shifts.map((s) => s.employeeId))] }, flexibleHours: true },
    select: { id: true, name: true },
  });
  if (fleksibel.length > 0) {
    return res.status(422).json({
      error: pesanFleksibel(fleksibel.map((k) => k.name).join(', ')),
      details: shifts.flatMap((s, index) =>
        fleksibel.some((k) => k.id === s.employeeId) ? [{ index, error: 'Memakai jam fleksibel' }] : []
      ),
    });
  }

  const masalah: { index: number; error: string }[] = [];

  for (const [index, input] of shifts.entries()) {
    const akses = await assertCanScheduleEmployee(actor, input.employeeId);
    if (!akses.ok) {
      masalah.push({ index, error: akses.error });
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

/** Karyawan yang dicakup filter roster; null = seluruh perusahaan. */
const karyawanDalamLingkup = async (
  query: ListShiftQuery,
  actor: { role: Role; departmentId: string | null }
): Promise<string[] | null> => {
  if (query.employeeId) return [query.employeeId];
  const dept = actor.role === Role.MANAGER ? actor.departmentId ?? '__tanpa_departemen__' : query.departmentId;
  if (!dept) return null;
  const karyawan = await prisma.employee.findMany({ where: { departmentId: dept }, select: { id: true } });
  return karyawan.map((k) => k.id);
};

export const getAllShifts = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListShiftQuery;
  const actor = req.user!;

  const where = buildShiftWhere(query, actor);
  if ('forbidden' in where) {
    return res.status(403).json({ error: where.forbidden });
  }

  // Roster yang dibuka jauh ke depan harus sudah berisi baris penugasan
  // "seterusnya" untuk pekan itu, bukan tampak kosong.
  if (query.endDate) {
    await pastikanJadwalTerbit(await karyawanDalamLingkup(query, actor), query.endDate);
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
      flexibleHours: true,
      department: { select: { id: true, name: true } },
    },
    orderBy: { name: 'asc' },
    take: 300,
  });

  const jendela = jendelaRoster(monthStart, monthEnd);
  await pastikanJadwalTerbit(
    karyawan.map((k) => k.id),
    jendela.lte
  );

  const shifts = await prisma.shiftSchedule.findMany({
    where: {
      employeeId: { in: karyawan.map((k) => k.id) },
      status: { not: 'cancelled' },
      date: jendela,
    },
    select: { employeeId: true, date: true },
  });

  const perKaryawan = new Map<string, Set<string>>();
  for (const s of shifts) {
    const kunci = perKaryawan.get(s.employeeId) ?? new Set<string>();
    kunci.add(calendarKey(s.date));
    perKaryawan.set(s.employeeId, kunci);
  }

  const data = karyawan.map((k) => {
    const rekap = hitungRekapLibur({
      scheduledDateKeys: perKaryawan.get(k.id) ?? new Set<string>(),
      monthStart,
      monthEnd,
    });
    // Karyawan berjam fleksibel memang tidak punya roster: tanggal kosongnya
    // bukan "belum disusun", dan peringatan hari libur tidak berlaku.
    return {
      ...k,
      ...rekap,
      ...(k.flexibleHours ? { belumDisusun: 0, kurangLibur: false, beruntunLewatBatas: false } : {}),
    };
  });

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

  const employeeId = req.user!.id;

  // Shift yang dibatalkan tidak dikirim: aplikasi mobile menganggap setiap
  // baris sebagai hari kerja.
  const where: Prisma.ShiftScheduleWhereInput = { employeeId, status: { not: 'cancelled' } };
  if (query.startDate || query.endDate) {
    where.date = {
      ...(query.startDate ? { gte: query.startDate } : {}),
      ...(query.endDate ? { lte: query.endDate } : {}),
    };
  }
  if (query.endDate) await pastikanJadwalTerbit([employeeId], query.endDate);

  const [total, rows, saya] = await Promise.all([
    prisma.shiftSchedule.count({ where }),
    prisma.shiftSchedule.findMany({
      where,
      select: shiftSelect,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.employee.findUnique({ where: { id: employeeId }, select: { flexibleHours: true } }),
  ]);

  res.json({
    data: rows.map(toDTO),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit) || 1,
    },
    // Supaya aplikasi bisa menjelaskan "tidak ada roster" alih-alih "libur".
    flexibleHours: saya?.flexibleHours ?? false,
  });
};

export const updateShift = async (req: Request, res: Response) => {
  const input = req.body as UpdateShiftInput;
  const actor = req.user!;

  const existing = await prisma.shiftSchedule.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      employeeId: true,
      date: true,
      startTime: true,
      endTime: true,
      breakDuration: true,
      assignmentId: true,
    },
  });

  if (!existing) {
    return res.status(404).json({ error: 'Jadwal shift tidak ditemukan' });
  }

  const akses = await assertCanScheduleEmployee(actor, existing.employeeId, { izinkanNonaktif: true });
  if (!akses.ok) return res.status(akses.status === 404 ? 404 : 403).json({ error: akses.error });

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

  // Baris dari penugasan yang jam/tanggalnya dikoreksi manual tidak boleh
  // lagi ditimpa oleh perubahan jenis shift atau pengakhiran penugasan.
  const waktuBerubah =
    gabungan.date.getTime() !== existing.date.getTime() ||
    gabungan.startTime !== existing.startTime ||
    gabungan.endTime !== existing.endTime ||
    gabungan.breakDuration !== existing.breakDuration.toNumber();
  if (existing.assignmentId && waktuBerubah) data.isOverride = true;

  try {
    const shift = await prisma.shiftSchedule.update({
      where: { id: existing.id },
      data,
      select: shiftSelect,
    });
    res.json(toDTO(shift));
  } catch (error) {
    // Satu penugasan hanya punya satu baris per tanggal (unik assignmentId +
    // date). Memindahkan barisnya ke tanggal yang sudah berisi split shift
    // dari penugasan yang sama melanggarnya — itu bentrok, bukan galat server.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({
        error: 'Tanggal itu sudah punya shift dari penugasan yang sama. Ubah atau hapus shift tersebut dulu.',
      });
    }
    throw error;
  }
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

  const akses = await assertCanScheduleEmployee(actor, existing.employeeId, { izinkanNonaktif: true });
  if (!akses.ok) return res.status(akses.status === 404 ? 404 : 403).json({ error: akses.error });

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
