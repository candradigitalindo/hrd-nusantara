// src/schemas/authSchema.ts
import { z } from 'zod';

/**
 * Username = nomor HP/WhatsApp (08xx, +62xx, 62xx) — sesuai kebijakan
 * perusahaan. Email tetap diterima: akun admin awal dan akun lama mungkin
 * belum punya nomor. `email` dipertahankan sebagai nama field lama.
 */
export const loginSchema = z
  .object({
    username: z.string().trim().min(3, 'Nomor HP atau email wajib diisi').max(150).optional(),
    // Field lama: bila dipakai, isinya memang harus email.
    email: z.email('Format email tidak valid').toLowerCase().optional(),
    password: z.string().min(1, 'Password wajib diisi'),
  })
  .strict()
  .refine((d) => Boolean(d.username || d.email), {
    message: 'Nomor HP/WhatsApp atau email wajib diisi',
    path: ['username'],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Password saat ini wajib diisi'),
    newPassword: z.string().min(8, 'Password baru minimal 8 karakter').max(128),
  })
  .strict()
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'Password baru harus berbeda dari password lama',
    path: ['newPassword'],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
