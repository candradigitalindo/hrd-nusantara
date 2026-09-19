// src/schemas/documentSchema.ts
import { z } from 'zod';
import { ulidField, dateOnlyField, paginationFields } from './common';

export const DOCUMENT_TYPES = [
  'cv',
  'surat_lamaran',
  'ktp',
  'skck',
  'ijazah',
  'sertifikat',
  'kontrak_kerja',
  'npwp',
  'bpjs_kesehatan',
  'bpjs_ketenagakerjaan',
  'lainnya',
] as const;

/// Base64 murni atau data URI. Ukuran sebenarnya diperiksa setelah didekode;
/// batas panjang string di sini hanya menahan muatan yang jelas-jelas absurd.
const berkasField = z.string().min(44).max(10_000_000);

export const uploadDocumentSchema = z
  .object({
    type: z.enum(DOCUMENT_TYPES),
    title: z.string().trim().min(2).max(150),
    /// Nama asli dari pengunggah, untuk ditampilkan.
    fileName: z.string().trim().min(1).max(255),
    file: berkasField,
    issuedAt: dateOnlyField.optional(),
    expiresAt: dateOnlyField.optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((d) => !d.issuedAt || !d.expiresAt || d.expiresAt > d.issuedAt, {
    message: 'Tanggal kedaluwarsa harus setelah tanggal terbit',
    path: ['expiresAt'],
  });

export const updateDocumentSchema = z
  .object({
    type: z.enum(DOCUMENT_TYPES).optional(),
    title: z.string().trim().min(2).max(150).optional(),
    issuedAt: dateOnlyField.nullable().optional(),
    expiresAt: dateOnlyField.nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Tidak ada field yang diubah' });

export const listDocumentQuerySchema = z.object({
  type: z.enum(DOCUMENT_TYPES).optional(),
  /// HR bisa melihat yang sudah dihapus untuk keperluan audit.
  includeDeleted: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

export const expiringDocumentQuerySchema = z.object({
  ...paginationFields,
  /// Kedaluwarsa dalam N hari ke depan (termasuk yang sudah lewat).
  days: z.coerce.number().int().min(1).max(365).default(30),
  type: z.enum(DOCUMENT_TYPES).optional(),
  departmentId: ulidField.optional(),
});

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
export type ListDocumentQuery = z.infer<typeof listDocumentQuerySchema>;
export type ExpiringDocumentQuery = z.infer<typeof expiringDocumentQuerySchema>;
