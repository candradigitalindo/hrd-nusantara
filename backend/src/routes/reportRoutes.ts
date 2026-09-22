// src/routes/reportRoutes.ts
import express from 'express';
import {
  getDashboard,
  getTurnoverAnalysis,
  getCostAnalysis,
  getProductivityReport,
  getRawData,
} from '../controllers/reportController';
import { authenticateToken, requirePermission, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { periodQuerySchema, rawDataQuerySchema } from '../schemas/reportSchema';

const router = express.Router();

router.use(authenticateToken);

// Laporan menyeluruh hanya untuk HR: isinya menggabungkan gaji, presensi,
// dan alasan berhenti seluruh karyawan.

// Dasbor terbuka untuk manajer, tapi controller membatasinya ke departemennya.
router.get(
  '/reports/dashboard',
  requirePermission('laporan.lihat'),
  validate(periodQuerySchema, 'query'),
  asyncHandler(getDashboard)
);
router.get(
  '/reports/turnover',
  requirePermission('laporan_hr.lihat'),
  validate(periodQuerySchema, 'query'),
  asyncHandler(getTurnoverAnalysis)
);
router.get(
  '/reports/costs',
  requirePermission('laporan_hr.lihat'),
  validate(periodQuerySchema, 'query'),
  asyncHandler(getCostAnalysis)
);

// Produktivitas terbuka juga untuk manajer: ini alat kerja operasional mereka.
router.get(
  '/reports/productivity',
  requirePermission('laporan.lihat'),
  validate(periodQuerySchema, 'query'),
  asyncHandler(getProductivityReport)
);

router.get(
  '/reports/raw-data',
  requirePermission('laporan_hr.lihat'),
  validate(rawDataQuerySchema, 'query'),
  asyncHandler(getRawData)
);

export default router;
