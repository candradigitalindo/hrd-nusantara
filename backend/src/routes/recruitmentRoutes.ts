// src/routes/recruitmentRoutes.ts
import express from 'express';
import { Role } from '@prisma/client';
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
import { authenticateToken, requireRole, asyncHandler } from '../middleware/auth';
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

const HR = [Role.SUPER_ADMIN, Role.HR_ADMIN] as const;

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
  requireRole(...HR),
  validate(createJobPostingSchema),
  asyncHandler(createJobPosting)
);
router.put(
  '/job-postings/:id',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  validate(updateJobPostingSchema),
  asyncHandler(updateJobPosting)
);
router.patch(
  '/job-postings/:id/status',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  validate(changeJobPostingStatusSchema),
  asyncHandler(changeJobPostingStatus)
);

// --- Pelamar ---
router.get(
  '/candidates',
  requireRole(...HR),
  validate(listCandidateQuerySchema, 'query'),
  asyncHandler(getAllCandidates)
);
router.post(
  '/candidates',
  requireRole(...HR),
  validate(createCandidateSchema),
  asyncHandler(createCandidate)
);
router.get(
  '/candidates/:id',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  asyncHandler(getCandidateById)
);
router.patch(
  '/candidates/:id/stage',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  validate(changeCandidateStageSchema),
  asyncHandler(changeCandidateStage)
);
router.post(
  '/candidates/:id/hire',
  requireRole(...HR),
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
  requireRole(...HR),
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
  requireRole(...HR),
  validate(recruitmentReportQuerySchema, 'query'),
  asyncHandler(getRecruitmentFunnel)
);

export default router;
