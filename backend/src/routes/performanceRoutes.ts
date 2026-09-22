// src/routes/performanceRoutes.ts
import express from 'express';
import {
  createTemplate,
  getAllTemplates,
  createCycle,
  changeCycleStatus,
  getAllCycles,
  assignReview,
  submitReview,
  acknowledgeReview,
  getAllReviews,
  getReviewById,
  addDiscussion,
  getReviewSummary,
  createFeedback,
  getFeedback,
} from '../controllers/performanceController';
import { authenticateToken, requirePermission, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import {
  createTemplateSchema,
  listTemplateQuerySchema,
  createCycleSchema,
  changeCycleStatusSchema,
  listCycleQuerySchema,
  assignReviewSchema,
  submitReviewSchema,
  addDiscussionSchema,
  listReviewQuerySchema,
  createFeedbackSchema,
  listFeedbackQuerySchema,
} from '../schemas/performanceSchema';
import { kelola, lihatAtauKelola } from '../utils/permissions';

const router = express.Router();

router.use(authenticateToken);


// --- Formulir penilaian ---
router.get(
  '/performance/templates',
  requirePermission(...kelola('kinerja')),
  validate(listTemplateQuerySchema, 'query'),
  asyncHandler(getAllTemplates)
);
router.post(
  '/performance/templates',
  requirePermission('kinerja.buat'),
  validate(createTemplateSchema),
  asyncHandler(createTemplate)
);

// --- Siklus penilaian ---
router.get(
  '/performance/cycles',
  requirePermission(...kelola('kinerja')),
  validate(listCycleQuerySchema, 'query'),
  asyncHandler(getAllCycles)
);
router.post(
  '/performance/cycles',
  requirePermission('kinerja.buat'),
  validate(createCycleSchema),
  asyncHandler(createCycle)
);
router.patch(
  '/performance/cycles/:id/status',
  requirePermission('kinerja.ubah'),
  validate(idParamSchema, 'params'),
  validate(changeCycleStatusSchema),
  asyncHandler(changeCycleStatus)
);

// --- Penilaian ---
router.post(
  '/performance/reviews',
  requirePermission('kinerja.buat'),
  validate(assignReviewSchema),
  asyncHandler(assignReview)
);

// Tanpa requireRole: penilai dan yang dinilai perlu akses.
// Penyaringan siapa melihat apa dikerjakan di controller.
router.get(
  '/performance/reviews',
  requirePermission(...lihatAtauKelola('kinerja')),
  validate(listReviewQuerySchema, 'query'),
  asyncHandler(getAllReviews)
);
router.get(
  '/performance/reviews/:id',
  requirePermission(...lihatAtauKelola('kinerja')),
  validate(idParamSchema, 'params'),
  asyncHandler(getReviewById)
);
router.post(
  '/performance/reviews/:id/submit',
  requirePermission(...lihatAtauKelola('kinerja')),
  validate(idParamSchema, 'params'),
  validate(submitReviewSchema),
  asyncHandler(submitReview)
);
router.post(
  '/performance/reviews/:id/acknowledge',
  requirePermission(...lihatAtauKelola('kinerja')),
  validate(idParamSchema, 'params'),
  asyncHandler(acknowledgeReview)
);
router.post(
  '/performance/reviews/:id/discussions',
  requirePermission(...lihatAtauKelola('kinerja')),
  validate(idParamSchema, 'params'),
  validate(addDiscussionSchema),
  asyncHandler(addDiscussion)
);

router.get(
  '/performance/summary/:cycleId/:employeeId',
  requirePermission(...lihatAtauKelola('kinerja')),
  asyncHandler(getReviewSummary)
);

// --- Umpan balik berkelanjutan ---
// Terbuka untuk semua karyawan: justru itu intinya, umpan balik antar rekan
// kerja yang tercatat tanpa menunggu siklus penilaian.
router.post('/feedback', requirePermission(...lihatAtauKelola('kinerja')), validate(createFeedbackSchema), asyncHandler(createFeedback));
router.get('/feedback', requirePermission(...lihatAtauKelola('kinerja')), validate(listFeedbackQuerySchema, 'query'), asyncHandler(getFeedback));

export default router;
