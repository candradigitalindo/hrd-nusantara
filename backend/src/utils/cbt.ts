// src/utils/cbt.ts
//
// Aturan penilaian CBT, terpisah dari controller supaya bisa diuji langsung
// tanpa basis data. Semua keputusan "benar atau salah" hanya di sini.

/** Tipe butir soal yang dikenal. Kunci ini ikut tersimpan di basis data. */
export const TIPE_SOAL = ['pilihan_ganda', 'banyak_jawaban', 'benar_salah', 'isian', 'esai'] as const;
export type TipeSoal = (typeof TIPE_SOAL)[number];

export const TINGKAT_SOAL = ['mudah', 'sedang', 'sulit'] as const;

/** Soal esai tidak punya kunci: nilainya diberikan penguji. */
export const dinilaiOtomatis = (tipe: string): boolean => tipe !== 'esai';

export interface PilihanSoal {
  kode: string;
  teks: string;
}

/** Pilihan jawaban dari kolom Json, dibersihkan dari bentuk yang tidak sah. */
export const bacaPilihan = (options: unknown): PilihanSoal[] => {
  if (!Array.isArray(options)) return [];
  return options.flatMap((o) => {
    if (!o || typeof o !== 'object') return [];
    const { kode, teks } = o as { kode?: unknown; teks?: unknown };
    return typeof kode === 'string' && typeof teks === 'string' ? [{ kode, teks }] : [];
  });
};

/**
 * Pembandingan jawaban isian: spasi berlebih dan besar-kecil huruf diabaikan.
 * Lebih dari itu (sinonim, salah ketik) memang tidak bisa diputuskan mesin —
 * untuk itulah tipe esai ada.
 */
const bakukan = (teks: string) => teks.trim().toLowerCase().replace(/\s+/g, ' ');

export interface ButirDinilai {
  tipe: string;
  /** Kode pilihan yang benar, atau daftar teks yang diterima untuk isian. */
  kunci: readonly string[];
  /** Bobot nilai butir ini. */
  poin: number;
}

export interface JawabanPeserta {
  /** Kode pilihan yang dipilih peserta. */
  dipilih: readonly string[];
  /** Jawaban isian atau esai. */
  teks?: string | null;
}

export interface HasilButir {
  /** null berarti belum bisa diputuskan mesin (esai). */
  benar: boolean | null;
  /** null berarti menunggu penilaian penguji. */
  poin: number | null;
}

/**
 * Menilai satu butir.
 *
 * Jawaban ganda dinilai penuh atau nol, bukan sebagian: nilai sebagian
 * membuat menebak semua pilihan jadi strategi yang menguntungkan.
 */
export const nilaiButir = (butir: ButirDinilai, jawaban: JawabanPeserta | null): HasilButir => {
  if (!dinilaiOtomatis(butir.tipe)) return { benar: null, poin: null };
  if (!jawaban) return { benar: false, poin: 0 };

  if (butir.tipe === 'isian') {
    const teks = (jawaban.teks ?? '').trim();
    if (!teks) return { benar: false, poin: 0 };
    const benar = butir.kunci.some((k) => bakukan(k) === bakukan(teks));
    return { benar, poin: benar ? butir.poin : 0 };
  }

  const dipilih = [...new Set(jawaban.dipilih)].sort();
  const kunci = [...new Set(butir.kunci)].sort();
  if (dipilih.length === 0) return { benar: false, poin: 0 };
  const benar = dipilih.length === kunci.length && dipilih.every((k, i) => k === kunci[i]);
  return { benar, poin: benar ? butir.poin : 0 };
};

/** Nilai satu pengerjaan, dipisah objektif dan esai supaya terlihat mana yang masih menunggu. */
export interface RingkasanNilai {
  objektif: number;
  esai: number;
  total: number;
  maksimal: number;
  persen: number;
  /** null bila paket tidak menetapkan ambang. */
  lulus: boolean | null;
  /** Masih ada butir esai yang belum dinilai penguji. */
  menungguPenilaian: boolean;
}

export const hitungNilai = (
  butir: readonly { tipe: string; poin: number; poinDiperoleh: number | null }[],
  ambangPersen: number | null | undefined
): RingkasanNilai => {
  let objektif = 0;
  let esai = 0;
  let maksimal = 0;
  let menunggu = false;

  for (const b of butir) {
    maksimal += b.poin;
    if (b.poinDiperoleh === null) {
      // Butir esai yang belum dinilai tidak dihitung nol: nilainya belum ada.
      if (!dinilaiOtomatis(b.tipe)) menunggu = true;
      continue;
    }
    if (dinilaiOtomatis(b.tipe)) objektif += b.poinDiperoleh;
    else esai += b.poinDiperoleh;
  }

  const total = objektif + esai;
  // Pembulatan dua angka di belakang koma; tanpa ini 0.1+0.2 muncul di UI.
  const bulat = (n: number) => Math.round(n * 100) / 100;
  const persen = maksimal > 0 ? bulat((total / maksimal) * 100) : 0;

  return {
    objektif: bulat(objektif),
    esai: bulat(esai),
    total: bulat(total),
    maksimal: bulat(maksimal),
    persen,
    // Kelulusan ditahan sampai seluruh esai dinilai: menyatakan "tidak lulus"
    // sebelum jawaban esainya dibaca adalah kesimpulan yang belum berhak.
    lulus: ambangPersen === null || ambangPersen === undefined || menunggu ? null : persen >= ambangPersen,
    menungguPenilaian: menunggu,
  };
};

/**
 * Pengacakan Fisher-Yates. Urutan hasilnya disimpan di basis data supaya
 * pengerjaan yang terputus bisa dilanjutkan dengan urutan yang sama.
 */
export const acak = <T>(daftar: readonly T[], rng: () => number = Math.random): T[] => {
  const hasil = [...daftar];
  for (let i = hasil.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [hasil[i], hasil[j]] = [hasil[j], hasil[i]];
  }
  return hasil;
};

/** Sisa waktu dalam detik; 0 berarti waktu habis. */
export const sisaDetik = (batas: Date, sekarang: Date = new Date()): number =>
  Math.max(0, Math.floor((batas.getTime() - sekarang.getTime()) / 1000));
