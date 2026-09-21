// src/routes/psychometricRoutes.ts
import express from 'express';
import { createTestResult, listTestResults, updateTestResult } from '../controllers/psychometricController';
import { authenticateToken, requirePermission, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import { createTestResultSchema, updateTestResultSchema, listTestResultQuerySchema } from '../schemas/psychometricSchema';

const router = express.Router();


router.use(authenticateToken);

// requireRole dipasang PER RUTE, bukan router.use(): router ini di-mount di
// /api, dan middleware tingkat router berjalan untuk semua permintaan /api/*
// yang lewat — router.use(requirePermission('rekrutmen.kelola')) di sini membuat setiap router
// yang di-mount sesudahnya menolak karyawan biasa dengan 403.
//
// Hasil psikotes adalah data pribadi kandidat: hanya HR, sejalan dengan
// endpoint kandidat lainnya di recruitmentRoutes.
router.post('/candidates/:id/psychometric-tests', requirePermission('rekrutmen.kelola'), validate(idParamSchema, 'params'), validate(createTestResultSchema), asyncHandler(createTestResult));
router.get('/psychometric-tests', requirePermission('rekrutmen.kelola'), validate(listTestResultQuerySchema, 'query'), asyncHandler(listTestResults));
router.patch('/psychometric-tests/:id', requirePermission('rekrutmen.kelola'), validate(idParamSchema, 'params'), validate(updateTestResultSchema), asyncHandler(updateTestResult));

export default router;
