// src/routes/authRoutes.ts
import express from 'express';
import rateLimit from 'express-rate-limit';
import { login, me, changePassword } from '../controllers/authController';
import { authenticateToken, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { env } from '../config/env';
import { loginSchema, changePasswordSchema } from '../schemas/authSchema';

const router = express.Router();

/** Membatasi percobaan login supaya password tidak bisa ditebak brute force. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // Dimatikan saat test: banyak skenario perlu login berkali-kali, dan
  // rate limit akan menggagalkannya karena alasan yang bukan sedang diuji.
  skip: () => env.NODE_ENV === 'test',
  message: { error: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' },
});

router.post('/login', loginLimiter, validate(loginSchema), asyncHandler(login));
router.get('/me', authenticateToken, asyncHandler(me));
router.post(
  '/change-password',
  authenticateToken,
  validate(changePasswordSchema),
  asyncHandler(changePassword)
);

export default router;
