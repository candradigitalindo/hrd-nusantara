// src/routes/webhookRoutes.ts
import express from 'express';
import { handleBellysWebhook } from '../controllers/whatsappController';
import { asyncHandler } from '../middleware/auth';
import { verifyBellysWebhook } from '../middleware/webhookAuth';
import { validate } from '../middleware/validate';
import { bellysWebhookSchema } from '../schemas/whatsappSchema';

/**
 * Endpoint yang dipanggil mesin, bukan pengguna.
 *
 * Dipisahkan ke router sendiri dan dipasang SEBELUM router lain karena
 * beberapa router lain memanggil router.use(authenticateToken) dan sama-sama
 * dipasang di '/api'. Middleware itu berlaku untuk semua permintaan yang
 * melewatinya — termasuk path yang bukan milik router tersebut — sehingga
 * webhook akan ditolak sebagai "token tidak ada" sebelum sampai ke tujuannya.
 */
const router = express.Router();

router.post(
  '/bellys',
  verifyBellysWebhook,
  validate(bellysWebhookSchema),
  asyncHandler(handleBellysWebhook)
);

export default router;
