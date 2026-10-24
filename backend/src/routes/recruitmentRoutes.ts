// src/routes/recruitmentRoutes.ts
import express from 'express';
import {
  createJobPosting,
  getAllJobPostings,
  updateJobPosting,
  changeJobPostingStatus,
  createCandidate,
  getAllCandidates,
  unduhCvPelamar,
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
import { lihatAtauKelola } from '../utils/permissions';
import { getRecruitmentIntegrations, testRecruitmentIntegration, getJobPublications, changeJobPublication } from '../controllers/recruitmentIntegrationController';
import { integrationParamsSchema, publicationParamsSchema, publicationInputSchema } from '../schemas/recruitmentIntegrationSchema';

const router = express.Router();

router.use(authenticateToken);

router.get('/recruitment/integrations', requirePermission(...lihatAtauKelola('rekrutmen')), asyncHandler(getRecruitmentIntegrations));
router.post('/recruitment/integrations/:platform/test', requirePermission('rekrutmen.ubah'), validate(integrationParamsSchema, 'params'), asyncHandler(testRecruitmentIntegration));
router.get('/job-postings/:id/publications', requirePermission(...lihatAtauKelola('rekrutmen')), validate(idParamSchema, 'params'), asyncHandler(getJobPublications));
router.post('/job-postings/:id/publications/:platform', requirePermission('rekrutmen.ubah'), validate(publicationParamsSchema, 'params'), validate(publicationInputSchema), asyncHandler(changeJobPublication));


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
  requirePermission('rekrutmen.buat'),
  validate(createJobPostingSchema),
  asyncHandler(createJobPosting)
);
router.put(
  '/job-postings/:id',
  requirePermission('rekrutmen.ubah'),
  validate(idParamSchema, 'params'),
  validate(updateJobPostingSchema),
  asyncHandler(updateJobPosting)
);
router.patch(
  '/job-postings/:id/status',
  requirePermission('rekrutmen.ubah'),
  validate(idParamSchema, 'params'),
  validate(changeJobPostingStatusSchema),
  asyncHandler(changeJobPostingStatus)
);

// --- Pelamar ---
router.get(
  '/candidates',
  requirePermission(...lihatAtauKelola('rekrutmen')),
  validate(listCandidateQuerySchema, 'query'),
  asyncHandler(getAllCandidates)
);
router.post(
  '/candidates',
  requirePermission('rekrutmen.buat'),
  validate(createCandidateSchema),
  asyncHandler(createCandidate)
);
router.get(
  '/candidates/:id/cv',
  requirePermission(...lihatAtauKelola('rekrutmen')),
  validate(idParamSchema, 'params'),
  asyncHandler(unduhCvPelamar)
);
router.get(
  '/candidates/:id',
  requirePermission(...lihatAtauKelola('rekrutmen')),
  validate(idParamSchema, 'params'),
  asyncHandler(getCandidateById)
);
router.patch(
  '/candidates/:id/stage',
  requirePermission('rekrutmen.ubah'),
  validate(idParamSchema, 'params'),
  validate(changeCandidateStageSchema),
  asyncHandler(changeCandidateStage)
);
router.post(
  '/candidates/:id/hire',
  requirePermission('rekrutmen.ubah'),
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
  requirePermission('rekrutmen.buat'),
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
  requirePermission(...lihatAtauKelola('rekrutmen')),
  validate(recruitmentReportQuerySchema, 'query'),
  asyncHandler(getRecruitmentFunnel)
);

export default router;
