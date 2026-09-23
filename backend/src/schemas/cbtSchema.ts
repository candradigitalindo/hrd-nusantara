// src/schemas/cbtSchema.ts
import { z } from 'zod';
import { ulidField, dateField, paginationFields } from './common';
import { TINGKAT_SOAL, TIPE_SOAL } from '../utils/cbt';

const teksPendek = z.string().trim().min(1).max(200);
const persen = z.coerce.number().min(0).max(100);

const pilihan = z
  .array(z.object({ kode: z.string().trim().min(1).max(8), teks: z.string().trim().min(1).max(500) }).strict())
  .max(10);

// --- Bank soal ---

const soalDasar = {
  category: teksPendek,
  difficulty: z.enum(TINGKAT_SOAL).default('sedang'),
  type: z.enum(TIPE_SOAL),
  /// Boleh datang sebagai teks polos atau textHtml dari editor berformat.
  text: z.string().trim().min(3).max(5000).optional(),
  /// HTML dari editor berformat; teks polosnya diturunkan server dari sini.
  textHtml: z.string().max(200_000).nullable().optional(),
  /// Gambar dikirim sebagai data URI base64; server yang memutuskan jenisnya.
  image: z.string().max(4_000_000).nullable().optional(),
  options: pilihan.optional(),
  answerKey: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  rubric: z.string().trim().max(2000).nullable().optional(),
  points: z.coerce.number().min(0.5).max(100).default(1),
  explanation: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().default(true),
};

/**
 * Bentuk soal diperiksa terhadap tipenya, bukan hanya per field.
 *
 * Soal pilihan ganda tanpa kunci, atau kunci yang menunjuk pilihan yang tidak
 * ada, baru ketahuan saat peserta sudah mengerjakan — dan saat itu nilainya
 * sudah terlanjur salah. Karena itu ditolak di gerbang masuk.
 */
const periksaBentukSoal = (d: {
  type: string;
  options?: { kode: string; teks: string }[];
  answerKey: string[];
}, ctx: z.RefinementCtx) => {
  const objektifBerpilihan = d.type === 'pilihan_ganda' || d.type === 'banyak_jawaban' || d.type === 'benar_salah';

  if (objektifBerpilihan) {
    const opsi = d.options ?? [];
    if (opsi.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'Soal berpilihan butuh minimal 2 pilihan jawaban' });
      return;
    }
    const kode = opsi.map((o) => o.kode);
    if (new Set(kode).size !== kode.length) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'Kode pilihan tidak boleh kembar' });
    }
    const asing = d.answerKey.filter((k) => !kode.includes(k));
    if (asing.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['answerKey'], message: `Kunci menunjuk pilihan yang tidak ada: ${asing.join(', ')}` });
    }
    if (d.answerKey.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['answerKey'], message: 'Kunci jawaban wajib diisi' });
    }
    if (d.type !== 'banyak_jawaban' && d.answerKey.length > 1) {
      ctx.addIssue({ code: 'custom', path: ['answerKey'], message: 'Tipe ini hanya boleh punya satu jawaban benar' });
    }
  }

  if (d.type === 'isian' && d.answerKey.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['answerKey'], message: 'Isi minimal satu jawaban yang diterima' });
  }
  if (d.type === 'esai' && d.answerKey.length > 0) {
    ctx.addIssue({ code: 'custom', path: ['answerKey'], message: 'Soal esai tidak punya kunci jawaban; pakai rubrik' });
  }
};

export const createQuestionSchema = z.object(soalDasar).strict().superRefine(periksaBentukSoal);

export const updateQuestionSchema = z
  .object({
    category: teksPendek.optional(),
    difficulty: z.enum(TINGKAT_SOAL).optional(),
    type: z.enum(TIPE_SOAL).optional(),
    text: z.string().trim().min(3).max(5000).optional(),
    textHtml: z.string().max(200_000).nullable().optional(),
    image: z.string().max(4_000_000).nullable().optional(),
    options: pilihan.optional(),
    answerKey: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
    rubric: z.string().trim().max(2000).nullable().optional(),
    points: z.coerce.number().min(0.5).max(100).optional(),
    explanation: z.string().trim().max(2000).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Tidak ada field yang diubah' });

export const listQuestionQuerySchema = z
  .object({
    ...paginationFields,
    category: z.string().trim().max(200).optional(),
    type: z.enum(TIPE_SOAL).optional(),
    difficulty: z.enum(TINGKAT_SOAL).optional(),
    search: z.string().trim().max(200).optional(),
    includeInactive: z.coerce.boolean().default(false),
  })
  .strict();

// --- Paket tes ---

export const AUDIENS = ['karyawan', 'pelamar', 'keduanya'] as const;
export const STATUS_TES = ['draft', 'published', 'archived'] as const;

export const createTestSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[A-Z0-9_-]+$/, 'Kode hanya boleh huruf kapital, angka, garis bawah, dan strip'),
    title: z.string().trim().min(3).max(150),
    description: z.string().trim().max(2000).nullable().optional(),
    descriptionHtml: z.string().max(200_000).nullable().optional(),
    audience: z.enum(AUDIENS).default('keduanya'),
    durationMinutes: z.coerce.number().int().min(1).max(600),
    passingScore: persen.nullable().optional(),
    shuffleQuestions: z.boolean().default(true),
    shuffleOptions: z.boolean().default(true),
    showResultToTaker: z.boolean().default(false),
    recordProctorEvents: z.boolean().default(true),
    proctorPhotos: z.boolean().default(false),
    proctorPhotoIntervalSec: z.coerce.number().int().min(30).max(1800).default(180),
  })
  .strict();

/**
 * Ditulis ulang field demi field, BUKAN `createTestSchema.partial()`.
 *
 * Zod mempertahankan nilai bawaan pada skema yang di-partial: `parse({ status })`
 * tetap mengembalikan `proctorPhotos: false`, `audience: 'keduanya'`, dan
 * seterusnya. Akibatnya sekadar menayangkan paket akan diam-diam mengembalikan
 * seluruh setelannya ke bawaan. Di sini semuanya optional tanpa bawaan, jadi
 * yang tidak dikirim benar-benar tidak berubah.
 */
export const updateTestSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[A-Z0-9_-]+$/, 'Kode hanya boleh huruf kapital, angka, garis bawah, dan strip')
      .optional(),
    title: z.string().trim().min(3).max(150).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    descriptionHtml: z.string().max(200_000).nullable().optional(),
    audience: z.enum(AUDIENS).optional(),
    durationMinutes: z.coerce.number().int().min(1).max(600).optional(),
    passingScore: persen.nullable().optional(),
    shuffleQuestions: z.boolean().optional(),
    shuffleOptions: z.boolean().optional(),
    showResultToTaker: z.boolean().optional(),
    recordProctorEvents: z.boolean().optional(),
    proctorPhotos: z.boolean().optional(),
    proctorPhotoIntervalSec: z.coerce.number().int().min(30).max(1800).optional(),
    status: z.enum(STATUS_TES).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Tidak ada field yang diubah' });

export const setTestQuestionsSchema = z
  .object({
    questions: z
      .array(z.object({ questionId: ulidField, points: z.coerce.number().min(0.5).max(100).nullable().optional() }).strict())
      .min(1, 'Paket tes butuh minimal satu soal')
      .max(200),
  })
  .strict();

// --- Penugasan ---

export const createAssignmentSchema = z
  .object({
    testId: ulidField,
    employeeIds: z.array(ulidField).max(500).default([]),
    candidateIds: z.array(ulidField).max(500).default([]),
    availableFrom: dateField.nullable().optional(),
    availableUntil: dateField.nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine((d) => d.employeeIds.length + d.candidateIds.length > 0, { message: 'Pilih minimal satu peserta' })
  .refine((d) => !d.availableFrom || !d.availableUntil || d.availableUntil > d.availableFrom, {
    path: ['availableUntil'],
    message: 'Batas akhir harus setelah waktu mulai',
  });

export const listAssignmentQuerySchema = z
  .object({
    ...paginationFields,
    testId: ulidField.optional(),
    employeeId: ulidField.optional(),
    candidateId: ulidField.optional(),
    status: z.enum(['assigned', 'in_progress', 'submitted', 'graded', 'expired']).optional(),
  })
  .strict();

// --- Pengerjaan ---

/**
 * Jawaban dikirim sekaligus, bukan satu permintaan per soal: ujian 60 soal
 * yang menyimpan tiap ketukan akan menabrak batas laju permintaan, apalagi
 * bila seluruh peserta berada di balik satu alamat IP kantor.
 */
export const saveAnswersSchema = z
  .object({
    jawaban: z
      .array(
        z
          .object({
            questionId: ulidField,
            chosen: z.array(z.string().trim().min(1).max(8)).max(10).default([]),
            text: z.string().max(10000).nullable().optional(),
          })
          .strict()
      )
      .min(1)
      .max(200),
  })
  .strict();

export const TIPE_KEJADIAN = ['keluar_layar', 'kembali', 'salin', 'tempel', 'layar_penuh_keluar', 'kamera_mati'] as const;

export const proctorEventSchema = z
  .object({ type: z.enum(TIPE_KEJADIAN), detail: z.string().trim().max(200).nullable().optional() })
  .strict();

export const proctorPhotoSchema = z.object({ image: z.string().min(100).max(4_000_000) }).strict();

// --- Penilaian esai ---

export const gradeAttemptSchema = z
  .object({
    scores: z
      .array(
        z
          .object({
            questionId: ulidField,
            points: z.coerce.number().min(0).max(100),
            graderNote: z.string().trim().max(1000).nullable().optional(),
          })
          .strict()
      )
      .min(1)
      .max(200),
  })
  .strict();

export const tokenParamSchema = z.object({ token: z.string().trim().length(43) }).strict();

export const questionIdParamSchema = z.object({ id: ulidField, questionId: ulidField }).strict();

export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;
export type ListQuestionQuery = z.infer<typeof listQuestionQuerySchema>;
export type CreateTestInput = z.infer<typeof createTestSchema>;
export type UpdateTestInput = z.infer<typeof updateTestSchema>;
export type SetTestQuestionsInput = z.infer<typeof setTestQuestionsSchema>;
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
export type ListAssignmentQuery = z.infer<typeof listAssignmentQuerySchema>;
export type SaveAnswersInput = z.infer<typeof saveAnswersSchema>;
export type ProctorEventInput = z.infer<typeof proctorEventSchema>;
export type GradeAttemptInput = z.infer<typeof gradeAttemptSchema>;
