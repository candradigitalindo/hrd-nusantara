// src/schemas/organizationSchema.ts
import { z } from 'zod';
import { ulidField, paginationFields } from './common';

const nama = z.string().trim().min(2).max(100);
const deskripsi = z.string().trim().max(500);

// --- Departemen ---

export const createDepartmentSchema = z
  .object({
    name: nama,
    description: deskripsi.optional(),
    workPatternId: ulidField.nullable().optional(),
  })
  .strict();

export const updateDepartmentSchema = z
  .object({
    name: nama.optional(),
    description: deskripsi.nullable().optional(),
    workPatternId: ulidField.nullable().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Tidak ada field yang diubah' });

export const listDepartmentQuerySchema = z.object({
  ...paginationFields,
  search: z.string().trim().min(1).max(100).optional(),
});

// --- Jabatan ---

export const createPositionSchema = z
  .object({
    name: nama,
    description: deskripsi.optional(),
    departmentId: ulidField.nullable().optional(),
  })
  .strict();

export const updatePositionSchema = z
  .object({
    name: nama.optional(),
    description: deskripsi.nullable().optional(),
    departmentId: ulidField.nullable().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Tidak ada field yang diubah' });

export const listPositionQuerySchema = z.object({
  ...paginationFields,
  search: z.string().trim().min(1).max(100).optional(),
  departmentId: ulidField.optional(),
});

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
export type ListDepartmentQuery = z.infer<typeof listDepartmentQuerySchema>;
export type CreatePositionInput = z.infer<typeof createPositionSchema>;
export type UpdatePositionInput = z.infer<typeof updatePositionSchema>;
export type ListPositionQuery = z.infer<typeof listPositionQuerySchema>;
