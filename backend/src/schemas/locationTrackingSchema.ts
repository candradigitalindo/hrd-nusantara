// src/schemas/locationTrackingSchema.ts
import { z } from 'zod';
import { dateOnlyField, latitudeField, longitudeField } from './common';

export const TRACKING_MODES = ['always', 'while_working'] as const;
export const TRACKING_PERMISSIONS = ['granted_always', 'granted_while_in_use', 'denied', 'denied_forever', 'service_off'] as const;

/** Diatur Super Admin: kapan dan seberapa sering ponsel mengirim lokasi, dan berapa lama disimpan. */
export const trackingSettingsSchema = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(TRACKING_MODES),
    intervalMinutes: z.coerce.number().int().min(1, 'Minimal 1 menit').max(240, 'Maksimal 240 menit'),
    retentionDays: z.coerce.number().int().min(1, 'Minimal 1 hari').max(365, 'Maksimal 365 hari'),
  })
  .strict();

/** Titik lokasi dari ponsel; dikirim berkelompok, termasuk yang menumpuk saat offline. */
export const locationPingsSchema = z
  .object({
    pings: z
      .array(
        z
          .object({
            latitude: latitudeField,
            longitude: longitudeField,
            accuracyMeters: z.number().min(0).max(100_000).nullable().optional(),
            recordedAt: z.iso.datetime({ offset: true }),
            isMocked: z.boolean().optional(),
          })
          .strict()
      )
      .min(1)
      .max(500),
  })
  .strict();

/** Keadaan pemantauan di ponsel: persetujuan karyawan dan izin lokasinya. */
export const trackingStatusSchema = z
  .object({
    consent: z.boolean(),
    permission: z.enum(TRACKING_PERMISSIONS).optional(),
    platform: z.enum(['android', 'ios']).optional(),
    appVersion: z.string().trim().max(40).optional(),
  })
  .strict();

export const trailQuerySchema = z.object({ date: dateOnlyField }).strict();

export type TrackingSettingsInput = z.infer<typeof trackingSettingsSchema>;
export type LocationPingsInput = z.infer<typeof locationPingsSchema>;
export type TrackingStatusInput = z.infer<typeof trackingStatusSchema>;
export type TrailQuery = z.infer<typeof trailQuerySchema>;
