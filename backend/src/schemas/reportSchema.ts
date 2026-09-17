// src/schemas/reportSchema.ts
import { z } from 'zod';
import { ulidField, dateOnlyField, paginationFields } from './common';

export const periodQuerySchema = z.object({
  startDate: dateOnlyField,
  endDate: dateOnlyField,
  departmentId: ulidField.optional(),
});

export const RAW_DATASETS = [
  'employees',
  'attendance',
  'leaves',
  'payrolls',
  'trainings',
] as const;

export const rawDataQuerySchema = z.object({
  ...paginationFields,
  dataset: z.enum(RAW_DATASETS),
  startDate: dateOnlyField.optional(),
  endDate: dateOnlyField.optional(),
  departmentId: ulidField.optional(),
});

export type PeriodQuery = z.infer<typeof periodQuerySchema>;
export type RawDataQuery = z.infer<typeof rawDataQuerySchema>;
