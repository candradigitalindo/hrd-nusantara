// src/utils/performanceScoring.ts

export const REVIEWER_TYPES = ['self', 'manager', 'peer', 'subordinate'] as const;
export type ReviewerType = (typeof REVIEWER_TYPES)[number];

export interface CriterionInput {
  id: string;
  code: string;
  name: string;
  weight: number;
  maxScore: number;
}

export interface ScoreInput {
  criterionId: string;
  score: number;
}

/** Selisih pembulatan yang masih ditoleransi saat menjumlahkan bobot. */
const TOLERANSI_BOBOT = 0.01;

export interface WeightValidation {
  valid: boolean;
  total: number;
  reason?: string;
}

/**
 * Bobot seluruh kriteria pada satu formulir harus berjumlah 100 persen.
 *
 * Kalau tidak, nilai akhir tidak bisa ditafsirkan: formulir berbobot total 80
 * akan selalu menghasilkan nilai lebih rendah daripada formulir berbobot 100
 * untuk kinerja yang sama persis.
 */
export const validateWeights = (criteria: { weight: number }[]): WeightValidation => {
  if (criteria.length === 0) {
    return { valid: false, total: 0, reason: 'Formulir belum punya kriteria penilaian' };
  }

  const total = criteria.reduce((sum, c) => sum + c.weight, 0);

  if (Math.abs(total - 100) > TOLERANSI_BOBOT) {
    return {
      valid: false,
      total,
      reason: `Jumlah bobot kriteria harus 100, saat ini ${Math.round(total * 100) / 100}`,
    };
  }

  return { valid: true, total };
};

export interface ScoringResult {
  /** Nilai berbobot pada skala 0-100. */
  totalScore: number;
  /** Nilai yang dipetakan kembali ke skala formulir, untuk ditampilkan. */
  rating: number;
  breakdown: {
    criterionId: string;
    code: string;
    name: string;
    score: number;
    maxScore: number;
    weight: number;
    /** Sumbangan kriteria ini terhadap nilai akhir. */
    weightedScore: number;
  }[];
}

export class ScoringError extends Error {
  constructor(
    public readonly code: 'missing_score' | 'unknown_criterion' | 'out_of_range' | 'invalid_weights',
    message: string
  ) {
    super(message);
    this.name = 'ScoringError';
  }
}

/**
 * Menghitung nilai akhir berbobot.
 *
 * Tiap kriteria dinormalkan dulu ke rentang 0-1 terhadap nilai maksimumnya,
 * baru dikalikan bobot. Tanpa normalisasi, kriteria berskala 1-10 akan
 * mendominasi kriteria berskala 1-5 walaupun bobotnya sama.
 */
export const calculateReviewScore = (
  criteria: CriterionInput[],
  scores: ScoreInput[]
): ScoringResult => {
  const cekBobot = validateWeights(criteria);
  if (!cekBobot.valid) {
    throw new ScoringError('invalid_weights', cekBobot.reason!);
  }

  const perId = new Map(scores.map((s) => [s.criterionId, s]));

  // Kriteria yang tidak dikenal menandakan formulirnya berubah setelah
  // penilaian dimulai — lebih baik ditolak daripada diam-diam diabaikan.
  const dikenal = new Set(criteria.map((c) => c.id));
  for (const s of scores) {
    if (!dikenal.has(s.criterionId)) {
      throw new ScoringError(
        'unknown_criterion',
        `Kriteria ${s.criterionId} tidak ada pada formulir ini`
      );
    }
  }

  const breakdown = criteria.map((kriteria) => {
    const nilai = perId.get(kriteria.id);

    if (!nilai) {
      throw new ScoringError(
        'missing_score',
        `Kriteria "${kriteria.name}" belum dinilai`
      );
    }

    if (nilai.score < 0 || nilai.score > kriteria.maxScore) {
      throw new ScoringError(
        'out_of_range',
        `Nilai "${kriteria.name}" harus antara 0 dan ${kriteria.maxScore}`
      );
    }

    const ternormalisasi = kriteria.maxScore === 0 ? 0 : nilai.score / kriteria.maxScore;

    return {
      criterionId: kriteria.id,
      code: kriteria.code,
      name: kriteria.name,
      score: nilai.score,
      maxScore: kriteria.maxScore,
      weight: kriteria.weight,
      weightedScore: Math.round(ternormalisasi * kriteria.weight * 100) / 100,
    };
  });

  const totalScore =
    Math.round(breakdown.reduce((sum, b) => sum + b.weightedScore, 0) * 100) / 100;

  // Dipetakan ke skala maksimum terbesar yang dipakai formulir, supaya angka
  // yang ditampilkan sejalan dengan skala yang diisi penilai.
  const skala = Math.max(...criteria.map((c) => c.maxScore));

  return {
    totalScore,
    rating: Math.round((totalScore / 100) * skala * 100) / 100,
    breakdown,
  };
};

export interface ReviewSummaryInput {
  reviewerType: ReviewerType;
  totalScore: number;
}

/**
 * Merangkum beberapa penilaian 360 derajat atas satu orang.
 *
 * Rata-rata dihitung per sudut pandang lebih dulu, baru dirata-ratakan lagi.
 * Kalau semua penilaian dirata-ratakan langsung, seorang karyawan dengan lima
 * rekan sejawat dan satu atasan akan nilainya ditentukan hampir sepenuhnya
 * oleh rekan sejawat — padahal penilaian atasan tidak kalah penting.
 */
export const summarize360 = (
  reviews: ReviewSummaryInput[]
): {
  overall: number | null;
  byReviewerType: { reviewerType: ReviewerType; count: number; averageScore: number }[];
} => {
  if (reviews.length === 0) return { overall: null, byReviewerType: [] };

  const kelompok = new Map<ReviewerType, number[]>();
  for (const r of reviews) {
    const daftar = kelompok.get(r.reviewerType) ?? [];
    daftar.push(r.totalScore);
    kelompok.set(r.reviewerType, daftar);
  }

  const byReviewerType = [...kelompok.entries()].map(([reviewerType, nilai]) => ({
    reviewerType,
    count: nilai.length,
    averageScore: Math.round((nilai.reduce((s, v) => s + v, 0) / nilai.length) * 100) / 100,
  }));

  const overall =
    Math.round(
      (byReviewerType.reduce((s, k) => s + k.averageScore, 0) / byReviewerType.length) * 100
    ) / 100;

  return { overall, byReviewerType };
};
