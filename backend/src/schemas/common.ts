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
  // Date.parse saja tidak cukup: "2026-02-31" diterimanya lalu digeser diam-
  // diam menjadi 3 Maret. Tanggal dianggap sah hanya bila kembali utuh
  // setelah diurai.
  .refine((value) => {
    const waktu = Date.parse(`${value}T00:00:00.000Z`);
    return !Number.isNaN(waktu) && new Date(waktu).toISOString().slice(0, 10) === value;
  }, 'Tanggal tidak valid')
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
