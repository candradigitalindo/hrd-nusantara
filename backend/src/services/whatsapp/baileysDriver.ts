// src/services/whatsapp/baileysDriver.ts
//
// Satu-satunya berkas yang benar-benar menyentuh pustaka Baileys.
//
// Pemuatannya dinamis dan baru terjadi saat driver dinyalakan: Baileys
// membawa protobuf, WebSocket, dan jembatan WASM yang tidak ada gunanya
// dimuat pada instance yang hanya melayani API biasa. Sisa sistem cukup
// mengenal antarmuka SoketWhatsApp, jadi pergantian versi pustaka —
// 7.x masih berstatus RC — berhenti di berkas ini.
import type { PembuatSoket, SoketWhatsApp } from './session';
import { muatAuthState, type AlatBaileys } from './authStore';

/**
 * Versi protokol diambil dari WhatsApp paling sering sekali per 6 jam dan
 * tidak ditunggu lebih dari 10 detik. Dulu diambil pada setiap pembukaan
 * soket: saat jaringan keluar sedang bermasalah — justru saat sambung ulang
 * paling sering terjadi — permintaan ini ikut lambat dan menunda setiap
 * percobaan. Bila gagal dan belum ada cache, Baileys memakai versi bawaannya.
 */
const UMUR_CACHE_VERSI_MS = 6 * 60 * 60 * 1000;
const BATAS_AMBIL_VERSI_MS = 10_000;
let versiTersimpan: { version: unknown; pada: number } | null = null;

const versiProtokol = async (ambilVersi: () => Promise<{ version: unknown }>): Promise<unknown | undefined> => {
  if (versiTersimpan && Date.now() - versiTersimpan.pada < UMUR_CACHE_VERSI_MS) return versiTersimpan.version;

  const ambil = ambilVersi().then(
    (h) => h.version,
    () => null
  );
  const batas = new Promise<null>((selesai) => {
    const t = setTimeout(() => selesai(null), BATAS_AMBIL_VERSI_MS);
    t.unref?.();
  });
  const hasil = await Promise.race([ambil, batas]);
  if (hasil) {
    versiTersimpan = { version: hasil, pada: Date.now() };
    return hasil;
  }
  // Jawaban yang datang terlambat tetap disimpan untuk pembukaan berikutnya.
  void ambil.then((h) => {
    if (h) versiTersimpan = { version: h, pada: Date.now() };
  });
  return versiTersimpan?.version;
};

export const buatPembuatSoketBaileys = (): PembuatSoket => async ({ accountId }) => {
  const baileys = await import('baileys');
  const makeWASocket = (baileys as unknown as { default?: unknown }).default ?? baileys.makeWASocket;
  const {
    fetchLatestBaileysVersion,
    Browsers,
    downloadMediaMessage,
    makeCacheableSignalKeyStore,
    BufferJSON,
    initAuthCreds,
    proto,
  } = baileys;

  // Kredensial sesi di database, terenkripsi: setara akses penuh ke akun
  // WhatsApp itu. Lihat authStore.ts.
  const { state, saveCreds } = await muatAuthState(accountId, {
    BufferJSON,
    initAuthCreds,
    proto,
  } as unknown as AlatBaileys);

  // Versi protokol diambil dari WhatsApp, bukan dipatok: versi yang basi
  // ditolak sambungannya dan gejalanya menyesatkan ("connection closed").
  const version = await versiProtokol(fetchLatestBaileysVersion as () => Promise<{ version: unknown }>);

  const { default: pino } = await import('pino');
  // Log Baileys sangat berisik dan memuat isi pesan. Menuliskannya ke log
  // server berarti isi percakapan bocor ke tempat yang tidak terenkripsi,
  // persis yang dihindari oleh enkripsi kolom.
  const logger = pino({ level: 'silent' });

  const sock = (makeWASocket as (opsi: unknown) => unknown)({
    ...(version ? { version } : {}),
    // Jabat tangan diberi 30 detik (bawaan 20): saat jaringan sedang buruk,
    // percobaan yang gagal persis di detik ke-20 lalu diulang dari awal
    // hanya memperpanjang gangguan. Ping tiap 30 detik; diam lebih dari 35
    // detik dianggap putus (kode 408) dan disambung ulang.
    connectTimeoutMs: 30_000,
    keepAliveIntervalMs: 30_000,
    defaultQueryTimeoutMs: 60_000,
    auth: {
      creds: state.creds,
      // Kunci Signal dibaca untuk hampir setiap pesan. Cache di memori di
      // depan database menjaga jumlah kueri tetap kecil walau banyak nomor
      // tersambung bersamaan.
      keys: (makeCacheableSignalKeyStore as (simpanan: unknown, log: unknown) => unknown)(state.keys, logger),
    },
    logger,
    browser: Browsers.ubuntu('HRD Nusantara'),
    // Jangan menandai nomor sebagai online: kalau ditandai, WhatsApp berhenti
    // mengirim notifikasi ke ponsel pemegang nomor, dan pemantauan jadi
    // mengganggu pekerjaan yang dipantaunya.
    markOnlineOnConnect: false,
    // Jangan menarik seluruh riwayat lama. Selain berat, mengarsipkan
    // percakapan dari sebelum pemantauan disetujui berada di luar ruang
    // lingkup yang disepakati.
    syncFullHistory: false,
  });

  const soket = sock as SoketWhatsApp & {
    updateMediaMessage?: (pesan: unknown) => Promise<unknown>;
  };

  // Gambar, video, dan pesan suara tidak punya teks: tanpa berkasnya arsip
  // tidak memuat isi pesan sama sekali. Kuncinya ada di dalam pesan, jadi
  // pengunduhannya hanya bisa dilakukan dari sini.
  soket.unduhMedia = async (pesan: unknown) => {
    const isi = await (downloadMediaMessage as (
      pesan: unknown,
      jenis: 'buffer',
      opsi: Record<string, unknown>,
      konteks: Record<string, unknown>
    ) => Promise<Buffer>)(
      pesan,
      'buffer',
      {},
      {
        logger,
        // Berkas yang kedaluwarsa di server WhatsApp diminta ulang lewat
        // ponsel pemegang nomor; tanpa ini media lama gagal diunduh.
        reuploadRequest: soket.updateMediaMessage?.bind(soket),
      }
    );
    return isi;
  };

  return {
    sock: soket,
    simpanKredensial: saveCreds,
  };
};
