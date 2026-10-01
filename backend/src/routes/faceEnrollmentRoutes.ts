// src/routes/faceEnrollmentRoutes.ts
import express from 'express';
import {
  enrollFace,
  getFaceEnrollments,
  deactivateFaceEnrollment,
  getWajahSaya,
  kirimWajahSendiri,
  getWajahMenunggu,
  getFotoWajah,
  setujuiWajah,
  tolakWajah,
} from '../controllers/faceEnrollmentController';
import { authenticateToken, requirePermission, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import {
  enrollFaceSchema,
  listFaceEnrollmentQuerySchema,
  kirimWajahSendiriSchema,
  listWajahMenungguQuerySchema,
  setujuiWajahSchema,
  tolakWajahSchema,
} from '../schemas/faceSchema';
import { lihatAtauKelola } from '../utils/permissions';

const router = express.Router();

router.use(authenticateToken);

/**
 * Wajah yang dipakai mencocokkan check-in selalu melewati HR.
 *
 * Kalau karyawan bisa langsung mendaftarkan wajahnya sendiri, ia juga bisa
 * mendaftarkan wajah rekannya — dan seluruh gunanya verifikasi wajah untuk
 * presensi hilang. Jadi ada dua jalur: HR mendaftarkan langsung di web, atau
 * karyawan mengirim selfie dari aplikasi yang baru berlaku setelah HR melihat
 * fotonya dan menyetujui.
 */
router.post(
  '/employees/:id/face-enrollments',
  requirePermission('wajah.buat'),
  validate(idParamSchema, 'params'),
  validate(enrollFaceSchema),
  asyncHandler(enrollFace)
);

router.get(
  '/employees/:id/face-enrollments',
  requirePermission(...lihatAtauKelola('wajah')),
  validate(idParamSchema, 'params'),
  validate(listFaceEnrollmentQuerySchema, 'query'),
  asyncHandler(getFaceEnrollments)
);

// Rute bernama (/me, /pending) didaftarkan sebelum rute ber-:id supaya tidak
// tertangkap sebagai id.

// Milik sendiri: semua peran, tanpa izin wajah — yang dikirim baru berlaku
// setelah disetujui HR.
router.get('/face-enrollments/me', asyncHandler(getWajahSaya));

router.post(
  '/face-enrollments/me',
  validate(kirimWajahSendiriSchema),
  asyncHandler(kirimWajahSendiri)
);

// Peninjauan: izin yang sama dengan mendaftarkan langsung, karena menyetujui
// kiriman berakibat sama dengan mendaftarkannya.
router.get(
  '/face-enrollments/pending',
  requirePermission('wajah.buat'),
  validate(listWajahMenungguQuerySchema, 'query'),
  asyncHandler(getWajahMenunggu)
);

router.get(
  '/face-enrollments/:id/photo',
  requirePermission('wajah.buat'),
  validate(idParamSchema, 'params'),
  asyncHandler(getFotoWajah)
);

router.post(
  '/face-enrollments/:id/approve',
  requirePermission('wajah.buat'),
  validate(idParamSchema, 'params'),
  validate(setujuiWajahSchema),
  asyncHandler(setujuiWajah)
);

router.post(
  '/face-enrollments/:id/reject',
  requirePermission('wajah.buat'),
  validate(idParamSchema, 'params'),
  validate(tolakWajahSchema),
  asyncHandler(tolakWajah)
);

router.delete(
  '/face-enrollments/:id',
  requirePermission('wajah.hapus'),
  validate(idParamSchema, 'params'),
  asyncHandler(deactivateFaceEnrollment)
);

export default router;
