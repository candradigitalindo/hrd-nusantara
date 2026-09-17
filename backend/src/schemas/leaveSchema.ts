// src/schemas/leaveSchema.ts
import { z } from 'zod';
import { ulidField, dateOnlyField, paginationFields } from './common';

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export const GENDERS = ['female', 'male'] as const;

// --- Jenis cuti ---

export const createLeaveTypeSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[a-z0-9_]+$/, 'Kode hanya boleh huruf kecil, angka, dan garis bawah'),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
    defaultQuotaDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
    isPaid: z.boolean().default(true),
    deductsBalance: z.boolean().default(true),
    requiresAttachment: z.boolean().default(false),
    maxConsecutiveDays: z.coerce.number().int().min(1).max(365).nullable().optional(),
    genderRestriction: z.enum(GENDERS).nullable().optional(),
    countsCalendarDays: z.boolean().default(false),
  })
  .strict();

export const updateLeaveTypeSchema = createLeaveTypeSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Tidak ada field yang diubah' });

export const listLeaveTypeQuerySchema = z.object({
  ...paginationFields,
  includeInactive: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

// --- Pola hari kerja ---

export const WORK_PATTERN_TYPES = ['fixed', 'shift'] as const;

const weekdaysField = z
  .array(z.coerce.number().int().min(0).max(6))
  .min(1, 'Minimal satu hari kerja')
  .max(7)
  .refine((v) => new Set(v).size === v.length, 'Ada hari yang disebut dua kali');

export const createWorkPatternSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[a-z0-9_]+$/, 'Kode hanya boleh huruf kecil, angka, dan garis bawah'),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
    type: z.enum(WORK_PATTERN_TYPES),
    /// 0 = Minggu, 6 = Sabtu. Kantor Senin–Sabtu berarti [1,2,3,4,5,6].
    workingWeekdays: weekdaysField,
    observesPublicHolidays: z.boolean().default(true),
    isDefault: z.boolean().default(false),
  })
  .strict();

export const updateWorkPatternSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    type: z.enum(WORK_PATTERN_TYPES).optional(),
    workingWeekdays: weekdaysField.optional(),
    observesPublicHolidays: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Tidak ada field yang diubah' });

export const listWorkPatternQuerySchema = z.object({
  ...paginationFields,
  includeInactive: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

export const assignWorkPatternSchema = z
  .object({ workPatternId: ulidField.nullable() })
  .strict();

// --- Hari libur ---

const holidayFields = {
  date: dateOnlyField,
  name: z.string().trim().min(1).max(150),
  isCollectiveLeave: z.boolean().default(false),
};

export const createHolidaySchema = z.object(holidayFields).strict();

export const bulkCreateHolidaySchema = z
  .object({ holidays: z.array(z.object(holidayFields).strict()).min(1).max(100) })
  .strict();

export const listHolidayQuerySchema = z.object({
  ...paginationFields,
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  startDate: dateOnlyField.optional(),
  endDate: dateOnlyField.optional(),
});

// --- Saldo cuti ---

export const upsertLeaveBalanceSchema = z
  .object({
    employeeId: ulidField,
    leaveTypeId: ulidField,
    year: z.coerce.number().int().min(2000).max(2100),
    entitledDays: z.coerce.number().min(0).max(365),
    carriedOverDays: z.coerce.number().min(0).max(365).default(0),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const listLeaveBalanceQuerySchema = z.object({
  ...paginationFields,
  employeeId: ulidField.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

// --- Pengajuan cuti ---

export const createLeaveSchema = z
  .object({
    leaveTypeId: ulidField,
    startDate: dateOnlyField,
    endDate: dateOnlyField,
    reason: z.string().trim().max(1000).optional(),
    attachmentUrl: z.url('attachmentUrl harus berupa URL').max(500).optional(),
  })
  .strict()
  .refine((d) => d.endDate.getTime() >= d.startDate.getTime(), {
    message: 'Tanggal selesai tidak boleh lebih awal dari tanggal mulai',
    path: ['endDate'],
  });

export const decideLeaveSchema = z
  .object({
    approved: z.boolean(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

export const cancelLeaveSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .strict();

export const listLeaveQuerySchema = z.object({
  ...paginationFields,
  employeeId: ulidField.optional(),
  departmentId: ulidField.optional(),
  leaveTypeId: ulidField.optional(),
  status: z.enum(LEAVE_STATUSES).optional(),
  startDate: dateOnlyField.optional(),
  endDate: dateOnlyField.optional(),
});

/** Kalender cuti untuk perencanaan staffing (hrd_features_doc.md bagian 3). */
export const leaveCalendarQuerySchema = z.object({
  startDate: dateOnlyField,
  endDate: dateOnlyField,
  departmentId: ulidField.optional(),
});

export type CreateLeaveTypeInput = z.infer<typeof createLeaveTypeSchema>;
export type UpdateLeaveTypeInput = z.infer<typeof updateLeaveTypeSchema>;
export type ListLeaveTypeQuery = z.infer<typeof listLeaveTypeQuerySchema>;
export type CreateWorkPatternInput = z.infer<typeof createWorkPatternSchema>;
export type UpdateWorkPatternInput = z.infer<typeof updateWorkPatternSchema>;
export type ListWorkPatternQuery = z.infer<typeof listWorkPatternQuerySchema>;
export type AssignWorkPatternInput = z.infer<typeof assignWorkPatternSchema>;
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;
export type ListHolidayQuery = z.infer<typeof listHolidayQuerySchema>;
export type UpsertLeaveBalanceInput = z.infer<typeof upsertLeaveBalanceSchema>;
export type ListLeaveBalanceQuery = z.infer<typeof listLeaveBalanceQuerySchema>;
export type CreateLeaveInput = z.infer<typeof createLeaveSchema>;
export type DecideLeaveInput = z.infer<typeof decideLeaveSchema>;
export type CancelLeaveInput = z.infer<typeof cancelLeaveSchema>;
export type ListLeaveQuery = z.infer<typeof listLeaveQuerySchema>;
export type LeaveCalendarQuery = z.infer<typeof leaveCalendarQuerySchema>;
