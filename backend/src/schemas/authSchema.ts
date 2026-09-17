// src/schemas/authSchema.ts
import { z } from 'zod';

export const loginSchema = z
  .object({
    email: z.email('Format email tidak valid').toLowerCase(),
    password: z.string().min(1, 'Password wajib diisi'),
  })
  .strict();

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
