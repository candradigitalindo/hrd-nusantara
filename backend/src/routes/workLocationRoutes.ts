// src/routes/workLocationRoutes.ts
import express from 'express';
import { Role } from '@prisma/client';
import {
  createWorkLocation,
  getAllWorkLocations,
  getWorkLocationById,
  updateWorkLocation,
  rotateQrSecret,
} from '../controllers/workLocationController';
import { authenticateToken, requireRole, asyncHandler } from '../middleware/auth';
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
router.get('/', validate(listWorkLocationQuerySchema, 'query'), asyncHandler(getAllWorkLocations));
router.get('/:id', validate(idParamSchema, 'params'), asyncHandler(getWorkLocationById));

router.post(
  '/',
  requireRole(Role.SUPER_ADMIN, Role.HR_ADMIN),
  validate(createWorkLocationSchema),
  asyncHandler(createWorkLocation)
);

router.put(
  '/:id',
  requireRole(Role.SUPER_ADMIN, Role.HR_ADMIN),
  validate(idParamSchema, 'params'),
  validate(updateWorkLocationSchema),
  asyncHandler(updateWorkLocation)
);

router.post(
  '/:id/rotate-qr',
  requireRole(Role.SUPER_ADMIN, Role.HR_ADMIN),
  validate(idParamSchema, 'params'),
  asyncHandler(rotateQrSecret)
);

export default router;
