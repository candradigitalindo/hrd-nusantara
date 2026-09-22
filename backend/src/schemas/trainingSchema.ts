// src/schemas/trainingSchema.ts
import { z } from 'zod';
import { ulidField, dateField, dateOnlyField, paginationFields } from './common';
import { REGISTRATION_STATUSES } from '../utils/trainingRules';

export const SESSION_STATUSES = ['scheduled', 'ongoing', 'completed', 'cancelled'] as const;

const uang = z.coerce.number().min(0).max(1_000_000_000_000);
const nilai = z.coerce.number().min(0).max(100);

// --- Program ---

export const createProgramSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[A-Z0-9_]+$/, 'Kode hanya boleh huruf kapital, angka, dan garis bawah'),
    name: z.string().trim().min(1).max(150),
    description: z.string().trim().max(2000).optional(),
    category: z.string().trim().max(60).optional(),
    isMandatory: z.boolean().default(false),
    targetPositionId: ulidField.nullable().optional(),
    targetDepartmentId: ulidField.nullable().optional(),
    passingScore: nilai.nullable().optional(),
    validityMonths: z.coerce.number().int().min(1).max(600).nullable().optional(),
    durationHours: z.coerce.number().min(0.5).max(1000).nullable().optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    // Program wajib yang menyasar semua orang sekaligus hampir selalu keliru:
    // pelatihan Hygiene untuk staf dapur tidak relevan bagi bagian keuangan.
    // Bukan kesalahan fatal, jadi hanya dicegah bila keduanya diisi sekaligus.
    if (d.targetPositionId && d.targetDepartmentId) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetDepartmentId'],
        message: 'Pilih salah satu sasaran: jabatan atau departemen, tidak keduanya',
      });
    }
  });

export const updateProgramSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    category: z.string().trim().max(60).nullable().optional(),
    isMandatory: z.boolean().optional(),
    passingScore: nilai.nullable().optional(),
    validityMonths: z.coerce.number().int().min(1).max(600).nullable().optional(),
    durationHours: z.coerce.number().min(0.5).max(1000).nullable().optional(),
    // null = lepaskan sasaran. Formulir sunting mengirim keduanya, jadi harus
    // diterima di sini; sebelumnya .strict() menolak seluruh permintaan.
    targetPositionId: ulidField.nullable().optional(),
    targetDepartmentId: ulidField.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Tidak ada field yang diubah' })
  .superRefine((d, ctx) => {
    if (d.targetPositionId && d.targetDepartmentId) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetDepartmentId'],
        message: 'Pilih salah satu sasaran: jabatan atau departemen, tidak keduanya',
      });
    }
  });

export const listProgramQuerySchema = z.object({
  ...paginationFields,
  category: z.string().trim().max(60).optional(),
  isMandatory: z.enum(['true', 'false']).optional().transform((v) => (v ? v === 'true' : undefined)),
  includeInactive: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

// --- Sesi ---

export const createSessionSchema = z
  .object({
    programId: ulidField,
    title: z.string().trim().min(1).max(150),
    description: z.string().trim().max(2000).optional(),
    trainer: z.string().trim().min(1).max(150),
    startDateTime: dateField,
    endDateTime: dateField,
    location: z.string().trim().max(200).optional(),
    maxParticipants: z.coerce.number().int().min(1).max(10_000).nullable().optional(),
    registrationDeadline: dateField.nullable().optional(),
    cost: uang.nullable().optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.endDateTime.getTime() <= d.startDateTime.getTime()) {
      ctx.addIssue({
        code: 'custom',
        path: ['endDateTime'],
        message: 'Waktu selesai harus setelah waktu mulai',
      });
    }
    if (d.registrationDeadline && d.registrationDeadline.getTime() > d.startDateTime.getTime()) {
      ctx.addIssue({
        code: 'custom',
        path: ['registrationDeadline'],
        message: 'Batas pendaftaran tidak boleh setelah pelatihan dimulai',
      });
    }
  });

export const changeSessionStatusSchema = z
  .object({
    status: z.enum(['ongoing', 'completed', 'cancelled']),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const listSessionQuerySchema = z.object({
  ...paginationFields,
  programId: ulidField.optional(),
  status: z.enum(SESSION_STATUSES).optional(),
  startDate: dateOnlyField.optional(),
  endDate: dateOnlyField.optional(),
});

// --- Pendaftaran & evaluasi ---

export const registerSchema = z
  .object({
    /// Kosong berarti mendaftarkan diri sendiri.
    employeeId: ulidField.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const recordAttendanceSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            registrationId: ulidField,
            attended: z.boolean(),
          })
          .strict()
      )
      .min(1)
      .max(500),
  })
  .strict();

export const evaluateSchema = z
  .object({
    score: nilai.nullable().optional(),
    certificateUrl: z.url('certificateUrl harus berupa URL').max(500).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

export const listRegistrationQuerySchema = z.object({
  ...paginationFields,
  employeeId: ulidField.optional(),
  trainingSessionId: ulidField.optional(),
  status: z.enum(REGISTRATION_STATUSES).optional(),
});

export const complianceQuerySchema = z.object({
  programId: ulidField.optional(),
  departmentId: ulidField.optional(),
  warningDays: z.coerce.number().int().min(1).max(365).default(30),
});

export type CreateProgramInput = z.infer<typeof createProgramSchema>;
export type UpdateProgramInput = z.infer<typeof updateProgramSchema>;
export type ListProgramQuery = z.infer<typeof listProgramQuerySchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type ChangeSessionStatusInput = z.infer<typeof changeSessionStatusSchema>;
export type ListSessionQuery = z.infer<typeof listSessionQuerySchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type RecordAttendanceInput = z.infer<typeof recordAttendanceSchema>;
export type EvaluateInput = z.infer<typeof evaluateSchema>;
export type ListRegistrationQuery = z.infer<typeof listRegistrationQuerySchema>;
export type ComplianceQuery = z.infer<typeof complianceQuerySchema>;
