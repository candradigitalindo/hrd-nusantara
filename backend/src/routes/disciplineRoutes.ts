// src/routes/disciplineRoutes.ts
import express from 'express';
import {
  createComplaint,
  createDisciplinaryAction,
  listCases,
  getCase,
  updateCaseStatus,
} from '../controllers/disciplineController';
import { authenticateToken, requirePermission, asyncHandler } from '../middleware/auth';
import { idempotensi } from '../middleware/idempotensi';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import {
  createComplaintSchema,
  createDisciplinarySchema,
  updateCaseStatusSchema,
  listCaseQuerySchema,
} from '../schemas/disciplineSchema';
import { kelola } from '../utils/permissions';

const router = express.Router();

router.use(authenticateToken);

// Keluhan boleh diajukan siapa pun — itulah gunanya.
router.post('/complaints', requirePermission('kasus.lihat', ...kelola('kasus')), idempotensi, validate(createComplaintSchema), asyncHandler(createComplaint));

// Tindakan disiplin: HR dan manajer. Batas departemen manajer di controller.
router.post('/disciplinary-actions', requirePermission('kasus.buat'), validate(createDisciplinarySchema), asyncHandler(createDisciplinaryAction));

// Daftar dan detail: semua peran, disaring ketat di controller (lihat
// lingkupLihat). Yang tidak berhak mendapat 404, bukan 403.
router.get('/cases', requirePermission('kasus.lihat', ...kelola('kasus')), validate(listCaseQuerySchema, 'query'), asyncHandler(listCases));
router.get('/cases/:id', requirePermission('kasus.lihat', ...kelola('kasus')), validate(idParamSchema, 'params'), asyncHandler(getCase));

router.patch('/cases/:id/status', requirePermission('kasus.ubah'), validate(idParamSchema, 'params'), validate(updateCaseStatusSchema), asyncHandler(updateCaseStatus));

export default router;
