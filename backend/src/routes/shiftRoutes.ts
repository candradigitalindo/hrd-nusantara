// src/routes/shiftRoutes.ts
import express from 'express';
import { Role } from '@prisma/client';
import {
  createShift,
  bulkCreateShifts,
  getAllShifts,
  getMyShifts,
  updateShift,
  cancelShift,
} from '../controllers/shiftController';
import { authenticateToken, requireRole, asyncHandler } from '../middleware/auth';
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
  requireRole(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER),
  validate(listShiftQuerySchema, 'query'),
  asyncHandler(getAllShifts)
);

router.post(
  '/',
  requireRole(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER),
  validate(createShiftSchema),
  asyncHandler(createShift)
);

router.post(
  '/bulk',
  requireRole(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER),
  validate(bulkCreateShiftSchema),
  asyncHandler(bulkCreateShifts)
);

router.put(
  '/:id',
  requireRole(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER),
  validate(idParamSchema, 'params'),
  validate(updateShiftSchema),
  asyncHandler(updateShift)
);

router.delete(
  '/:id',
  requireRole(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER),
  validate(idParamSchema, 'params'),
  asyncHandler(cancelShift)
);

export default router;
