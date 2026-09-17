// src/schemas/workLocationSchema.ts
import { z } from 'zod';
import { latitudeField, longitudeField, paginationFields } from './common';

export const createWorkLocationSchema = z
  .object({
    name: z.string().trim().min(1, 'Nama lokasi wajib diisi').max(150),
    address: z.string().trim().max(500).optional(),
    latitude: latitudeField,
    longitude: longitudeField,
    // 25 meter adalah batas bawah yang wajar: akurasi GPS ponsel di dalam
    // bangunan sering meleset belasan meter, radius terlalu kecil akan
    // menolak karyawan yang sebenarnya sudah di lokasi.
    radiusMeters: z.coerce.number().int().min(25).max(5_000).default(100),
  })
  .strict();

export const updateWorkLocationSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    address: z.string().trim().max(500).nullable().optional(),
    latitude: latitudeField.optional(),
    longitude: longitudeField.optional(),
    radiusMeters: z.coerce.number().int().min(25).max(5_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: 'Tidak ada field yang diubah' });

export const listWorkLocationQuerySchema = z.object({
  ...paginationFields,
  search: z.string().trim().min(1).max(100).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type CreateWorkLocationInput = z.infer<typeof createWorkLocationSchema>;
export type UpdateWorkLocationInput = z.infer<typeof updateWorkLocationSchema>;
export type ListWorkLocationQuery = z.infer<typeof listWorkLocationQuerySchema>;
