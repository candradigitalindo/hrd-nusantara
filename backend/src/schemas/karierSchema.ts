// src/schemas/karierSchema.ts
import { z } from 'zod';
import { ulidField } from './common';

const sandi = z.string().min(8, 'Kata sandi minimal 8 karakter').max(128);
const email = z.string().trim().toLowerCase().email('Format email tidak valid').max(150);
const nama = z.string().trim().min(2, 'Nama minimal 2 karakter').max(150);
const telepon = z.string().trim().max(25).nullable().optional();

/**
 * Umpan perangkap: kolom yang disembunyikan dari manusia lewat CSS. Robot
 * pengisi formulir mengisi semua kolom, jadi kolom yang terisi adalah tanda
 * paling murah bahwa kiriman ini bukan dari orang.
 */
const perangkap = z.string().max(200).optional();

export const daftarPelamarSchema = z
  .object({ name: nama, email, phoneNumber: telepon, password: sandi, situs: perangkap })
  .strict();

export const masukPelamarSchema = z.object({ email, password: z.string().min(1).max(128) }).strict();

export const ubahProfilPelamarSchema = z
  .object({ name: nama.optional(), phoneNumber: telepon })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Tidak ada field yang diubah' });

export const gantiSandiPelamarSchema = z
  .object({ passwordLama: z.string().min(1).max(128), passwordBaru: sandi })
  .strict()
  .refine((d) => d.passwordLama !== d.passwordBaru, {
    path: ['passwordBaru'],
    message: 'Kata sandi baru harus berbeda',
  });

export const lamarSchema = z
  .object({
    jobPostingId: ulidField,
    expectedSalary: z.coerce.number().min(0).max(1_000_000_000).nullable().optional(),
    coverLetter: z.string().trim().max(5000).nullable().optional(),
    /// Berkas CV sebagai data URI base64; server memeriksa jenisnya dari isi berkas.
    cv: z.string().max(8_000_000).nullable().optional(),
    cvFileName: z.string().trim().max(200).nullable().optional(),
    situs: perangkap,
  })
  .strict();

export const unggahCvSchema = z
  .object({ cv: z.string().min(100).max(8_000_000), cvFileName: z.string().trim().min(1).max(200) })
  .strict();

export type DaftarPelamarInput = z.infer<typeof daftarPelamarSchema>;
export type MasukPelamarInput = z.infer<typeof masukPelamarSchema>;
export type UbahProfilPelamarInput = z.infer<typeof ubahProfilPelamarSchema>;
export type GantiSandiPelamarInput = z.infer<typeof gantiSandiPelamarSchema>;
export type LamarInput = z.infer<typeof lamarSchema>;
export type UnggahCvInput = z.infer<typeof unggahCvSchema>;
