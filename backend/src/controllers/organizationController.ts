// src/controllers/organizationController.ts
//
// Departemen dan jabatan: tulang punggung struktur organisasi. Dokumen fitur
// meminta karyawan dikelompokkan per departemen (Kitchen, Front Office,
// Housekeeping, ...) dan level jabatan — tapi sampai modul ini ada, tidak
// ada satu pun jalan untuk MEMBUAT departemen selain menulis langsung ke
// database. Karyawan pertama tidak bisa ditempatkan di mana pun.
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import type {
  CreateDepartmentInput,
  UpdateDepartmentInput,
  ListDepartmentQuery,
  CreatePositionInput,
  UpdatePositionInput,
  ListPositionQuery,
} from '../schemas/organizationSchema';

const departmentSelect = {
  id: true,
  name: true,
  description: true,
  workPatternId: true,
  workPattern: { select: { id: true, name: true, type: true } },
  createdAt: true,
  updatedAt: true,
  _count: { select: { employees: true, positions: true } },
} satisfies Prisma.DepartmentSelect;

const positionSelect = {
  id: true,
  name: true,
  description: true,
  departmentId: true,
  department: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
  _count: { select: { employees: true } },
} satisfies Prisma.PositionSelect;

const paginasi = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});

/**
 * Menghapus hanya bila tidak ada yang merujuk. Departemen dengan karyawan di
 * dalamnya tidak boleh hilang: karyawannya akan kehilangan tempat, dan arsip
 * presensi serta penggajian yang menunjuk ke sana ikut yatim.
 *
 * Diperiksa EKSPLISIT, bukan mengandalkan galat foreign key: relasi opsional
 * di Prisma bawaannya ON DELETE SET NULL, jadi database tidak menolak —
 * ia diam-diam mengosongkan departemen semua karyawannya.
 */
const tanganiHapus = (error: unknown, res: Response, apa: string) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025') return res.status(404).json({ error: `${apa} tidak ditemukan` });
    if (error.code === 'P2003') {
      return res.status(409).json({ error: `${apa} masih dirujuk data lain` });
    }
  }
  throw error;
};

// ============ Departemen ============

export const createDepartment = async (req: Request, res: Response) => {
  const input = req.body as CreateDepartmentInput;

  if (input.workPatternId) {
    const pola = await prisma.workPattern.findUnique({ where: { id: input.workPatternId }, select: { id: true } });
    if (!pola) return res.status(404).json({ error: 'Pola kerja tidak ditemukan' });
  }

  const departemen = await prisma.department.create({
    data: { id: generateULID(), ...input },
    select: departmentSelect,
  });
  res.status(201).json(departemen);
};

export const getAllDepartments = async (req: Request, res: Response) => {
  const { page, limit, search } = req.query as unknown as ListDepartmentQuery;
  const where: Prisma.DepartmentWhereInput = search
    ? { name: { contains: search, mode: 'insensitive' } }
    : {};

  const [total, data] = await Promise.all([
    prisma.department.count({ where }),
    prisma.department.findMany({
      where,
      select: departmentSelect,
      orderBy: { name: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({ data, pagination: paginasi(page, limit, total) });
};

export const getDepartmentById = async (req: Request, res: Response) => {
  const departemen = await prisma.department.findUnique({
    where: { id: req.params.id },
    select: { ...departmentSelect, positions: { select: { id: true, name: true } } },
  });
  if (!departemen) return res.status(404).json({ error: 'Departemen tidak ditemukan' });
  res.json(departemen);
};

export const updateDepartment = async (req: Request, res: Response) => {
  const input = req.body as UpdateDepartmentInput;

  if (input.workPatternId) {
    const pola = await prisma.workPattern.findUnique({ where: { id: input.workPatternId }, select: { id: true } });
    if (!pola) return res.status(404).json({ error: 'Pola kerja tidak ditemukan' });
  }

  try {
    const departemen = await prisma.department.update({
      where: { id: req.params.id },
      data: input,
      select: departmentSelect,
    });
    res.json(departemen);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({ error: 'Departemen tidak ditemukan' });
    }
    throw error;
  }
};

export const deleteDepartment = async (req: Request, res: Response) => {
  const dipakai = await prisma.department.findUnique({
    where: { id: req.params.id },
    select: { _count: { select: { employees: true, positions: true, whatsappAccounts: true } } },
  });
  if (!dipakai) return res.status(404).json({ error: 'Departemen tidak ditemukan' });

  const { employees, positions, whatsappAccounts } = dipakai._count;
  if (employees + positions + whatsappAccounts > 0) {
    return res.status(409).json({
      error: `Departemen masih dipakai: ${employees} karyawan, ${positions} jabatan, ${whatsappAccounts} nomor WhatsApp. Pindahkan dulu sebelum dihapus.`,
    });
  }

  try {
    await prisma.department.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    tanganiHapus(error, res, 'Departemen');
  }
};

// ============ Jabatan ============

export const createPosition = async (req: Request, res: Response) => {
  const input = req.body as CreatePositionInput;

  if (input.departmentId) {
    const dept = await prisma.department.findUnique({ where: { id: input.departmentId }, select: { id: true } });
    if (!dept) return res.status(404).json({ error: 'Departemen tidak ditemukan' });
  }

  const jabatan = await prisma.position.create({
    data: { id: generateULID(), ...input },
    select: positionSelect,
  });
  res.status(201).json(jabatan);
};

export const getAllPositions = async (req: Request, res: Response) => {
  const { page, limit, search, departmentId } = req.query as unknown as ListPositionQuery;
  const where: Prisma.PositionWhereInput = {
    ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    ...(departmentId ? { departmentId } : {}),
  };

  const [total, data] = await Promise.all([
    prisma.position.count({ where }),
    prisma.position.findMany({
      where,
      select: positionSelect,
      orderBy: { name: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({ data, pagination: paginasi(page, limit, total) });
};

export const updatePosition = async (req: Request, res: Response) => {
  const input = req.body as UpdatePositionInput;

  if (input.departmentId) {
    const dept = await prisma.department.findUnique({ where: { id: input.departmentId }, select: { id: true } });
    if (!dept) return res.status(404).json({ error: 'Departemen tidak ditemukan' });
  }

  try {
    const jabatan = await prisma.position.update({
      where: { id: req.params.id },
      data: input,
      select: positionSelect,
    });
    res.json(jabatan);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({ error: 'Jabatan tidak ditemukan' });
    }
    throw error;
  }
};

export const deletePosition = async (req: Request, res: Response) => {
  const dipakai = await prisma.position.findUnique({
    where: { id: req.params.id },
    select: { _count: { select: { employees: true, jobPostings: true } } },
  });
  if (!dipakai) return res.status(404).json({ error: 'Jabatan tidak ditemukan' });

  if (dipakai._count.employees + dipakai._count.jobPostings > 0) {
    return res.status(409).json({
      error: `Jabatan masih dipakai: ${dipakai._count.employees} karyawan, ${dipakai._count.jobPostings} lowongan. Pindahkan dulu sebelum dihapus.`,
    });
  }

  try {
    await prisma.position.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    tanganiHapus(error, res, 'Jabatan');
  }
};
