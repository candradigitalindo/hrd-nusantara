// src/services/whatsapp/baileysDriver.ts
//
// Satu-satunya berkas yang benar-benar menyentuh pustaka Baileys.
//
// Pemuatannya dinamis dan baru terjadi saat driver dinyalakan: Baileys
// membawa protobuf, WebSocket, dan jembatan WASM yang tidak ada gunanya
// dimuat pada instance yang hanya melayani API biasa. Sisa sistem cukup
// mengenal antarmuka SoketWhatsApp, jadi pergantian versi pustaka —
// 7.x masih berstatus RC — berhenti di berkas ini.
import fs from 'fs/promises';
import type { PembuatSoket, SoketWhatsApp } from './session';

export const buatPembuatSoketBaileys = (): PembuatSoket => async ({ authDir }) => {
  const baileys = await import('baileys');
  const makeWASocket = (baileys as unknown as { default?: unknown }).default ?? baileys.makeWASocket;
  const { useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, downloadMediaMessage } = baileys;

  // Kredensial sesi: setara akses penuh ke akun WhatsApp itu. 0700 supaya
  // pengguna lain di server yang sama tidak bisa membacanya.
  await fs.mkdir(authDir, { recursive: true, mode: 0o700 });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  // Versi protokol diambil dari WhatsApp, bukan dipatok: versi yang basi
  // ditolak sambungannya dan gejalanya menyesatkan ("connection closed").
  const { version } = await fetchLatestBaileysVersion();

  const { default: pino } = await import('pino');

  const sock = (makeWASocket as (opsi: unknown) => unknown)({
    version,
    auth: state,
    // Log Baileys sangat berisik dan memuat isi pesan. Menuliskannya ke log
    // server berarti isi percakapan bocor ke tempat yang tidak terenkripsi,
    // persis yang dihindari oleh enkripsi kolom.
    logger: pino({ level: 'silent' }),
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
        logger: pino({ level: 'silent' }),
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
