// src/schemas/disciplineSchema.ts
import { z } from 'zod';
import { ulidField, dateOnlyField, paginationFields } from './common';

export const CASE_TYPES = ['complaint', 'disciplinary_action'] as const;
export const CASE_STATUSES = ['open', 'under_review', 'resolved', 'dismissed'] as const;
/// UU 13/2003 pasal 161: peringatan pertama, kedua, ketiga sebelum PHK.
export const SEVERITIES = ['teguran_lisan', 'sp1', 'sp2', 'sp3'] as const;

const judul = z.string().trim().min(3).max(150);
const uraian = z.string().trim().min(10, 'Uraikan kejadiannya, minimal 10 karakter').max(5000);

/** Keluhan: diajukan siapa pun. Subjeknya boleh diri sendiri (keluhan
 *  soal kondisi kerja) atau karyawan lain (keluhan soal perilaku). */
export const createComplaintSchema = z
  .object({
    employeeId: ulidField.optional(),
    title: judul,
    description: uraian,
    incidentDate: dateOnlyField.optional(),
  })
  .strict();

/** Tindakan disiplin: hanya HR dan manajer, wajib menyebut tingkatnya. */
export const createDisciplinarySchema = z
  .object({
    employeeId: ulidField,
    title: judul,
    description: uraian,
    severity: z.enum(SEVERITIES),
    incidentDate: dateOnlyField.optional(),
  })
  .strict();

export const updateCaseStatusSchema = z
  .object({
    status: z.enum(['under_review', 'resolved', 'dismissed']),
    resolutionNotes: z.string().trim().max(5000).optional(),
  })
  .strict()
  .refine((d) => d.status === 'under_review' || (d.resolutionNotes && d.resolutionNotes.length >= 5), {
    message: 'Keputusan resolved/dismissed harus disertai catatan penyelesaian',
    path: ['resolutionNotes'],
  });

export const listCaseQuerySchema = z.object({
  ...paginationFields,
  type: z.enum(CASE_TYPES).optional(),
  status: z.enum(CASE_STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  employeeId: ulidField.optional(),
  departmentId: ulidField.optional(),
});

export type CreateComplaintInput = z.infer<typeof createComplaintSchema>;
export type CreateDisciplinaryInput = z.infer<typeof createDisciplinarySchema>;
export type UpdateCaseStatusInput = z.infer<typeof updateCaseStatusSchema>;
export type ListCaseQuery = z.infer<typeof listCaseQuerySchema>;
