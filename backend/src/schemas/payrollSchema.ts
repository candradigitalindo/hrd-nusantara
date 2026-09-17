// src/schemas/payrollSchema.ts
import { z } from 'zod';
import { ulidField, dateOnlyField, paginationFields } from './common';

export const SALARY_TYPES = ['monthly', 'daily', 'hourly'] as const;
export const COMPONENT_TYPES = ['allowance', 'deduction'] as const;
export const CALCULATION_METHODS = ['fixed', 'percentage'] as const;
export const PERCENTAGE_BASES = ['basic', 'gross'] as const;
export const PAYROLL_RUN_STATUSES = ['draft', 'calculated', 'approved', 'paid', 'cancelled'] as const;

const uang = z.coerce.number().min(0).max(1_000_000_000_000);
const persen = z.coerce.number().min(0).max(100);

// --- Komponen gaji ---

export const createSalaryComponentSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[A-Z0-9_]+$/, 'Kode hanya boleh huruf kapital, angka, dan garis bawah'),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
    type: z.enum(COMPONENT_TYPES),
    calculation: z.enum(CALCULATION_METHODS),
    percentageBase: z.enum(PERCENTAGE_BASES).nullable().optional(),
    defaultAmount: uang.nullable().optional(),
    defaultPercentage: persen.nullable().optional(),
    capAmount: uang.nullable().optional(),
    isTaxable: z.boolean().default(true),
    isStatutory: z.boolean().default(false),
  })
  .strict()
  .superRefine((d, ctx) => {
    // Komponen persentase tanpa angka persen akan diam-diam menghasilkan nol,
    // dan itu baru ketahuan saat slip gaji keluar salah.
    if (d.calculation === 'percentage') {
      if (d.defaultPercentage == null) {
        ctx.addIssue({
          code: 'custom',
          path: ['defaultPercentage'],
          message: 'Komponen persentase membutuhkan defaultPercentage',
        });
      }
      if (!d.percentageBase) {
        ctx.addIssue({
          code: 'custom',
          path: ['percentageBase'],
          message: 'Komponen persentase membutuhkan percentageBase (basic atau gross)',
        });
      }
    }
    if (d.calculation === 'fixed' && d.defaultAmount == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['defaultAmount'],
        message: 'Komponen nominal tetap membutuhkan defaultAmount',
      });
    }
  });

export const updateSalaryComponentSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    defaultAmount: uang.nullable().optional(),
    defaultPercentage: persen.nullable().optional(),
    capAmount: uang.nullable().optional(),
    isTaxable: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Tidak ada field yang diubah' });

export const listSalaryComponentQuerySchema = z.object({
  ...paginationFields,
  type: z.enum(COMPONENT_TYPES).optional(),
  includeInactive: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

// --- Struktur gaji karyawan ---

export const setEmployeeSalarySchema = z
  .object({
    salaryType: z.enum(SALARY_TYPES),
    baseAmount: uang,
    effectiveFrom: dateOnlyField,
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const assignComponentSchema = z
  .object({
    componentId: ulidField,
    amount: uang.nullable().optional(),
    percentage: persen.nullable().optional(),
    effectiveFrom: dateOnlyField,
    effectiveTo: dateOnlyField.nullable().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

// --- Batch penggajian ---

export const createPayrollRunSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(4)
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/, 'Kode hanya boleh huruf, angka, garis bawah, dan strip'),
    name: z.string().trim().min(1).max(150),
    periodStart: dateOnlyField,
    periodEnd: dateOnlyField,
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((d) => d.periodEnd.getTime() >= d.periodStart.getTime(), {
    message: 'periodEnd tidak boleh lebih awal dari periodStart',
    path: ['periodEnd'],
  });

export const calculatePayrollRunSchema = z
  .object({
    /** Kosong berarti seluruh karyawan aktif. */
    employeeIds: z.array(ulidField).max(1000).optional(),
    departmentId: ulidField.optional(),
  })
  .strict();

export const decidePayrollRunSchema = z
  .object({
    approved: z.boolean(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const listPayrollRunQuerySchema = z.object({
  ...paginationFields,
  status: z.enum(PAYROLL_RUN_STATUSES).optional(),
});

export const listPayrollQuerySchema = z.object({
  ...paginationFields,
  employeeId: ulidField.optional(),
  departmentId: ulidField.optional(),
  payrollRunId: ulidField.optional(),
});

export type CreateSalaryComponentInput = z.infer<typeof createSalaryComponentSchema>;
export type UpdateSalaryComponentInput = z.infer<typeof updateSalaryComponentSchema>;
export type ListSalaryComponentQuery = z.infer<typeof listSalaryComponentQuerySchema>;
export type SetEmployeeSalaryInput = z.infer<typeof setEmployeeSalarySchema>;
export type AssignComponentInput = z.infer<typeof assignComponentSchema>;
export type CreatePayrollRunInput = z.infer<typeof createPayrollRunSchema>;
export type CalculatePayrollRunInput = z.infer<typeof calculatePayrollRunSchema>;
export type DecidePayrollRunInput = z.infer<typeof decidePayrollRunSchema>;
export type ListPayrollRunQuery = z.infer<typeof listPayrollRunQuerySchema>;
export type ListPayrollQuery = z.infer<typeof listPayrollQuerySchema>;
