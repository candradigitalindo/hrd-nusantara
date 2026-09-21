// src/routes/competencyRoutes.ts
import express from 'express';
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
import { authenticateToken, requirePermission, asyncHandler } from '../middleware/auth';
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


// --- Kamus kompetensi ---
router.get(
  '/competencies',
  requirePermission('halaman.kompetensi', 'kompetensi.kelola'),
  validate(listCompetencyQuerySchema, 'query'),
  asyncHandler(getAllCompetencies)
);
router.post(
  '/competencies',
  requirePermission('kompetensi.kelola'),
  validate(createCompetencySchema),
  asyncHandler(createCompetency)
);

// --- Standar jabatan ---
router.get(
  '/positions/:id/competency-standards',
  requirePermission('halaman.kompetensi', 'kompetensi.kelola'),
  validate(idParamSchema, 'params'),
  asyncHandler(getPositionStandards)
);
router.put(
  '/positions/:id/competency-standards',
  requirePermission('kompetensi.kelola'),
  validate(idParamSchema, 'params'),
  validate(setStandardSchema),
  asyncHandler(setStandard)
);
router.delete(
  '/competency-standards/:id',
  requirePermission('kompetensi.kelola'),
  validate(idParamSchema, 'params'),
  asyncHandler(removeStandard)
);

// --- Kompetensi karyawan ---
router.put(
  '/employees/:id/competencies',
  requirePermission('kompetensi.kelola'),
  validate(idParamSchema, 'params'),
  validate(assessCompetencySchema),
  asyncHandler(assessCompetency)
);

// Tanpa requireRole: karyawan boleh melihat kesenjangan kompetensinya sendiri.
router.get(
  '/employees/:id/competency-gap',
  requirePermission('halaman.kompetensi', 'kompetensi.kelola'),
  validate(idParamSchema, 'params'),
  asyncHandler(getEmployeeGap)
);
router.get(
  '/competency-gap',
  requirePermission('kompetensi.kelola'),
  validate(gapQuerySchema, 'query'),
  asyncHandler(getGapReport)
);

// --- Jenis sertifikasi ---
router.get(
  '/certification-types',
  requirePermission('halaman.kompetensi', 'kompetensi.kelola'),
  validate(listCertificationTypeQuerySchema, 'query'),
  asyncHandler(getAllCertificationTypes)
);
router.post(
  '/certification-types',
  requirePermission('kompetensi.kelola'),
  validate(createCertificationTypeSchema),
  asyncHandler(createCertificationType)
);

// --- Sertifikat karyawan ---
router.get(
  '/certifications',
  requirePermission('halaman.kompetensi', 'kompetensi.kelola'),
  validate(listCertificationQuerySchema, 'query'),
  asyncHandler(getAllCertifications)
);
router.post(
  '/certifications',
  requirePermission('kompetensi.kelola'),
  validate(createCertificationSchema),
  asyncHandler(createCertification)
);
router.patch(
  '/certifications/:id/revoke',
  requirePermission('kompetensi.kelola'),
  validate(idParamSchema, 'params'),
  validate(revokeCertificationSchema),
  asyncHandler(revokeCertification)
);

export default router;
