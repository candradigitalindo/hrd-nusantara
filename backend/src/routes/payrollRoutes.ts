// src/routes/payrollRoutes.ts
import express from 'express';
import {
  createSalaryComponent,
  getAllSalaryComponents,
  updateSalaryComponent,
  setEmployeeSalary,
  getEmployeeSalaryHistory,
  assignEmployeeComponent,
  removeEmployeeComponent,
  createPayrollRun,
  calculatePayrollRun,
  decidePayrollRun,
  getAllPayrollRuns,
  getAllPayrolls,
  getMyPayrolls,
  getPayrollById,
  previewPayroll,
} from '../controllers/payrollController';
import { authenticateToken, requirePermission, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import {
  createSalaryComponentSchema,
  updateSalaryComponentSchema,
  listSalaryComponentQuerySchema,
  setEmployeeSalarySchema,
  assignComponentSchema,
  createPayrollRunSchema,
  calculatePayrollRunSchema,
  decidePayrollRunSchema,
  listPayrollRunQuerySchema,
  listPayrollQuerySchema,
} from '../schemas/payrollSchema';
import { lihatAtauKelola } from '../utils/permissions';

const router = express.Router();

router.use(authenticateToken);

// Seluruh modul penggajian hanya untuk HR. Manajer sengaja tidak diberi akses:
// gaji anggota tim bukan bagian dari kewenangan operasional mereka.

// --- Komponen gaji ---
router.get(
  '/salary-components',
  requirePermission(...lihatAtauKelola('payroll')),
  validate(listSalaryComponentQuerySchema, 'query'),
  asyncHandler(getAllSalaryComponents)
);
router.post(
  '/salary-components',
  requirePermission('payroll.buat'),
  validate(createSalaryComponentSchema),
  asyncHandler(createSalaryComponent)
);
router.put(
  '/salary-components/:id',
  requirePermission('payroll.ubah'),
  validate(idParamSchema, 'params'),
  validate(updateSalaryComponentSchema),
  asyncHandler(updateSalaryComponent)
);

// --- Struktur gaji karyawan ---
// Tanpa requireRole: karyawan boleh melihat riwayat gajinya sendiri,
// pembatasannya di controller.
router.get(
  '/employees/:id/salary',
  requirePermission('gaji.lihat', ...lihatAtauKelola('payroll')),
  validate(idParamSchema, 'params'),
  asyncHandler(getEmployeeSalaryHistory)
);
router.post(
  '/employees/:id/salary',
  requirePermission('payroll.buat'),
  validate(idParamSchema, 'params'),
  validate(setEmployeeSalarySchema),
  asyncHandler(setEmployeeSalary)
);
router.post(
  '/employees/:id/salary-components',
  requirePermission('payroll.buat'),
  validate(idParamSchema, 'params'),
  validate(assignComponentSchema),
  asyncHandler(assignEmployeeComponent)
);
router.delete(
  '/employee-salary-components/:id',
  requirePermission('payroll.hapus'),
  validate(idParamSchema, 'params'),
  asyncHandler(removeEmployeeComponent)
);

// --- Batch penggajian ---
router.get(
  '/payroll-runs',
  requirePermission(...lihatAtauKelola('payroll')),
  validate(listPayrollRunQuerySchema, 'query'),
  asyncHandler(getAllPayrollRuns)
);
router.post(
  '/payroll-runs',
  requirePermission('payroll.buat'),
  validate(createPayrollRunSchema),
  asyncHandler(createPayrollRun)
);
router.post(
  '/payroll-runs/:id/calculate',
  requirePermission('payroll.ubah'),
  validate(idParamSchema, 'params'),
  validate(calculatePayrollRunSchema),
  asyncHandler(calculatePayrollRun)
);
router.patch(
  '/payroll-runs/:id/decision',
  requirePermission('payroll.ubah'),
  validate(idParamSchema, 'params'),
  validate(decidePayrollRunSchema),
  asyncHandler(decidePayrollRun)
);
router.get(
  '/payroll-runs/:id/preview/:employeeId',
  requirePermission(...lihatAtauKelola('payroll')),
  asyncHandler(previewPayroll)
);

// --- Slip gaji ---
// Didaftarkan sebelum '/:id' supaya "me" tidak tertangkap sebagai ULID.
router.get('/payrolls/me', requirePermission('gaji.lihat'), validate(listPayrollQuerySchema, 'query'), asyncHandler(getMyPayrolls));
router.get(
  '/payrolls',
  requirePermission(...lihatAtauKelola('payroll')),
  validate(listPayrollQuerySchema, 'query'),
  asyncHandler(getAllPayrolls)
);
router.get('/payrolls/:id', requirePermission('gaji.lihat', ...lihatAtauKelola('payroll')), validate(idParamSchema, 'params'), asyncHandler(getPayrollById));

export default router;
