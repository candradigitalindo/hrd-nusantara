// src/schemas/psychometricSchema.ts
import { z } from 'zod';
import { ulidField, dateOnlyField, paginationFields } from './common';

export const TEST_STATUSES = ['pending', 'completed', 'reviewed'] as const;

export const createTestResultSchema = z
  .object({
    testName: z.string().trim().min(2).max(150),
    score: z.number().min(0),
    maxScore: z.number().positive().optional(),
    testDate: dateOnlyField.optional(),
    interpretation: z.string().trim().max(5000).optional(),
    reportUrl: z.string().trim().url().max(2000).optional(),
    status: z.enum(TEST_STATUSES).default('completed'),
  })
  .strict()
  .refine((d) => d.maxScore === undefined || d.score <= d.maxScore, {
    message: 'Skor tidak boleh melebihi skor maksimal',
    path: ['score'],
  });

export const updateTestResultSchema = z
  .object({
    score: z.number().min(0).optional(),
    maxScore: z.number().positive().nullable().optional(),
    testDate: dateOnlyField.nullable().optional(),
    interpretation: z.string().trim().max(5000).nullable().optional(),
    reportUrl: z.string().trim().url().max(2000).nullable().optional(),
    status: z.enum(TEST_STATUSES).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Tidak ada field yang diubah' });

export const listTestResultQuerySchema = z.object({
  ...paginationFields,
  candidateId: ulidField.optional(),
  status: z.enum(TEST_STATUSES).optional(),
});

export type CreateTestResultInput = z.infer<typeof createTestResultSchema>;
export type UpdateTestResultInput = z.infer<typeof updateTestResultSchema>;
export type ListTestResultQuery = z.infer<typeof listTestResultQuerySchema>;
