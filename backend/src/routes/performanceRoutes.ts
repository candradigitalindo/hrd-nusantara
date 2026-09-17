// src/routes/performanceRoutes.ts
import express from 'express';
import { Role } from '@prisma/client';
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
import { authenticateToken, requireRole, asyncHandler } from '../middleware/auth';
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

const HR = [Role.SUPER_ADMIN, Role.HR_ADMIN] as const;

// --- Formulir penilaian ---
router.get(
  '/performance/templates',
  requireRole(...HR),
  validate(listTemplateQuerySchema, 'query'),
  asyncHandler(getAllTemplates)
);
router.post(
  '/performance/templates',
  requireRole(...HR),
  validate(createTemplateSchema),
  asyncHandler(createTemplate)
);

// --- Siklus penilaian ---
router.get(
  '/performance/cycles',
  requireRole(...HR),
  validate(listCycleQuerySchema, 'query'),
  asyncHandler(getAllCycles)
);
router.post(
  '/performance/cycles',
  requireRole(...HR),
  validate(createCycleSchema),
  asyncHandler(createCycle)
);
router.patch(
  '/performance/cycles/:id/status',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  validate(changeCycleStatusSchema),
  asyncHandler(changeCycleStatus)
);

// --- Penilaian ---
router.post(
  '/performance/reviews',
  requireRole(...HR),
  validate(assignReviewSchema),
  asyncHandler(assignReview)
);

// Tanpa requireRole: penilai dan yang dinilai perlu akses.
// Penyaringan siapa melihat apa dikerjakan di controller.
router.get(
  '/performance/reviews',
  validate(listReviewQuerySchema, 'query'),
  asyncHandler(getAllReviews)
);
router.get(
  '/performance/reviews/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(getReviewById)
);
router.post(
  '/performance/reviews/:id/submit',
  validate(idParamSchema, 'params'),
  validate(submitReviewSchema),
  asyncHandler(submitReview)
);
router.post(
  '/performance/reviews/:id/acknowledge',
  validate(idParamSchema, 'params'),
  asyncHandler(acknowledgeReview)
);
router.post(
  '/performance/reviews/:id/discussions',
  validate(idParamSchema, 'params'),
  validate(addDiscussionSchema),
  asyncHandler(addDiscussion)
);

router.get(
  '/performance/summary/:cycleId/:employeeId',
  asyncHandler(getReviewSummary)
);

// --- Umpan balik berkelanjutan ---
// Terbuka untuk semua karyawan: justru itu intinya, umpan balik antar rekan
// kerja yang tercatat tanpa menunggu siklus penilaian.
router.post('/feedback', validate(createFeedbackSchema), asyncHandler(createFeedback));
router.get('/feedback', validate(listFeedbackQuerySchema, 'query'), asyncHandler(getFeedback));

export default router;
