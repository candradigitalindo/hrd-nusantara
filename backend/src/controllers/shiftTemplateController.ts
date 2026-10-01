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
    summary: `Membuat jenis shift ${template.name} (${template.startTime}–${template.endTime})`,
  };

  res.status(201).json(toTemplateDTO(template));
};

/**
 * Jam baru jenis shift ikut diterapkan ke jadwal KE DEPAN yang dibuat dari
 * jenis ini — selama belum dikoreksi manual, belum dibatalkan, dan belum
 * dipakai presensi. Jadwal yang sudah lewat adalah catatan sejarah.
 *
 * Baris yang dengan jam baru akan bertabrakan dengan shift lain orang itu
 * dibiarkan dengan jam lamanya dan dilaporkan, bukan dipaksakan bertumpuk.
 */
const terapkanJamBaru = async (
  tx: PrismaTransactionClient,
  templateId: string,
  jam: { startTime: string; endTime: string; breakDuration: number },
  periksaBentrok: boolean
): Promise<{ rowsUpdated: number; rowsSkipped: number }> => {
  const baris = await tx.shiftSchedule.findMany({
    where: {
      templateId,
      date: { gte: hariIni() },
      isOverride: false,
      status: { not: 'cancelled' },
      attendances: { none: {} },
    },
    select: { id: true, employeeId: true, date: true },
  });
  if (baris.length === 0) return { rowsUpdated: 0, rowsSkipped: 0 };

  let diperbarui = baris.map((b) => b.id);
  if (periksaBentrok) {
    const waktu = baris.map((b) => b.date.getTime());
    const lain = await tx.shiftSchedule.findMany({
      where: {
        employeeId: { in: [...new Set(baris.map((b) => b.employeeId))] },
        status: { not: 'cancelled' },
        id: { notIn: diperbarui },
        date: { gte: geserHari(new Date(Math.min(...waktu)), -1), lte: geserHari(new Date(Math.max(...waktu)), 1) },
      },
      select: { employeeId: true, date: true, startTime: true, endTime: true },
    });
    const jendelaLain = lain.map((r) => ({
      employeeId: r.employeeId,
      ...resolveShiftWindow(r.date, r.startTime, r.endTime, env.APP_TIMEZONE),
    }));

    diperbarui = baris
      .filter((b) => {
        const baru = resolveShiftWindow(b.date, jam.startTime, jam.endTime, env.APP_TIMEZONE);
        return !jendelaLain.some((j) => j.employeeId === b.employeeId && j.start < baru.end && baru.start < j.end);
      })
      .map((b) => b.id);
  }

  if (diperbarui.length > 0) {
    await tx.shiftSchedule.updateMany({
      where: { id: { in: diperbarui } },
      data: { startTime: jam.startTime, endTime: jam.endTime, breakDuration: new Prisma.Decimal(jam.breakDuration) },
    });
  }
  return { rowsUpdated: diperbarui.length, rowsSkipped: baris.length - diperbarui.length };
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

  const nama = input.name ?? lama.name;
  if (lama.isActive && (nama !== lama.name || departmentId !== lama.departmentId)) {
    if (await namaSudahDipakai(nama, departmentId, lama.id)) {
      return res.status(409).json({ error: `Jenis shift "${nama}" sudah ada` });
    }
  }

  const jamPindah = jam.startTime !== lama.startTime || jam.endTime !== lama.endTime;
  const jamBerubah = jamPindah || jam.breakDuration !== lama.breakDuration.toNumber();

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
          ...(input.color ? { color: input.color } : {}),
          departmentId,
        },
        select: templateSelect(),
      });
      const hasil = jamBerubah
        ? await terapkanJamBaru(tx, lama.id, jam, jamPindah)
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
      ? `Mengubah jam jenis shift ${template.name} menjadi ${jam.startTime}–${jam.endTime}; ${hasil.rowsUpdated} jadwal ke depan ikut berubah`
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
