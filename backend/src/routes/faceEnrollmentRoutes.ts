// src/routes/faceEnrollmentRoutes.ts
import express from 'express';
import { Role } from '@prisma/client';
import {
  enrollFace,
  getFaceEnrollments,
  deactivateFaceEnrollment,
} from '../controllers/faceEnrollmentController';
import { authenticateToken, requireRole, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import { enrollFaceSchema, listFaceEnrollmentQuerySchema } from '../schemas/faceSchema';

const router = express.Router();

router.use(authenticateToken);

/**
 * Pendaftaran wajah hanya boleh dilakukan HR, tidak oleh karyawan sendiri.
 *
 * Kalau karyawan bisa mendaftarkan wajahnya sendiri, ia juga bisa mendaftarkan
 * wajah rekannya — dan seluruh gunanya verifikasi wajah untuk presensi hilang.
 * Konsekuensinya HR harus melakukan pendaftaran awal satu per satu; itu memang
 * biaya yang disengaja.
 */
router.post(
  '/employees/:id/face-enrollments',
  requireRole(Role.SUPER_ADMIN, Role.HR_ADMIN),
  validate(idParamSchema, 'params'),
  validate(enrollFaceSchema),
  asyncHandler(enrollFace)
);

router.get(
  '/employees/:id/face-enrollments',
  requireRole(Role.SUPER_ADMIN, Role.HR_ADMIN),
  validate(idParamSchema, 'params'),
  validate(listFaceEnrollmentQuerySchema, 'query'),
  asyncHandler(getFaceEnrollments)
);

router.delete(
  '/face-enrollments/:id',
  requireRole(Role.SUPER_ADMIN, Role.HR_ADMIN),
  validate(idParamSchema, 'params'),
  asyncHandler(deactivateFaceEnrollment)
);

export default router;
