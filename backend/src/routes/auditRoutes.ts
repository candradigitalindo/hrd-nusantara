// src/routes/auditRoutes.ts
import express from 'express';
import { getAuditLogs } from '../controllers/auditController';
import { authenticateToken, requirePermission, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { listAuditQuerySchema } from '../schemas/auditSchema';

const router = express.Router();

router.use(authenticateToken);

// Hanya SUPER_ADMIN. Jejak audit memperlihatkan perbuatan semua orang,
// termasuk HR — kalau HR bisa membacanya sendiri, pengawasan atas HR hilang.
// Tidak ada rute tulis atau hapus di sini, dan itu disengaja.
router.get(
  '/audit-logs',
  requirePermission('audit.lihat'),
  validate(listAuditQuerySchema, 'query'),
  asyncHandler(getAuditLogs)
);

export default router;
