// src/utils/cbt.ts
//
// Aturan penilaian CBT, terpisah dari controller supaya bisa diuji langsung
// tanpa basis data. Semua keputusan "benar atau salah" hanya di sini.

/** Tipe butir soal yang dikenal. Kunci ini ikut tersimpan di basis data. */
/**
 * `skala` = butir sikap berskala (Likert) untuk inventori kepribadian: setiap
 * pilihan membawa nilai, tidak ada yang benar atau salah, dan nilainya
 * dijumlahkan per kategori (dimensi) menjadi profil.
 */
export const TIPE_SOAL = ['pilihan_ganda', 'banyak_jawaban', 'benar_salah', 'isian', 'esai', 'skala'] as const;
export type TipeSoal = (typeof TIPE_SOAL)[number];

export const TINGKAT_SOAL = ['mudah', 'sedang', 'sulit'] as const;

/** Soal esai tidak punya kunci: nilainya diberikan penguji. */
export const dinilaiOtomatis = (tipe: string): boolean => tipe !== 'esai';

export interface PilihanSoal {
  kode: string;
  teks: string;
  /** Nilai pilihan pada butir `skala`; tidak ada pada tipe lain. */
  nilai?: number;
}

/** Pilihan jawaban dari kolom Json, dibersihkan dari bentuk yang tidak sah. */
export const bacaPilihan = (options: unknown): PilihanSoal[] => {
  if (!Array.isArray(options)) return [];
  return options.flatMap((o) => {
    if (!o || typeof o !== 'object') return [];
    const { kode, teks, nilai } = o as { kode?: unknown; teks?: unknown; nilai?: unknown };
    if (typeof kode !== 'string' || typeof teks !== 'string') return [];
    return [typeof nilai === 'number' && Number.isFinite(nilai) ? { kode, teks, nilai } : { kode, teks }];
  });
};

/** Pilihan tanpa nilainya, untuk dikirim ke peserta: arah butir terbalik tidak perlu terlihat. */
export const pilihanTanpaNilai = (pilihan: readonly PilihanSoal[]): PilihanSoal[] =>
  pilihan.map(({ kode, teks }) => ({ kode, teks }));

/** Rentang nilai sebuah butir skala, dari pilihannya. Butir tanpa nilai dianggap 0–0. */
export const rentangSkala = (pilihan: readonly PilihanSoal[]): { min: number; max: number } => {
  const nilai = pilihan.map((p) => p.nilai).filter((n): n is number => typeof n === 'number');
  if (nilai.length === 0) return { min: 0, max: 0 };
  return { min: Math.min(...nilai), max: Math.max(...nilai) };
};

/** Peta kode pilihan → nilai, untuk menilai butir skala. */
export const petaNilaiSkala = (pilihan: readonly PilihanSoal[]): Record<string, number> =>
  Object.fromEntries(pilihan.filter((p) => typeof p.nilai === 'number').map((p) => [p.kode, p.nilai as number]));

export type JenisPaket = 'pengetahuan' | 'kepribadian';

/**
 * Paket yang seluruh butirnya skala adalah inventori kepribadian: tidak ada
 * kelulusan, hasilnya profil per dimensi. Diturunkan dari isinya supaya tidak
 * ada kolom yang bisa berselisih dengan kenyataan.
 */
export const jenisPaket = (tipeButir: readonly string[]): JenisPaket =>
  tipeButir.length > 0 && tipeButir.every((t) => t === 'skala') ? 'kepribadian' : 'pengetahuan';

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
  /** Nilai tiap kode pilihan pada butir skala. */
  nilaiPilihan?: Readonly<Record<string, number>>;
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

  if (butir.tipe === 'skala') {
    // Tidak ada benar/salah: nilainya adalah nilai pilihan yang diambil.
    // Butir yang dilewati bernilai nol, bukan "menunggu penilaian".
    const kode = jawaban?.dipilih[0];
    const nilai = kode !== undefined ? butir.nilaiPilihan?.[kode] : undefined;
    return { benar: null, poin: typeof nilai === 'number' ? nilai : 0 };
  }

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
