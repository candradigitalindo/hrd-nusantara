// src/routes/shiftRoutes.ts
import express from 'express';
import {
  createShift,
  bulkCreateShifts,
  getAllShifts,
  getMyShifts,
  updateShift,
  cancelShift,
} from '../controllers/shiftController';
import { authenticateToken, requirePermission, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import {
  createShiftSchema,
  bulkCreateShiftSchema,
  updateShiftSchema,
  listShiftQuerySchema,
} from '../schemas/shiftSchema';
import { lihatAtauKelola } from '../utils/permissions';

const router = express.Router();

router.use(authenticateToken);

// Didaftarkan sebelum '/:id' supaya "me" tidak tertangkap sebagai ULID.
router.get('/me', requirePermission('presensi.lihat'), validate(listShiftQuerySchema, 'query'), asyncHandler(getMyShifts));

router.get(
  '/',
  requirePermission(...lihatAtauKelola('shift')),
  validate(listShiftQuerySchema, 'query'),
  asyncHandler(getAllShifts)
);

router.post(
  '/',
  requirePermission('shift.buat'),
  validate(createShiftSchema),
  asyncHandler(createShift)
);

router.post(
  '/bulk',
  requirePermission('shift.buat'),
  validate(bulkCreateShiftSchema),
  asyncHandler(bulkCreateShifts)
);

router.put(
  '/:id',
  requirePermission('shift.ubah'),
  validate(idParamSchema, 'params'),
  validate(updateShiftSchema),
  asyncHandler(updateShift)
);

router.delete(
  '/:id',
  requirePermission('shift.hapus'),
  validate(idParamSchema, 'params'),
  asyncHandler(cancelShift)
);

export default router;
