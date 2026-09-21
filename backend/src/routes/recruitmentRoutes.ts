// src/routes/recruitmentRoutes.ts
import express from 'express';
import {
  createJobPosting,
  getAllJobPostings,
  updateJobPosting,
  changeJobPostingStatus,
  createCandidate,
  getAllCandidates,
  getCandidateById,
  changeCandidateStage,
  hireCandidate,
  scheduleInterview,
  submitInterviewFeedback,
  getAllInterviews,
  getRecruitmentFunnel,
} from '../controllers/recruitmentController';
import { authenticateToken, requirePermission, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import {
  createJobPostingSchema,
  updateJobPostingSchema,
  changeJobPostingStatusSchema,
  listJobPostingQuerySchema,
  createCandidateSchema,
  changeCandidateStageSchema,
  hireCandidateSchema,
  listCandidateQuerySchema,
  scheduleInterviewSchema,
  submitInterviewFeedbackSchema,
  listInterviewQuerySchema,
  recruitmentReportQuerySchema,
} from '../schemas/recruitmentSchema';

const router = express.Router();

router.use(authenticateToken);


// --- Lowongan ---
// Daftar lowongan terbuka untuk semua karyawan: rekrutmen internal dan
// program referral bergantung pada karyawan bisa melihatnya.
router.get(
  '/job-postings',
  validate(listJobPostingQuerySchema, 'query'),
  asyncHandler(getAllJobPostings)
);
router.post(
  '/job-postings',
  requirePermission('rekrutmen.kelola'),
  validate(createJobPostingSchema),
  asyncHandler(createJobPosting)
);
router.put(
  '/job-postings/:id',
  requirePermission('rekrutmen.kelola'),
  validate(idParamSchema, 'params'),
  validate(updateJobPostingSchema),
  asyncHandler(updateJobPosting)
);
router.patch(
  '/job-postings/:id/status',
  requirePermission('rekrutmen.kelola'),
  validate(idParamSchema, 'params'),
  validate(changeJobPostingStatusSchema),
  asyncHandler(changeJobPostingStatus)
);

// --- Pelamar ---
router.get(
  '/candidates',
  requirePermission('rekrutmen.kelola'),
  validate(listCandidateQuerySchema, 'query'),
  asyncHandler(getAllCandidates)
);
router.post(
  '/candidates',
  requirePermission('rekrutmen.kelola'),
  validate(createCandidateSchema),
  asyncHandler(createCandidate)
);
router.get(
  '/candidates/:id',
  requirePermission('rekrutmen.kelola'),
  validate(idParamSchema, 'params'),
  asyncHandler(getCandidateById)
);
router.patch(
  '/candidates/:id/stage',
  requirePermission('rekrutmen.kelola'),
  validate(idParamSchema, 'params'),
  validate(changeCandidateStageSchema),
  asyncHandler(changeCandidateStage)
);
router.post(
  '/candidates/:id/hire',
  requirePermission('rekrutmen.kelola'),
  validate(idParamSchema, 'params'),
  validate(hireCandidateSchema),
  asyncHandler(hireCandidate)
);

// --- Wawancara ---
// Tanpa requireRole: pewawancara perlu melihat jadwalnya sendiri.
// Penyaringan siapa melihat apa dikerjakan di controller.
router.get(
  '/interviews',
  validate(listInterviewQuerySchema, 'query'),
  asyncHandler(getAllInterviews)
);
router.post(
  '/interviews',
  requirePermission('rekrutmen.kelola'),
  validate(scheduleInterviewSchema),
  asyncHandler(scheduleInterview)
);
router.patch(
  '/interviews/:id/feedback',
  validate(idParamSchema, 'params'),
  validate(submitInterviewFeedbackSchema),
  asyncHandler(submitInterviewFeedback)
);

// --- Laporan ---
router.get(
  '/recruitment/funnel',
  requirePermission('rekrutmen.kelola'),
  validate(recruitmentReportQuerySchema, 'query'),
  asyncHandler(getRecruitmentFunnel)
);

export default router;
