// src/schemas/competencySchema.ts
import { z } from 'zod';
import { ulidField, dateOnlyField, paginationFields } from './common';

const tingkat = z.coerce.number().int().min(0).max(20);

// Tautan bukti dan berkas ditampilkan sebagai tautan yang bisa diklik, jadi
// hanya http(s): skema lain (javascript:, data:) tidak punya tempat di sini.
const tautanWeb = (nama: string) =>
  z.url({ protocol: /^https?$/, error: `${nama} harus berupa URL http(s)` }).max(500);

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

// Syarat jabatan minimal tingkat 1: syarat "tingkat 0" terpenuhi oleh siapa pun,
// termasuk yang belum pernah dinilai, sehingga kesiapan jabatan menggelembung.
const tingkatSyarat = z.coerce
  .number()
  .int()
  .min(1, 'Syarat jabatan minimal tingkat 1')
  .max(20);

export const setStandardSchema = z
  .object({
    competencyId: ulidField,
    requiredLevel: tingkatSyarat,
    description: z.string().trim().max(500).optional(),
  })
  .strict();

// --- Penilaian kompetensi karyawan ---

export const assessCompetencySchema = z
  .object({
    competencyId: ulidField,
    currentLevel: tingkat,
    evidenceUrl: tautanWeb('evidenceUrl').optional(),
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
    certificateUrl: tautanWeb('certificateUrl').optional(),
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

// --- Kepatuhan sertifikat wajib ---

export const certificationComplianceQuerySchema = z.object({
  certificationTypeId: ulidField.optional(),
  departmentId: ulidField.optional(),
  warningDays: z.coerce.number().int().min(1).max(365).default(30),
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
export type CertificationComplianceQuery = z.infer<typeof certificationComplianceQuerySchema>;
