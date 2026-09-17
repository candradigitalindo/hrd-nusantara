// src/schemas/faceSchema.ts
import { z } from 'zod';
import { paginationFields } from './common';

/**
 * Gambar dikirim sebagai base64 di dalam body JSON, bukan sebagai URL.
 *
 * Kalau server disuruh mengambil URL kiriman klien, ia bisa dipancing
 * menembak alamat internal (SSRF), dan fotonya harus singgah di penyimpanan
 * pihak lain dulu. Base64 membuat foto langsung sampai ke server sendiri.
 */
export const base64ImageField = z
  .string()
  .min(100, 'Data gambar terlalu pendek')
  // Batas longgar; ukuran sebenarnya diperiksa setelah di-decode.
  .max(20_000_000, 'Data gambar terlalu besar');

export const enrollFaceSchema = z
  .object({
    image: base64ImageField,
    // Menonaktifkan pendaftaran lama, misalnya setelah karyawan berganti
    // penampilan secara mencolok.
    replaceExisting: z.boolean().default(false),
  })
  .strict();

export const listFaceEnrollmentQuerySchema = z.object({
  ...paginationFields,
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type EnrollFaceInput = z.infer<typeof enrollFaceSchema>;
export type ListFaceEnrollmentQuery = z.infer<typeof listFaceEnrollmentQuerySchema>;
