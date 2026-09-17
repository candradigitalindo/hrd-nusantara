// src/routes/whatsappRoutes.ts
import express from 'express';
import { Role } from '@prisma/client';
import {
  createAccount,
  getAllAccounts,
  updateAccount,
  getConversations,
  getSessionEvents,
  markEventsNotified,
} from '../controllers/whatsappController';
import { authenticateToken, requireRole, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import {
  createAccountSchema,
  updateAccountSchema,
  listAccountQuerySchema,
  listConversationQuerySchema,
  listSessionEventQuerySchema,
  markNotifiedSchema,
} from '../schemas/whatsappSchema';

const router = express.Router();

const HR = [Role.SUPER_ADMIN, Role.HR_ADMIN] as const;

// Webhook Belly's ada di src/routes/webhookRoutes.ts, dipasang lebih dulu
// karena tidak memakai token JWT.
router.use(authenticateToken);

// --- Nomor perusahaan ---
router.get(
  '/whatsapp/accounts',
  requireRole(...HR),
  validate(listAccountQuerySchema, 'query'),
  asyncHandler(getAllAccounts)
);
router.post(
  '/whatsapp/accounts',
  requireRole(...HR),
  validate(createAccountSchema),
  asyncHandler(createAccount)
);
router.put(
  '/whatsapp/accounts/:id',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  validate(updateAccountSchema),
  asyncHandler(updateAccount)
);

// --- Arsip percakapan ---
// Hanya HR: arsip ini memuat data pribadi pihak ketiga (pelanggan dan tamu)
// yang tidak pernah menjadi bagian dari perusahaan.
router.get(
  '/whatsapp/conversations',
  requireRole(...HR),
  validate(listConversationQuerySchema, 'query'),
  asyncHandler(getConversations)
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
  requireRole(...HR),
  validate(markNotifiedSchema),
  asyncHandler(markEventsNotified)
);

export default router;
