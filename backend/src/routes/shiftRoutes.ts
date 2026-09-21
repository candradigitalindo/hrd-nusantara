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

const router = express.Router();

router.use(authenticateToken);

// Didaftarkan sebelum '/:id' supaya "me" tidak tertangkap sebagai ULID.
router.get('/me', validate(listShiftQuerySchema, 'query'), asyncHandler(getMyShifts));

router.get(
  '/',
  requirePermission('shift.kelola'),
  validate(listShiftQuerySchema, 'query'),
  asyncHandler(getAllShifts)
);

router.post(
  '/',
  requirePermission('shift.kelola'),
  validate(createShiftSchema),
  asyncHandler(createShift)
);

router.post(
  '/bulk',
  requirePermission('shift.kelola'),
  validate(bulkCreateShiftSchema),
  asyncHandler(bulkCreateShifts)
);

router.put(
  '/:id',
  requirePermission('shift.kelola'),
  validate(idParamSchema, 'params'),
  validate(updateShiftSchema),
  asyncHandler(updateShift)
);

router.delete(
  '/:id',
  requirePermission('shift.kelola'),
  validate(idParamSchema, 'params'),
  asyncHandler(cancelShift)
);

export default router;
