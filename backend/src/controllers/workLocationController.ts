// src/controllers/workLocationController.ts
import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { toDataURL } from 'qrcode';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import type {
  CreateWorkLocationInput,
  UpdateWorkLocationInput,
  ListWorkLocationQuery,
} from '../schemas/workLocationSchema';

type WorkLocationRow = Prisma.WorkLocationGetPayload<object>;

/**
 * Koordinat dikirim sebagai angka, bukan string Decimal bawaan Prisma —
 * aplikasi Flutter memakainya langsung untuk perhitungan jarak.
 * `qrSecret` hanya untuk HR: token itulah isi QR yang ditempel di lokasi,
 * dan siapa pun yang mengetahuinya bisa absen tanpa berada di sana.
 */
const toDTO = (location: WorkLocationRow, includeSecret: boolean) => ({
  id: location.id,
  name: location.name,
  address: location.address,
  latitude: location.latitude.toNumber(),
  longitude: location.longitude.toNumber(),
  radiusMeters: location.radiusMeters,
  isActive: location.isActive,
  ...(includeSecret ? { qrSecret: location.qrSecret } : {}),
  createdAt: location.createdAt,
  updatedAt: location.updatedAt,
});

const canSeeSecret = (role: Role) => role === Role.SUPER_ADMIN || role === Role.HR_ADMIN;

export const createWorkLocation = async (req: Request, res: Response) => {
  const input = req.body as CreateWorkLocationInput;

  const location = await prisma.workLocation.create({
    data: {
      id: generateULID(),
      name: input.name,
      address: input.address,
      latitude: new Prisma.Decimal(input.latitude),
      longitude: new Prisma.Decimal(input.longitude),
      radiusMeters: input.radiusMeters,
      // Dibuat server, tidak pernah diterima dari klien: token ini adalah
      // kunci absensi QR, jadi nilainya harus tak bisa ditebak.
      qrSecret: randomBytes(24).toString('base64url'),
    },
  });

  res.status(201).json(toDTO(location, true));
};

export const getAllWorkLocations = async (req: Request, res: Response) => {
  const { page, limit, search, includeInactive } =
    req.query as unknown as ListWorkLocationQuery;

  const where: Prisma.WorkLocationWhereInput = {};
  if (!includeInactive) where.isActive = true;
  if (search) where.name = { contains: search, mode: 'insensitive' };

  const [total, rows] = await Promise.all([
    prisma.workLocation.count({ where }),
    prisma.workLocation.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data: rows.map((row) => toDTO(row, canSeeSecret(req.user!.role))),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
};

export const getWorkLocationById = async (req: Request, res: Response) => {
  const location = await prisma.workLocation.findUnique({ where: { id: req.params.id } });

  if (!location) {
    return res.status(404).json({ error: 'Lokasi kerja tidak ditemukan' });
  }

  res.json(toDTO(location, canSeeSecret(req.user!.role)));
};

export const updateWorkLocation = async (req: Request, res: Response) => {
  const input = req.body as UpdateWorkLocationInput;

  const data: Prisma.WorkLocationUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.address !== undefined) data.address = input.address;
  if (input.latitude !== undefined) data.latitude = new Prisma.Decimal(input.latitude);
  if (input.longitude !== undefined) data.longitude = new Prisma.Decimal(input.longitude);
  if (input.radiusMeters !== undefined) data.radiusMeters = input.radiusMeters;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  try {
    const location = await prisma.workLocation.update({ where: { id: req.params.id }, data });
    res.json(toDTO(location, true));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({ error: 'Lokasi kerja tidak ditemukan' });
    }
    throw error;
  }
};

/**
 * Gambar QR lokasi untuk dicetak dan ditempel di titik presensi. Isinya
 * token absensi, jadi hanya untuk yang boleh melihat token (HR / Super
 * Admin) dan dibuat di server — tidak pernah lewat layanan QR pihak luar.
 */
export const getWorkLocationQr = async (req: Request, res: Response) => {
  if (!canSeeSecret(req.user!.role)) {
    return res.status(403).json({ error: 'Hanya HR yang boleh melihat QR presensi' });
  }
  const location = await prisma.workLocation.findUnique({ where: { id: req.params.id } });
  if (!location) return res.status(404).json({ error: 'Lokasi kerja tidak ditemukan' });
  res.json({ name: location.name, dataUrl: await toDataURL(location.qrSecret, { width: 720, margin: 2, errorCorrectionLevel: 'M' }) });
};

/** Memutar ulang token QR, misalnya setelah QR lama bocor atau difoto orang. */
export const rotateQrSecret = async (req: Request, res: Response) => {
  try {
    const location = await prisma.workLocation.update({
      where: { id: req.params.id },
      data: { qrSecret: randomBytes(24).toString('base64url') },
    });
    res.json({
      message: 'Token QR diperbarui. Cetak ulang QR di lokasi — yang lama tidak berlaku lagi.',
      workLocation: toDTO(location, true),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({ error: 'Lokasi kerja tidak ditemukan' });
    }
    throw error;
  }
};
