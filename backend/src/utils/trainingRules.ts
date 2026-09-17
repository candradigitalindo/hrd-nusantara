// src/utils/trainingRules.ts

export const REGISTRATION_STATUSES = [
  'registered',
  'waitlisted',
  'attended',
  'completed',
  'failed',
  'no_show',
  'cancelled',
] as const;

export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/** Status yang masih memakai satu kursi pada sesi. */
export const SEAT_HOLDING_STATUSES: RegistrationStatus[] = [
  'registered',
  'attended',
  'completed',
  'failed',
  'no_show',
];

/**
 * Menentukan status pendaftaran baru terhadap kuota.
 *
 * Pendaftar yang melebihi kuota masuk daftar tunggu, bukan ditolak: di
 * operasional restoran dan hotel, pembatalan menjelang hari-H itu lazim, dan
 * daftar tunggu membuat kursi kosong langsung terisi.
 */
export const decideRegistrationStatus = (params: {
  maxParticipants: number | null;
  occupiedSeats: number;
}): RegistrationStatus => {
  if (params.maxParticipants === null) return 'registered';
  return params.occupiedSeats < params.maxParticipants ? 'registered' : 'waitlisted';
};

export interface EvaluationOutcome {
  status: RegistrationStatus;
  passed: boolean;
  expiresAt: Date | null;
}

/**
 * Menilai hasil evaluasi pasca-pelatihan.
 *
 * Program tanpa nilai minimum (`passingScore` null) berarti pelatihan tanpa
 * ujian: kehadiran saja sudah dihitung selesai.
 */
export const evaluateTraining = (params: {
  score: number | null;
  passingScore: number | null;
  validityMonths: number | null;
  completedAt: Date;
}): EvaluationOutcome => {
  const { score, passingScore, validityMonths, completedAt } = params;

  const passed = passingScore === null ? true : score !== null && score >= passingScore;

  return {
    status: passed ? 'completed' : 'failed',
    passed,
    // Masa berlaku hanya diberikan pada kelulusan; yang tidak lulus tidak
    // punya apa pun untuk kedaluwarsa.
    expiresAt: passed && validityMonths !== null ? addMonths(completedAt, validityMonths) : null,
  };
};

/**
 * Menambahkan bulan dengan menjaga tanggal tetap sah.
 *
 * Menambah satu bulan pada 31 Januari akan meluber ke 3 Maret bila memakai
 * setMonth apa adanya. Di sini dijepit ke hari terakhir bulan tujuan.
 */
export const addMonths = (date: Date, months: number): Date => {
  const tahun = date.getUTCFullYear();
  const bulan = date.getUTCMonth() + months;
  const hari = date.getUTCDate();

  const hariTerakhir = new Date(Date.UTC(tahun, bulan + 1, 0)).getUTCDate();

  return new Date(
    Date.UTC(
      tahun,
      bulan,
      Math.min(hari, hariTerakhir),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    )
  );
};

export type ComplianceState = 'compliant' | 'expiring_soon' | 'expired' | 'never_completed';

export interface ComplianceInput {
  passed: boolean;
  completedAt: Date | null;
  expiresAt: Date | null;
}

/**
 * Status kepatuhan seorang karyawan terhadap satu program wajib.
 *
 * "Akan kedaluwarsa" dipisahkan dari "masih berlaku" supaya HR bisa
 * menjadwalkan pelatihan ulang sebelum sertifikatnya mati — bukan setelahnya,
 * yang berarti karyawan sempat bekerja tanpa kualifikasi yang disyaratkan.
 */
export const assessCompliance = (
  records: ComplianceInput[],
  now: Date,
  warningDays: number
): { state: ComplianceState; validUntil: Date | null } => {
  const lulus = records.filter((r) => r.passed && r.completedAt !== null);

  if (lulus.length === 0) return { state: 'never_completed', validUntil: null };

  // Yang dipakai adalah kelulusan dengan masa berlaku terjauh; kelulusan
  // tanpa kedaluwarsa mengalahkan semuanya.
  const abadi = lulus.some((r) => r.expiresAt === null);
  if (abadi) return { state: 'compliant', validUntil: null };

  const terjauh = lulus
    .map((r) => r.expiresAt!)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  if (terjauh.getTime() <= now.getTime()) {
    return { state: 'expired', validUntil: terjauh };
  }

  const ambang = new Date(now.getTime() + warningDays * 24 * 60 * 60 * 1000);

  return {
    state: terjauh.getTime() <= ambang.getTime() ? 'expiring_soon' : 'compliant',
    validUntil: terjauh,
  };
};
