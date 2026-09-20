// src/controllers/holidayController.ts
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import type { CreateHolidayInput, ListHolidayQuery } from '../schemas/leaveSchema';
import {
  applyHolidayDeductions,
  revertHolidayDeductions,
  type RingkasanPotongan,
} from '../services/collectiveLeave';

export const createHoliday = async (req: Request, res: Response) => {
  const input = req.body as CreateHolidayInput;

  try {
    const libur = await prisma.holiday.create({ data: { id: generateULID(), ...input } });
    // Cuti bersama memotong saldo begitu ditetapkan; ringkasannya dikembalikan
    // supaya HR langsung tahu berapa orang yang terpotong dan berapa yang
    // dilewati karena bekerja shift.
    const collectiveLeave = await applyHolidayDeductions(libur.id);
    res.status(201).json({ ...libur, collectiveLeave });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'Tanggal tersebut sudah terdaftar sebagai hari libur' });
    }
    throw error;
  }
};

/** Menambahkan kalender libur setahun sekaligus. */
export const bulkCreateHolidays = async (req: Request, res: Response) => {
  const { holidays } = req.body as { holidays: CreateHolidayInput[] };

  const kunci = holidays.map((h) => h.date.toISOString().slice(0, 10));
  const duplikatDalamBatch = kunci.filter((k, i) => kunci.indexOf(k) !== i);

  if (duplikatDalamBatch.length > 0) {
    return res.status(400).json({
      error: 'Ada tanggal yang muncul lebih dari sekali dalam permintaan ini',
      duplicates: [...new Set(duplikatDalamBatch)],
    });
  }

  const sudahAda = await prisma.holiday.findMany({
    where: { date: { in: holidays.map((h) => h.date) } },
    select: { date: true },
  });

  if (sudahAda.length > 0) {
    return res.status(409).json({
      error: 'Sebagian tanggal sudah terdaftar',
      conflicts: sudahAda.map((h) => h.date.toISOString().slice(0, 10)),
    });
  }

  const data = holidays.map((h) => ({ id: generateULID(), ...h }));
  const dibuat = await prisma.holiday.createMany({ data });

  const collectiveLeave: RingkasanPotongan = { deducted: 0, skippedShift: 0, skippedNoBalance: 0 };
  for (const h of data) {
    if (!h.isCollectiveLeave) continue;
    const r = await applyHolidayDeductions(h.id);
    collectiveLeave.deducted += r.deducted;
    collectiveLeave.skippedShift += r.skippedShift;
    collectiveLeave.skippedNoBalance += r.skippedNoBalance;
  }

  res.status(201).json({ created: dibuat.count, collectiveLeave });
};

export const getAllHolidays = async (req: Request, res: Response) => {
  const { page, limit, year, startDate, endDate } = req.query as unknown as ListHolidayQuery;

  const where: Prisma.HolidayWhereInput = {};

  if (year) {
    where.date = {
      gte: new Date(`${year}-01-01T00:00:00.000Z`),
      lt: new Date(`${year + 1}-01-01T00:00:00.000Z`),
    };
  } else if (startDate || endDate) {
    where.date = {
      ...(startDate ? { gte: startDate } : {}),
      ...(endDate ? { lte: endDate } : {}),
    };
  }

  const [total, data] = await Promise.all([
    prisma.holiday.count({ where }),
    prisma.holiday.findMany({
      where,
      orderBy: { date: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
};

export const deleteHoliday = async (req: Request, res: Response) => {
  try {
    // Dipulihkan DULU: FK cascade akan menghapus jejak potongannya, tapi tidak
    // mengembalikan angka collectiveLeaveDays di saldo.
    const restored = await revertHolidayDeductions(req.params.id);
    await prisma.holiday.delete({ where: { id: req.params.id } });
    res.json({ message: 'Hari libur dihapus', restoredBalances: restored });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({ error: 'Hari libur tidak ditemukan' });
    }
    throw error;
  }
};
