// src/routes/trainingRoutes.ts
import express from 'express';
import { Role } from '@prisma/client';
import {
  createProgram,
  getAllPrograms,
  updateProgram,
  createSession,
  getAllSessions,
  changeSessionStatus,
  register,
  cancelRegistration,
  recordAttendance,
  evaluate,
  getAllRegistrations,
  getComplianceReport,
} from '../controllers/trainingController';
import { authenticateToken, requireRole, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import {
  createProgramSchema,
  updateProgramSchema,
  listProgramQuerySchema,
  createSessionSchema,
  changeSessionStatusSchema,
  listSessionQuerySchema,
  registerSchema,
  recordAttendanceSchema,
  evaluateSchema,
  listRegistrationQuerySchema,
  complianceQuerySchema,
} from '../schemas/trainingSchema';

const router = express.Router();

router.use(authenticateToken);

const HR = [Role.SUPER_ADMIN, Role.HR_ADMIN] as const;

// --- Program pelatihan ---
// Daftar program terbuka untuk semua karyawan: mereka perlu tahu pelatihan
// apa saja yang tersedia dan mana yang wajib.
router.get(
  '/training/programs',
  validate(listProgramQuerySchema, 'query'),
  asyncHandler(getAllPrograms)
);
router.post(
  '/training/programs',
  requireRole(...HR),
  validate(createProgramSchema),
  asyncHandler(createProgram)
);
router.put(
  '/training/programs/:id',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  validate(updateProgramSchema),
  asyncHandler(updateProgram)
);

// --- Sesi pelatihan ---
router.get(
  '/training/sessions',
  validate(listSessionQuerySchema, 'query'),
  asyncHandler(getAllSessions)
);
router.post(
  '/training/sessions',
  requireRole(...HR),
  validate(createSessionSchema),
  asyncHandler(createSession)
);
router.patch(
  '/training/sessions/:id/status',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  validate(changeSessionStatusSchema),
  asyncHandler(changeSessionStatus)
);

// Karyawan mendaftar sendiri; HR bisa mendaftarkan orang lain.
router.post(
  '/training/sessions/:id/register',
  validate(idParamSchema, 'params'),
  validate(registerSchema),
  asyncHandler(register)
);
router.post(
  '/training/sessions/:id/attendance',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  validate(recordAttendanceSchema),
  asyncHandler(recordAttendance)
);

// --- Pendaftaran & evaluasi ---
router.get(
  '/training/registrations',
  validate(listRegistrationQuerySchema, 'query'),
  asyncHandler(getAllRegistrations)
);
router.patch(
  '/training/registrations/:id/cancel',
  validate(idParamSchema, 'params'),
  asyncHandler(cancelRegistration)
);
router.post(
  '/training/registrations/:id/evaluate',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  validate(evaluateSchema),
  asyncHandler(evaluate)
);

// --- Laporan kepatuhan ---
router.get(
  '/training/compliance',
  requireRole(...HR),
  validate(complianceQuerySchema, 'query'),
  asyncHandler(getComplianceReport)
);

export default router;
