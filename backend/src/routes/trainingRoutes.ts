// src/routes/trainingRoutes.ts
import express from 'express';
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
import { authenticateToken, requirePermission, asyncHandler } from '../middleware/auth';
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


// --- Program pelatihan ---
// Daftar program terbuka untuk semua karyawan: mereka perlu tahu pelatihan
// apa saja yang tersedia dan mana yang wajib.
router.get(
  '/training/programs',
  requirePermission('halaman.pelatihan', 'pelatihan.kelola'),
  validate(listProgramQuerySchema, 'query'),
  asyncHandler(getAllPrograms)
);
router.post(
  '/training/programs',
  requirePermission('pelatihan.kelola'),
  validate(createProgramSchema),
  asyncHandler(createProgram)
);
router.put(
  '/training/programs/:id',
  requirePermission('pelatihan.kelola'),
  validate(idParamSchema, 'params'),
  validate(updateProgramSchema),
  asyncHandler(updateProgram)
);

// --- Sesi pelatihan ---
router.get(
  '/training/sessions',
  requirePermission('halaman.pelatihan', 'pelatihan.kelola'),
  validate(listSessionQuerySchema, 'query'),
  asyncHandler(getAllSessions)
);
router.post(
  '/training/sessions',
  requirePermission('pelatihan.kelola'),
  validate(createSessionSchema),
  asyncHandler(createSession)
);
router.patch(
  '/training/sessions/:id/status',
  requirePermission('pelatihan.kelola'),
  validate(idParamSchema, 'params'),
  validate(changeSessionStatusSchema),
  asyncHandler(changeSessionStatus)
);

// Karyawan mendaftar sendiri; HR bisa mendaftarkan orang lain.
router.post(
  '/training/sessions/:id/register',
  requirePermission('halaman.pelatihan', 'pelatihan.kelola'),
  validate(idParamSchema, 'params'),
  validate(registerSchema),
  asyncHandler(register)
);
router.post(
  '/training/sessions/:id/attendance',
  requirePermission('pelatihan.kelola'),
  validate(idParamSchema, 'params'),
  validate(recordAttendanceSchema),
  asyncHandler(recordAttendance)
);

// --- Pendaftaran & evaluasi ---
router.get(
  '/training/registrations',
  requirePermission('halaman.pelatihan', 'pelatihan.kelola'),
  validate(listRegistrationQuerySchema, 'query'),
  asyncHandler(getAllRegistrations)
);
router.patch(
  '/training/registrations/:id/cancel',
  requirePermission('halaman.pelatihan', 'pelatihan.kelola'),
  validate(idParamSchema, 'params'),
  asyncHandler(cancelRegistration)
);
router.post(
  '/training/registrations/:id/evaluate',
  requirePermission('pelatihan.kelola'),
  validate(idParamSchema, 'params'),
  validate(evaluateSchema),
  asyncHandler(evaluate)
);

// --- Laporan kepatuhan ---
router.get(
  '/training/compliance',
  requirePermission('pelatihan.kelola'),
  validate(complianceQuerySchema, 'query'),
  asyncHandler(getComplianceReport)
);

export default router;
