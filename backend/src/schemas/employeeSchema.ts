// src/schemas/employeeSchema.ts
import { z } from 'zod';
import { Role } from '@prisma/client';
import { dateField, ulidField, paginationFields } from './common';

/** Status kepegawaian sesuai hrd_features_doc.md bagian 1. */
export const EMPLOYEE_STATUSES = [
  'active',
  'probation',
  'contract',
  'internship',
  'on_leave',
  'inactive',
  'resign',
  'terminated',
] as const;

const ROLES = Object.values(Role) as [Role, ...Role[]];

/**
 * `.strict()` membuat field yang tidak dikenal DITOLAK, bukan diam-diam dibuang.
 * Pilihan ini disengaja: kalau frontend mengirim field yang tidak ada di sini,
 * lebih baik ketahuan sebagai 400 daripada datanya hilang tanpa jejak.
 */
export const createEmployeeSchema = z
  .object({
    nik: z.string().trim().min(1, 'NIK wajib diisi').max(32),
    name: z.string().trim().min(1, 'Nama wajib diisi').max(150),
    email: z.email('Format email tidak valid').toLowerCase(),
    phoneNumber: z.string().trim().max(32).optional(),
    address: z.string().trim().max(500).optional(),
    dateOfBirth: dateField.optional(),
    status: z.enum(EMPLOYEE_STATUSES).default('active'),
    role: z.enum(ROLES).default(Role.EMPLOYEE),
    departmentId: ulidField.optional(),
    positionId: ulidField.optional(),
    password: z.string().min(8, 'Password minimal 8 karakter').max(128).optional(),
  })
  .strict();

export const updateEmployeeSchema = z
  .object({
    nik: z.string().trim().min(1).max(32).optional(),
    name: z.string().trim().min(1).max(150).optional(),
    email: z.email('Format email tidak valid').toLowerCase().optional(),
    phoneNumber: z.string().trim().max(32).nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    dateOfBirth: dateField.nullable().optional(),
    status: z.enum(EMPLOYEE_STATUSES).optional(),
    role: z.enum(ROLES).optional(),
    // null = lepaskan dari departemen/posisi. Versi lama menerjemahkan ini
    // menjadi connect:{id:null} yang selalu error.
    departmentId: ulidField.nullable().optional(),
    positionId: ulidField.nullable().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Tidak ada field yang diubah',
  });

export const listEmployeeQuerySchema = z.object({
  ...paginationFields,
  search: z.string().trim().min(1).max(100).optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  departmentId: ulidField.optional(),
  // Default-nya karyawan resign/terminated disembunyikan dari daftar.
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export const employeeIdParamSchema = z.object({ id: ulidField });

export const deactivateEmployeeSchema = z
  .object({
    status: z.enum(['resign', 'terminated', 'inactive']).default('resign'),
    /// Alasan berhenti. Inti dari analisis perputaran karyawan bukan berapa
    /// banyak yang keluar, melainkan mengapa.
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type ListEmployeeQuery = z.infer<typeof listEmployeeQuerySchema>;
export type DeactivateEmployeeInput = z.infer<typeof deactivateEmployeeSchema>;

/** Direktori ringkas untuk memilih rekan (chat, umpan balik): nama & unit saja. */
export const directoryQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
});
export type DirectoryQuery = z.infer<typeof directoryQuerySchema>;
