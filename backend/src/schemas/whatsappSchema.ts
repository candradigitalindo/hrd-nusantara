// src/schemas/whatsappSchema.ts
import { z } from 'zod';
import { ulidField, dateField, dateOnlyField, paginationFields } from './common';
import { MESSAGE_DIRECTIONS, SESSION_EVENT_TYPES } from '../utils/whatsappRules';

export const SESSION_STATUSES = ['connected', 'disconnected', 'pending_scan'] as const;
export const MESSAGE_TYPES = ['text', 'image', 'document', 'audio', 'video'] as const;

const nomor = z.string().trim().min(8).max(25);

// --- Nomor perusahaan ---

export const createAccountSchema = z
  .object({
    phoneNumber: nomor,
    label: z.string().trim().min(1).max(150),
    description: z.string().trim().max(500).optional(),
    assignedEmployeeId: ulidField.nullable().optional(),
    departmentId: ulidField.nullable().optional(),
  })
  .strict();

export const updateAccountSchema = z
  .object({
    label: z.string().trim().min(1).max(150).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    assignedEmployeeId: ulidField.nullable().optional(),
    departmentId: ulidField.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Tidak ada field yang diubah' });

export const ACCOUNT_KINDS = ['company', 'personal'] as const;

export const listAccountQuerySchema = z.object({
  kind: z.enum(ACCOUNT_KINDS).optional(),
  ...paginationFields,
  sessionStatus: z.enum(SESSION_STATUSES).optional(),
  includeInactive: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

// --- Webhook Belly's ---

export const bellysMessageSchema = z
  .object({
    event: z.literal('message'),
    messageId: z.string().trim().min(1).max(200),
    from: nomor,
    to: nomor,
    body: z.string().max(20_000),
    type: z.enum(MESSAGE_TYPES).default('text'),
    timestamp: dateField,
  })
  .strict();

export const bellysSessionSchema = z
  .object({
    event: z.literal('session'),
    phoneNumber: nomor,
    status: z.enum(SESSION_EVENT_TYPES),
    timestamp: dateField.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const bellysWebhookSchema = z.discriminatedUnion('event', [
  bellysMessageSchema,
  bellysSessionSchema,
]);

// --- Arsip percakapan ---

export const listConversationQuerySchema = z.object({
  ...paginationFields,
  accountId: ulidField.optional(),
  employeeId: ulidField.optional(),
  contactNumber: nomor.optional(),
  direction: z.enum(MESSAGE_DIRECTIONS).optional(),
  /// Pencarian isi pesan, untuk pelacakan isu. Per KATA UTUH, bukan potongan
  /// kata: isi pesan terenkripsi, jadi pencocokan lewat indeks buta. Beberapa
  /// kata berarti DAN. Lihat src/utils/fieldCrypto.ts.
  search: z.string().trim().min(2).max(200).optional(),
  startDate: dateOnlyField.optional(),
  endDate: dateOnlyField.optional(),
});

export const listSessionEventQuerySchema = z.object({
  ...paginationFields,
  accountId: ulidField.optional(),
  eventType: z.enum(SESSION_EVENT_TYPES).optional(),
  unnotifiedOnly: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

export const markNotifiedSchema = z
  .object({ eventIds: z.array(ulidField).min(1).max(200) })
  .strict();

// --- Retensi ---

/// dryRun bawaannya true: penghapusan permanen tidak boleh terjadi hanya
/// karena seseorang salah menekan tombol atau lupa mengisi body.
export const purgeSchema = z.object({ dryRun: z.boolean().default(true) }).strict();

// --- Sesi Baileys ---

/// logout bawaannya false: memutus sementara cukup untuk perawatan, sedangkan
/// logout menghapus pairing dan memaksa scan QR ulang oleh pemegang nomor.
export const disconnectSchema = z.object({ logout: z.boolean().default(false) }).strict();

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type ListAccountQuery = z.infer<typeof listAccountQuerySchema>;
export type BellysWebhookInput = z.infer<typeof bellysWebhookSchema>;
export type ListConversationQuery = z.infer<typeof listConversationQuerySchema>;
export type ListSessionEventQuery = z.infer<typeof listSessionEventQuerySchema>;
export type MarkNotifiedInput = z.infer<typeof markNotifiedSchema>;
export type PurgeInput = z.infer<typeof purgeSchema>;
export type DisconnectInput = z.infer<typeof disconnectSchema>;

// --- Kepatuhan: setiap karyawan wajib menautkan WhatsApp-nya ---

export const complianceQuerySchema = z.object({
  departmentId: ulidField.optional(),
});

export const remindSchema = z
  .object({
    /// Kosong = semua karyawan aktif yang WhatsApp-nya belum tersambung.
    employeeIds: z.array(ulidField).max(500).optional(),
  })
  .strict();

export type ComplianceQuery = z.infer<typeof complianceQuerySchema>;
export type RemindInput = z.infer<typeof remindSchema>;
