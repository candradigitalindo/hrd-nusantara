// src/routes/leaveRoutes.ts
import express from 'express';
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
  listLeaveBalances,
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
import { authenticateToken, requirePermission, asyncHandler } from '../middleware/auth';
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
  listAllLeaveBalanceQuerySchema,
  createWorkPatternSchema,
  updateWorkPatternSchema,
  listWorkPatternQuerySchema,
  assignWorkPatternSchema,
} from '../schemas/leaveSchema';
import { lihatAtauKelola } from '../utils/permissions';

const router = express.Router();

router.use(authenticateToken);


// --- Jenis cuti ---
// Semua karyawan boleh membaca daftarnya; dibutuhkan untuk mengisi form.
router.get('/leave-types', validate(listLeaveTypeQuerySchema, 'query'), asyncHandler(getAllLeaveTypes));
router.post('/leave-types', requirePermission('pengaturan_cuti.buat'), validate(createLeaveTypeSchema), asyncHandler(createLeaveType));
router.put(
  '/leave-types/:id',
  requirePermission('pengaturan_cuti.ubah'),
  validate(idParamSchema, 'params'),
  validate(updateLeaveTypeSchema),
  asyncHandler(updateLeaveType)
);
router.delete(
  '/leave-types/:id',
  requirePermission('pengaturan_cuti.hapus'),
  validate(idParamSchema, 'params'),
  asyncHandler(deactivateLeaveType)
);

// --- Pola hari kerja ---
// Kantor memakai hari tetap; outlet dan hotel mengikuti roster.
router.get('/work-patterns/me', asyncHandler(getMyWorkPattern));
router.get('/work-patterns', validate(listWorkPatternQuerySchema, 'query'), asyncHandler(getAllWorkPatterns));
router.post('/work-patterns', requirePermission('pengaturan_cuti.buat'), validate(createWorkPatternSchema), asyncHandler(createWorkPattern));
router.put(
  '/work-patterns/:id',
  requirePermission('pengaturan_cuti.ubah'),
  validate(idParamSchema, 'params'),
  validate(updateWorkPatternSchema),
  asyncHandler(updateWorkPattern)
);
router.patch(
  '/employees/:id/work-pattern',
  requirePermission('pengaturan_cuti.ubah'),
  validate(idParamSchema, 'params'),
  validate(assignWorkPatternSchema),
  asyncHandler(assignEmployeeWorkPattern)
);
router.patch(
  '/departments/:id/work-pattern',
  requirePermission('pengaturan_cuti.ubah'),
  validate(idParamSchema, 'params'),
  validate(assignWorkPatternSchema),
  asyncHandler(assignDepartmentWorkPattern)
);

// --- Hari libur ---
router.get('/holidays', validate(listHolidayQuerySchema, 'query'), asyncHandler(getAllHolidays));
router.post('/holidays', requirePermission('pengaturan_cuti.buat'), validate(createHolidaySchema), asyncHandler(createHoliday));
router.post('/holidays/bulk', requirePermission('pengaturan_cuti.buat'), validate(bulkCreateHolidaySchema), asyncHandler(bulkCreateHolidays));
router.delete(
  '/holidays/:id',
  requirePermission('pengaturan_cuti.hapus'),
  validate(idParamSchema, 'params'),
  asyncHandler(deleteHoliday)
);

// --- Saldo cuti ---
router.get('/leave-balances', requirePermission(...lihatAtauKelola('pengaturan_cuti')), validate(listAllLeaveBalanceQuerySchema, 'query'), asyncHandler(listLeaveBalances));
router.get('/leave-balances/me', requirePermission('cuti.lihat'), validate(listLeaveBalanceQuerySchema, 'query'), asyncHandler(getMyLeaveBalances));
router.post('/leave-balances', requirePermission('pengaturan_cuti.buat', 'pengaturan_cuti.ubah'), validate(upsertLeaveBalanceSchema), asyncHandler(upsertLeaveBalance));
router.get(
  '/employees/:id/leave-balances',
  requirePermission('cuti_tim.lihat', 'cuti_tim.ubah', ...lihatAtauKelola('pengaturan_cuti')),
  validate(idParamSchema, 'params'),
  validate(listLeaveBalanceQuerySchema, 'query'),
  asyncHandler(getEmployeeLeaveBalances)
);

// --- Pengajuan cuti ---
// Rute literal didaftarkan sebelum '/:id'.
router.get('/leaves/me', requirePermission('cuti.lihat'), validate(listLeaveQuerySchema, 'query'), asyncHandler(getMyLeaves));
router.get(
  '/leaves/calendar',
  requirePermission('cuti_tim.lihat', 'cuti_tim.ubah'),
  validate(leaveCalendarQuerySchema, 'query'),
  asyncHandler(getLeaveCalendar)
);
router.get(
  '/leaves',
  requirePermission('cuti_tim.lihat', 'cuti_tim.ubah'),
  validate(listLeaveQuerySchema, 'query'),
  asyncHandler(getAllLeaves)
);

// Pengajuan selalu untuk diri sendiri: identitas diambil dari token, tidak
// dari body, supaya tidak ada yang bisa mengajukan cuti atas nama orang lain.
router.post('/leaves', requirePermission('cuti.lihat'), validate(createLeaveSchema), asyncHandler(createLeave));

router.get('/leaves/:id', requirePermission('cuti.lihat', 'cuti_tim.lihat', 'cuti_tim.ubah'), validate(idParamSchema, 'params'), asyncHandler(getLeaveById));

router.patch(
  '/leaves/:id/decision',
  requirePermission('cuti_tim.ubah'),
  validate(idParamSchema, 'params'),
  validate(decideLeaveSchema),
  asyncHandler(decideLeave)
);

// Tanpa requireRole: karyawan boleh membatalkan pengajuannya sendiri.
router.patch(
  '/leaves/:id/cancel',
  requirePermission('cuti.lihat'),
  validate(idParamSchema, 'params'),
  validate(cancelLeaveSchema),
  asyncHandler(cancelLeave)
);

export default router;
