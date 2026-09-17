// src/routes/auditRoutes.ts
import express from 'express';
import { Role } from '@prisma/client';
import { getAuditLogs } from '../controllers/auditController';
import { authenticateToken, requireRole, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { listAuditQuerySchema } from '../schemas/auditSchema';

const router = express.Router();

router.use(authenticateToken);

// Hanya SUPER_ADMIN. Jejak audit memperlihatkan perbuatan semua orang,
// termasuk HR — kalau HR bisa membacanya sendiri, pengawasan atas HR hilang.
// Tidak ada rute tulis atau hapus di sini, dan itu disengaja.
router.get(
  '/audit-logs',
  requireRole(Role.SUPER_ADMIN),
  validate(listAuditQuerySchema, 'query'),
  asyncHandler(getAuditLogs)
);

export default router;
