// src/routes/attendanceRoutes.ts
import express from 'express';
import {
  checkIn,
  checkOut,
  getAllAttendance,
  getMyAttendance,
  getAttendanceById,
  decideOvertime,
  getAttendanceReport,
} from '../controllers/attendanceController';
import { authenticateToken, requirePermission, asyncHandler } from '../middleware/auth';
import { idempotensi } from '../middleware/idempotensi';
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
router.post('/check-in', requirePermission('presensi.lihat'), idempotensi, validate(checkInSchema), asyncHandler(checkIn));
router.post('/check-out', requirePermission('presensi.lihat'), idempotensi, validate(checkOutSchema), asyncHandler(checkOut));

// Rute literal didaftarkan sebelum '/:id'.
router.get('/me', requirePermission('presensi.lihat'), validate(listAttendanceQuerySchema, 'query'), asyncHandler(getMyAttendance));

router.get(
  '/reports/summary',
  requirePermission('presensi_tim.lihat'),
  validate(attendanceReportQuerySchema, 'query'),
  asyncHandler(getAttendanceReport)
);

router.get(
  '/',
  requirePermission('presensi_tim.lihat'),
  validate(listAttendanceQuerySchema, 'query'),
  asyncHandler(getAllAttendance)
);

// Tanpa requireRole: karyawan boleh membuka presensinya sendiri,
// pembatasannya di controller.
router.get('/:id', requirePermission('presensi.lihat', 'presensi_tim.lihat'), validate(idParamSchema, 'params'), asyncHandler(getAttendanceById));

router.patch(
  '/:id/overtime',
  requirePermission('lembur.ubah'),
  validate(idParamSchema, 'params'),
  validate(overtimeDecisionSchema),
  asyncHandler(decideOvertime)
);

export default router;
