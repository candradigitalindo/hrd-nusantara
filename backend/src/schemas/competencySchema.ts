// src/schemas/competencySchema.ts
import { z } from 'zod';
import { ulidField, dateOnlyField, paginationFields } from './common';

const tingkat = z.coerce.number().int().min(0).max(20);

// --- Kamus kompetensi ---

export const createCompetencySchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[A-Z0-9_]+$/, 'Kode hanya boleh huruf kapital, angka, dan garis bawah'),
    name: z.string().trim().min(1).max(150),
    description: z.string().trim().max(1000).optional(),
    category: z.string().trim().max(60).optional(),
    maxLevel: z.coerce.number().int().min(1).max(20).default(4),
    levelLabels: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const listCompetencyQuerySchema = z.object({
  ...paginationFields,
  category: z.string().trim().max(60).optional(),
  includeInactive: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

// --- Standar jabatan ---

export const setStandardSchema = z
  .object({
    competencyId: ulidField,
    requiredLevel: tingkat,
    description: z.string().trim().max(500).optional(),
  })
  .strict();

// --- Penilaian kompetensi karyawan ---

export const assessCompetencySchema = z
  .object({
    competencyId: ulidField,
    currentLevel: tingkat,
    evidenceUrl: z.url('evidenceUrl harus berupa URL').max(500).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

// --- Jenis sertifikasi ---

export const createCertificationTypeSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[A-Z0-9_]+$/, 'Kode hanya boleh huruf kapital, angka, dan garis bawah'),
    name: z.string().trim().min(1).max(150),
    description: z.string().trim().max(1000).optional(),
    issuingOrganization: z.string().trim().max(150).optional(),
    validityMonths: z.coerce.number().int().min(1).max(600).nullable().optional(),
    isMandatory: z.boolean().default(false),
    targetPositionId: ulidField.nullable().optional(),
    trainingProgramId: ulidField.nullable().optional(),
  })
  .strict();

export const listCertificationTypeQuerySchema = z.object({
  ...paginationFields,
  includeInactive: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

// --- Catatan sertifikat ---

export const createCertificationSchema = z
  .object({
    employeeId: ulidField,
    certificationTypeId: ulidField.nullable().optional(),
    /// Wajib bila tidak memakai jenis terdaftar.
    certificationName: z.string().trim().min(1).max(150).optional(),
    issuingOrganization: z.string().trim().min(1).max(150).optional(),
    issueDate: dateOnlyField,
    expiryDate: dateOnlyField.nullable().optional(),
    certificateUrl: z.url('certificateUrl harus berupa URL').max(500).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (!d.certificationTypeId) {
      if (!d.certificationName) {
        ctx.addIssue({
          code: 'custom',
          path: ['certificationName'],
          message: 'Sertifikat di luar daftar resmi harus menyebutkan namanya',
        });
      }
      if (!d.issuingOrganization) {
        ctx.addIssue({
          code: 'custom',
          path: ['issuingOrganization'],
          message: 'Sertifikat di luar daftar resmi harus menyebutkan penerbitnya',
        });
      }
    }
    if (d.expiryDate && d.expiryDate.getTime() < d.issueDate.getTime()) {
      ctx.addIssue({
        code: 'custom',
        path: ['expiryDate'],
        message: 'Tanggal kedaluwarsa tidak boleh sebelum tanggal terbit',
      });
    }
  });

export const revokeCertificationSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();

export const listCertificationQuerySchema = z.object({
  ...paginationFields,
  employeeId: ulidField.optional(),
  certificationTypeId: ulidField.optional(),
  state: z.enum(['valid', 'expiring_soon', 'expired', 'revoked']).optional(),
  warningDays: z.coerce.number().int().min(1).max(365).default(30),
});

export const gapQuerySchema = z.object({
  departmentId: ulidField.optional(),
  positionId: ulidField.optional(),
});

export type CreateCompetencyInput = z.infer<typeof createCompetencySchema>;
export type ListCompetencyQuery = z.infer<typeof listCompetencyQuerySchema>;
export type SetStandardInput = z.infer<typeof setStandardSchema>;
export type AssessCompetencyInput = z.infer<typeof assessCompetencySchema>;
export type CreateCertificationTypeInput = z.infer<typeof createCertificationTypeSchema>;
export type ListCertificationTypeQuery = z.infer<typeof listCertificationTypeQuerySchema>;
export type CreateCertificationInput = z.infer<typeof createCertificationSchema>;
export type RevokeCertificationInput = z.infer<typeof revokeCertificationSchema>;
export type ListCertificationQuery = z.infer<typeof listCertificationQuerySchema>;
export type GapQuery = z.infer<typeof gapQuerySchema>;
