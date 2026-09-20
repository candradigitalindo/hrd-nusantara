// src/routes/reportRoutes.ts
import express from 'express';
import { Role } from '@prisma/client';
import {
  getDashboard,
  getTurnoverAnalysis,
  getCostAnalysis,
  getProductivityReport,
  getRawData,
} from '../controllers/reportController';
import { authenticateToken, requireRole, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { periodQuerySchema, rawDataQuerySchema } from '../schemas/reportSchema';

const router = express.Router();

router.use(authenticateToken);

// Laporan menyeluruh hanya untuk HR: isinya menggabungkan gaji, presensi,
// dan alasan berhenti seluruh karyawan.
const HR = [Role.SUPER_ADMIN, Role.HR_ADMIN] as const;

// Dasbor terbuka untuk manajer, tapi controller membatasinya ke departemennya.
router.get(
  '/reports/dashboard',
  requireRole(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER),
  validate(periodQuerySchema, 'query'),
  asyncHandler(getDashboard)
);
router.get(
  '/reports/turnover',
  requireRole(...HR),
  validate(periodQuerySchema, 'query'),
  asyncHandler(getTurnoverAnalysis)
);
router.get(
  '/reports/costs',
  requireRole(...HR),
  validate(periodQuerySchema, 'query'),
  asyncHandler(getCostAnalysis)
);

// Produktivitas terbuka juga untuk manajer: ini alat kerja operasional mereka.
router.get(
  '/reports/productivity',
  requireRole(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER),
  validate(periodQuerySchema, 'query'),
  asyncHandler(getProductivityReport)
);

router.get(
  '/reports/raw-data',
  requireRole(...HR),
  validate(rawDataQuerySchema, 'query'),
  asyncHandler(getRawData)
);

export default router;
