// src/routes/workLocationRoutes.ts
import express from 'express';
import {
  createWorkLocation,
  getAllWorkLocations,
  getWorkLocationById,
  updateWorkLocation,
  rotateQrSecret,
} from '../controllers/workLocationController';
import { authenticateToken, requirePermission, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import {
  createWorkLocationSchema,
  updateWorkLocationSchema,
  listWorkLocationQuerySchema,
} from '../schemas/workLocationSchema';

const router = express.Router();

router.use(authenticateToken);

// Semua karyawan boleh melihat daftar lokasi — dibutuhkan untuk memilih
// lokasi saat check-in. Token QR-nya disaring di controller.
router.get('/', requirePermission('halaman.presensi', 'presensi.lihat_tim', 'lokasi.kelola'), validate(listWorkLocationQuerySchema, 'query'), asyncHandler(getAllWorkLocations));
router.get('/:id', requirePermission('halaman.presensi', 'presensi.lihat_tim', 'lokasi.kelola'), validate(idParamSchema, 'params'), asyncHandler(getWorkLocationById));

router.post(
  '/',
  requirePermission('lokasi.kelola'),
  validate(createWorkLocationSchema),
  asyncHandler(createWorkLocation)
);

router.put(
  '/:id',
  requirePermission('lokasi.kelola'),
  validate(idParamSchema, 'params'),
  validate(updateWorkLocationSchema),
  asyncHandler(updateWorkLocation)
);

router.post(
  '/:id/rotate-qr',
  requirePermission('lokasi.kelola'),
  validate(idParamSchema, 'params'),
  asyncHandler(rotateQrSecret)
);

export default router;
