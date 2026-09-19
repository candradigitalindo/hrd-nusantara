// src/routes/organizationRoutes.ts
import express from 'express';
import { Role } from '@prisma/client';
import {
  createDepartment,
  getAllDepartments,
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
  createPosition,
  getAllPositions,
  updatePosition,
  deletePosition,
} from '../controllers/organizationController';
import { authenticateToken, requireRole, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import {
  createDepartmentSchema,
  updateDepartmentSchema,
  listDepartmentQuerySchema,
  createPositionSchema,
  updatePositionSchema,
  listPositionQuerySchema,
} from '../schemas/organizationSchema';

const router = express.Router();
const HR = [Role.SUPER_ADMIN, Role.HR_ADMIN] as const;

router.use(authenticateToken);

// Daftar boleh dibaca semua karyawan: dibutuhkan untuk mengisi pilihan di
// formulir, dan nama departemen bukan rahasia.
router.get('/departments', validate(listDepartmentQuerySchema, 'query'), asyncHandler(getAllDepartments));
router.get('/departments/:id', validate(idParamSchema, 'params'), asyncHandler(getDepartmentById));
router.post('/departments', requireRole(...HR), validate(createDepartmentSchema), asyncHandler(createDepartment));
router.put('/departments/:id', requireRole(...HR), validate(idParamSchema, 'params'), validate(updateDepartmentSchema), asyncHandler(updateDepartment));
router.delete('/departments/:id', requireRole(...HR), validate(idParamSchema, 'params'), asyncHandler(deleteDepartment));

router.get('/positions', validate(listPositionQuerySchema, 'query'), asyncHandler(getAllPositions));
router.post('/positions', requireRole(...HR), validate(createPositionSchema), asyncHandler(createPosition));
router.put('/positions/:id', requireRole(...HR), validate(idParamSchema, 'params'), validate(updatePositionSchema), asyncHandler(updatePosition));
router.delete('/positions/:id', requireRole(...HR), validate(idParamSchema, 'params'), asyncHandler(deletePosition));

export default router;
