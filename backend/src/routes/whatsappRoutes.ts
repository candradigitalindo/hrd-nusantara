// src/routes/whatsappRoutes.ts
import express from 'express';
import {
  createAccount,
  getAllAccounts,
  updateAccount,
  getConversations,
  getConversationMedia,
  tarikRiwayatAkun,
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
  tarikRiwayatSchema,
  listSessionEventQuerySchema,
  markNotifiedSchema,
  purgeSchema,
  disconnectSchema,
  complianceQuerySchema,
  remindSchema,
  attendanceGroupSchema,
} from '../schemas/whatsappSchema';
import { lihatAtauKelola } from '../utils/permissions';

const router = express.Router();


// Webhook Belly's ada di src/routes/webhookRoutes.ts, dipasang lebih dulu
// karena tidak memakai token JWT.
router.use(authenticateToken);

// --- WhatsApp pribadi karyawan (wajib, sesuai dokumen fitur) ---
// Tanpa requireRole: setiap karyawan menautkan nomornya sendiri.
router.get('/whatsapp/me', requirePermission('whatsapp_saya.lihat', ...lihatAtauKelola('whatsapp')), asyncHandler(getMyWhatsApp));
router.post('/whatsapp/me/connect', requirePermission('whatsapp_saya.ubah', 'whatsapp.ubah'), asyncHandler(connectMyWhatsApp));
// Grup tujuan foto absensi ber-stempel — dipilih dari grup yang diikuti nomor itu.
router.get('/whatsapp/me/groups', requirePermission('whatsapp_saya.lihat', ...lihatAtauKelola('whatsapp')), asyncHandler(getMyGroups));
router.put('/whatsapp/me/attendance-group', requirePermission('whatsapp_saya.ubah', 'whatsapp.ubah'), validate(attendanceGroupSchema), asyncHandler(setMyAttendanceGroup));

// Kepatuhan hanya untuk HR: daftar siapa yang belum/putus, plus pengingat.
router.get(
  '/whatsapp/compliance',
  requirePermission(...lihatAtauKelola('whatsapp')),
  validate(complianceQuerySchema, 'query'),
  asyncHandler(getCompliance)
);
router.post(
  '/whatsapp/compliance/remind',
  requirePermission('whatsapp.ubah'),
  validate(remindSchema),
  asyncHandler(remindCompliance)
);

// --- Nomor perusahaan ---
router.get(
  '/whatsapp/accounts',
  requirePermission(...lihatAtauKelola('whatsapp')),
  validate(listAccountQuerySchema, 'query'),
  asyncHandler(getAllAccounts)
);
router.post(
  '/whatsapp/accounts',
  requirePermission('whatsapp.buat'),
  validate(createAccountSchema),
  asyncHandler(createAccount)
);
router.put(
  '/whatsapp/accounts/:id',
  requirePermission('whatsapp.ubah'),
  validate(idParamSchema, 'params'),
  validate(updateAccountSchema),
  asyncHandler(updateAccount)
);

// --- Sesi WhatsApp (Baileys) ---
router.post(
  '/whatsapp/accounts/:id/connect',
  requirePermission('whatsapp.ubah'),
  validate(idParamSchema, 'params'),
  asyncHandler(connectWhatsAppAccount)
);
// Tanpa requireRole: pemegang nomor perlu melihat QR-nya sendiri untuk
// memindai ulang. Penyaringan siapa melihat apa dikerjakan di controller.
router.get(
  '/whatsapp/accounts/:id/session',
  requirePermission('whatsapp_saya.lihat', ...lihatAtauKelola('whatsapp')),
  validate(idParamSchema, 'params'),
  asyncHandler(getWhatsAppSession)
);
router.post(
  '/whatsapp/accounts/:id/disconnect',
  requirePermission('whatsapp.ubah'),
  validate(idParamSchema, 'params'),
  validate(disconnectSchema),
  asyncHandler(disconnectWhatsAppAccount)
);

// Menarik percakapan lama sebuah nomor — opsional, atas permintaan Super
// Admin. Perannya diperiksa di controller, sekalian dengan pemeriksaan
// driver Baileys yang harus menyala.
router.post(
  '/whatsapp/accounts/:id/riwayat',
  requirePermission(...lihatAtauKelola('whatsapp')),
  validate(idParamSchema, 'params'),
  validate(tarikRiwayatSchema),
  asyncHandler(tarikRiwayatAkun)
);

// --- Arsip percakapan ---
// Hanya HR: arsip ini memuat data pribadi pihak ketiga (pelanggan dan tamu)
// yang tidak pernah menjadi bagian dari perusahaan.
router.get(
  '/whatsapp/conversations',
  requirePermission(...lihatAtauKelola('whatsapp')),
  validate(listConversationQuerySchema, 'query'),
  asyncHandler(getConversations)
);

// Berkas media (foto, video, pesan suara, dokumen) — hanya Super Admin, dan
// setiap pembukaan tercatat. Penyaringan perannya di controller, sekaligus
// dengan penyaringan baris grup pada daftar di atas.
router.get(
  '/whatsapp/conversations/:id/media',
  requirePermission(...lihatAtauKelola('whatsapp')),
  validate(idParamSchema, 'params'),
  asyncHandler(getConversationMedia)
);

// --- Retensi ---
// Tidak ada penjadwal di dalam aplikasi; ini dipanggil oleh cron di luar,
// supaya jadwal penghapusan terlihat dan bisa diaudit oleh yang mengelola
// server, bukan tersembunyi di dalam proses.
router.post(
  '/whatsapp/retention/purge',
  requirePermission('whatsapp.hapus'),
  validate(purgeSchema),
  asyncHandler(purgeExpiredConversations)
);

// --- Kejadian sesi ---
// Tanpa requireRole: pemegang nomor perlu tahu sesinya terputus.
// Penyaringan siapa melihat apa dikerjakan di controller.
router.get(
  '/whatsapp/session-events',
  requirePermission('whatsapp_saya.lihat', ...lihatAtauKelola('whatsapp')),
  validate(listSessionEventQuerySchema, 'query'),
  asyncHandler(getSessionEvents)
);
router.post(
  '/whatsapp/session-events/notified',
  requirePermission('whatsapp.ubah'),
  validate(markNotifiedSchema),
  asyncHandler(markEventsNotified)
);

export default router;
