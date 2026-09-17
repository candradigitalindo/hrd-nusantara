// src/services/whatsapp/session.ts
//
// Mengelola koneksi Baileys untuk tiap nomor perusahaan.
//
// Baileys bukan layanan luar yang dipanggil lewat HTTP: ia membuka WebSocket
// ke WhatsApp dari dalam proses ini dan hidup terus selama proses hidup. Yang
// harus dijaga di sini ada tiga:
//
//   1. Pesan masuk tetap lewat ingestMessage, aturan ruang lingkup dan
//      enkripsinya sama persis dengan jalur webhook.
//   2. Putus koneksi tidak boleh senyap — tiap perubahan dicatat sebagai
//      WhatsAppSessionEvent supaya pemegang nomor bisa diberi tahu.
//   3. Kesalahan di dalam penangan event tidak boleh menjatuhkan proses.
//      Event ini datang dari jaringan; satu pesan aneh tidak boleh
//      mematikan seluruh backend HRD.
//
// Pabrik soketnya bisa diganti (buatSoket) supaya seluruh alur — QR, putus,
// sambung ulang, pesan masuk — bisa diuji tanpa benar-benar menghubungi
// WhatsApp.
import path from 'path';
import { env } from '../../config/env';
import { ingestMessage, applySessionEvent } from './ingest';
import { normalizeBaileysMessage, type PesanBaileys } from './baileysMessage';
import { putuskanReconnect } from './reconnect';

export interface SoketWhatsApp {
  ev: { on: (nama: string, penangan: (data: unknown) => void) => void };
  logout: () => Promise<void>;
  end: (error?: Error) => void;
}

export interface SesiDibuat {
  sock: SoketWhatsApp;
  simpanKredensial: () => Promise<void>;
}

export type PembuatSoket = (konteks: {
  accountId: string;
  authDir: string;
}) => Promise<SesiDibuat>;

export type StatusSesi = 'connecting' | 'pending_scan' | 'connected' | 'disconnected';

interface Sesi {
  accountId: string;
  phoneNumber: string;
  sock: SoketWhatsApp | null;
  status: StatusSesi;
  qr: string | null;
  qrDibuatPada: Date | null;
  percobaan: number;
  timer: NodeJS.Timeout | null;
  /** Ditutup atas permintaan, bukan karena gangguan: jangan sambung ulang. */
  ditutupSengaja: boolean;
  catatanTerakhir: string | null;
}

const sesiAktif = new Map<string, Sesi>();

let buatSoket: PembuatSoket | null = null;

/** Dipakai test untuk menyuntik soket palsu, dan oleh index.ts untuk memasang yang asli. */
export const setPembuatSoket = (pembuat: PembuatSoket | null) => {
  buatSoket = pembuat;
};

const catat = (pesan: string, error?: unknown) => {
  if (env.NODE_ENV === 'test') return;
  if (error) console.warn(`[whatsapp] ${pesan}`, error);
  else console.log(`[whatsapp] ${pesan}`);
};

const pekerjaanTertunda = new Set<Promise<void>>();

/** Penangan event berjalan di luar siklus request; kesalahan di dalamnya
 *  tidak punya siapa-siapa untuk dilapori kecuali log.
 *
 *  Pekerjaannya dicatat supaya bisa ditunggu sampai selesai: penyimpanan
 *  pesan yang sedang berjalan tidak boleh terpotong saat proses berhenti,
 *  dan test perlu titik tunggu yang pasti alih-alih menebak dengan jeda. */
const amanDijalankan = (nama: string, jalankan: () => Promise<void>) => {
  const kerja = jalankan()
    .catch((error) => catat(`gagal menangani ${nama}`, error))
    .finally(() => {
      pekerjaanTertunda.delete(kerja);
    });
  pekerjaanTertunda.add(kerja);
};

/** Menunggu semua penangan event yang sedang berjalan selesai. */
export const tungguEventSelesai = async () => {
  // Diulang: satu penangan bisa memunculkan penangan berikutnya.
  while (pekerjaanTertunda.size > 0) {
    await Promise.all([...pekerjaanTertunda]);
  }
};

const direktoriAuth = (accountId: string) => path.join(env.WHATSAPP_SESSION_DIR, accountId);

const bersihkanTimer = (sesi: Sesi) => {
  if (sesi.timer) {
    clearTimeout(sesi.timer);
    sesi.timer = null;
  }
};

// --- Penanganan event ---

const tanganiPesanMasuk = async (sesi: Sesi, muatan: unknown) => {
  const { messages, type } = (muatan ?? {}) as { messages?: PesanBaileys[]; type?: string };

  // 'notify' adalah pesan yang baru tiba. 'append' adalah sinkronisasi
  // riwayat — mengarsipkan seluruh riwayat lama sebuah nomor jauh melampaui
  // ruang lingkup pemantauan kanal kerja, jadi sengaja diabaikan.
  if (type !== 'notify' || !Array.isArray(messages)) return;

  for (const mentah of messages) {
    const hasil = normalizeBaileysMessage(mentah, sesi.phoneNumber);
    if (hasil.status === 'dilewati') continue;

    // Tiap pesan berdiri sendiri. Tanpa ini, satu kegagalan database di
    // tengah batch akan membuang seluruh pesan sesudahnya tanpa jejak —
    // dan WhatsApp tidak mengirim ulang pesan yang sudah diterima, jadi
    // yang hilang hilang untuk selamanya.
    try {
      const disimpan = await ingestMessage(hasil.pesan);
      if (disimpan.status === 'ditolak') {
        catat(`pesan di luar lingkup dilewati (${disimpan.alasan})`);
      }
    } catch (error) {
      catat(`gagal mengarsipkan pesan ${hasil.pesan.externalMessageId}`, error);
    }
  }
};

const tanganiPerubahanKoneksi = async (sesi: Sesi, muatan: unknown) => {
  const pembaruan = (muatan ?? {}) as {
    connection?: string;
    qr?: string;
    lastDisconnect?: { error?: { output?: { statusCode?: number } } };
  };

  if (pembaruan.qr) {
    const pertamaKali = sesi.qr === null;
    sesi.qr = pembaruan.qr;
    sesi.qrDibuatPada = new Date();
    sesi.status = 'pending_scan';

    // QR diperbarui tiap ~20 detik. Mencatat kejadian tiap kali akan
    // membanjiri arsip dan memberi tahu pemegang nomor berulang-ulang untuk
    // satu keadaan yang sama.
    if (pertamaKali) {
      await applySessionEvent({
        phoneNumber: sesi.phoneNumber,
        status: 'scan_required',
        note: 'Menunggu scan QR untuk menyambungkan nomor.',
      });
    }
  }

  if (pembaruan.connection === 'open') {
    sesi.status = 'connected';
    sesi.qr = null;
    sesi.qrDibuatPada = null;
    sesi.percobaan = 0;
    sesi.catatanTerakhir = null;
    await applySessionEvent({ phoneNumber: sesi.phoneNumber, status: 'connected' });
    catat(`${sesi.phoneNumber} tersambung`);
    return;
  }

  if (pembaruan.connection !== 'close') return;

  sesi.sock = null;

  if (sesi.ditutupSengaja) {
    sesi.status = 'disconnected';
    return;
  }

  const kode = pembaruan.lastDisconnect?.error?.output?.statusCode;
  const keputusan = putuskanReconnect(kode, sesi.percobaan);
  sesi.catatanTerakhir = keputusan.catatan;

  await applySessionEvent({
    phoneNumber: sesi.phoneNumber,
    status: keputusan.perluScanUlang ? 'scan_required' : 'disconnected',
    note: keputusan.catatan,
  });

  if (!keputusan.sambungUlang) {
    sesi.status = keputusan.perluScanUlang ? 'pending_scan' : 'disconnected';
    // Kredensial yang sudah tidak sah tidak ada gunanya disimpan, dan
    // menyisakannya membuat percobaan berikutnya gagal dengan alasan yang
    // membingungkan.
    if (keputusan.perluScanUlang) sesi.qr = null;
    catat(`${sesi.phoneNumber} berhenti: ${keputusan.catatan}`);
    return;
  }

  sesi.status = 'connecting';
  sesi.percobaan += 1;
  bersihkanTimer(sesi);
  sesi.timer = setTimeout(() => {
    amanDijalankan('sambung ulang', () => bukaSoket(sesi));
  }, keputusan.jedaMs);
  // Timer sambung ulang tidak boleh menahan proses tetap hidup saat backend
  // diminta berhenti.
  sesi.timer.unref?.();
};

const bukaSoket = async (sesi: Sesi) => {
  if (!buatSoket) throw new Error('Pembuat soket WhatsApp belum dipasang');

  const { sock, simpanKredensial } = await buatSoket({
    accountId: sesi.accountId,
    authDir: direktoriAuth(sesi.accountId),
  });

  sesi.sock = sock;
  sesi.ditutupSengaja = false;

  sock.ev.on('creds.update', () => {
    amanDijalankan('creds.update', simpanKredensial);
  });
  sock.ev.on('connection.update', (muatan) => {
    amanDijalankan('connection.update', () => tanganiPerubahanKoneksi(sesi, muatan));
  });
  sock.ev.on('messages.upsert', (muatan) => {
    amanDijalankan('messages.upsert', () => tanganiPesanMasuk(sesi, muatan));
  });
};

// --- Antarmuka yang dipakai controller ---

export interface RingkasanSesi {
  accountId: string;
  phoneNumber: string;
  status: StatusSesi;
  qrTersedia: boolean;
  qrDibuatPada: Date | null;
  percobaanSambungUlang: number;
  catatan: string | null;
}

const ringkas = (sesi: Sesi): RingkasanSesi => ({
  accountId: sesi.accountId,
  phoneNumber: sesi.phoneNumber,
  status: sesi.status,
  qrTersedia: sesi.qr !== null,
  qrDibuatPada: sesi.qrDibuatPada,
  percobaanSambungUlang: sesi.percobaan,
  catatan: sesi.catatanTerakhir,
});

export const connectAccount = async (
  accountId: string,
  phoneNumber: string
): Promise<RingkasanSesi> => {
  const adaSebelumnya = sesiAktif.get(accountId);
  if (adaSebelumnya && (adaSebelumnya.status === 'connected' || adaSebelumnya.status === 'connecting')) {
    return ringkas(adaSebelumnya);
  }

  const sesi: Sesi = adaSebelumnya ?? {
    accountId,
    phoneNumber,
    sock: null,
    status: 'connecting',
    qr: null,
    qrDibuatPada: null,
    percobaan: 0,
    timer: null,
    ditutupSengaja: false,
    catatanTerakhir: null,
  };
  sesi.phoneNumber = phoneNumber;
  sesi.status = 'connecting';
  sesi.percobaan = 0;
  bersihkanTimer(sesi);
  sesiAktif.set(accountId, sesi);

  await bukaSoket(sesi);
  return ringkas(sesi);
};

export const getSession = (accountId: string): RingkasanSesi | null => {
  const sesi = sesiAktif.get(accountId);
  return sesi ? ringkas(sesi) : null;
};

/** String QR mentah, untuk diubah menjadi gambar oleh pemanggilnya. */
export const getQrString = (accountId: string): string | null =>
  sesiAktif.get(accountId)?.qr ?? null;

export const disconnectAccount = async (
  accountId: string,
  opsi: { logout: boolean }
): Promise<RingkasanSesi | null> => {
  const sesi = sesiAktif.get(accountId);
  if (!sesi) return null;

  sesi.ditutupSengaja = true;
  bersihkanTimer(sesi);

  const sock = sesi.sock;
  sesi.sock = null;

  if (sock) {
    try {
      // logout menghapus pairing di sisi WhatsApp, jadi nomor harus discan
      // ulang. Tanpa logout, sesi bisa disambungkan lagi tanpa scan.
      if (opsi.logout) await sock.logout();
      else sock.end();
    } catch (error) {
      catat(`gagal menutup sesi ${sesi.phoneNumber}`, error);
    }
  }

  sesi.status = opsi.logout ? 'pending_scan' : 'disconnected';
  sesi.qr = null;
  sesi.qrDibuatPada = null;

  await applySessionEvent({
    phoneNumber: sesi.phoneNumber,
    status: opsi.logout ? 'scan_required' : 'disconnected',
    note: opsi.logout ? 'Sesi di-logout oleh HR. Perlu scan QR ulang.' : 'Sesi dihentikan oleh HR.',
  });

  return ringkas(sesi);
};

/**
 * Menutup semua sesi saat proses berhenti, tanpa mencatat kejadian: backend
 * yang restart bukan sesi yang putus.
 *
 * Timer dibersihkan LEBIH DULU, baru pekerjaan yang sedang berjalan ditunggu.
 * Urutan sebaliknya menyisakan celah: timer bisa menjadwalkan pekerjaan baru
 * tepat setelah penungguan selesai, dan penyimpanan pesan yang setengah jalan
 * ikut terpotong saat proses mati.
 */
export const shutdownSessions = async () => {
  for (const sesi of sesiAktif.values()) {
    sesi.ditutupSengaja = true;
    bersihkanTimer(sesi);
    try {
      sesi.sock?.end();
    } catch {
      // Proses sedang berhenti; tidak ada yang bisa dilakukan lagi.
    }
    sesi.sock = null;
  }
  sesiAktif.clear();

  await tungguEventSelesai();
};
