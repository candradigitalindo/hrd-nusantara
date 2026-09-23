// src/routes/karierRoutes.ts
//
// Portal karier. Dipasang lebih awal dari router internal, sama seperti
// webhook dan tautan ujian: pengunjung dan pelamar tidak punya akun karyawan,
// jadi rute ini tidak boleh melewati authenticateToken milik router lain.
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env';
import {
  daftar,
  fotoTes,
  gantiSandi,
  getLowonganPublik,
  getLowonganPublikById,
  kejadianTes,
  kirimTes,
  lamar,
  lamaranSaya,
  masuk,
  mulaiTes,
  profilSaya,
  simpanJawabanTes,
  ubahProfil,
  unduhCvSaya,
  unggahCv,
} from '../controllers/karierController';
import { authPelamar } from '../middleware/authPelamar';
import { asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import {
  daftarPelamarSchema,
  gantiSandiPelamarSchema,
  lamarSchema,
  masukPelamarSchema,
  ubahProfilPelamarSchema,
  unggahCvSchema,
} from '../schemas/karierSchema';
import { proctorEventSchema, proctorPhotoSchema, saveAnswersSchema } from '../schemas/cbtSchema';

const router = express.Router();

/**
 * Batas laju untuk jalur tulis yang terbuka bagi siapa saja.
 *
 * Pendaftaran dan lamaran adalah satu-satunya tempat orang luar bisa membuat
 * baris baru di basis data. Angkanya dibuat cukup untuk orang yang benar-benar
 * melamar beberapa lowongan sekaligus, tapi tidak cukup untuk membanjiri
 * antrean HR.
 */
const batasTulisPublik = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
  message: { error: 'Terlalu banyak percobaan dari jaringan ini. Coba lagi satu jam lagi.' },
});

/** Percobaan masuk dibatasi lebih ketat: ini pintu tebak-tebakan kata sandi. */
const batasMasuk = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
  message: { error: 'Terlalu banyak percobaan masuk. Coba lagi beberapa menit lagi.' },
});

/** Pengerjaan tes: dihitung per penugasan, bukan per IP (satu ruangan = satu IP). */
const batasPengerjaan = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 900,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  keyGenerator: (req) => req.params.id ?? ipKeyGenerator(req.ip ?? ''),
  message: { error: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.' },
});

// --- Terbuka untuk siapa saja ---
router.get('/lowongan', asyncHandler(getLowonganPublik));
router.get('/lowongan/:id', validate(idParamSchema, 'params'), asyncHandler(getLowonganPublikById));
router.post('/daftar', batasTulisPublik, validate(daftarPelamarSchema), asyncHandler(daftar));
router.post('/masuk', batasMasuk, validate(masukPelamarSchema), asyncHandler(masuk));

// --- Butuh akun pelamar ---
router.get('/saya', authPelamar, asyncHandler(profilSaya));
router.put('/saya', authPelamar, validate(ubahProfilPelamarSchema), asyncHandler(ubahProfil));
router.put('/saya/sandi', authPelamar, validate(gantiSandiPelamarSchema), asyncHandler(gantiSandi));
router.post('/saya/cv', authPelamar, validate(unggahCvSchema), asyncHandler(unggahCv));
router.get('/saya/cv', authPelamar, asyncHandler(unduhCvSaya));
router.post('/lamar', authPelamar, batasTulisPublik, validate(lamarSchema), asyncHandler(lamar));
router.get('/lamaran/:id', authPelamar, validate(idParamSchema, 'params'), asyncHandler(lamaranSaya));

// --- Tes CBT dari portal ---
router.post('/tes/:id/mulai', authPelamar, batasPengerjaan, validate(idParamSchema, 'params'), asyncHandler(mulaiTes));
router.put('/tes/:id/jawaban', authPelamar, batasPengerjaan, validate(idParamSchema, 'params'), validate(saveAnswersSchema), asyncHandler(simpanJawabanTes));
router.post('/tes/:id/kirim', authPelamar, batasPengerjaan, validate(idParamSchema, 'params'), asyncHandler(kirimTes));
router.post('/tes/:id/kejadian', authPelamar, batasPengerjaan, validate(idParamSchema, 'params'), validate(proctorEventSchema), asyncHandler(kejadianTes));
router.post('/tes/:id/foto', authPelamar, batasPengerjaan, validate(idParamSchema, 'params'), validate(proctorPhotoSchema), asyncHandler(fotoTes));

export default router;
