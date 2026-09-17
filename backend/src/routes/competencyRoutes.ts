// src/routes/competencyRoutes.ts
import express from 'express';
import { Role } from '@prisma/client';
import {
  createCompetency,
  getAllCompetencies,
  setStandard,
  getPositionStandards,
  removeStandard,
  assessCompetency,
  getEmployeeGap,
  getGapReport,
  createCertificationType,
  getAllCertificationTypes,
  createCertification,
  revokeCertification,
  getAllCertifications,
} from '../controllers/competencyController';
import { authenticateToken, requireRole, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import {
  createCompetencySchema,
  listCompetencyQuerySchema,
  setStandardSchema,
  assessCompetencySchema,
  createCertificationTypeSchema,
  listCertificationTypeQuerySchema,
  createCertificationSchema,
  revokeCertificationSchema,
  listCertificationQuerySchema,
  gapQuerySchema,
} from '../schemas/competencySchema';

const router = express.Router();

router.use(authenticateToken);

const HR = [Role.SUPER_ADMIN, Role.HR_ADMIN] as const;

// --- Kamus kompetensi ---
router.get(
  '/competencies',
  validate(listCompetencyQuerySchema, 'query'),
  asyncHandler(getAllCompetencies)
);
router.post(
  '/competencies',
  requireRole(...HR),
  validate(createCompetencySchema),
  asyncHandler(createCompetency)
);

// --- Standar jabatan ---
router.get(
  '/positions/:id/competency-standards',
  validate(idParamSchema, 'params'),
  asyncHandler(getPositionStandards)
);
router.put(
  '/positions/:id/competency-standards',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  validate(setStandardSchema),
  asyncHandler(setStandard)
);
router.delete(
  '/competency-standards/:id',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  asyncHandler(removeStandard)
);

// --- Kompetensi karyawan ---
router.put(
  '/employees/:id/competencies',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  validate(assessCompetencySchema),
  asyncHandler(assessCompetency)
);

// Tanpa requireRole: karyawan boleh melihat kesenjangan kompetensinya sendiri.
router.get(
  '/employees/:id/competency-gap',
  validate(idParamSchema, 'params'),
  asyncHandler(getEmployeeGap)
);
router.get(
  '/competency-gap',
  requireRole(...HR),
  validate(gapQuerySchema, 'query'),
  asyncHandler(getGapReport)
);

// --- Jenis sertifikasi ---
router.get(
  '/certification-types',
  validate(listCertificationTypeQuerySchema, 'query'),
  asyncHandler(getAllCertificationTypes)
);
router.post(
  '/certification-types',
  requireRole(...HR),
  validate(createCertificationTypeSchema),
  asyncHandler(createCertificationType)
);

// --- Sertifikat karyawan ---
router.get(
  '/certifications',
  validate(listCertificationQuerySchema, 'query'),
  asyncHandler(getAllCertifications)
);
router.post(
  '/certifications',
  requireRole(...HR),
  validate(createCertificationSchema),
  asyncHandler(createCertification)
);
router.patch(
  '/certifications/:id/revoke',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  validate(revokeCertificationSchema),
  asyncHandler(revokeCertification)
);

export default router;
