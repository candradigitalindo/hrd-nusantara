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
import { env } from '../../config/env';
import { ingestMessage, applySessionEvent, claimPhoneNumber, type BerkasMedia } from './ingest';
import { simpanMediaWhatsApp } from '../../utils/whatsappMedia';
import { normalizeBaileysMessage, nomorDariJid, type PesanBaileys } from './baileysMessage';
import { normalizePhoneNumber } from '../../utils/whatsappRules';
import { putuskanReconnect } from './reconnect';
import { hapusKredensialTersimpan } from './authStore';
import { prisma } from '../../lib/prisma';

/** Penunjuk satu pesan di WhatsApp; dipakai sebagai titik awal penarikan riwayat. */
export interface KunciPesanWhatsApp {
  remoteJid: string;
  id: string;
  fromMe: boolean;
  participant?: string;
}

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
  /** Keterangan satu grup; dipakai untuk menyimpan nama grup di arsip. */
  groupMetadata?: (jid: string) => Promise<MetadataGrup>;
  /**
   * Mengunduh berkas media sebuah pesan. Kuncinya ada di dalam pesan itu
   * sendiri, jadi hanya pemegang soket yang bisa melakukannya — dan hanya
   * selama kuncinya masih berlaku di server WhatsApp.
   */
  unduhMedia?: (pesan: unknown) => Promise<Buffer>;
  /**
   * Meminta WhatsApp mengirimkan pesan yang LEBIH LAMA dari sebuah pesan yang
   * sudah dikenal. Jawabannya tidak datang seketika: WhatsApp mengirimkannya
   * lewat event 'messaging-history.set', bisa beberapa saat kemudian.
   */
  fetchMessageHistory?: (
    jumlah: number,
    kunci: KunciPesanWhatsApp,
    waktuDetik: number
  ) => Promise<string>;
  /** Identitas akun WhatsApp yang tertaut, terisi setelah koneksi terbuka: "628…:12@s.whatsapp.net". */
  user?: { id?: string } | null;
}

export interface SesiDibuat {
  sock: SoketWhatsApp;
  simpanKredensial: () => Promise<void>;
}

/** Kredensialnya dimuat sendiri oleh pembuat soket dari database (authStore.ts). */
export type PembuatSoket = (konteks: { accountId: string }) => Promise<SesiDibuat>;

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
  /** Nama grup yang sudah pernah ditanyakan, supaya tidak ditanya per pesan. */
  namaGrup: Map<string, string>;
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

const bersihkanTimer = (sesi: Sesi) => {
  if (sesi.timer) {
    clearTimeout(sesi.timer);
    sesi.timer = null;
  }
};

// --- Penanganan event ---

/**
 * Nama grup, ditanyakan sekali lalu diingat selama sesi hidup.
 *
 * Tanpa nama, arsip grup hanya berisi deretan angka JID yang tidak bisa
 * dikenali siapa pun. Kegagalannya tidak fatal: pesannya tetap diarsipkan
 * dengan nama kosong.
 */
const namaGrupUntuk = async (sesi: Sesi, jid: string): Promise<string | null> => {
  const tersimpan = sesi.namaGrup.get(jid);
  if (tersimpan !== undefined) return tersimpan;

  try {
    const meta = await sesi.sock?.groupMetadata?.(jid);
    const nama = meta?.subject ?? null;
    if (nama) sesi.namaGrup.set(jid, nama);
    return nama;
  } catch (error) {
    catat(`gagal membaca nama grup ${jid}`, error);
    return null;
  }
};

/**
 * Mengunduh berkas media sebuah pesan.
 *
 * Kunci media hanya ada pada pesannya dan hanya berlaku selama berkasnya
 * masih tersimpan di server WhatsApp, jadi ini harus dilakukan saat pesannya
 * tiba — bukan nanti saat ada yang membukanya di halaman arsip.
 */
const unduhBerkas = async (
  sesi: Sesi,
  mentah: PesanBaileys,
  keterangan: { mimeType: string | null; fileName: string | null }
): Promise<BerkasMedia> => {
  const dasar = { mimeType: keterangan.mimeType, fileName: keterangan.fileName };

  if (!sesi.sock?.unduhMedia) {
    return { ...dasar, path: null, sizeBytes: null, status: 'tidak_didukung' };
  }

  try {
    const buffer = await sesi.sock.unduhMedia(mentah);
    if (buffer.byteLength > env.WHATSAPP_MEDIA_MAX_BYTES) {
      // Pesannya tetap diarsipkan: yang hilang hanya berkasnya, dan itu
      // harus terlihat sebagai keputusan sistem, bukan sebagai kegagalan.
      return { ...dasar, path: null, sizeBytes: buffer.byteLength, status: 'terlalu_besar' };
    }

    const path = await simpanMediaWhatsApp({
      accountId: sesi.accountId,
      buffer,
      mimeType: keterangan.mimeType,
    });
    return { ...dasar, path, sizeBytes: buffer.byteLength, status: 'tersimpan' };
  } catch (error) {
    catat(`gagal mengunduh media pesan di akun ${sesi.accountId}`, error);
    return { ...dasar, path: null, sizeBytes: null, status: 'gagal' };
  }
};

const arsipkanPesan = async (sesi: Sesi, messages: PesanBaileys[]) => {
  // Tanpa nomor sendiri, arah pesan tidak bisa ditentukan. Ini hanya terjadi
  // bila pesan datang sebelum koneksi dilaporkan terbuka — sangat jarang.
  if (!sesi.phoneNumber) {
    catat(`pesan untuk akun ${sesi.accountId} datang sebelum nomornya diketahui; dilewati`);
    return;
  }

  for (const mentah of messages) {
    const hasil = normalizeBaileysMessage(mentah, sesi.phoneNumber);
    if (hasil.status === 'dilewati') continue;

    const pesan = hasil.pesan;
    if (pesan.grup) {
      pesan.grup.nama = await namaGrupUntuk(sesi, pesan.grup.jid);
    }

    const berkas = pesan.media ? await unduhBerkas(sesi, mentah, pesan.media) : undefined;

    // Tiap pesan berdiri sendiri. Tanpa ini, satu kegagalan database di
    // tengah batch akan membuang seluruh pesan sesudahnya tanpa jejak —
    // dan WhatsApp tidak mengirim ulang pesan yang sudah diterima, jadi
    // yang hilang hilang untuk selamanya.
    try {
      const disimpan = await ingestMessage(pesan, { accountId: sesi.accountId, berkas });
      if (disimpan.status === 'ditolak') {
        catat(`pesan di luar lingkup dilewati (${disimpan.alasan})`);
      }
    } catch (error) {
      catat(`gagal mengarsipkan pesan ${pesan.externalMessageId}`, error);
    }
  }
};

const tanganiPesanMasuk = async (sesi: Sesi, muatan: unknown) => {
  const { messages, type } = (muatan ?? {}) as { messages?: PesanBaileys[]; type?: string };

  // 'notify' adalah pesan yang baru tiba, 'append' adalah pesan yang
  // disusulkan ponsel — antara lain yang datang saat sesi ini sempat putus.
  // Keduanya diarsipkan; yang ditolak hanya muatan tanpa daftar pesan.
  if ((type !== 'notify' && type !== 'append') || !Array.isArray(messages)) return;

  await arsipkanPesan(sesi, messages);
};

/**
 * Riwayat lama yang dikirim WhatsApp setelah diminta lewat tarikRiwayat().
 *
 * Event yang sama juga dipakai WhatsApp saat perangkat baru ditautkan; karena
 * syncFullHistory dimatikan, yang datang tanpa diminta hanya sedikit.
 */
const tanganiRiwayat = async (sesi: Sesi, muatan: unknown) => {
  const { messages } = (muatan ?? {}) as { messages?: PesanBaileys[] };
  if (!Array.isArray(messages) || messages.length === 0) return;

  catat(`riwayat masuk untuk akun ${sesi.accountId}: ${messages.length} pesan`);
  await arsipkanPesan(sesi, messages);
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
  const keputusan = putuskanReconnect(kode, sesi.percobaan, {
    menungguScan: sesi.status === 'pending_scan',
  });
  sesi.catatanTerakhir = keputusan.catatan;

  if (keputusan.perluScanUlang) {
    // Kredensial yang sudah tidak sah dibuang. Kalau disisakan, sambungan
    // berikutnya mencoba masuk dengan identitas yang sudah ditolak, ditolak
    // lagi, dan QR untuk menautkan ulang tidak pernah muncul.
    try {
      await hapusKredensialTersimpan(sesi.accountId);
    } catch (error) {
      // Kejadiannya tetap harus tercatat walau penghapusan gagal.
      catat(`gagal membuang kredensial ${sesi.accountId}`, error);
    }
  }

  // QR yang kedaluwarsa bukan sesi yang putus. Mencatatnya sebagai kejadian
  // memberi tahu pemegang nomor bahwa sesinya terputus, belasan kali, untuk
  // nomor yang belum pernah tertaut.
  if (!keputusan.tahapQr) {
    await applySessionEvent({
      accountId: sesi.accountId,
      status: keputusan.perluScanUlang ? 'scan_required' : 'disconnected',
      note: keputusan.catatan,
    });
  }

  if (!keputusan.sambungUlang) {
    // Tidak ada percobaan berikutnya: timer sisa percobaan sebelumnya dibuang
    // supaya state sesi tidak menyisakan jejak yang membingungkan.
    bersihkanTimer(sesi);
    sesi.status = keputusan.perluScanUlang ? 'pending_scan' : 'disconnected';
    if (keputusan.perluScanUlang) {
      sesi.qr = null;
      sesi.qrDibuatPada = null;
    }
    catat(`${sesi.phoneNumber ?? sesi.accountId} berhenti: ${keputusan.catatan}`);
    return;
  }

  // Saat QR diganti, halaman tetap menampilkan tempat QR, bukan "menyambung
  // ulang": dari sisi orang yang memindai, tidak ada yang putus.
  sesi.status = keputusan.tahapQr ? 'pending_scan' : 'connecting';
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
  // Tautan ke ponsel yang salah tidak boleh dibuka lagi saat restart.
  await hapusKredensialTersimpan(sesi.accountId);
  sesi.status = 'pending_scan';
  sesi.qr = null;
  sesi.qrDibuatPada = null;
  sesi.catatanTerakhir = catatan;
  await applySessionEvent({ accountId: sesi.accountId, status: 'scan_required', note: catatan });
};

const bukaSoket = async (sesi: Sesi) => {
  if (!buatSoket) throw new Error('Pembuat soket WhatsApp belum dipasang');

  const { sock, simpanKredensial } = await buatSoket({ accountId: sesi.accountId });

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
  sock.ev.on('messaging-history.set', (muatan) => {
    amanDijalankan('messaging-history.set', () => tanganiRiwayat(sesi, muatan));
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
  /**
   * Sistem masih akan mencoba menyambung sendiri. Dipisahkan dari `catatan`
   * supaya antarmuka tidak perlu menebak dari kalimatnya: gangguan yang
   * sedang dipulihkan otomatis tidak boleh tampil segenting sesi yang sudah
   * menyerah dan menunggu orang memindai ulang.
   */
  sedangSambungUlang: boolean;
  catatan: string | null;
}

const ringkas = (sesi: Sesi): RingkasanSesi => ({
  accountId: sesi.accountId,
  phoneNumber: sesi.phoneNumber,
  status: sesi.status,
  qrTersedia: sesi.qr !== null,
  qrDibuatPada: sesi.qrDibuatPada,
  percobaanSambungUlang: sesi.percobaan,
  // Dibaca dari status, bukan dari ada tidaknya timer: timer tetap memegang
  // referensi setelah callback-nya berjalan, jadi nilainya tidak bisa
  // dipercaya. Status 'connecting' dengan percobaan > 0 hanya terjadi saat
  // sambung ulang dijadwalkan; begitu menyerah, statusnya bukan itu lagi.
  sedangSambungUlang: sesi.status === 'connecting' && sesi.percobaan > 0,
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
    namaGrup: new Map(),
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

  // Tautan yang sudah di-logout tidak sah lagi, jadi kredensialnya dibuang.
  // Memutus tanpa logout sengaja menyisakannya supaya bisa disambung lagi
  // tanpa scan.
  if (opsi.logout) await hapusKredensialTersimpan(sesi.accountId);

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
  constructor(
    pesan: string,
    public readonly kode: 'tidak_tersambung' | 'tidak_didukung' | 'tanpa_titik_awal'
  ) {
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

export interface HasilTarikRiwayat {
  /** Berapa percakapan yang dimintakan riwayatnya. */
  percakapan: number;
  /** Berapa pesan yang diminta per percakapan. */
  jumlahPerPercakapan: number;
  /** Nama atau nomor percakapan yang diminta, untuk ditampilkan kembali. */
  daftar: { kontak: string; nama: string | null; sejak: Date }[];
}

/**
 * Meminta WhatsApp mengirimkan percakapan yang lebih lama.
 *
 * Perangkat tertaut tidak menerima riwayat sebelum ia dipasang, kecuali
 * diminta. Permintaan itu harus berangkat dari sebuah pesan yang sudah
 * dikenal — WhatsApp menjawab dengan pesan yang lebih tua dari pesan itu —
 * jadi titik awalnya diambil dari pesan tertua yang sudah ada di arsip.
 *
 * Jawabannya tidak datang seketika. WhatsApp mengirimkannya lewat event
 * 'messaging-history.set' beberapa saat kemudian, dan pesannya masuk arsip
 * lewat jalur yang sama dengan pesan baru.
 */
export const tarikRiwayat = async (
  accountId: string,
  opsi: { jumlah: number; contactNumber?: string }
): Promise<HasilTarikRiwayat> => {
  const sock = soketTersambung(accountId);
  if (!sock.fetchMessageHistory) {
    throw new GalatSesiWhatsApp('Driver WhatsApp ini tidak mendukung penarikan riwayat', 'tidak_didukung');
  }

  const percakapan = await prisma.whatsAppConversation.groupBy({
    by: ['contactNumber', 'groupJid'],
    where: { accountId, ...(opsi.contactNumber ? { contactNumber: opsi.contactNumber } : {}) },
    _min: { timestamp: true },
    // Satu permintaan per percakapan; dibatasi supaya satu klik tidak
    // menghasilkan ratusan permintaan sekaligus ke server WhatsApp.
    orderBy: { contactNumber: 'asc' },
    take: 50,
  });

  if (percakapan.length === 0) {
    throw new GalatSesiWhatsApp(
      'Belum ada pesan sama sekali di arsip nomor ini, jadi tidak ada titik awal untuk menarik riwayat. Tunggu satu pesan masuk lebih dulu.',
      'tanpa_titik_awal'
    );
  }

  const daftar: HasilTarikRiwayat['daftar'] = [];

  for (const c of percakapan) {
    const tertua = await prisma.whatsAppConversation.findFirst({
      where: {
        accountId,
        contactNumber: c.contactNumber,
        groupJid: c.groupJid,
        timestamp: c._min.timestamp ?? undefined,
      },
      select: {
        externalMessageId: true,
        direction: true,
        contactNumber: true,
        groupJid: true,
        groupName: true,
        participantNumber: true,
        timestamp: true,
      },
    });
    if (!tertua) continue;

    const kunci: KunciPesanWhatsApp = {
      remoteJid: tertua.groupJid ?? `${tertua.contactNumber}@s.whatsapp.net`,
      id: tertua.externalMessageId,
      fromMe: tertua.direction === 'outgoing',
      ...(tertua.groupJid && tertua.participantNumber
        ? { participant: `${tertua.participantNumber}@s.whatsapp.net` }
        : {}),
    };

    try {
      await sock.fetchMessageHistory(opsi.jumlah, kunci, Math.floor(tertua.timestamp.getTime() / 1000));
      daftar.push({
        kontak: tertua.contactNumber,
        nama: tertua.groupName,
        sejak: tertua.timestamp,
      });
    } catch (error) {
      // Satu percakapan yang ditolak tidak boleh membatalkan sisanya.
      catat(`gagal meminta riwayat ${kunci.remoteJid} pada akun ${accountId}`, error);
    }
  }

  return { percakapan: daftar.length, jumlahPerPercakapan: opsi.jumlah, daftar };
};

/** Mengirim gambar berketerangan ke sebuah grup atas nama nomor ini. */
export const sendImageToGroup = async (accountId: string, jid: string, image: Buffer, caption: string) => {
  const sock = soketTersambung(accountId);
  if (!sock.sendMessage) throw new GalatSesiWhatsApp('Driver WhatsApp ini tidak mendukung pengiriman pesan', 'tidak_didukung');
  await sock.sendMessage(jid, { image, caption });
};
