// src/schemas/common.ts
import { z } from 'zod';

export const ulidField = z.string().length(26, 'ID harus berupa ULID (26 karakter)');

/** Menerima ISO 8601 (tanggal atau tanggal+jam) dan mengubahnya menjadi Date. */
export const dateField = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Format tanggal tidak valid (pakai ISO 8601)')
  .transform((value) => new Date(value));

/**
 * Tanggal kalender murni (YYYY-MM-DD), disimpan sebagai tengah malam UTC.
 * Dipakai untuk tanggal shift, yang jam-nya ditentukan terpisah lewat "HH:mm".
 */
export const dateOnlyField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Tanggal tidak valid')
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

export const timeField = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Format jam harus HH:mm (24 jam)');

export const latitudeField = z.coerce.number().min(-90).max(90);
export const longitudeField = z.coerce.number().min(-180).max(180);

export const paginationFields = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};

export const idParamSchema = z.object({ id: ulidField });
