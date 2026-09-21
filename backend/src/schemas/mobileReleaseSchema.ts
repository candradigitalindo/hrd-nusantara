// src/schemas/mobileReleaseSchema.ts
import { z } from 'zod';
import { paginationFields } from './common';

/** Metadata rilis dikirim lewat query: badan permintaannya adalah berkas APK mentah. */
export const uploadReleaseQuerySchema = z.object({
  versionName: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^\d+\.\d+\.\d+([+-][A-Za-z0-9.]+)?$/, 'Format versi harus mis. 1.2.0 atau 1.2.0+5'),
  versionCode: z.coerce.number().int().min(1).max(2_000_000_000),
  notes: z.string().trim().max(2000).optional(),
});

export const updateReleaseSchema = z
  .object({
    isActive: z.boolean().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Tidak ada field yang diubah' });

export const listReleaseQuerySchema = z.object({ ...paginationFields });

export const qrQuerySchema = z.object({ text: z.string().trim().min(1).max(500) });

export type UploadReleaseQuery = z.infer<typeof uploadReleaseQuerySchema>;
export type UpdateReleaseInput = z.infer<typeof updateReleaseSchema>;
export type ListReleaseQuery = z.infer<typeof listReleaseQuerySchema>;
export type QrQuery = z.infer<typeof qrQuerySchema>;
