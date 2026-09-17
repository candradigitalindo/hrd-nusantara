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
const JEDA_AWAL_MS = 1_000;
const JEDA_MAKS_MS = 60_000;

export interface KeputusanReconnect {
  sambungUlang: boolean;
  /** Sesi mati sampai ada yang scan QR lagi. */
  perluScanUlang: boolean;
  jedaMs: number;
  catatan: string;
}

/**
 * @param kode kode putus, atau undefined kalau tidak terbaca.
 * @param percobaan berapa kali sudah dicoba sambung ulang secara beruntun.
 */
export const putuskanReconnect = (
  kode: number | undefined,
  percobaan: number
): KeputusanReconnect => {
  const jeda = Math.min(JEDA_AWAL_MS * 2 ** Math.max(0, percobaan), JEDA_MAKS_MS);

  switch (kode) {
    // Sesi sudah tidak sah lagi. Menyambung ulang dengan kredensial yang
    // sama hanya akan ditolak berulang-ulang.
    case ALASAN_PUTUS.loggedOut:
      return { sambungUlang: false, perluScanUlang: true, jedaMs: 0, catatan: 'Sesi di-logout dari perangkat. Perlu scan QR ulang.' };
    case ALASAN_PUTUS.badSession:
      return { sambungUlang: false, perluScanUlang: true, jedaMs: 0, catatan: 'Kredensial sesi rusak. Perlu scan QR ulang.' };
    case ALASAN_PUTUS.multideviceMismatch:
      return { sambungUlang: false, perluScanUlang: true, jedaMs: 0, catatan: 'Ketidakcocokan multi-perangkat. Perlu scan QR ulang.' };

    // Nomor diblokir WhatsApp. Mencoba terus justru memperburuk keadaan.
    case ALASAN_PUTUS.forbidden:
      return { sambungUlang: false, perluScanUlang: false, jedaMs: 0, catatan: 'Nomor ditolak WhatsApp (forbidden). Perlu ditangani manual.' };

    // Perangkat lain mengambil alih sesi. Kalau di sini disambung ulang,
    // keduanya akan saling memutus tanpa henti.
    case ALASAN_PUTUS.connectionReplaced:
      return { sambungUlang: false, perluScanUlang: false, jedaMs: 0, catatan: 'Sesi diambil alih perangkat lain.' };

    // Baileys memang meminta proses disambung ulang setelah pairing.
    case ALASAN_PUTUS.restartRequired:
      return { sambungUlang: true, perluScanUlang: false, jedaMs: 0, catatan: 'Restart diminta oleh WhatsApp.' };

    default:
      break;
  }

  // Sisanya gangguan sementara: jaringan putus, server WhatsApp sibuk.
  if (percobaan >= MAKS_PERCOBAAN) {
    return {
      sambungUlang: false,
      perluScanUlang: false,
      jedaMs: 0,
      catatan: `Gagal menyambung ulang setelah ${MAKS_PERCOBAAN} percobaan. Perlu disambungkan manual.`,
    };
  }

  return {
    sambungUlang: true,
    perluScanUlang: false,
    jedaMs: jeda,
    catatan: `Koneksi terputus (kode ${kode ?? 'tidak diketahui'}). Menyambung ulang dalam ${Math.round(jeda / 1000)} detik.`,
  };
};
