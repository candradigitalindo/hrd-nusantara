// src/routes/documentRoutes.ts
import express from 'express';
import {
  uploadDocument,
  listDocuments,
  downloadDocument,
  updateDocument,
  deleteDocument,
  listExpiringDocuments,
} from '../controllers/documentController';
import { authenticateToken, requirePermission, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import {
  uploadDocumentSchema,
  updateDocumentSchema,
  listDocumentQuerySchema,
  expiringDocumentQuerySchema,
} from '../schemas/documentSchema';
import { lihatAtauKelola } from '../utils/permissions';

const router = express.Router();

router.use(authenticateToken);

// Unggah, ubah, hapus: hanya HR. Kalau karyawan bisa mengunggah kontraknya
// sendiri, ia bisa mengunggah kontrak yang isinya ia karang.
router.post('/employees/:id/documents', requirePermission('dokumen.buat'), validate(idParamSchema, 'params'), validate(uploadDocumentSchema), asyncHandler(uploadDocument));

// Lihat dan unduh: HR semua, karyawan miliknya sendiri. Disaring di controller.
router.get('/employees/:id/documents', validate(idParamSchema, 'params'), validate(listDocumentQuerySchema, 'query'), asyncHandler(listDocuments));
router.get('/documents/:id/download', validate(idParamSchema, 'params'), asyncHandler(downloadDocument));

// Pelacakan masa berlaku, sebelum /documents/:id supaya "expiring" tidak
// tertangkap sebagai id.
router.get('/documents/expiring', requirePermission(...lihatAtauKelola('dokumen')), validate(expiringDocumentQuerySchema, 'query'), asyncHandler(listExpiringDocuments));

router.patch('/documents/:id', requirePermission('dokumen.ubah'), validate(idParamSchema, 'params'), validate(updateDocumentSchema), asyncHandler(updateDocument));
router.delete('/documents/:id', requirePermission('dokumen.hapus'), validate(idParamSchema, 'params'), asyncHandler(deleteDocument));

export default router;
