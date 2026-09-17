// src/controllers/leaveTypeController.ts
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import type {
  CreateLeaveTypeInput,
  UpdateLeaveTypeInput,
  ListLeaveTypeQuery,
} from '../schemas/leaveSchema';

export const createLeaveType = async (req: Request, res: Response) => {
  const input = req.body as CreateLeaveTypeInput;

  try {
    const tipe = await prisma.leaveType.create({
      data: { id: generateULID(), ...input },
    });
    res.status(201).json(tipe);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: `Kode jenis cuti "${input.code}" sudah dipakai` });
    }
    throw error;
  }
};

export const getAllLeaveTypes = async (req: Request, res: Response) => {
  const { page, limit, includeInactive } = req.query as unknown as ListLeaveTypeQuery;

  const where: Prisma.LeaveTypeWhereInput = includeInactive ? {} : { isActive: true };

  const [total, data] = await Promise.all([
    prisma.leaveType.count({ where }),
    prisma.leaveType.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
};

export const updateLeaveType = async (req: Request, res: Response) => {
  const input = req.body as UpdateLeaveTypeInput;

  try {
    const tipe = await prisma.leaveType.update({ where: { id: req.params.id }, data: input });
    res.json(tipe);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return res.status(404).json({ error: 'Jenis cuti tidak ditemukan' });
      }
      if (error.code === 'P2002') {
        return res.status(409).json({ error: 'Kode jenis cuti sudah dipakai' });
      }
    }
    throw error;
  }
};

/**
 * Jenis cuti dinonaktifkan, tidak dihapus: pengajuan cuti lama menunjuk ke
 * sini, dan menghapusnya akan memutus riwayat cuti karyawan.
 */
export const deactivateLeaveType = async (req: Request, res: Response) => {
  try {
    const tipe = await prisma.leaveType.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ message: 'Jenis cuti dinonaktifkan', leaveType: tipe });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({ error: 'Jenis cuti tidak ditemukan' });
    }
    throw error;
  }
};
