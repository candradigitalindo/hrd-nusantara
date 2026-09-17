// src/routes/leaveRoutes.ts
import express from 'express';
import { Role } from '@prisma/client';
import {
  createLeave,
  decideLeave,
  cancelLeave,
  getAllLeaves,
  getMyLeaves,
  getLeaveById,
  getLeaveCalendar,
  upsertLeaveBalance,
  getMyLeaveBalances,
  getEmployeeLeaveBalances,
} from '../controllers/leaveController';
import {
  createLeaveType,
  getAllLeaveTypes,
  updateLeaveType,
  deactivateLeaveType,
} from '../controllers/leaveTypeController';
import {
  createHoliday,
  bulkCreateHolidays,
  getAllHolidays,
  deleteHoliday,
} from '../controllers/holidayController';
import {
  createWorkPattern,
  getAllWorkPatterns,
  updateWorkPattern,
  assignEmployeeWorkPattern,
  assignDepartmentWorkPattern,
  getMyWorkPattern,
} from '../controllers/workPatternController';
import { authenticateToken, requireRole, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import {
  createLeaveSchema,
  decideLeaveSchema,
  cancelLeaveSchema,
  listLeaveQuerySchema,
  leaveCalendarQuerySchema,
  createLeaveTypeSchema,
  updateLeaveTypeSchema,
  listLeaveTypeQuerySchema,
  createHolidaySchema,
  bulkCreateHolidaySchema,
  listHolidayQuerySchema,
  upsertLeaveBalanceSchema,
  listLeaveBalanceQuerySchema,
  createWorkPatternSchema,
  updateWorkPatternSchema,
  listWorkPatternQuerySchema,
  assignWorkPatternSchema,
} from '../schemas/leaveSchema';

const router = express.Router();

router.use(authenticateToken);

const HR = [Role.SUPER_ADMIN, Role.HR_ADMIN] as const;
const HR_DAN_MANAJER = [Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER] as const;

// --- Jenis cuti ---
// Semua karyawan boleh membaca daftarnya; dibutuhkan untuk mengisi form.
router.get('/leave-types', validate(listLeaveTypeQuerySchema, 'query'), asyncHandler(getAllLeaveTypes));
router.post('/leave-types', requireRole(...HR), validate(createLeaveTypeSchema), asyncHandler(createLeaveType));
router.put(
  '/leave-types/:id',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  validate(updateLeaveTypeSchema),
  asyncHandler(updateLeaveType)
);
router.delete(
  '/leave-types/:id',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  asyncHandler(deactivateLeaveType)
);

// --- Pola hari kerja ---
// Kantor memakai hari tetap; outlet dan hotel mengikuti roster.
router.get('/work-patterns/me', asyncHandler(getMyWorkPattern));
router.get('/work-patterns', validate(listWorkPatternQuerySchema, 'query'), asyncHandler(getAllWorkPatterns));
router.post('/work-patterns', requireRole(...HR), validate(createWorkPatternSchema), asyncHandler(createWorkPattern));
router.put(
  '/work-patterns/:id',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  validate(updateWorkPatternSchema),
  asyncHandler(updateWorkPattern)
);
router.patch(
  '/employees/:id/work-pattern',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  validate(assignWorkPatternSchema),
  asyncHandler(assignEmployeeWorkPattern)
);
router.patch(
  '/departments/:id/work-pattern',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  validate(assignWorkPatternSchema),
  asyncHandler(assignDepartmentWorkPattern)
);

// --- Hari libur ---
router.get('/holidays', validate(listHolidayQuerySchema, 'query'), asyncHandler(getAllHolidays));
router.post('/holidays', requireRole(...HR), validate(createHolidaySchema), asyncHandler(createHoliday));
router.post('/holidays/bulk', requireRole(...HR), validate(bulkCreateHolidaySchema), asyncHandler(bulkCreateHolidays));
router.delete(
  '/holidays/:id',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  asyncHandler(deleteHoliday)
);

// --- Saldo cuti ---
router.get('/leave-balances/me', validate(listLeaveBalanceQuerySchema, 'query'), asyncHandler(getMyLeaveBalances));
router.post('/leave-balances', requireRole(...HR), validate(upsertLeaveBalanceSchema), asyncHandler(upsertLeaveBalance));
router.get(
  '/employees/:id/leave-balances',
  requireRole(...HR_DAN_MANAJER),
  validate(idParamSchema, 'params'),
  validate(listLeaveBalanceQuerySchema, 'query'),
  asyncHandler(getEmployeeLeaveBalances)
);

// --- Pengajuan cuti ---
// Rute literal didaftarkan sebelum '/:id'.
router.get('/leaves/me', validate(listLeaveQuerySchema, 'query'), asyncHandler(getMyLeaves));
router.get(
  '/leaves/calendar',
  requireRole(...HR_DAN_MANAJER),
  validate(leaveCalendarQuerySchema, 'query'),
  asyncHandler(getLeaveCalendar)
);
router.get(
  '/leaves',
  requireRole(...HR_DAN_MANAJER),
  validate(listLeaveQuerySchema, 'query'),
  asyncHandler(getAllLeaves)
);

// Pengajuan selalu untuk diri sendiri: identitas diambil dari token, tidak
// dari body, supaya tidak ada yang bisa mengajukan cuti atas nama orang lain.
router.post('/leaves', validate(createLeaveSchema), asyncHandler(createLeave));

router.get('/leaves/:id', validate(idParamSchema, 'params'), asyncHandler(getLeaveById));

router.patch(
  '/leaves/:id/decision',
  requireRole(...HR_DAN_MANAJER),
  validate(idParamSchema, 'params'),
  validate(decideLeaveSchema),
  asyncHandler(decideLeave)
);

// Tanpa requireRole: karyawan boleh membatalkan pengajuannya sendiri.
router.patch(
  '/leaves/:id/cancel',
  validate(idParamSchema, 'params'),
  validate(cancelLeaveSchema),
  asyncHandler(cancelLeave)
);

export default router;
