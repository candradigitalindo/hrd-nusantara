// src/schemas/shiftSchema.ts
import { z } from 'zod';
import { ulidField, dateOnlyField, timeField, paginationFields } from './common';

export const SHIFT_STATUSES = ['confirmed', 'tentative', 'cancelled'] as const;

const shiftFields = {
  employeeId: ulidField,
  date: dateOnlyField,
  startTime: timeField,
  endTime: timeField,
  // Jam istirahat. Tidak divalidasi terhadap durasi shift di sini karena
  // panjang shift baru diketahui setelah jam mulai/selesai diurai —
  // pengecekannya ada di controller.
  breakDuration: z.coerce.number().min(0).max(12).default(0),
  status: z.enum(SHIFT_STATUSES).default('confirmed'),
  notes: z.string().trim().max(500).optional(),
};

/**
 * Satu shift. Dengan templateId, jam dan istirahat diambil dari jenis
 * shift-nya kecuali dikirim eksplisit — klien lama yang selalu mengirim jam
 * tetap diterima apa adanya.
 */
export const createShiftSchema = z
  .object({
    ...shiftFields,
    templateId: ulidField.optional(),
    startTime: timeField.optional(),
    endTime: timeField.optional(),
    // Tanpa default di sini: "tidak dikirim" harus bisa dibedakan dari 0
    // supaya istirahat jenis shift tidak tertimpa nol.
    breakDuration: z.coerce.number().min(0).max(12).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.templateId) return;
    if (!data.startTime) ctx.addIssue({ code: 'custom', path: ['startTime'], message: 'Jam mulai wajib diisi' });
    if (!data.endTime) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Jam selesai wajib diisi' });
  });

export const bulkCreateShiftSchema = z
  .object({
    shifts: z.array(z.object(shiftFields).strict()).min(1).max(200),
  })
  .strict();

export const updateShiftSchema = z
  .object({
    date: dateOnlyField.optional(),
    startTime: timeField.optional(),
    endTime: timeField.optional(),
    breakDuration: z.coerce.number().min(0).max(12).optional(),
    status: z.enum(SHIFT_STATUSES).optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: 'Tidak ada field yang diubah' });

export const listShiftQuerySchema = z.object({
  ...paginationFields,
  employeeId: ulidField.optional(),
  departmentId: ulidField.optional(),
  status: z.enum(SHIFT_STATUSES).optional(),
  startDate: dateOnlyField.optional(),
  endDate: dateOnlyField.optional(),
});

/**
 * Rekap libur per bulan. Bulan dipakai, bukan rentang bebas, karena aturan
 * yang diperiksa — satu hari libur tiap pekan — hanya bermakna pada periode
 * yang utuh.
 */
export const shiftRecapQuerySchema = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Format bulan harus YYYY-MM'),
    departmentId: ulidField.optional(),
  })
  .strict();

// ============ Jenis shift ============

/**
 * Kunci palet, bukan kode warna bebas: web dan mobile memetakan tiap kunci ke
 * pasangan warna terang/gelap yang sudah diuji keterbacaannya.
 */
export const WARNA_JENIS_SHIFT = ['teal', 'blue', 'amber', 'violet', 'rose', 'slate', 'green', 'orange'] as const;

const templateFields = {
  name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(40, 'Nama maksimal 40 karakter'),
  code: z.string().trim().min(1).max(4, 'Kode maksimal 4 karakter'),
  startTime: timeField,
  endTime: timeField,
  breakDuration: z.coerce.number().min(0).max(12),
  color: z.enum(WARNA_JENIS_SHIFT),
  departmentId: ulidField,
};

export const createShiftTemplateSchema = z
  .object({
    ...templateFields,
    code: templateFields.code.optional(),
    breakDuration: templateFields.breakDuration.default(0),
    color: templateFields.color.optional(),
    departmentId: templateFields.departmentId.optional(),
  })
  .strict();

export const updateShiftTemplateSchema = z
  .object({
    name: templateFields.name.optional(),
    // null = hapus kode / jadikan jenis shift untuk semua departemen.
    code: templateFields.code.nullable().optional(),
    startTime: timeField.optional(),
    endTime: timeField.optional(),
    breakDuration: templateFields.breakDuration.optional(),
    color: templateFields.color.optional(),
    departmentId: ulidField.nullable().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: 'Tidak ada field yang diubah' });

const boolQuery = (bawaan: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(bawaan)
    .transform((v) => v === 'true');

export const listShiftTemplateQuerySchema = z
  .object({ includeInactive: boolQuery('false') })
  .strict();

// ============ Penugasan shift ============

export const DURASI_PENUGASAN = ['hari', 'minggu', 'bulan', 'seterusnya', 'sampai'] as const;

/** Rentang terpanjang untuk durasi "sampai"; lebih dari itu pakai "seterusnya". */
export const MAKS_HARI_PENUGASAN = 366;

const SEHARI_MS = 24 * 60 * 60 * 1000;

export const createAssignmentSchema = z
  .object({
    employeeIds: z
      .array(ulidField)
      .min(1, 'Pilih minimal satu karyawan')
      .max(100, 'Maksimal 100 karyawan sekali tetapkan')
      .refine((ids) => new Set(ids).size === ids.length, 'Karyawan tidak boleh dipilih dua kali'),
    templateId: ulidField.optional(),
    // Jam kustom tanpa jenis shift — hanya untuk durasi 1 hari.
    startTime: timeField.optional(),
    endTime: timeField.optional(),
    breakDuration: z.coerce.number().min(0).max(12).optional(),
    startDate: dateOnlyField,
    durasi: z.enum(DURASI_PENUGASAN),
    // Hanya dibaca untuk durasi "sampai"; durasi lain menghitung sendiri
    // tanggal akhirnya, jadi nilai sisa dari formulir diabaikan.
    endDate: dateOnlyField.optional(),
    weekdays: z
      .array(z.number().int().min(0).max(6))
      .max(7)
      .transform((hari) => [...new Set(hari)].sort((a, b) => a - b))
      .optional(),
    skipPublicHolidays: z.boolean().default(false),
    replaceExisting: z.boolean().default(false),
    status: z.enum(['confirmed', 'tentative']).default('confirmed'),
    notes: z.string().trim().max(500).optional(),
    preview: z.boolean().default(false),
  })
  .strict()
  .superRefine((data, ctx) => {
    const jamKustom = data.startTime !== undefined || data.endTime !== undefined || data.breakDuration !== undefined;

    if (data.durasi === 'hari') {
      if (data.templateId && jamKustom) {
        ctx.addIssue({ code: 'custom', path: ['startTime'], message: 'Pilih jenis shift atau jam kustom, bukan keduanya' });
      }
      if (!data.templateId && (!data.startTime || !data.endTime)) {
        ctx.addIssue({ code: 'custom', path: ['templateId'], message: 'Pilih jenis shift atau isi jam mulai dan selesai' });
      }
      return;
    }

    if (!data.templateId) {
      ctx.addIssue({ code: 'custom', path: ['templateId'], message: 'Pilih jenis shift — jam kustom hanya untuk 1 hari' });
    }
    if (jamKustom) {
      ctx.addIssue({ code: 'custom', path: ['startTime'], message: 'Jam kustom hanya untuk durasi 1 hari' });
    }
    if (!data.weekdays || data.weekdays.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'Pilih minimal satu hari' });
    }
    if (data.durasi === 'sampai') {
      if (!data.endDate) {
        ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Tanggal akhir wajib diisi' });
      } else if (data.endDate.getTime() < data.startDate.getTime()) {
        ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Tanggal akhir tidak boleh sebelum tanggal mulai' });
      } else if (data.endDate.getTime() - data.startDate.getTime() > MAKS_HARI_PENUGASAN * SEHARI_MS) {
        ctx.addIssue({
          code: 'custom',
          path: ['endDate'],
          message: `Rentang maksimal ${MAKS_HARI_PENUGASAN} hari; untuk lebih lama pilih "Seterusnya"`,
        });
      }
    }
  });

export const endAssignmentSchema = z.object({ endDate: dateOnlyField }).strict();

export const listAssignmentQuerySchema = z
  .object({
    ...paginationFields,
    employeeId: ulidField.optional(),
    departmentId: ulidField.optional(),
    active: boolQuery('true'),
  })
  .strict();

export type CreateShiftInput = z.infer<typeof createShiftSchema>;
export type BulkShiftItem = z.infer<typeof bulkCreateShiftSchema>['shifts'][number];
export type CreateShiftTemplateInput = z.infer<typeof createShiftTemplateSchema>;
export type UpdateShiftTemplateInput = z.infer<typeof updateShiftTemplateSchema>;
export type ListShiftTemplateQuery = z.infer<typeof listShiftTemplateQuerySchema>;
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
export type EndAssignmentInput = z.infer<typeof endAssignmentSchema>;
export type ListAssignmentQuery = z.infer<typeof listAssignmentQuerySchema>;
export type BulkCreateShiftInput = z.infer<typeof bulkCreateShiftSchema>;
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;
export type ListShiftQuery = z.infer<typeof listShiftQuerySchema>;
export type ShiftRecapQuery = z.infer<typeof shiftRecapQuerySchema>;
