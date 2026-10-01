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

/** Kiriman mandiri dari aplikasi: hanya foto — pemiliknya selalu si pengirim. */
export const kirimWajahSendiriSchema = z.object({ image: base64ImageField }).strict();

export const listWajahMenungguQuerySchema = z.object(paginationFields);

export const setujuiWajahSchema = z
  .object({
    // Sama seperti pendaftaran oleh HR: menonaktifkan foto lama, misalnya
    // karena karyawan memperbarui fotonya setelah berganti penampilan.
    replaceExisting: z.boolean().default(false),
  })
  .strict();

export const tolakWajahSchema = z
  .object({
    // Wajib: alasannya dikirim ke karyawan, supaya ia tahu apa yang harus
    // diperbaiki pada kiriman berikutnya.
    reason: z
      .string()
      .trim()
      .min(3, 'Alasan penolakan minimal 3 karakter')
      .max(300, 'Alasan penolakan maksimal 300 karakter'),
  })
  .strict();

export type EnrollFaceInput = z.infer<typeof enrollFaceSchema>;
export type ListFaceEnrollmentQuery = z.infer<typeof listFaceEnrollmentQuerySchema>;
export type KirimWajahSendiriInput = z.infer<typeof kirimWajahSendiriSchema>;
export type ListWajahMenungguQuery = z.infer<typeof listWajahMenungguQuerySchema>;
export type SetujuiWajahInput = z.infer<typeof setujuiWajahSchema>;
export type TolakWajahInput = z.infer<typeof tolakWajahSchema>;
