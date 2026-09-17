// src/controllers/deviceController.ts
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import type { RegisterDeviceInput, UnregisterDeviceInput } from '../schemas/deviceSchema';

const deviceSelect = {
  id: true,
  platform: true,
  isActive: true,
  lastUsedAt: true,
  createdAt: true,
} satisfies Prisma.DeviceTokenSelect;

/**
 * Mendaftarkan perangkat untuk menerima notifikasi.
 *
 * Token dijadikan kunci, bukan pasangan (karyawan, perangkat): satu token
 * milik satu pemasangan aplikasi. Kalau ponsel berpindah tangan dan orang
 * baru login, token yang sama harus BERPINDAH pemilik — kalau tidak,
 * notifikasi pemilik lama, termasuk soal nomor WhatsApp perusahaan yang
 * dipegangnya, akan terus mengalir ke layar orang lain.
 */
export const registerDevice = async (req: Request, res: Response) => {
  const input = req.body as RegisterDeviceInput;
  const actor = req.user!;

  const perangkat = await prisma.deviceToken.upsert({
    where: { token: input.token },
    create: {
      id: generateULID(),
      employeeId: actor.id,
      token: input.token,
      platform: input.platform,
    },
    update: {
      employeeId: actor.id,
      platform: input.platform,
      // Token yang sempat dimatikan bisa hidup lagi saat aplikasi dipasang
      // ulang dan Firebase mengembalikan token yang sama.
      isActive: true,
    },
    select: deviceSelect,
  });

  res.status(201).json(perangkat);
};

/** Dipanggil saat karyawan logout dari aplikasi mobile. */
export const unregisterDevice = async (req: Request, res: Response) => {
  const { token } = req.body as UnregisterDeviceInput;
  const actor = req.user!;

  // Dibatasi pada token milik sendiri: tanpa itu, siapa pun yang tahu token
  // orang lain bisa mematikan notifikasi orang tersebut.
  const hasil = await prisma.deviceToken.updateMany({
    where: { token, employeeId: actor.id },
    data: { isActive: false },
  });

  if (hasil.count === 0) {
    return res.status(404).json({ error: 'Perangkat tidak ditemukan untuk akun ini' });
  }

  res.json({ unregistered: hasil.count });
};

export const getMyDevices = async (req: Request, res: Response) => {
  const perangkat = await prisma.deviceToken.findMany({
    where: { employeeId: req.user!.id, isActive: true },
    select: deviceSelect,
    orderBy: { createdAt: 'desc' },
  });

  res.json({ data: perangkat });
};
