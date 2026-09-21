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

const router = express.Router();

router.use(authenticateToken);


// --- Formulir penilaian ---
router.get(
  '/performance/templates',
  requirePermission('kinerja.kelola'),
  validate(listTemplateQuerySchema, 'query'),
  asyncHandler(getAllTemplates)
);
router.post(
  '/performance/templates',
  requirePermission('kinerja.kelola'),
  validate(createTemplateSchema),
  asyncHandler(createTemplate)
);

// --- Siklus penilaian ---
router.get(
  '/performance/cycles',
  requirePermission('kinerja.kelola'),
  validate(listCycleQuerySchema, 'query'),
  asyncHandler(getAllCycles)
);
router.post(
  '/performance/cycles',
  requirePermission('kinerja.kelola'),
  validate(createCycleSchema),
  asyncHandler(createCycle)
);
router.patch(
  '/performance/cycles/:id/status',
  requirePermission('kinerja.kelola'),
  validate(idParamSchema, 'params'),
  validate(changeCycleStatusSchema),
  asyncHandler(changeCycleStatus)
);

// --- Penilaian ---
router.post(
  '/performance/reviews',
  requirePermission('kinerja.kelola'),
  validate(assignReviewSchema),
  asyncHandler(assignReview)
);

// Tanpa requireRole: penilai dan yang dinilai perlu akses.
// Penyaringan siapa melihat apa dikerjakan di controller.
router.get(
  '/performance/reviews',
  requirePermission('halaman.kinerja', 'kinerja.kelola'),
  validate(listReviewQuerySchema, 'query'),
  asyncHandler(getAllReviews)
);
router.get(
  '/performance/reviews/:id',
  requirePermission('halaman.kinerja', 'kinerja.kelola'),
  validate(idParamSchema, 'params'),
  asyncHandler(getReviewById)
);
router.post(
  '/performance/reviews/:id/submit',
  requirePermission('halaman.kinerja', 'kinerja.kelola'),
  validate(idParamSchema, 'params'),
  validate(submitReviewSchema),
  asyncHandler(submitReview)
);
router.post(
  '/performance/reviews/:id/acknowledge',
  requirePermission('halaman.kinerja', 'kinerja.kelola'),
  validate(idParamSchema, 'params'),
  asyncHandler(acknowledgeReview)
);
router.post(
  '/performance/reviews/:id/discussions',
  requirePermission('halaman.kinerja', 'kinerja.kelola'),
  validate(idParamSchema, 'params'),
  validate(addDiscussionSchema),
  asyncHandler(addDiscussion)
);

router.get(
  '/performance/summary/:cycleId/:employeeId',
  requirePermission('halaman.kinerja', 'kinerja.kelola'),
  asyncHandler(getReviewSummary)
);

// --- Umpan balik berkelanjutan ---
// Terbuka untuk semua karyawan: justru itu intinya, umpan balik antar rekan
// kerja yang tercatat tanpa menunggu siklus penilaian.
router.post('/feedback', requirePermission('halaman.kinerja', 'kinerja.kelola'), validate(createFeedbackSchema), asyncHandler(createFeedback));
router.get('/feedback', requirePermission('halaman.kinerja', 'kinerja.kelola'), validate(listFeedbackQuerySchema, 'query'), asyncHandler(getFeedback));

export default router;
