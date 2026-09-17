// src/schemas/auditSchema.ts
import { z } from 'zod';
import { ulidField, dateOnlyField, paginationFields } from './common';

export const listAuditQuerySchema = z.object({
  ...paginationFields,
  actorId: ulidField.optional(),
  /// Pola rute, misalnya "POST /api/whatsapp/retention/purge".
  action: z.string().trim().min(2).max(200).optional(),
  entity: z.string().trim().min(2).max(100).optional(),
  entityId: ulidField.optional(),
  /// Menyaring yang gagal saja, untuk menelusuri percobaan yang ditolak.
  onlyFailed: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  startDate: dateOnlyField.optional(),
  endDate: dateOnlyField.optional(),
});

export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;
