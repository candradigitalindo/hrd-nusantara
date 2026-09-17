// src/utils/recruitmentStages.ts

export const CANDIDATE_STAGES = [
  'applied',
  'screening',
  'interview',
  'offer',
  'hired',
  'rejected',
  'withdrawn',
] as const;

export type CandidateStage = (typeof CANDIDATE_STAGES)[number];

/** Tahap yang sudah menutup proses; tidak bisa dilanjutkan tanpa dibuka ulang. */
export const TERMINAL_STAGES: CandidateStage[] = ['hired', 'withdrawn'];

/**
 * Perpindahan tahap yang diizinkan.
 *
 * Mundur satu langkah sengaja dibolehkan (misalnya dari interview kembali ke
 * screening) karena dalam praktiknya proses rekrutmen memang bisa berputar —
 * pelamar diminta melengkapi berkas, atau jadwal wawancara diulang.
 *
 * Yang tidak boleh adalah melompat ke 'hired': tahap itu hanya tercapai lewat
 * proses penerimaan yang sekaligus membuatkan data karyawan. Kalau bisa
 * diset langsung, akan ada pelamar berstatus diterima tanpa pernah menjadi
 * karyawan di sistem.
 */
const ALLOWED: Record<CandidateStage, CandidateStage[]> = {
  applied: ['screening', 'interview', 'rejected', 'withdrawn'],
  screening: ['interview', 'offer', 'applied', 'rejected', 'withdrawn'],
  interview: ['offer', 'screening', 'rejected', 'withdrawn'],
  offer: ['interview', 'rejected', 'withdrawn'],
  // Sudah diterima: perubahan status selanjutnya urusan modul kepegawaian.
  hired: [],
  // Ditolak masih bisa dibuka ulang, misalnya untuk lowongan lain.
  rejected: ['screening'],
  withdrawn: [],
};

export interface TransitionCheck {
  allowed: boolean;
  reason?: string;
}

export const canTransition = (from: CandidateStage, to: CandidateStage): TransitionCheck => {
  if (from === to) {
    return { allowed: false, reason: `Pelamar sudah berada di tahap "${to}"` };
  }

  if (to === 'hired') {
    return {
      allowed: false,
      reason:
        'Tahap "hired" tidak bisa diset langsung. Pakai proses penerimaan ' +
        'agar data karyawannya sekaligus terbentuk.',
    };
  }

  if (!ALLOWED[from].includes(to)) {
    const pilihan = ALLOWED[from];
    return {
      allowed: false,
      reason: pilihan.length
        ? `Dari "${from}" hanya bisa pindah ke: ${pilihan.join(', ')}`
        : `Tahap "${from}" sudah final dan tidak bisa diubah`,
    };
  }

  return { allowed: true };
};

/** Apakah pelamar boleh diterima menjadi karyawan dari tahapnya sekarang. */
export const canHire = (from: CandidateStage): TransitionCheck => {
  if (from === 'hired') {
    return { allowed: false, reason: 'Pelamar ini sudah diterima' };
  }
  if (from !== 'offer') {
    return {
      allowed: false,
      reason: `Penerimaan hanya dari tahap "offer", pelamar ini di tahap "${from}"`,
    };
  }
  return { allowed: true };
};

/** Urutan tahap dalam corong rekrutmen, untuk laporan. */
export const FUNNEL_ORDER: CandidateStage[] = [
  'applied',
  'screening',
  'interview',
  'offer',
  'hired',
];

export interface StageEvent {
  toStage: string;
  createdAt: Date;
}

/**
 * Lama proses dari lamaran masuk sampai diterima, dalam hari.
 * Mengembalikan null bila pelamar belum mencapai tahap diterima.
 */
export const daysToHire = (applicationDate: Date, events: StageEvent[]): number | null => {
  const diterima = events
    .filter((e) => e.toStage === 'hired')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

  if (!diterima) return null;

  const selisih = diterima.createdAt.getTime() - applicationDate.getTime();
  return Math.max(0, Math.round(selisih / (24 * 60 * 60 * 1000)));
};
