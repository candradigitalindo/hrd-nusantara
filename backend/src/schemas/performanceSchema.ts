// src/schemas/performanceSchema.ts
import { z } from 'zod';
import { ulidField, dateOnlyField, paginationFields } from './common';
import { REVIEWER_TYPES } from '../utils/performanceScoring';

export const PERIOD_TYPES = ['quarterly', 'semester', 'annual'] as const;
export const CYCLE_STATUSES = ['draft', 'open', 'closed'] as const;
export const REVIEW_STATUSES = ['draft', 'submitted', 'acknowledged', 'finalized'] as const;
export const FEEDBACK_TYPES = ['praise', 'improvement', 'note'] as const;

// --- Formulir & kriteria ---

const criterionFields = {
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Z0-9_]+$/, 'Kode hanya boleh huruf kapital, angka, dan garis bawah'),
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(500).optional(),
  category: z.string().trim().max(60).optional(),
  weight: z.coerce.number().min(0.01).max(100),
  maxScore: z.coerce.number().int().min(1).max(100).default(5),
};

export const createTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    description: z.string().trim().max(1000).optional(),
    positionId: ulidField.nullable().optional(),
    criteria: z.array(z.object(criterionFields).strict()).min(1).max(50),
  })
  .strict()
  .superRefine((d, ctx) => {
    const kode = d.criteria.map((c) => c.code);
    if (new Set(kode).size !== kode.length) {
      ctx.addIssue({ code: 'custom', path: ['criteria'], message: 'Ada kode kriteria yang ganda' });
    }

    // Diperiksa di sini juga, supaya formulir tidak pernah tersimpan dalam
    // keadaan yang membuat nilai akhirnya tidak bisa ditafsirkan.
    const total = d.criteria.reduce((s, c) => s + c.weight, 0);
    if (Math.abs(total - 100) > 0.01) {
      ctx.addIssue({
        code: 'custom',
        path: ['criteria'],
        message: `Jumlah bobot kriteria harus 100, saat ini ${Math.round(total * 100) / 100}`,
      });
    }
  });

export const listTemplateQuerySchema = z.object({
  ...paginationFields,
  positionId: ulidField.optional(),
  includeInactive: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

// --- Siklus penilaian ---

export const createCycleSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/, 'Kode hanya boleh huruf, angka, garis bawah, dan strip'),
    name: z.string().trim().min(1).max(150),
    periodType: z.enum(PERIOD_TYPES),
    periodStart: dateOnlyField,
    periodEnd: dateOnlyField,
    note: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((d) => d.periodEnd.getTime() >= d.periodStart.getTime(), {
    message: 'periodEnd tidak boleh lebih awal dari periodStart',
    path: ['periodEnd'],
  });

export const changeCycleStatusSchema = z
  .object({ status: z.enum(['open', 'closed']), note: z.string().trim().max(500).optional() })
  .strict();

export const listCycleQuerySchema = z.object({
  ...paginationFields,
  status: z.enum(CYCLE_STATUSES).optional(),
});

// --- Penilaian ---

export const assignReviewSchema = z
  .object({
    cycleId: ulidField,
    revieweeId: ulidField,
    reviewerId: ulidField,
    reviewerType: z.enum(REVIEWER_TYPES),
    formTemplateId: ulidField,
  })
  .strict()
  .superRefine((d, ctx) => {
    // Penilaian diri sendiri harus ditandai sebagai 'self'; kalau tidak,
    // nilainya tercampur ke rata-rata atasan atau rekan sejawat.
    if (d.revieweeId === d.reviewerId && d.reviewerType !== 'self') {
      ctx.addIssue({
        code: 'custom',
        path: ['reviewerType'],
        message: 'Menilai diri sendiri harus memakai reviewerType "self"',
      });
    }
    if (d.revieweeId !== d.reviewerId && d.reviewerType === 'self') {
      ctx.addIssue({
        code: 'custom',
        path: ['reviewerType'],
        message: 'reviewerType "self" hanya untuk menilai diri sendiri',
      });
    }
  });

export const submitReviewSchema = z
  .object({
    scores: z
      .array(
        z
          .object({
            criterionId: ulidField,
            score: z.coerce.number().min(0).max(100),
            comment: z.string().trim().max(1000).optional(),
          })
          .strict()
      )
      .min(1)
      .max(50),
    feedback: z.string().trim().max(5000).optional(),
  })
  .strict();

export const addDiscussionSchema = z
  .object({ note: z.string().trim().min(1).max(5000) })
  .strict();

export const listReviewQuerySchema = z.object({
  ...paginationFields,
  cycleId: ulidField.optional(),
  revieweeId: ulidField.optional(),
  reviewerId: ulidField.optional(),
  status: z.enum(REVIEW_STATUSES).optional(),
});

// --- Umpan balik berkelanjutan ---

export const createFeedbackSchema = z
  .object({
    recipientId: ulidField,
    type: z.enum(FEEDBACK_TYPES).default('note'),
    message: z.string().trim().min(1).max(2000),
    isPrivate: z.boolean().default(false),
  })
  .strict();

export const listFeedbackQuerySchema = z.object({
  ...paginationFields,
  recipientId: ulidField.optional(),
  type: z.enum(FEEDBACK_TYPES).optional(),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type ListTemplateQuery = z.infer<typeof listTemplateQuerySchema>;
export type CreateCycleInput = z.infer<typeof createCycleSchema>;
export type ChangeCycleStatusInput = z.infer<typeof changeCycleStatusSchema>;
export type ListCycleQuery = z.infer<typeof listCycleQuerySchema>;
export type AssignReviewInput = z.infer<typeof assignReviewSchema>;
export type SubmitReviewInput = z.infer<typeof submitReviewSchema>;
export type AddDiscussionInput = z.infer<typeof addDiscussionSchema>;
export type ListReviewQuery = z.infer<typeof listReviewQuerySchema>;
export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;
export type ListFeedbackQuery = z.infer<typeof listFeedbackQuerySchema>;
