// src/routes/employeeRoutes.ts
import express from 'express';
import { Role } from '@prisma/client';
import {
  getAllEmployees,
  getDirectory,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  deactivateEmployee,
} from '../controllers/employeeController';
import { authenticateToken, requireRole, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  listEmployeeQuerySchema,
  employeeIdParamSchema,
  deactivateEmployeeSchema,
  directoryQuerySchema,
} from '../schemas/employeeSchema';

const router = express.Router();

// Semua endpoint di bawah ini butuh token yang sah.
router.use(authenticateToken);

router.get(
  '/',
  requireRole(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER),
  validate(listEmployeeQuerySchema, 'query'),
  asyncHandler(getAllEmployees)
);

// Direktori ringkas untuk semua peran — harus di atas '/:id' agar tidak
// tertangkap sebagai ID karyawan bernama "directory".
router.get('/directory', validate(directoryQuerySchema, 'query'), asyncHandler(getDirectory));

// Tanpa requireRole: karyawan biasa boleh membuka datanya sendiri.
// Pembatasan siapa boleh melihat siapa dikerjakan di dalam controller.
router.get('/:id', validate(employeeIdParamSchema, 'params'), asyncHandler(getEmployeeById));

router.post(
  '/',
  requireRole(Role.SUPER_ADMIN, Role.HR_ADMIN),
  validate(createEmployeeSchema),
  asyncHandler(createEmployee)
);

router.put(
  '/:id',
  requireRole(Role.SUPER_ADMIN, Role.HR_ADMIN),
  validate(employeeIdParamSchema, 'params'),
  validate(updateEmployeeSchema),
  asyncHandler(updateEmployee)
);

// Bukan DELETE: data kepegawaian diarsipkan, bukan dihapus.
router.patch(
  '/:id/deactivate',
  requireRole(Role.SUPER_ADMIN, Role.HR_ADMIN),
  validate(employeeIdParamSchema, 'params'),
  validate(deactivateEmployeeSchema),
  asyncHandler(deactivateEmployee)
);

export default router;
