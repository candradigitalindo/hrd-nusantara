// src/controllers/workPatternController.ts
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import { resolveWorkPattern } from '../services/workPattern';
import type {
  CreateWorkPatternInput,
  UpdateWorkPatternInput,
  ListWorkPatternQuery,
  AssignWorkPatternInput,
} from '../schemas/leaveSchema';

/** Hanya boleh ada satu pola bawaan; yang lama dilepas saat ada yang baru. */
const lepasBawaanLain = async (tx: PrismaTransactionClient, kecualiId?: string) => {
  await tx.workPattern.updateMany({
    where: { isDefault: true, ...(kecualiId ? { id: { not: kecualiId } } : {}) },
    data: { isDefault: false },
  });
};

export const createWorkPattern = async (req: Request, res: Response) => {
  const input = req.body as CreateWorkPatternInput;

  try {
    const pola = await prisma.$transaction(async (tx) => {
      if (input.isDefault) await lepasBawaanLain(tx);
      return tx.workPattern.create({
        data: { id: generateULID(), ...input, workingWeekdays: [...input.workingWeekdays].sort() },
      });
    });

    res.status(201).json(pola);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: `Kode pola kerja "${input.code}" sudah dipakai` });
    }
    throw error;
  }
};

export const getAllWorkPatterns = async (req: Request, res: Response) => {
  const { page, limit, includeInactive } = req.query as unknown as ListWorkPatternQuery;
  const where: Prisma.WorkPatternWhereInput = includeInactive ? {} : { isActive: true };

  const [total, data] = await Promise.all([
    prisma.workPattern.count({ where }),
    prisma.workPattern.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
};

export const updateWorkPattern = async (req: Request, res: Response) => {
  const input = req.body as UpdateWorkPatternInput;
  const id = req.params.id;

  try {
    const pola = await prisma.$transaction(async (tx) => {
      if (input.isDefault) await lepasBawaanLain(tx, id);
      return tx.workPattern.update({
        where: { id },
        data: {
          ...input,
          ...(input.workingWeekdays ? { workingWeekdays: [...input.workingWeekdays].sort() } : {}),
        },
      });
    });

    res.json(pola);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({ error: 'Pola kerja tidak ditemukan' });
    }
    throw error;
  }
};

export const assignEmployeeWorkPattern = async (req: Request, res: Response) => {
  const { workPatternId } = req.body as AssignWorkPatternInput;

  try {
    const karyawan = await prisma.employee.update({
      where: { id: req.params.id },
      data: { workPatternId },
      select: { id: true, nik: true, name: true, workPatternId: true },
    });

    res.json(karyawan);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({ error: 'Karyawan atau pola kerja tidak ditemukan' });
    }
    throw error;
  }
};

export const assignDepartmentWorkPattern = async (req: Request, res: Response) => {
  const { workPatternId } = req.body as AssignWorkPatternInput;

  try {
    const dept = await prisma.department.update({
      where: { id: req.params.id },
      data: { workPatternId },
      select: { id: true, name: true, workPatternId: true },
    });

    res.json(dept);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({ error: 'Departemen atau pola kerja tidak ditemukan' });
    }
    throw error;
  }
};

/** Pola yang berlaku untuk pengguna saat ini, setelah penjenjangan diterapkan. */
export const getMyWorkPattern = async (req: Request, res: Response) => {
  res.json(await resolveWorkPattern(req.user!.id));
};
