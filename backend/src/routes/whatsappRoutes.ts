// src/routes/whatsappRoutes.ts
import express from 'express';
import {
  createAccount,
  getAllAccounts,
  updateAccount,
  getConversations,
  getSessionEvents,
  markEventsNotified,
  purgeExpiredConversations,
  connectWhatsAppAccount,
  getWhatsAppSession,
  disconnectWhatsAppAccount,
  getMyWhatsApp,
  connectMyWhatsApp,
  getCompliance,
  remindCompliance,
  getMyGroups,
  setMyAttendanceGroup,
} from '../controllers/whatsappController';
import { authenticateToken, requirePermission, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import {
  createAccountSchema,
  updateAccountSchema,
  listAccountQuerySchema,
  listConversationQuerySchema,
  listSessionEventQuerySchema,
  markNotifiedSchema,
  purgeSchema,
  disconnectSchema,
  complianceQuerySchema,
  remindSchema,
  attendanceGroupSchema,
} from '../schemas/whatsappSchema';

const router = express.Router();


// Webhook Belly's ada di src/routes/webhookRoutes.ts, dipasang lebih dulu
// karena tidak memakai token JWT.
router.use(authenticateToken);

// --- WhatsApp pribadi karyawan (wajib, sesuai dokumen fitur) ---
// Tanpa requireRole: setiap karyawan menautkan nomornya sendiri.
router.get('/whatsapp/me', asyncHandler(getMyWhatsApp));
router.post('/whatsapp/me/connect', asyncHandler(connectMyWhatsApp));
// Grup tujuan foto absensi ber-stempel — dipilih dari grup yang diikuti nomor itu.
router.get('/whatsapp/me/groups', asyncHandler(getMyGroups));
router.put('/whatsapp/me/attendance-group', validate(attendanceGroupSchema), asyncHandler(setMyAttendanceGroup));

// Kepatuhan hanya untuk HR: daftar siapa yang belum/putus, plus pengingat.
router.get(
  '/whatsapp/compliance',
  requirePermission('whatsapp.pantau'),
  validate(complianceQuerySchema, 'query'),
  asyncHandler(getCompliance)
);
router.post(
  '/whatsapp/compliance/remind',
  requirePermission('whatsapp.pantau'),
  validate(remindSchema),
  asyncHandler(remindCompliance)
);

// --- Nomor perusahaan ---
router.get(
  '/whatsapp/accounts',
  requirePermission('whatsapp.pantau'),
  validate(listAccountQuerySchema, 'query'),
  asyncHandler(getAllAccounts)
);
router.post(
  '/whatsapp/accounts',
  requirePermission('whatsapp.pantau'),
  validate(createAccountSchema),
  asyncHandler(createAccount)
);
router.put(
  '/whatsapp/accounts/:id',
  requirePermission('whatsapp.pantau'),
  validate(idParamSchema, 'params'),
  validate(updateAccountSchema),
  asyncHandler(updateAccount)
);

// --- Sesi WhatsApp (Baileys) ---
router.post(
  '/whatsapp/accounts/:id/connect',
  requirePermission('whatsapp.pantau'),
  validate(idParamSchema, 'params'),
  asyncHandler(connectWhatsAppAccount)
);
// Tanpa requireRole: pemegang nomor perlu melihat QR-nya sendiri untuk
// memindai ulang. Penyaringan siapa melihat apa dikerjakan di controller.
router.get(
  '/whatsapp/accounts/:id/session',
  validate(idParamSchema, 'params'),
  asyncHandler(getWhatsAppSession)
);
router.post(
  '/whatsapp/accounts/:id/disconnect',
  requirePermission('whatsapp.pantau'),
  validate(idParamSchema, 'params'),
  validate(disconnectSchema),
  asyncHandler(disconnectWhatsAppAccount)
);

// --- Arsip percakapan ---
// Hanya HR: arsip ini memuat data pribadi pihak ketiga (pelanggan dan tamu)
// yang tidak pernah menjadi bagian dari perusahaan.
router.get(
  '/whatsapp/conversations',
  requirePermission('whatsapp.pantau'),
  validate(listConversationQuerySchema, 'query'),
  asyncHandler(getConversations)
);

// --- Retensi ---
// Tidak ada penjadwal di dalam aplikasi; ini dipanggil oleh cron di luar,
// supaya jadwal penghapusan terlihat dan bisa diaudit oleh yang mengelola
// server, bukan tersembunyi di dalam proses.
router.post(
  '/whatsapp/retention/purge',
  requirePermission('whatsapp.pantau'),
  validate(purgeSchema),
  asyncHandler(purgeExpiredConversations)
);

// --- Kejadian sesi ---
// Tanpa requireRole: pemegang nomor perlu tahu sesinya terputus.
// Penyaringan siapa melihat apa dikerjakan di controller.
router.get(
  '/whatsapp/session-events',
  validate(listSessionEventQuerySchema, 'query'),
  asyncHandler(getSessionEvents)
);
router.post(
  '/whatsapp/session-events/notified',
  requirePermission('whatsapp.pantau'),
  validate(markNotifiedSchema),
  asyncHandler(markEventsNotified)
);

export default router;
