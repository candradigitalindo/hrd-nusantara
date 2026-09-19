// src/routes/documentRoutes.ts
import express from 'express';
import { Role } from '@prisma/client';
import {
  uploadDocument,
  listDocuments,
  downloadDocument,
  updateDocument,
  deleteDocument,
  listExpiringDocuments,
} from '../controllers/documentController';
import { authenticateToken, requireRole, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import {
  uploadDocumentSchema,
  updateDocumentSchema,
  listDocumentQuerySchema,
  expiringDocumentQuerySchema,
} from '../schemas/documentSchema';

const router = express.Router();
const HR = [Role.SUPER_ADMIN, Role.HR_ADMIN] as const;

router.use(authenticateToken);

// Unggah, ubah, hapus: hanya HR. Kalau karyawan bisa mengunggah kontraknya
// sendiri, ia bisa mengunggah kontrak yang isinya ia karang.
router.post('/employees/:id/documents', requireRole(...HR), validate(idParamSchema, 'params'), validate(uploadDocumentSchema), asyncHandler(uploadDocument));

// Lihat dan unduh: HR semua, karyawan miliknya sendiri. Disaring di controller.
router.get('/employees/:id/documents', validate(idParamSchema, 'params'), validate(listDocumentQuerySchema, 'query'), asyncHandler(listDocuments));
router.get('/documents/:id/download', validate(idParamSchema, 'params'), asyncHandler(downloadDocument));

// Pelacakan masa berlaku, sebelum /documents/:id supaya "expiring" tidak
// tertangkap sebagai id.
router.get('/documents/expiring', requireRole(...HR), validate(expiringDocumentQuerySchema, 'query'), asyncHandler(listExpiringDocuments));

router.patch('/documents/:id', requireRole(...HR), validate(idParamSchema, 'params'), validate(updateDocumentSchema), asyncHandler(updateDocument));
router.delete('/documents/:id', requireRole(...HR), validate(idParamSchema, 'params'), asyncHandler(deleteDocument));

export default router;
