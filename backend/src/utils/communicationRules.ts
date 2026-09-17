// src/utils/communicationRules.ts

export const ANNOUNCEMENT_PRIORITIES = ['normal', 'important', 'urgent'] as const;
export const QUESTION_TYPES = ['scale', 'text', 'choice'] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export interface AudienceTarget {
  targetDepartmentId: string | null;
}

/**
 * Apakah seorang karyawan termasuk sasaran sebuah pengumuman atau survei.
 *
 * Tanpa departemen sasaran berarti ditujukan untuk semua orang. Karyawan yang
 * belum punya departemen tidak pernah termasuk sasaran yang menyebut departemen
 * tertentu — memasukkannya akan menghasilkan daftar penerima yang keliru.
 */
export const isTargeted = (
  target: AudienceTarget,
  employee: { departmentId: string | null }
): boolean => {
  if (target.targetDepartmentId === null) return true;
  return employee.departmentId === target.targetDepartmentId;
};

export interface QuestionSpec {
  id: string;
  code: string;
  text: string;
  type: QuestionType;
  options: string[] | null;
  minScale: number | null;
  maxScale: number | null;
  isRequired: boolean;
}

export interface AnswerInput {
  questionId: string;
  scaleValue?: number | null;
  textValue?: string | null;
  choiceValue?: string | null;
}

export class SurveyAnswerError extends Error {
  constructor(
    public readonly code:
      | 'unknown_question'
      | 'missing_required'
      | 'wrong_type'
      | 'out_of_scale'
      | 'invalid_choice',
    message: string
  ) {
    super(message);
    this.name = 'SurveyAnswerError';
  }
}

/**
 * Memvalidasi jawaban terhadap bentuk pertanyaannya.
 *
 * Inilah yang tidak mungkin dilakukan saat pertanyaan dan jawaban sama-sama
 * disimpan sebagai Json bebas: nilai skala di luar rentang, pilihan yang tidak
 * ada dalam daftar, atau pertanyaan wajib yang dilewati semuanya akan lolos
 * tanpa ketahuan, dan baru terlihat saat hasilnya diagregasi.
 */
export const validateAnswers = (
  questions: QuestionSpec[],
  answers: AnswerInput[]
): void => {
  const perId = new Map(questions.map((q) => [q.id, q]));

  for (const jawaban of answers) {
    if (!perId.has(jawaban.questionId)) {
      throw new SurveyAnswerError(
        'unknown_question',
        `Pertanyaan ${jawaban.questionId} bukan bagian dari survei ini`
      );
    }
  }

  const terjawab = new Map(answers.map((a) => [a.questionId, a]));

  for (const soal of questions) {
    const jawaban = terjawab.get(soal.id);

    if (!jawaban) {
      if (soal.isRequired) {
        throw new SurveyAnswerError(
          'missing_required',
          `Pertanyaan "${soal.text}" wajib dijawab`
        );
      }
      continue;
    }

    if (soal.type === 'scale') {
      if (typeof jawaban.scaleValue !== 'number') {
        throw new SurveyAnswerError(
          'wrong_type',
          `Pertanyaan "${soal.text}" membutuhkan jawaban berupa angka skala`
        );
      }
      const min = soal.minScale ?? 1;
      const max = soal.maxScale ?? 5;
      if (jawaban.scaleValue < min || jawaban.scaleValue > max) {
        throw new SurveyAnswerError(
          'out_of_scale',
          `Jawaban "${soal.text}" harus antara ${min} dan ${max}`
        );
      }
      continue;
    }

    if (soal.type === 'choice') {
      if (typeof jawaban.choiceValue !== 'string') {
        throw new SurveyAnswerError(
          'wrong_type',
          `Pertanyaan "${soal.text}" membutuhkan salah satu pilihan`
        );
      }
      if (!(soal.options ?? []).includes(jawaban.choiceValue)) {
        throw new SurveyAnswerError(
          'invalid_choice',
          `"${jawaban.choiceValue}" bukan pilihan yang tersedia untuk "${soal.text}"`
        );
      }
      continue;
    }

    // type 'text'
    if (typeof jawaban.textValue !== 'string' || jawaban.textValue.trim() === '') {
      throw new SurveyAnswerError(
        'wrong_type',
        `Pertanyaan "${soal.text}" membutuhkan jawaban teks`
      );
    }
  }
};

export interface ScaleAggregate {
  questionId: string;
  code: string;
  text: string;
  type: QuestionType;
  responseCount: number;
  average: number | null;
  distribution: Record<string, number>;
}

/**
 * Merangkum jawaban per pertanyaan.
 *
 * Rata-rata hanya bermakna untuk pertanyaan berskala. Untuk pilihan, yang
 * berguna adalah sebarannya; untuk teks, hanya jumlah yang menjawab —
 * merata-ratakan keduanya akan menghasilkan angka yang terlihat sah tapi
 * tidak berarti apa-apa.
 */
export const aggregateAnswers = (
  questions: QuestionSpec[],
  answers: { questionId: string; scaleValue: number | null; choiceValue: string | null; textValue: string | null }[]
): ScaleAggregate[] =>
  questions.map((soal) => {
    const miliknya = answers.filter((a) => a.questionId === soal.id);
    const distribution: Record<string, number> = {};

    let average: number | null = null;

    if (soal.type === 'scale') {
      const nilai = miliknya
        .map((a) => a.scaleValue)
        .filter((v): v is number => v !== null);

      for (const v of nilai) {
        distribution[String(v)] = (distribution[String(v)] ?? 0) + 1;
      }

      average =
        nilai.length > 0
          ? Math.round((nilai.reduce((s, v) => s + v, 0) / nilai.length) * 100) / 100
          : null;
    }

    if (soal.type === 'choice') {
      for (const a of miliknya) {
        if (a.choiceValue === null) continue;
        distribution[a.choiceValue] = (distribution[a.choiceValue] ?? 0) + 1;
      }
    }

    return {
      questionId: soal.id,
      code: soal.code,
      text: soal.text,
      type: soal.type,
      responseCount: miliknya.length,
      average,
      distribution,
    };
  });
