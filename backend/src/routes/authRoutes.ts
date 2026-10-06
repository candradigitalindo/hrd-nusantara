// src/routes/authRoutes.ts
import express from 'express';
import rateLimit from 'express-rate-limit';
import { login, me, changePassword, refresh, logout } from '../controllers/authController';
import { authenticateToken, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { env } from '../config/env';
import { loginSchema, changePasswordSchema, refreshTokenSchema } from '../schemas/authSchema';

const router = express.Router();

/**
 * Membatasi percobaan login supaya password tidak bisa ditebak brute force.
 * Hanya KEGAGALAN yang dihitung: satu kantor atau outlet berbagi satu IP,
 * dan dua puluh orang yang login dengan benar di pagi yang sama bukan
 * serangan. 30 sandi salah per 15 menit per IP tetap jauh di bawah laju
 * yang berguna untuk menebak sandi ber-bcrypt.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // Dimatikan saat test: banyak skenario perlu login berkali-kali, dan
  // rate limit akan menggagalkannya karena alasan yang bukan sedang diuji.
  skip: () => env.NODE_ENV === 'test',
  message: { error: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' },
});

router.post('/login', loginLimiter, validate(loginSchema), asyncHandler(login));
// Tanpa token akses: justru dipakai saat token akses sudah kedaluwarsa.
router.post('/refresh', validate(refreshTokenSchema), asyncHandler(refresh));
router.post('/logout', validate(refreshTokenSchema), asyncHandler(logout));
router.get('/me', authenticateToken, asyncHandler(me));
router.post(
  '/change-password',
  authenticateToken,
  validate(changePasswordSchema),
  asyncHandler(changePassword)
);

export default router;
