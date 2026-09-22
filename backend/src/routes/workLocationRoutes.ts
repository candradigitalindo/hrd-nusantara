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
import { lihatAtauKelola } from '../utils/permissions';

const router = express.Router();

router.use(authenticateToken);

// Semua karyawan boleh melihat daftar lokasi — dibutuhkan untuk memilih
// lokasi saat check-in. Token QR-nya disaring di controller.
router.get('/', requirePermission('presensi.lihat', 'presensi_tim.lihat', ...lihatAtauKelola('lokasi')), validate(listWorkLocationQuerySchema, 'query'), asyncHandler(getAllWorkLocations));
router.get('/:id', requirePermission('presensi.lihat', 'presensi_tim.lihat', ...lihatAtauKelola('lokasi')), validate(idParamSchema, 'params'), asyncHandler(getWorkLocationById));

router.post(
  '/',
  requirePermission('lokasi.buat'),
  validate(createWorkLocationSchema),
  asyncHandler(createWorkLocation)
);

router.put(
  '/:id',
  requirePermission('lokasi.ubah'),
  validate(idParamSchema, 'params'),
  validate(updateWorkLocationSchema),
  asyncHandler(updateWorkLocation)
);

router.post(
  '/:id/rotate-qr',
  requirePermission('lokasi.ubah'),
  validate(idParamSchema, 'params'),
  asyncHandler(rotateQrSecret)
);

export default router;
