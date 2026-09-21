// src/routes/mobileReleaseRoutes.ts
//
// Dipasang di '/api/mobile' SEBELUM router-router ber-JWT yang dipasang di
// '/api': rute unduh harus publik, karena karyawan mengunduh aplikasi
// sebelum punya sesi di ponselnya.
import express from 'express';
import {
  uploadRelease,
  listReleases,
  updateRelease,
  getLatestRelease,
  downloadLatestApk,
  downloadApk,
  qrForText,
} from '../controllers/mobileReleaseController';
import { authenticateToken, requirePermission, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import {
  uploadReleaseQuerySchema,
  updateReleaseSchema,
  listReleaseQuerySchema,
  qrQuerySchema,
} from '../schemas/mobileReleaseSchema';

const router = express.Router();

// --- Publik ---
router.get('/releases/latest', asyncHandler(getLatestRelease));
router.get('/apk/latest', asyncHandler(downloadLatestApk));
router.get('/releases/:id/apk', validate(idParamSchema, 'params'), asyncHandler(downloadApk));

// --- HR ---
router.get(
  '/releases',
  authenticateToken,
  requirePermission('aplikasi.rilis'),
  validate(listReleaseQuerySchema, 'query'),
  asyncHandler(listReleases)
);
// Badan = berkas APK mentah (bukan JSON), metadata lewat query. express.raw
// dipasang hanya di sini supaya batas 300 MB tidak berlaku ke rute lain.
router.post(
  '/releases',
  authenticateToken,
  requirePermission('aplikasi.rilis'),
  validate(uploadReleaseQuerySchema, 'query'),
  express.raw({ type: () => true, limit: '300mb' }),
  asyncHandler(uploadRelease)
);
router.patch(
  '/releases/:id',
  authenticateToken,
  requirePermission('aplikasi.rilis'),
  validate(idParamSchema, 'params'),
  validate(updateReleaseSchema),
  asyncHandler(updateRelease)
);
router.get('/qr', authenticateToken, requirePermission('aplikasi.rilis'), validate(qrQuerySchema, 'query'), asyncHandler(qrForText));

export default router;
