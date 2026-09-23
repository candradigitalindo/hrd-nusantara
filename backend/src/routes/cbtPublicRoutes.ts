// src/routes/cbtPublicRoutes.ts
//
// Pintu masuk pelamar: tautan bertoken, tanpa akun.
//
// Dipasang TERPISAH dan lebih awal dari router lain, sama seperti webhook.
// Router-router lain sama-sama terpasang di '/api' dan memanggil
// router.use(authenticateToken); kalau rute ini ikut di sana, permintaan
// pelamar sudah ditolak "Token akses dibutuhkan" sebelum sampai ke sini.
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env';
import {
  publicEvent,
  publicInfo,
  publicPhoto,
  publicQuestionImage,
  publicSaveAnswers,
  publicStart,
  publicSubmit,
} from '../controllers/cbtAttemptController';
import { asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { proctorEventSchema, proctorPhotoSchema, saveAnswersSchema, tokenParamSchema } from '../schemas/cbtSchema';

const router = express.Router();

/**
 * Batas laju dihitung per TOKEN, bukan per alamat IP: satu ruangan tes berisi
 * dua puluh orang tampak sebagai satu IP dari luar, dan batas per-IP akan
 * menghentikan ujian justru karena semua peserta tertib menyimpan jawaban.
 */
const batasPeserta = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 900,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  // Token dulu; kalau belum ada (jalur yang salah bentuk), jatuh ke IP lewat
  // ipKeyGenerator supaya alamat IPv6 dinormalkan per /64, bukan per alamat.
  keyGenerator: (req) => req.params.token ?? ipKeyGenerator(req.ip ?? ''),
  message: { error: 'Terlalu banyak permintaan dari peserta ini. Tunggu sebentar lalu coba lagi.' },
});

// Dipasang per rute, bukan lewat router.use(): middleware tingkat router
// berlaku untuk seluruh permintaan yang melewatinya, dan tests/routeMounting
// menjaga agar hanya authenticateToken yang boleh dipasang begitu.
router.get('/:token', batasPeserta, validate(tokenParamSchema, 'params'), asyncHandler(publicInfo));
router.post('/:token/mulai', batasPeserta, validate(tokenParamSchema, 'params'), asyncHandler(publicStart));
router.put('/:token/jawaban', batasPeserta, validate(tokenParamSchema, 'params'), validate(saveAnswersSchema), asyncHandler(publicSaveAnswers));
router.post('/:token/kirim', batasPeserta, validate(tokenParamSchema, 'params'), asyncHandler(publicSubmit));
router.post('/:token/kejadian', batasPeserta, validate(tokenParamSchema, 'params'), validate(proctorEventSchema), asyncHandler(publicEvent));
router.post('/:token/foto', batasPeserta, validate(tokenParamSchema, 'params'), validate(proctorPhotoSchema), asyncHandler(publicPhoto));
router.get('/:token/soal/:questionId/gambar', batasPeserta, asyncHandler(publicQuestionImage));

export default router;
