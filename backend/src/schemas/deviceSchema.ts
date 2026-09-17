// src/schemas/deviceSchema.ts
import { z } from 'zod';

export const DEVICE_PLATFORMS = ['android', 'ios', 'web'] as const;

/// Token FCM panjangnya ratusan karakter dan tidak berpola tetap, jadi yang
/// diperiksa hanya batas atas yang masuk akal.
const tokenField = z.string().trim().min(20).max(4096);

export const registerDeviceSchema = z
  .object({
    token: tokenField,
    platform: z.enum(DEVICE_PLATFORMS),
  })
  .strict();

export const unregisterDeviceSchema = z.object({ token: tokenField }).strict();

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
export type UnregisterDeviceInput = z.infer<typeof unregisterDeviceSchema>;
