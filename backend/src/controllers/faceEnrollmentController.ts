// src/controllers/faceEnrollmentController.ts
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { generateULID } from '../utils/generateULID';
import { decodeBase64Image, saveImage, InvalidImageError } from '../utils/imageUpload';
import {
  extractForEnrollment,
  embeddingToBuffer,
  FaceProcessingError,
  FaceModelError,
} from '../services/face';
import type { EnrollFaceInput, ListFaceEnrollmentQuery } from '../schemas/faceSchema';

/** Embedding tidak pernah ikut keluar lewat API — itu data biometrik. */
const enrollmentSelect = {
  id: true,
  employeeId: true,
  dimensions: true,
  modelName: true,
  detectionScore: true,
  isActive: true,
  enrolledById: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FaceEnrollmentSelect;

/**
 * Menerjemahkan kegagalan pemrosesan wajah menjadi status HTTP.
 * Dipakai bersama oleh pendaftaran dan check-in supaya aplikasi mobile
 * melihat kode yang konsisten.
 */
export const handleFaceError = (error: unknown, res: Response): boolean => {
  if (error instanceof FaceModelError) {
    // 503: masalah kesiapan server, bukan kesalahan pengguna.
    res.status(503).json({
      error: 'Model pengenalan wajah belum siap di server',
      detail: error.message,
    });
    return true;
  }

  if (error instanceof FaceProcessingError) {
    const status = error.reason === 'recognition_disabled' ? 503 : 422;
    res.status(status).json({ error: error.message, reason: error.reason });
    return true;
  }

  if (error instanceof InvalidImageError) {
    res.status(400).json({ error: error.message });
    return true;
  }

  return false;
};

export const enrollFace = async (req: Request, res: Response) => {
  const { image, replaceExisting } = req.body as EnrollFaceInput;
  const employeeId = req.params.id;

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true },
  });

  if (!employee) {
    return res.status(404).json({ error: 'Karyawan tidak ditemukan' });
  }

  try {
    const { buffer, extension } = decodeBase64Image(image);
    const hasil = await extractForEnrollment(buffer);

    const imageUrl = await saveImage(buffer, extension, 'face-enrollments');

    const enrollment = await prisma.$transaction(async (tx) => {
      if (replaceExisting) {
        await tx.faceEnrollment.updateMany({
          where: { employeeId, isActive: true },
          data: { isActive: false },
        });
      }

      return tx.faceEnrollment.create({
        data: {
          id: generateULID(),
          employeeId,
          embedding: embeddingToBuffer(hasil.embedding),
          dimensions: hasil.embedding.length,
          modelName: hasil.modelName,
          detectionScore: hasil.detectionScore,
          imageUrl,
          enrolledById: req.user!.id,
        },
        select: enrollmentSelect,
      });
    });

    res.status(201).json(enrollment);
  } catch (error) {
    if (handleFaceError(error, res)) return;
    throw error;
  }
};

export const getFaceEnrollments = async (req: Request, res: Response) => {
  const { page, limit, includeInactive } = req.query as unknown as ListFaceEnrollmentQuery;
  const employeeId = req.params.id;

  const where: Prisma.FaceEnrollmentWhereInput = { employeeId };
  if (!includeInactive) where.isActive = true;

  const [total, rows] = await Promise.all([
    prisma.faceEnrollment.count({ where }),
    prisma.faceEnrollment.findMany({
      where,
      select: enrollmentSelect,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data: rows.map((row) => ({
      ...row,
      // Pendaftaran dari model lain tidak bisa dibandingkan dengan model
      // yang sedang aktif, jadi statusnya ditandai agar HR bisa mendaftar ulang.
      stale: row.modelName !== env.FACE_MODEL_NAME,
    })),
    activeModel: env.FACE_MODEL_NAME,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
};

/**
 * Pendaftaran wajah dinonaktifkan, bukan dihapus — jejak siapa mendaftarkan
 * siapa dan kapan adalah bagian dari audit sistem biometrik.
 */
export const deactivateFaceEnrollment = async (req: Request, res: Response) => {
  try {
    const enrollment = await prisma.faceEnrollment.update({
      where: { id: req.params.id },
      data: { isActive: false },
      select: enrollmentSelect,
    });

    res.json({ message: 'Pendaftaran wajah dinonaktifkan', enrollment });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({ error: 'Pendaftaran wajah tidak ditemukan' });
    }
    throw error;
  }
};
