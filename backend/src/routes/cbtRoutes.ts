// src/routes/cbtRoutes.ts
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env';
import {
  createAssignments,
  createQuestion,
  createTest,
  deleteAssignment,
  deleteQuestion,
  deleteTest,
  getAssignments,
  getProctorPhoto,
  getQuestionCategories,
  getQuestionImage,
  getQuestions,
  getResultDetail,
  getResults,
  getTestById,
  getTests,
  gradeAttempt,
  regenerateAssignmentToken,
  setTestQuestions,
  updateQuestion,
  updateTest,
} from '../controllers/cbtController';
import {
  getMyAssignments,
  getMyResult,
  recordMyEvent,
  saveMyAnswers,
  saveMyPhoto,
  startMyAttempt,
  submitMyAttempt,
} from '../controllers/cbtAttemptController';
import { authenticateToken, requirePermission, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import {
  createAssignmentSchema,
  createQuestionSchema,
  createTestSchema,
  gradeAttemptSchema,
  listAssignmentQuerySchema,
  listQuestionQuerySchema,
  proctorEventSchema,
  proctorPhotoSchema,
  saveAnswersSchema,
  setTestQuestionsSchema,
  updateQuestionSchema,
  updateTestSchema,
} from '../schemas/cbtSchema';

const router = express.Router();

/**
 * Batas laju khusus pengerjaan, dihitung per PESERTA, bukan per alamat IP.
 *
 * Satu ruangan tes berisi dua puluh orang tampak sebagai satu IP dari luar;
 * batas per-IP akan menghentikan ujian di tengah jalan justru karena semua
 * peserta tertib menyimpan jawaban. Angkanya longgar tapi tetap ada, supaya
 * tautan yang bocor tidak bisa dipakai membanjiri server.
 */
const batasPengerjaan = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 900,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  // Penugasan atau penggunanya dulu; IP hanya cadangan, lewat ipKeyGenerator
  // supaya alamat IPv6 dinormalkan per /64.
  keyGenerator: (req) => req.params.id ?? req.user?.id ?? ipKeyGenerator(req.ip ?? ''),
  message: { error: 'Terlalu banyak permintaan dari peserta ini. Tunggu sebentar lalu coba lagi.' },
});

// ============ Semua di bawah ini butuh akun ============
router.use(authenticateToken);

// --- Peserta karyawan ---
router.get('/cbt/saya', requirePermission('cbt.lihat'), asyncHandler(getMyAssignments));
router.post('/cbt/saya/:id/mulai', batasPengerjaan, requirePermission('cbt.lihat'), validate(idParamSchema, 'params'), asyncHandler(startMyAttempt));
router.put(
  '/cbt/saya/:id/jawaban',
  batasPengerjaan,
  requirePermission('cbt.lihat'),
  validate(idParamSchema, 'params'),
  validate(saveAnswersSchema),
  asyncHandler(saveMyAnswers)
);
router.post('/cbt/saya/:id/kirim', batasPengerjaan, requirePermission('cbt.lihat'), validate(idParamSchema, 'params'), asyncHandler(submitMyAttempt));
router.post(
  '/cbt/saya/:id/kejadian',
  batasPengerjaan,
  requirePermission('cbt.lihat'),
  validate(idParamSchema, 'params'),
  validate(proctorEventSchema),
  asyncHandler(recordMyEvent)
);
router.post(
  '/cbt/saya/:id/foto',
  batasPengerjaan,
  requirePermission('cbt.lihat'),
  validate(idParamSchema, 'params'),
  validate(proctorPhotoSchema),
  asyncHandler(saveMyPhoto)
);
router.get('/cbt/saya/:id/hasil', requirePermission('cbt.lihat'), validate(idParamSchema, 'params'), asyncHandler(getMyResult));

// --- Bank soal ---
router.get('/cbt/soal/kategori', requirePermission('cbt_soal.lihat', 'cbt.buat', 'cbt.ubah'), asyncHandler(getQuestionCategories));
router.get('/cbt/soal', requirePermission('cbt_soal.lihat', 'cbt.buat', 'cbt.ubah'), validate(listQuestionQuerySchema, 'query'), asyncHandler(getQuestions));
router.post('/cbt/soal', requirePermission('cbt_soal.buat'), validate(createQuestionSchema), asyncHandler(createQuestion));
router.put('/cbt/soal/:id', requirePermission('cbt_soal.ubah'), validate(idParamSchema, 'params'), validate(updateQuestionSchema), asyncHandler(updateQuestion));
router.delete('/cbt/soal/:id', requirePermission('cbt_soal.hapus'), validate(idParamSchema, 'params'), asyncHandler(deleteQuestion));
// Gambar soal juga dibuka untuk peserta karyawan: tanpa ini soal bergambar
// tidak bisa dikerjakan.
router.get('/cbt/soal/:id/gambar', requirePermission('cbt.lihat', 'cbt_soal.lihat'), validate(idParamSchema, 'params'), asyncHandler(getQuestionImage));

// --- Paket tes ---
router.get('/cbt/tes', requirePermission('cbt.lihat', 'cbt.buat', 'cbt.ubah'), asyncHandler(getTests));
router.get('/cbt/tes/:id', requirePermission('cbt.buat', 'cbt.ubah', 'cbt_hasil.lihat'), validate(idParamSchema, 'params'), asyncHandler(getTestById));
router.post('/cbt/tes', requirePermission('cbt.buat'), validate(createTestSchema), asyncHandler(createTest));
router.put('/cbt/tes/:id', requirePermission('cbt.ubah'), validate(idParamSchema, 'params'), validate(updateTestSchema), asyncHandler(updateTest));
router.put('/cbt/tes/:id/soal', requirePermission('cbt.ubah'), validate(idParamSchema, 'params'), validate(setTestQuestionsSchema), asyncHandler(setTestQuestions));
router.delete('/cbt/tes/:id', requirePermission('cbt.hapus'), validate(idParamSchema, 'params'), asyncHandler(deleteTest));

// --- Penugasan ---
router.get('/cbt/penugasan', requirePermission('cbt.buat', 'cbt.ubah', 'cbt_hasil.lihat'), validate(listAssignmentQuerySchema, 'query'), asyncHandler(getAssignments));
router.post('/cbt/penugasan', requirePermission('cbt.buat'), validate(createAssignmentSchema), asyncHandler(createAssignments));
router.post('/cbt/penugasan/:id/tautan', requirePermission('cbt.buat', 'cbt.ubah'), validate(idParamSchema, 'params'), asyncHandler(regenerateAssignmentToken));
router.delete('/cbt/penugasan/:id', requirePermission('cbt.ubah'), validate(idParamSchema, 'params'), asyncHandler(deleteAssignment));

// --- Hasil & penilaian ---
router.get('/cbt/hasil', requirePermission('cbt_hasil.lihat'), validate(listAssignmentQuerySchema, 'query'), asyncHandler(getResults));
router.get('/cbt/hasil/:id', requirePermission('cbt_hasil.lihat'), validate(idParamSchema, 'params'), asyncHandler(getResultDetail));
router.put('/cbt/hasil/:id/nilai', requirePermission('cbt_hasil.ubah'), validate(idParamSchema, 'params'), validate(gradeAttemptSchema), asyncHandler(gradeAttempt));
router.get('/cbt/hasil/:id/foto/:photoId', requirePermission('cbt_hasil.lihat'), asyncHandler(getProctorPhoto));

export default router;
