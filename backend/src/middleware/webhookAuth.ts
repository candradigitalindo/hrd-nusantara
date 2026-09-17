// src/middleware/webhookAuth.ts
import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { verifyWebhookSignature } from '../utils/whatsappRules';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

/**
 * Memverifikasi bahwa kiriman webhook benar-benar dari Belly's.
 *
 * Pemantauan yang dimatikan menolak kiriman, bukan menerimanya tanpa
 * pemeriksaan. Begitu pula kunci yang belum diatur: menerima kiriman tak
 * terverifikasi ke arsip yang dipakai audit lebih buruk daripada menolaknya.
 */
export const verifyBellysWebhook = (req: Request, res: Response, next: NextFunction) => {
  if (!env.WHATSAPP_MONITORING_ENABLED) {
    return res.status(503).json({ error: 'Pemantauan WhatsApp sedang dinonaktifkan' });
  }

  if (!env.BELLYS_WEBHOOK_SECRET) {
    return res.status(503).json({
      error: 'BELLYS_WEBHOOK_SECRET belum diatur, webhook tidak bisa diverifikasi',
    });
  }

  const sah = verifyWebhookSignature({
    rawBody: req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {})),
    signature: req.header('x-bellys-signature'),
    secret: env.BELLYS_WEBHOOK_SECRET,
  });

  if (!sah) {
    return res.status(401).json({ error: 'Tanda tangan webhook tidak sah' });
  }

  next();
};
