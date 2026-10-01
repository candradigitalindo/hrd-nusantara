// src/routes/shiftRoutes.ts
import express from 'express';
import {
  createShift,
  bulkCreateShifts,
  getAllShifts,
  getMyShifts,
  getShiftRecap,
  updateShift,
  cancelShift,
} from '../controllers/shiftController';
import {
  listShiftTemplates,
  createShiftTemplate,
  updateShiftTemplate,
  deactivateShiftTemplate,
} from '../controllers/shiftTemplateController';
import {
  listAssignments,
  createAssignments,
  endAssignment,
  deleteAssignment,
} from '../controllers/shiftAssignmentController';
import { authenticateToken, requirePermission, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import {
  createShiftSchema,
  bulkCreateShiftSchema,
  updateShiftSchema,
  listShiftQuerySchema,
  shiftRecapQuerySchema,
  listShiftTemplateQuerySchema,
  createShiftTemplateSchema,
  updateShiftTemplateSchema,
  listAssignmentQuerySchema,
  createAssignmentSchema,
  endAssignmentSchema,
} from '../schemas/shiftSchema';
import { lihatAtauKelola } from '../utils/permissions';

const router = express.Router();

router.use(authenticateToken);

// Didaftarkan sebelum '/:id' supaya "me" tidak tertangkap sebagai ULID.
router.get('/me', requirePermission('presensi.lihat'), validate(listShiftQuerySchema, 'query'), asyncHandler(getMyShifts));

// Sama seperti '/me': nama tetap, jadi harus didaftarkan lebih dulu.
router.get(
  '/rekap',
  requirePermission(...lihatAtauKelola('shift')),
  validate(shiftRecapQuerySchema, 'query'),
  asyncHandler(getShiftRecap)
);

// --- Jenis shift & penugasan berjangka ---
// Jalur statis ini harus terdaftar sebelum '/:id', kalau tidak "templates"
// dan "assignments" tertangkap sebagai id jadwal.
router.get(
  '/templates',
  requirePermission(...lihatAtauKelola('shift')),
  validate(listShiftTemplateQuerySchema, 'query'),
  asyncHandler(listShiftTemplates)
);
router.post('/templates', requirePermission('shift.buat'), validate(createShiftTemplateSchema), asyncHandler(createShiftTemplate));
router.put(
  '/templates/:id',
  requirePermission('shift.ubah'),
  validate(idParamSchema, 'params'),
  validate(updateShiftTemplateSchema),
  asyncHandler(updateShiftTemplate)
);
router.delete(
  '/templates/:id',
  requirePermission('shift.hapus'),
  validate(idParamSchema, 'params'),
  asyncHandler(deactivateShiftTemplate)
);

router.get(
  '/assignments',
  requirePermission(...lihatAtauKelola('shift')),
  validate(listAssignmentQuerySchema, 'query'),
  asyncHandler(listAssignments)
);
router.post('/assignments', requirePermission('shift.buat'), validate(createAssignmentSchema), asyncHandler(createAssignments));
router.post(
  '/assignments/:id/end',
  requirePermission('shift.ubah'),
  validate(idParamSchema, 'params'),
  validate(endAssignmentSchema),
  asyncHandler(endAssignment)
);
router.delete(
  '/assignments/:id',
  requirePermission('shift.hapus'),
  validate(idParamSchema, 'params'),
  asyncHandler(deleteAssignment)
);

router.get(
  '/',
  requirePermission(...lihatAtauKelola('shift')),
  validate(listShiftQuerySchema, 'query'),
  asyncHandler(getAllShifts)
);

router.post(
  '/',
  requirePermission('shift.buat'),
  validate(createShiftSchema),
  asyncHandler(createShift)
);

router.post(
  '/bulk',
  requirePermission('shift.buat'),
  validate(bulkCreateShiftSchema),
  asyncHandler(bulkCreateShifts)
);

router.put(
  '/:id',
  requirePermission('shift.ubah'),
  validate(idParamSchema, 'params'),
  validate(updateShiftSchema),
  asyncHandler(updateShift)
);

router.delete(
  '/:id',
  requirePermission('shift.hapus'),
  validate(idParamSchema, 'params'),
  asyncHandler(cancelShift)
);

export default router;
