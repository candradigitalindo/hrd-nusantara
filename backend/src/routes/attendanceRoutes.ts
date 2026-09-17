// src/routes/attendanceRoutes.ts
import express from 'express';
import { Role } from '@prisma/client';
import {
  checkIn,
  checkOut,
  getAllAttendance,
  getMyAttendance,
  getAttendanceById,
  decideOvertime,
  getAttendanceReport,
} from '../controllers/attendanceController';
import { authenticateToken, requireRole, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import {
  checkInSchema,
  checkOutSchema,
  overtimeDecisionSchema,
  listAttendanceQuerySchema,
  attendanceReportQuerySchema,
} from '../schemas/attendanceSchema';

const router = express.Router();

router.use(authenticateToken);

// Presensi selalu untuk diri sendiri — identitas diambil dari token,
// bukan dari body, supaya tidak ada yang bisa mengabsenkan orang lain.
router.post('/check-in', validate(checkInSchema), asyncHandler(checkIn));
router.post('/check-out', validate(checkOutSchema), asyncHandler(checkOut));

// Rute literal didaftarkan sebelum '/:id'.
router.get('/me', validate(listAttendanceQuerySchema, 'query'), asyncHandler(getMyAttendance));

router.get(
  '/reports/summary',
  requireRole(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER),
  validate(attendanceReportQuerySchema, 'query'),
  asyncHandler(getAttendanceReport)
);

router.get(
  '/',
  requireRole(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER),
  validate(listAttendanceQuerySchema, 'query'),
  asyncHandler(getAllAttendance)
);

// Tanpa requireRole: karyawan boleh membuka presensinya sendiri,
// pembatasannya di controller.
router.get('/:id', validate(idParamSchema, 'params'), asyncHandler(getAttendanceById));

router.patch(
  '/:id/overtime',
  requireRole(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER),
  validate(idParamSchema, 'params'),
  validate(overtimeDecisionSchema),
  asyncHandler(decideOvertime)
);

export default router;
