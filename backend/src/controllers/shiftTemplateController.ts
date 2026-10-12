// src/controllers/shiftTemplateController.ts
//
// Jenis shift ("Pagi 07:00–15:00") yang dibuat HR atau manajer sendiri, lalu
// dipakai ulang saat menetapkan shift — supaya roster tidak lagi diisi dengan
// mengetik jam yang sama setiap hari.
import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from '../lib/prisma';
import { env } from '../config/env';
import { generateULID } from '../utils/generateULID';
import { resolveShiftWindow, parseHHmm } from '../utils/shiftTime';
import { hariIni, geserHari } from '../services/shiftAssignment';
import {
  bacaJamPerHari,
  jamUntukTanggal,
  normalkanJamPerHari,
  samaJam,
  type JamHari,
  type JamShift,
} from '../utils/shiftTemplateHours';
import { tolakManajerTanpaDepartemen, type AktorJadwal } from './shiftController';
import type {
  CreateShiftTemplateInput,
  UpdateShiftTemplateInput,
  ListShiftTemplateQuery,
} from '../schemas/shiftSchema';

/** Penugasan dianggap aktif selama belum berakhir sebelum hari ini. */
const penugasanAktif = (): Prisma.ShiftAssignmentWhereInput => ({
  OR: [{ endDate: null }, { endDate: { gte: hariIni() } }],
});

const templateSelect = () =>
  ({
    id: true,
    name: true,
    code: true,
    startTime: true,
    endTime: true,
    breakDuration: true,
    dailyHours: true,
    color: true,
    departmentId: true,
    department: { select: { id: true, name: true } },
    isActive: true,
    _count: { select: { assignments: { where: penugasanAktif() } } },
  }) satisfies Prisma.ShiftTemplateSelect;

type TemplateRow = Prisma.ShiftTemplateGetPayload<{ select: ReturnType<typeof templateSelect> }>;

const toTemplateDTO = (t: TemplateRow) => ({
  id: t.id,
  name: t.name,
  code: t.code,
  startTime: t.startTime,
  endTime: t.endTime,
  breakDuration: t.breakDuration.toNumber(),
  /** Jam berbeda per hari; hari yang tidak tercantum memakai jam di atas. */
  dailyHours: bacaJamPerHari(t.dailyHours),
  color: t.color,
  departmentId: t.departmentId,
  department: t.department,
  isActive: t.isActive,
  activeAssignments: t._count.assignments,
});

/** Panjang shift dalam menit; jam selesai <= jam mulai berarti melewati tengah malam. */
const panjangMenit = (startTime: string, endTime: string) => {
  const mulai = parseHHmm(startTime);
  const selesai = parseHHmm(endTime);
  const selisih = selesai.hour * 60 + selesai.minute - (mulai.hour * 60 + mulai.minute);
  return selisih <= 0 ? selisih + 24 * 60 : selisih;
};

const istirahatTerlaluPanjang = (startTime: string, endTime: string, breakDuration: number) =>
  breakDuration * 60 >= panjangMenit(startTime, endTime);

const NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/** Pesan galat bila istirahat sebuah jam khusus menghabiskan panjang shift hari itu. */
const periksaJamPerHari = (jamPerHari: readonly JamHari[]): string | null => {
  const salah = jamPerHari.find((j) => istirahatTerlaluPanjang(j.startTime, j.endTime, j.breakDuration));
  return salah ? `Istirahat hari ${NAMA_HARI[salah.weekday]} tidak boleh sama atau melebihi panjang shift hari itu` : null;
};

/** "Jumat 08:00–11:30, Sabtu 08:00–13:00" untuk ringkasan jejak audit. */
const ringkasJamPerHari = (jamPerHari: readonly JamHari[]) =>
  jamPerHari.map((j) => `${NAMA_HARI[j.weekday]} ${j.startTime}–${j.endTime}`).join(', ');

/** Nama jenis shift unik di antara yang aktif, per departemen (null = semua departemen). */
const namaSudahDipakai = (name: string, departmentId: string | null, kecualiId?: string) =>
  prisma.shiftTemplate.findFirst({
    where: {
      isActive: true,
      departmentId,
      name: { equals: name, mode: 'insensitive' },
      ...(kecualiId ? { id: { not: kecualiId } } : {}),
    },
    select: { id: true },
  });

/**
 * Manajer hanya mengelola jenis shift departemennya. Jenis shift untuk semua
 * departemen dipakai lintas tim, jadi hanya HR yang boleh mengubahnya.
 */
const tolakKelolaManajer = (actor: AktorJadwal, template: { departmentId: string | null }): string | null => {
  if (actor.role !== Role.MANAGER) return null;
  if (template.departmentId === null) return 'Jenis shift untuk semua departemen hanya bisa diubah HR';
  if (template.departmentId !== actor.departmentId) return 'Jenis shift ini milik departemen lain';
  return null;
};

export const listShiftTemplates = async (req: Request, res: Response) => {
  const { includeInactive } = req.query as unknown as ListShiftTemplateQuery;
  const actor = req.user!;

  const where: Prisma.ShiftTemplateWhereInput = includeInactive ? {} : { isActive: true };
  if (actor.role === Role.MANAGER) {
    where.OR = [{ departmentId: null }, ...(actor.departmentId ? [{ departmentId: actor.departmentId }] : [])];
  }

  const rows = await prisma.shiftTemplate.findMany({
    where,
    select: templateSelect(),
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });

  res.json({ data: rows.map(toTemplateDTO) });
};

export const createShiftTemplate = async (req: Request, res: Response) => {
  const input = req.body as CreateShiftTemplateInput;
  const actor = req.user!;

  const tanpaDept = tolakManajerTanpaDepartemen(actor);
  if (tanpaDept) return res.status(tanpaDept.status).json({ error: tanpaDept.error });

  // Manajer selalu membuat jenis shift untuk departemennya sendiri, apa pun
  // yang dikirim formulir.
  const departmentId = actor.role === Role.MANAGER ? actor.departmentId : (input.departmentId ?? null);

  if (departmentId && actor.role !== Role.MANAGER) {
    const ada = await prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } });
    if (!ada) return res.status(400).json({ error: 'Departemen tidak ditemukan' });
  }

  if (istirahatTerlaluPanjang(input.startTime, input.endTime, input.breakDuration)) {
    return res.status(400).json({ error: 'Durasi istirahat tidak boleh sama atau melebihi panjang shift' });
  }
  const jamPerHari = normalkanJamPerHari(input.dailyHours, {
    startTime: input.startTime,
    endTime: input.endTime,
    breakDuration: input.breakDuration,
  });
  const salahHari = periksaJamPerHari(jamPerHari);
  if (salahHari) return res.status(400).json({ error: salahHari });

  if (await namaSudahDipakai(input.name, departmentId)) {
    return res.status(409).json({ error: `Jenis shift "${input.name}" sudah ada` });
  }

  const template = await prisma.shiftTemplate.create({
    data: {
      id: generateULID(),
      name: input.name,
      code: input.code ?? null,
      startTime: input.startTime,
      endTime: input.endTime,
      breakDuration: new Prisma.Decimal(input.breakDuration),
      dailyHours: jamPerHari as unknown as Prisma.InputJsonValue,
      ...(input.color ? { color: input.color } : {}),
      departmentId,
      createdById: actor.id,
    },
    select: templateSelect(),
  });

  res.locals.audit = {
    action: 'shift.template.create',
    entity: 'ShiftTemplate',
    entityId: template.id,
    summary: `Membuat jenis shift ${template.name} (${template.startTime}–${template.endTime}${jamPerHari.length ? `; ${ringkasJamPerHari(jamPerHari)}` : ''})`,
  };

  res.status(201).json(toTemplateDTO(template));
};

/**
 * Jam baru jenis shift ikut diterapkan ke jadwal KE DEPAN yang dibuat dari
 * jenis ini — selama belum dikoreksi manual, belum dibatalkan, dan belum
 * dipakai presensi. Jadwal yang sudah lewat adalah catatan sejarah.
 *
 * Jam tiap baris mengikuti hari tanggalnya: jenis dengan jam berbeda per hari
 * memberi Jumat jam Jumat, Sabtu jam Sabtu, dan hari lain jam bawaannya.
 * Baris yang jamnya sudah sesuai tidak disentuh dan tidak dihitung.
 *
 * Baris yang dengan jam baru akan bertabrakan dengan shift lain orang itu
 * dibiarkan dengan jam lamanya dan dilaporkan, bukan dipaksakan bertumpuk.
 */
const terapkanJamBaru = async (
  tx: PrismaTransactionClient,
  templateId: string,
  jenis: JamShift & { dailyHours: JamHari[] }
): Promise<{ rowsUpdated: number; rowsSkipped: number }> => {
  const baris = await tx.shiftSchedule.findMany({
    where: {
      templateId,
      date: { gte: hariIni() },
      isOverride: false,
      status: { not: 'cancelled' },
      attendances: { none: {} },
    },
    select: { id: true, employeeId: true, date: true, startTime: true, endTime: true, breakDuration: true },
  });

  const berubah = baris
    .map((b) => ({ b, jam: jamUntukTanggal(jenis, b.date) }))
    .filter(({ b, jam }) => !samaJam({ startTime: b.startTime, endTime: b.endTime, breakDuration: b.breakDuration.toNumber() }, jam));
  if (berubah.length === 0) return { rowsUpdated: 0, rowsSkipped: 0 };

  // Bentrok hanya mungkin bagi baris yang jam mulai/selesainya bergeser;
  // perubahan istirahat saja tidak menggeser jendela shift.
  const geser = berubah.filter(({ b, jam }) => b.startTime !== jam.startTime || b.endTime !== jam.endTime);
  const bentrok = new Set<string>();
  if (geser.length > 0) {
    const waktu = geser.map(({ b }) => b.date.getTime());
    const lain = await tx.shiftSchedule.findMany({
      where: {
        employeeId: { in: [...new Set(geser.map(({ b }) => b.employeeId))] },
        status: { not: 'cancelled' },
        id: { notIn: baris.map((b) => b.id) },
        date: { gte: geserHari(new Date(Math.min(...waktu)), -1), lte: geserHari(new Date(Math.max(...waktu)), 1) },
      },
      select: { employeeId: true, date: true, startTime: true, endTime: true },
    });
    const jendelaLain = lain.map((r) => ({
      employeeId: r.employeeId,
      ...resolveShiftWindow(r.date, r.startTime, r.endTime, env.APP_TIMEZONE),
    }));
    for (const { b, jam } of geser) {
      const baru = resolveShiftWindow(b.date, jam.startTime, jam.endTime, env.APP_TIMEZONE);
      if (jendelaLain.some((j) => j.employeeId === b.employeeId && j.start < baru.end && baru.start < j.end)) bentrok.add(b.id);
    }
  }

  // Dikelompokkan per jam: paling banyak tujuh kelompok (satu per hari pekan).
  const kelompok = new Map<string, { jam: JamShift; ids: string[] }>();
  for (const { b, jam } of berubah) {
    if (bentrok.has(b.id)) continue;
    const kunci = `${jam.startTime}|${jam.endTime}|${jam.breakDuration}`;
    const k = kelompok.get(kunci) ?? { jam, ids: [] };
    k.ids.push(b.id);
    kelompok.set(kunci, k);
  }
  for (const { jam, ids } of kelompok.values()) {
    await tx.shiftSchedule.updateMany({
      where: { id: { in: ids } },
      data: { startTime: jam.startTime, endTime: jam.endTime, breakDuration: new Prisma.Decimal(jam.breakDuration) },
    });
  }
  return { rowsUpdated: berubah.length - bentrok.size, rowsSkipped: bentrok.size };
};

export const updateShiftTemplate = async (req: Request, res: Response) => {
  const input = req.body as UpdateShiftTemplateInput;
  const actor = req.user!;

  const lama = await prisma.shiftTemplate.findUnique({ where: { id: req.params.id } });
  if (!lama) return res.status(404).json({ error: 'Jenis shift tidak ditemukan' });

  const ditolak = tolakKelolaManajer(actor, lama);
  if (ditolak) return res.status(403).json({ error: ditolak });

  let departmentId = lama.departmentId;
  if (input.departmentId !== undefined && input.departmentId !== lama.departmentId) {
    if (actor.role === Role.MANAGER) {
      return res.status(403).json({ error: 'Manajer tidak bisa memindahkan jenis shift ke departemen lain' });
    }
    if (input.departmentId) {
      const ada = await prisma.department.findUnique({ where: { id: input.departmentId }, select: { id: true } });
      if (!ada) return res.status(400).json({ error: 'Departemen tidak ditemukan' });
    }
    departmentId = input.departmentId;
  }

  const jam = {
    startTime: input.startTime ?? lama.startTime,
    endTime: input.endTime ?? lama.endTime,
    breakDuration: input.breakDuration ?? lama.breakDuration.toNumber(),
  };
  if (istirahatTerlaluPanjang(jam.startTime, jam.endTime, jam.breakDuration)) {
    return res.status(400).json({ error: 'Durasi istirahat tidak boleh sama atau melebihi panjang shift' });
  }
  // Jam per hari dikirim utuh bila diubah; bila tidak, yang lama dipertahankan
  // (hari yang kini sama persis dengan jam bawaan baru ikut dibuang).
  const perHariLama = bacaJamPerHari(lama.dailyHours);
  const perHari = normalkanJamPerHari(input.dailyHours ?? perHariLama, jam);
  const salahHari = periksaJamPerHari(perHari);
  if (salahHari) return res.status(400).json({ error: salahHari });

  const nama = input.name ?? lama.name;
  if (lama.isActive && (nama !== lama.name || departmentId !== lama.departmentId)) {
    if (await namaSudahDipakai(nama, departmentId, lama.id)) {
      return res.status(409).json({ error: `Jenis shift "${nama}" sudah ada` });
    }
  }

  const jamBerubah =
    !samaJam(jam, { startTime: lama.startTime, endTime: lama.endTime, breakDuration: lama.breakDuration.toNumber() }) ||
    JSON.stringify(perHari) !== JSON.stringify(perHariLama);

  const { template, hasil } = await prisma.$transaction(
    async (tx) => {
      const template = await tx.shiftTemplate.update({
        where: { id: lama.id },
        data: {
          name: nama,
          ...(input.code !== undefined ? { code: input.code } : {}),
          startTime: jam.startTime,
          endTime: jam.endTime,
          breakDuration: new Prisma.Decimal(jam.breakDuration),
          dailyHours: perHari as unknown as Prisma.InputJsonValue,
          ...(input.color ? { color: input.color } : {}),
          departmentId,
        },
        select: templateSelect(),
      });
      const hasil = jamBerubah
        ? await terapkanJamBaru(tx, lama.id, { ...jam, dailyHours: perHari })
        : { rowsUpdated: 0, rowsSkipped: 0 };
      return { template, hasil };
    },
    { timeout: 30_000 }
  );

  res.locals.audit = {
    action: 'shift.template.update',
    entity: 'ShiftTemplate',
    entityId: lama.id,
    summary: jamBerubah
      ? `Mengubah jam jenis shift ${template.name} menjadi ${jam.startTime}–${jam.endTime}${perHari.length ? ` (${ringkasJamPerHari(perHari)})` : ''}; ${hasil.rowsUpdated} jadwal ke depan ikut berubah`
      : `Memperbarui jenis shift ${template.name}`,
    metadata: { fieldBerubah: Object.keys(input), ...hasil },
  };

  res.json({ template: toTemplateDTO(template), ...hasil });
};

/**
 * Jenis shift tidak dihapus, hanya dinonaktifkan: jadwal lama tetap
 * menunjuk ke sana untuk riwayat. Yang masih dipakai penugasan aktif
 * ditolak — penugasan itu akan terus membuat jadwal dari jenis ini.
 */
export const deactivateShiftTemplate = async (req: Request, res: Response) => {
  const actor = req.user!;

  const lama = await prisma.shiftTemplate.findUnique({ where: { id: req.params.id } });
  if (!lama) return res.status(404).json({ error: 'Jenis shift tidak ditemukan' });

  const ditolak = tolakKelolaManajer(actor, lama);
  if (ditolak) return res.status(403).json({ error: ditolak });

  const activeAssignments = await prisma.shiftAssignment.count({ where: { templateId: lama.id, ...penugasanAktif() } });
  if (activeAssignments > 0) {
    return res.status(409).json({
      error: `Jenis shift ini masih dipakai ${activeAssignments} penugasan aktif. Akhiri penugasannya dulu.`,
      activeAssignments,
    });
  }

  const template = await prisma.shiftTemplate.update({
    where: { id: lama.id },
    data: { isActive: false },
    select: templateSelect(),
  });

  res.locals.audit = {
    action: 'shift.template.deactivate',
    entity: 'ShiftTemplate',
    entityId: lama.id,
    summary: `Menonaktifkan jenis shift ${lama.name}`,
  };

  res.json({ message: 'Jenis shift dinonaktifkan', template: toTemplateDTO(template) });
};
