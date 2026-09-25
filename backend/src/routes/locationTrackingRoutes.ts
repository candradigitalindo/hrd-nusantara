// src/routes/locationTrackingRoutes.ts
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Role } from '@prisma/client';
import {
  getTrackingConfig,
  postLocationPings,
  putTrackingStatus,
  getTrackingSettings,
  putTrackingSettings,
  getLatestLocations,
  getEmployeeTrail,
} from '../controllers/locationTrackingController';
import { authenticateToken, requireRole, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { env } from '../config/env';
import { idParamSchema } from '../schemas/common';
import { trackingSettingsSchema, locationPingsSchema, trackingStatusSchema, trailQuerySchema } from '../schemas/locationTrackingSchema';

const router = express.Router();
router.use(authenticateToken);

// Kiriman lokasi dikecualikan dari batas per-IP (app.ts), jadi dibatasi per
// akun di sini: interval terpendek 1 menit ≈ 15 kiriman per 15 menit, sisanya
// ruang untuk antrean offline yang dikirim sekaligus.
const batasKiriman = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ''),
  message: { error: 'Terlalu banyak kiriman lokasi dari akun ini. Tunggu sebentar lalu coba lagi.' },
});

// Aplikasi mobile setiap karyawan: membaca pengaturan dan mengirim lokasinya sendiri.
router.get('/config', asyncHandler(getTrackingConfig));
router.post('/pings', batasKiriman, validate(locationPingsSchema), asyncHandler(postLocationPings));
router.put('/status', validate(trackingStatusSchema), asyncHandler(putTrackingStatus));

// Hanya Super Admin — berdasarkan lingkup peran, bukan izin yang bisa
// dibagikan ke peran kustom: data lokasi 24 jam tidak boleh bocor lewat
// matriks hak akses.
const superAdmin = requireRole(Role.SUPER_ADMIN);
router.get('/settings', superAdmin, asyncHandler(getTrackingSettings));
router.put('/settings', superAdmin, validate(trackingSettingsSchema), asyncHandler(putTrackingSettings));
router.get('/latest', superAdmin, asyncHandler(getLatestLocations));
router.get('/employees/:id/trail', superAdmin, validate(idParamSchema, 'params'), validate(trailQuerySchema, 'query'), asyncHandler(getEmployeeTrail));

export default router;
