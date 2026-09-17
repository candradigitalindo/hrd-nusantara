// src/schemas/shiftSchema.ts
import { z } from 'zod';
import { ulidField, dateOnlyField, timeField, paginationFields } from './common';

export const SHIFT_STATUSES = ['confirmed', 'tentative', 'cancelled'] as const;

const shiftFields = {
  employeeId: ulidField,
  date: dateOnlyField,
  startTime: timeField,
  endTime: timeField,
  // Jam istirahat. Tidak divalidasi terhadap durasi shift di sini karena
  // panjang shift baru diketahui setelah jam mulai/selesai diurai —
  // pengecekannya ada di controller.
  breakDuration: z.coerce.number().min(0).max(12).default(0),
  status: z.enum(SHIFT_STATUSES).default('confirmed'),
  notes: z.string().trim().max(500).optional(),
};

export const createShiftSchema = z.object(shiftFields).strict();

export const bulkCreateShiftSchema = z
  .object({
    shifts: z.array(z.object(shiftFields).strict()).min(1).max(200),
  })
  .strict();

export const updateShiftSchema = z
  .object({
    date: dateOnlyField.optional(),
    startTime: timeField.optional(),
    endTime: timeField.optional(),
    breakDuration: z.coerce.number().min(0).max(12).optional(),
    status: z.enum(SHIFT_STATUSES).optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: 'Tidak ada field yang diubah' });

export const listShiftQuerySchema = z.object({
  ...paginationFields,
  employeeId: ulidField.optional(),
  departmentId: ulidField.optional(),
  status: z.enum(SHIFT_STATUSES).optional(),
  startDate: dateOnlyField.optional(),
  endDate: dateOnlyField.optional(),
});

export type CreateShiftInput = z.infer<typeof createShiftSchema>;
export type BulkCreateShiftInput = z.infer<typeof bulkCreateShiftSchema>;
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;
export type ListShiftQuery = z.infer<typeof listShiftQuerySchema>;
