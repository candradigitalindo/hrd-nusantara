// src/services/whatsapp/reconnect.ts
//
// Menentukan apa yang harus dilakukan saat koneksi WhatsApp terputus.
//
// Ini dipisah menjadi fungsi murni karena bagian inilah yang paling mudah
// salah dan paling mahal kalau salah: menyambung ulang pada kasus "sesi
// diambil alih perangkat lain" membuat dua sesi saling menendang tanpa henti,
// sedangkan TIDAK menyambung ulang pada gangguan jaringan biasa membuat
// nomor perusahaan diam-diam berhenti terpantau sampai ada yang sadar.

/** Kode putus dari Baileys (DisconnectReason). Ditulis ulang di sini supaya
 *  modul ini tidak bergantung pada pustakanya dan bisa diuji sendirian. */
export const ALASAN_PUTUS = {
  loggedOut: 401,
  forbidden: 403,
  timedOut: 408,
  multideviceMismatch: 411,
  connectionClosed: 428,
  connectionReplaced: 440,
  badSession: 500,
  unavailableService: 503,
  restartRequired: 515,
} as const;

export const MAKS_PERCOBAAN = 10;

/**
 * Berapa kali QR dibuat untuk satu permintaan sambung. WhatsApp menutup tiap
 * QR yang tidak dipindai setelah ±2,5 menit, jadi tiga putaran memberi orang
 * di depan layar sekitar delapan menit.
 */
export const MAKS_PUTARAN_QR = 3;
const JEDA_AWAL_MS = 1_000;
const JEDA_MAKS_MS = 60_000;

export interface KeputusanReconnect {
  sambungUlang: boolean;
  /** Sesi mati sampai ada yang scan QR lagi. */
  perluScanUlang: boolean;
  jedaMs: number;
  catatan: string;
  /**
   * Keputusan ini tentang QR yang belum dipindai, bukan sesi yang putus.
   * Belum ada sesi, jadi tidak ada kejadian putus yang perlu dicatat atau
   * diberitahukan.
   */
  tahapQr: boolean;
}

export interface OpsiReconnect {
  /** Koneksi tertutup saat QR sedang ditampilkan dan belum dipindai. */
  menungguScan?: boolean;
}

/**
 * @param kode kode putus, atau undefined kalau tidak terbaca.
 * @param percobaan berapa kali sudah dicoba sambung ulang secara beruntun.
 */
export const putuskanReconnect = (
  kode: number | undefined,
  percobaan: number,
  opsi: OpsiReconnect = {}
): KeputusanReconnect => {
  const jeda = Math.min(JEDA_AWAL_MS * 2 ** Math.max(0, percobaan), JEDA_MAKS_MS);

  switch (kode) {
    // Sesi sudah tidak sah lagi. Menyambung ulang dengan kredensial yang
    // sama hanya akan ditolak berulang-ulang.
    case ALASAN_PUTUS.loggedOut:
      return { sambungUlang: false, perluScanUlang: true, jedaMs: 0, catatan: 'Sesi di-logout dari perangkat. Perlu scan QR ulang.', tahapQr: false };
    case ALASAN_PUTUS.badSession:
      return { sambungUlang: false, perluScanUlang: true, jedaMs: 0, catatan: 'Kredensial sesi rusak. Perlu scan QR ulang.', tahapQr: false };
    case ALASAN_PUTUS.multideviceMismatch:
      return { sambungUlang: false, perluScanUlang: true, jedaMs: 0, catatan: 'Ketidakcocokan multi-perangkat. Perlu scan QR ulang.', tahapQr: false };

    // Nomor diblokir WhatsApp. Mencoba terus justru memperburuk keadaan.
    case ALASAN_PUTUS.forbidden:
      return { sambungUlang: false, perluScanUlang: false, jedaMs: 0, catatan: 'Nomor ditolak WhatsApp (forbidden). Perlu ditangani manual.', tahapQr: false };

    // Perangkat lain mengambil alih sesi. Kalau di sini disambung ulang,
    // keduanya akan saling memutus tanpa henti.
    case ALASAN_PUTUS.connectionReplaced:
      return { sambungUlang: false, perluScanUlang: false, jedaMs: 0, catatan: 'Sesi diambil alih perangkat lain.', tahapQr: false };

    // Baileys memang meminta proses disambung ulang setelah pairing.
    case ALASAN_PUTUS.restartRequired:
      return { sambungUlang: true, perluScanUlang: false, jedaMs: 0, catatan: 'Restart diminta oleh WhatsApp.', tahapQr: false };

    default:
      break;
  }

  // QR yang tidak dipindai ditutup WhatsApp dengan 408 — kode yang sama
  // dengan koneksi yang putus karena jaringan. Diperlakukan sebagai putus
  // jaringan, QR terus dibuat ulang selama setengah jam untuk layar yang
  // mungkin tidak pernah dibuka, dan nomor yang belum pernah tertaut
  // berakhir tercatat "terputus".
  if (opsi.menungguScan) {
    if (percobaan + 1 >= MAKS_PUTARAN_QR) {
      return {
        sambungUlang: false,
        perluScanUlang: true,
        jedaMs: 0,
        catatan: 'QR tidak dipindai sampai kedaluwarsa. Minta QR baru untuk menautkan.',
        tahapQr: true,
      };
    }
    return { sambungUlang: true, perluScanUlang: false, jedaMs: 0, catatan: 'QR kedaluwarsa, membuat QR baru.', tahapQr: true };
  }

  // Sisanya gangguan sementara: jaringan putus, server WhatsApp sibuk.
  if (percobaan >= MAKS_PERCOBAAN) {
    return {
      sambungUlang: false,
      perluScanUlang: false,
      jedaMs: 0,
      catatan: `Gagal menyambung ulang setelah ${MAKS_PERCOBAAN} percobaan. Perlu disambungkan manual.`,
      tahapQr: false,
    };
  }

  return {
    sambungUlang: true,
    perluScanUlang: false,
    jedaMs: jeda,
    catatan: `Koneksi terputus (kode ${kode ?? 'tidak diketahui'}). Menyambung ulang dalam ${Math.round(jeda / 1000)} detik.`,
    tahapQr: false,
  };
};
