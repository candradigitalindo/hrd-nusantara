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
import { kelola, lihatAtauKelola } from '../utils/permissions';

const router = express.Router();

router.use(authenticateToken);


// --- Program pelatihan ---
// Daftar program terbuka untuk semua karyawan: mereka perlu tahu pelatihan
// apa saja yang tersedia dan mana yang wajib.
router.get(
  '/training/programs',
  requirePermission(...lihatAtauKelola('pelatihan')),
  validate(listProgramQuerySchema, 'query'),
  asyncHandler(getAllPrograms)
);
router.post(
  '/training/programs',
  requirePermission('pelatihan.buat'),
  validate(createProgramSchema),
  asyncHandler(createProgram)
);
router.put(
  '/training/programs/:id',
  requirePermission('pelatihan.ubah'),
  validate(idParamSchema, 'params'),
  validate(updateProgramSchema),
  asyncHandler(updateProgram)
);

// --- Sesi pelatihan ---
router.get(
  '/training/sessions',
  requirePermission(...lihatAtauKelola('pelatihan')),
  validate(listSessionQuerySchema, 'query'),
  asyncHandler(getAllSessions)
);
router.post(
  '/training/sessions',
  requirePermission('pelatihan.buat'),
  validate(createSessionSchema),
  asyncHandler(createSession)
);
router.patch(
  '/training/sessions/:id/status',
  requirePermission('pelatihan.ubah'),
  validate(idParamSchema, 'params'),
  validate(changeSessionStatusSchema),
  asyncHandler(changeSessionStatus)
);

// Karyawan mendaftar sendiri; HR bisa mendaftarkan orang lain.
router.post(
  '/training/sessions/:id/register',
  requirePermission(...lihatAtauKelola('pelatihan')),
  validate(idParamSchema, 'params'),
  validate(registerSchema),
  asyncHandler(register)
);
router.post(
  '/training/sessions/:id/attendance',
  requirePermission('pelatihan.ubah'),
  validate(idParamSchema, 'params'),
  validate(recordAttendanceSchema),
  asyncHandler(recordAttendance)
);

// --- Pendaftaran & evaluasi ---
router.get(
  '/training/registrations',
  requirePermission(...lihatAtauKelola('pelatihan')),
  validate(listRegistrationQuerySchema, 'query'),
  asyncHandler(getAllRegistrations)
);
router.patch(
  '/training/registrations/:id/cancel',
  requirePermission(...lihatAtauKelola('pelatihan')),
  validate(idParamSchema, 'params'),
  asyncHandler(cancelRegistration)
);
router.post(
  '/training/registrations/:id/evaluate',
  requirePermission('pelatihan.ubah'),
  validate(idParamSchema, 'params'),
  validate(evaluateSchema),
  asyncHandler(evaluate)
);

// --- Laporan kepatuhan ---
router.get(
  '/training/compliance',
  requirePermission(...kelola('pelatihan')),
  validate(complianceQuerySchema, 'query'),
  asyncHandler(getComplianceReport)
);

export default router;
