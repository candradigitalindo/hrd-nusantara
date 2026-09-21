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
import { ingestMessage, applySessionEvent, claimPhoneNumber } from './ingest';
import { normalizeBaileysMessage, nomorDariJid, type PesanBaileys } from './baileysMessage';
import { normalizePhoneNumber } from '../../utils/whatsappRules';
import { putuskanReconnect } from './reconnect';

export interface MetadataGrup {
  id: string;
  subject: string;
  size?: number;
  participants?: unknown[];
}

export interface SoketWhatsApp {
  ev: { on: (nama: string, penangan: (data: unknown) => void) => void };
  logout: () => Promise<void>;
  end: (error?: Error) => void;
  /** Grup yang diikuti nomor ini; dipakai untuk memilih grup tujuan foto absensi. */
  groupFetchAllParticipating?: () => Promise<Record<string, MetadataGrup>>;
  /** Mengirim pesan (gambar + keterangan) atas nama nomor ini. */
  sendMessage?: (jid: string, content: { image: Buffer; caption?: string } | { text: string }) => Promise<unknown>;
  /** Identitas akun WhatsApp yang tertaut, terisi setelah koneksi terbuka: "628…:12@s.whatsapp.net". */
  user?: { id?: string } | null;
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
  /** null untuk nomor pribadi yang belum selesai dipindai. */
  phoneNumber: string | null;
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

  // Tanpa nomor sendiri, arah pesan tidak bisa ditentukan. Ini hanya terjadi
  // bila pesan datang sebelum koneksi dilaporkan terbuka — sangat jarang.
  if (!sesi.phoneNumber) {
    catat(`pesan untuk akun ${sesi.accountId} datang sebelum nomornya diketahui; dilewati`);
    return;
  }

  for (const mentah of messages) {
    const hasil = normalizeBaileysMessage(mentah, sesi.phoneNumber);
    if (hasil.status === 'dilewati') continue;

    // Tiap pesan berdiri sendiri. Tanpa ini, satu kegagalan database di
    // tengah batch akan membuang seluruh pesan sesudahnya tanpa jejak —
    // dan WhatsApp tidak mengirim ulang pesan yang sudah diterima, jadi
    // yang hilang hilang untuk selamanya.
    try {
      const disimpan = await ingestMessage(hasil.pesan, { accountId: sesi.accountId });
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
        accountId: sesi.accountId,
        status: 'scan_required',
        note: 'Menunggu scan QR untuk menyambungkan nomor.',
      });
    }
  }

  if (pembaruan.connection === 'open') {
    // WhatsApp melaporkan nomor yang benar-benar tertaut. Untuk nomor pribadi
    // inilah saat nomornya diketahui; untuk nomor perusahaan ini pemeriksaan
    // bahwa yang memindai memang ponsel nomor itu.
    const idPengguna = sesi.sock?.user?.id;
    const nomorTertaut = idPengguna ? nomorDariJid(idPengguna) : null;
    if (nomorTertaut) {
      const klaim = await claimPhoneNumber(sesi.accountId, nomorTertaut);
      if (klaim.status === 'konflik' || klaim.status === 'salah_nomor') {
        const catatan =
          klaim.status === 'konflik'
            ? `Nomor +${normalizePhoneNumber(nomorTertaut)} sudah terdaftar sebagai "${klaim.label}". Tautan dibatalkan.`
            : `Ponsel yang memindai bernomor +${normalizePhoneNumber(nomorTertaut)}, bukan nomor terdaftar +${klaim.diharapkan}. Tautan dibatalkan.`;
        await lepasTautan(sesi, catatan);
        return;
      }
      sesi.phoneNumber = normalizePhoneNumber(nomorTertaut);
    }

    sesi.status = 'connected';
    sesi.qr = null;
    sesi.qrDibuatPada = null;
    sesi.percobaan = 0;
    sesi.catatanTerakhir = null;
    await applySessionEvent({ accountId: sesi.accountId, status: 'connected' });
    catat(`${sesi.phoneNumber ?? sesi.accountId} tersambung`);
    return;
  }

  if (pembaruan.connection !== 'close') return;

  sesi.sock = null;

  if (sesi.ditutupSengaja) {
    // Tautan yang dibatalkan (lepasTautan) sudah berstatus pending_scan; jangan ditimpa.
    if (sesi.status !== 'pending_scan') sesi.status = 'disconnected';
    return;
  }

  const kode = pembaruan.lastDisconnect?.error?.output?.statusCode;
  const keputusan = putuskanReconnect(kode, sesi.percobaan);
  sesi.catatanTerakhir = keputusan.catatan;

  await applySessionEvent({
    accountId: sesi.accountId,
    status: keputusan.perluScanUlang ? 'scan_required' : 'disconnected',
    note: keputusan.catatan,
  });

  if (!keputusan.sambungUlang) {
    sesi.status = keputusan.perluScanUlang ? 'pending_scan' : 'disconnected';
    // Kredensial yang sudah tidak sah tidak ada gunanya disimpan, dan
    // menyisakannya membuat percobaan berikutnya gagal dengan alasan yang
    // membingungkan.
    if (keputusan.perluScanUlang) sesi.qr = null;
    catat(`${sesi.phoneNumber ?? sesi.accountId} berhenti: ${keputusan.catatan}`);
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

/** Melepas pairing yang salah nomor: logout supaya WhatsApp di ponsel itu ikut terputus. */
const lepasTautan = async (sesi: Sesi, catatan: string) => {
  sesi.ditutupSengaja = true;
  bersihkanTimer(sesi);
  const sock = sesi.sock;
  sesi.sock = null;
  try {
    await sock?.logout();
  } catch (error) {
    catat(`gagal melepas tautan ${sesi.accountId}`, error);
  }
  sesi.status = 'pending_scan';
  sesi.qr = null;
  sesi.qrDibuatPada = null;
  sesi.catatanTerakhir = catatan;
  await applySessionEvent({ accountId: sesi.accountId, status: 'scan_required', note: catatan });
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
  phoneNumber: string | null;
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
  phoneNumber: string | null
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
  // Sesi yang sebelumnya ditutup sengaja (diputus HR, tautan dibatalkan)
  // kini dibuka lagi atas permintaan: putus berikutnya harus disambung ulang
  // seperti biasa. Tanpa reset ini penanda lama membuat penanganan 'close'
  // berhenti diam-diam, dan nomor itu tidak pernah menyambung sendiri lagi.
  sesi.ditutupSengaja = false;
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

/**
 * Status yang boleh ditindaklanjuti klien, dari keadaan di memori dan kolom
 * tersimpan.
 *
 * 'pending_scan' dipakai untuk dua keadaan yang bagi pengguna sangat berbeda:
 * "QR sedang hidup, pindai sekarang" dan "perlu scan, tapi tidak ada QR" —
 * sesudah backend restart (bootstrap sengaja tidak membuka ulang akun tanpa
 * kredensial), sesudah tautan dibatalkan karena salah nomor, sesudah di-logout
 * dari ponsel atau oleh HR. Halaman web dan aplikasi mobile hanya mengenal
 * arti pertama: keduanya menampilkan tempat QR yang tidak pernah terisi,
 * instruksi memindai kode yang tidak ada, dan terus mem-poll tiap 3 detik.
 *
 * Aturannya: pending_scan tanpa QR bukan "menunggu scan". Nomor yang belum
 * pernah tersambung kembali ke never_linked (tombol "Tautkan WhatsApp");
 * yang pernah tersambung menjadi disconnected (tombol "Pindai Ulang").
 * Keduanya nilai yang sudah dikenal semua klien — kontraknya tidak berubah,
 * hanya jadi jujur.
 */
export const statusEfektif = (
  akun: { sessionStatus: string; lastConnectedAt: Date | null; isActive: boolean },
  sesi: RingkasanSesi | null
): string => {
  if (!akun.isActive) return 'inactive';
  const mentah = sesi?.status ?? akun.sessionStatus;
  if (mentah !== 'pending_scan') return mentah;
  if (sesi?.qrTersedia) return 'pending_scan';
  return akun.lastConnectedAt ? 'disconnected' : 'never_linked';
};

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
      catat(`gagal menutup sesi ${sesi.phoneNumber ?? sesi.accountId}`, error);
    }
  }

  sesi.status = opsi.logout ? 'pending_scan' : 'disconnected';
  sesi.qr = null;
  sesi.qrDibuatPada = null;

  await applySessionEvent({
    accountId: sesi.accountId,
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

// --- Grup dan pengiriman pesan (foto absensi ber-stempel) ---

export class GalatSesiWhatsApp extends Error {
  constructor(pesan: string, public readonly kode: 'tidak_tersambung' | 'tidak_didukung') {
    super(pesan);
    this.name = 'GalatSesiWhatsApp';
  }
}

export interface GrupWhatsApp {
  jid: string;
  nama: string;
  jumlahAnggota: number;
}

const soketTersambung = (accountId: string): SoketWhatsApp => {
  const sesi = sesiAktif.get(accountId);
  if (!sesi || sesi.status !== 'connected' || !sesi.sock) {
    throw new GalatSesiWhatsApp('Sesi WhatsApp tidak tersambung', 'tidak_tersambung');
  }
  return sesi.sock;
};

/** Grup yang diikuti nomor ini, diurutkan namanya. Butuh sesi tersambung. */
export const listGroups = async (accountId: string): Promise<GrupWhatsApp[]> => {
  const sock = soketTersambung(accountId);
  if (!sock.groupFetchAllParticipating) {
    throw new GalatSesiWhatsApp('Driver WhatsApp ini tidak mendukung daftar grup', 'tidak_didukung');
  }
  const peta = await sock.groupFetchAllParticipating();
  return Object.values(peta)
    .map((g) => ({ jid: g.id, nama: g.subject, jumlahAnggota: g.participants?.length ?? g.size ?? 0 }))
    .sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
};

/** Mengirim gambar berketerangan ke sebuah grup atas nama nomor ini. */
export const sendImageToGroup = async (accountId: string, jid: string, image: Buffer, caption: string) => {
  const sock = soketTersambung(accountId);
  if (!sock.sendMessage) throw new GalatSesiWhatsApp('Driver WhatsApp ini tidak mendukung pengiriman pesan', 'tidak_didukung');
  await sock.sendMessage(jid, { image, caption });
};
