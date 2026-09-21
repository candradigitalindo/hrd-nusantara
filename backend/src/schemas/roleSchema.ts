// src/schemas/roleSchema.ts
import { z } from 'zod';
import { Role } from '@prisma/client';
import { KUNCI_IZIN } from '../utils/permissions';
import { ulidField } from './common';

const ROLES = Object.values(Role) as [Role, ...Role[]];

/** Daftar izin: hanya kunci yang ada di katalog, tanpa duplikat. */
const daftarIzin = z
  .array(z.enum(KUNCI_IZIN as [string, ...string[]], { message: 'Izin tidak dikenal' }))
  .max(KUNCI_IZIN.length)
  .transform((izin) => [...new Set(izin)]);

export const createRoleSchema = z
  .object({
    name: z.string().trim().min(2, 'Nama peran minimal 2 karakter').max(60),
    description: z.string().trim().max(300).optional(),
    baseRole: z.enum(ROLES),
    permissions: daftarIzin.default([]),
  })
  .strict();

export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(2, 'Nama peran minimal 2 karakter').max(60).optional(),
    description: z.string().trim().max(300).nullable().optional(),
    baseRole: z.enum(ROLES).optional(),
    permissions: daftarIzin.optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: 'Tidak ada field yang diubah' });

export const roleIdParamSchema = z.object({ id: ulidField });

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
