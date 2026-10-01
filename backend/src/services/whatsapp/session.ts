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
import {
  normalizeBaileysMessage,
  nomorDariJid,
  digitJid,
  jenisJid,
  lidDalamPesan,
  bacaKontakBaileys,
  pasanganDariPeserta,
  type PesanBaileys,
  type KontakBaileys,
  type PasanganLid,
} from './baileysMessage';
import { normalizePhoneNumber } from '../../utils/whatsappRules';
import { putuskanReconnect } from './reconnect';
import { hapusKredensialTersimpan } from './authStore';
import { petaLidDari, simpanPemetaanLid, type SumberLid } from './lidMap';
import { simpanKontak, type EntriKontak } from './kontak';
import { beriTahuKejadianSesi } from '../notification/sessionPush';
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
  /**
   * Store Signal Baileys. Yang dipakai hanya pemetaan LID -> nomor yang sudah
   * tersimpan di sesi ini; Baileys tidak bisa menanyakannya ke server.
   * Hasilnya JID lengkap: { lid: "<lid>@lid", pn: "<pn>:<dev>@s.whatsapp.net" }.
   */
  signalRepository?: {
    lidMapping?: {
      getPNsForLIDs?: (lids: string[]) => Promise<{ lid: string; pn: string }[] | null | undefined>;
    };
  };
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
  /** Kapan daftar grup (dan peserta ber-LID-nya) terakhir diambil; maksimal sekali per 6 jam. */
  grupDisinkronPada: number | null;
  /**
   * Naik setiap kali soket dibuka atau sesi ditutup sengaja. Soket yang baru
   * jadi setelah sesinya ditutup atau dibuka ulang (pembukaan yang terlambat)
   * ketahuan dari sini dan langsung ditutup, bukan menjadi sambungan liar.
   */
  generasi: number;
  /** Kapan pembukaan soket terakhir dimulai; dipakai pengawas mengenali sesi yang macet. */
  terakhirDicoba: number | null;
  /** Ada timer sambung ulang yang belum berjalan. */
  timerAktif: boolean;
  /** Kejadian "terputus" dari rangkaian gangguan yang sedang berjalan; pemberitahuannya ditunda. */
  kejadianPutusId: string | null;
  timerBeritahu: NodeJS.Timeout | null;
}

/**
 * Waktu-waktu ketahanan sambungan. Dapat diubah oleh test supaya tidak
 * menunggu menit-menitan sungguhan.
 */
export const WAKTU = {
  /** Pemegang nomor baru diberi tahu bila selama ini belum tersambung lagi. */
  jedaBeritahuPutusMs: 10 * 60_000,
  /** Membuka soket (muat kredensial, versi protokol, jabat tangan awal) lebih lama dari ini dianggap gagal. */
  batasBukaSoketMs: 45_000,
  intervalPengawasMs: 60_000,
  /** Sesi 'connecting' tanpa soket dan tanpa timer selama ini dianggap macet. */
  macetSetelahMs: 90_000,
  /** Pengali jeda sambung ulang; test memakai nilai sangat kecil. */
  skalaJeda: 1,
};

/** Jeda minimum antar-pengambilan daftar grup per sesi. */
const JEDA_SINKRON_GRUP_MS = 6 * 60 * 60 * 1000;

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
  sesi.timerAktif = false;
};

const bersihkanTimerBeritahu = (sesi: Sesi) => {
  if (sesi.timerBeritahu) {
    clearTimeout(sesi.timerBeritahu);
    sesi.timerBeritahu = null;
  }
};

/**
 * Menjadwalkan percobaan sambung ulang. Jedanya diacak ±20%: lima nomor
 * yang putus bersamaan (backend restart, gangguan ISP) tidak lalu menghantam
 * WhatsApp pada detik yang sama berulang-ulang.
 */
const jadwalkanSambungUlang = (sesi: Sesi, jedaMs: number) => {
  bersihkanTimer(sesi);
  const jeda = jedaMs > 0 ? Math.round(jedaMs * (0.8 + Math.random() * 0.4) * WAKTU.skalaJeda) : 0;
  sesi.timerAktif = true;
  sesi.timer = setTimeout(() => {
    sesi.timerAktif = false;
    amanDijalankan('sambung ulang', () => bukaSoketDenganPengaman(sesi));
  }, jeda);
  // Timer sambung ulang tidak boleh menahan proses tetap hidup saat backend
  // diminta berhenti.
  sesi.timer.unref?.();
};

/**
 * Pemberitahuan "terputus" ke pemegang nomor ditunda: gangguan yang pulih
 * sendiri dalam beberapa detik — yang paling sering terjadi — tidak perlu
 * diberitahukan, apalagi puluhan kali sehari. Yang dikirim hanya bila
 * setelah masa tenggang nomornya masih belum tersambung.
 */
const jadwalkanPemberitahuanPutus = (sesi: Sesi) => {
  if (sesi.timerBeritahu) return;
  sesi.timerBeritahu = setTimeout(() => {
    sesi.timerBeritahu = null;
    const id = sesi.kejadianPutusId;
    if (!id || sesi.status === 'connected' || sesi.ditutupSengaja) return;
    amanDijalankan('beri tahu putus', async () => {
      await beriTahuKejadianSesi(id);
    });
  }, WAKTU.jedaBeritahuPutusMs);
  sesi.timerBeritahu.unref?.();
};

const denganBatasWaktu = <T>(janji: Promise<T>, ms: number, apa: string, saatTerlambat: (hasil: T) => void): Promise<T> =>
  new Promise<T>((selesai, gagal) => {
    let terlambat = false;
    const t = setTimeout(() => {
      terlambat = true;
      gagal(new Error(`${apa} lebih dari ${Math.round(ms / 1000)} detik`));
    }, ms);
    t.unref?.();
    janji.then(
      (hasil) => {
        clearTimeout(t);
        if (terlambat) saatTerlambat(hasil);
        else selesai(hasil);
      },
      (error) => {
        clearTimeout(t);
        if (!terlambat) gagal(error);
      }
    );
  });

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

/**
 * Nomor asli untuk LID-LID ini: dari tabel permanen lebih dulu, lalu dari
 * store Baileys sesi ini. Yang ditemukan di store ikut disimpan permanen.
 * LID yang tidak ada di keduanya memang belum bisa diselesaikan — WhatsApp
 * tidak menyediakan cara menanyakannya.
 */
const selesaikanLid = async (sesi: Sesi, lids: Iterable<string>): Promise<Map<string, string>> => {
  const daftar = [...new Set(lids)];
  if (daftar.length === 0) return new Map();

  // Gagal membaca pemetaan bukan alasan menunda arsip: pesannya tetap
  // disimpan dengan LID, dan pemulihan berkala menggantinya belakangan.
  let peta = new Map<string, string>();
  try {
    peta = await petaLidDari(daftar);
  } catch (error) {
    catat(`gagal membaca pemetaan LID untuk akun ${sesi.accountId}`, error);
  }
  const sisa = daftar.filter((lid) => !peta.has(lid));
  const store = sesi.sock?.signalRepository?.lidMapping;
  if (sisa.length === 0 || !store?.getPNsForLIDs) return peta;

  try {
    const hasil = await store.getPNsForLIDs(sisa.map((lid) => `${lid}@lid`));
    const baru: PasanganLid[] = [];
    for (const r of hasil ?? []) {
      const lid = typeof r?.lid === 'string' ? digitJid(r.lid) : null;
      const pn = typeof r?.pn === 'string' && jenisJid(r.pn) === 'pn' ? digitJid(r.pn) : null;
      if (lid && pn && sisa.includes(lid)) {
        peta.set(lid, pn);
        baru.push({ lid, pn });
      }
    }
    if (baru.length > 0) await simpanPemetaanLid(baru, 'authkey');
  } catch (error) {
    catat(`gagal membaca pemetaan LID dari store akun ${sesi.accountId}`, error);
  }
  return peta;
};

/** Nama kontak dari event kontak Baileys atau dari riwayat. */
const bacaSemuaKontak = (daftar: KontakBaileys[]) =>
  daftar.map((k) => bacaKontakBaileys(k)).filter((k): k is NonNullable<typeof k> => k !== null);
type KontakTerbaca = ReturnType<typeof bacaSemuaKontak>[number];

/** Pasangan LID <-> nomor dari data kontak; dipakai untuk mengenali pengirim pesan. */
const pelajariPasanganKontak = async (terbaca: KontakTerbaca[], sumber: SumberLid) => {
  const pasangan = terbaca.flatMap((k) => (k.nomor && k.lid ? [{ lid: k.lid, pn: k.nomor }] : []));
  if (pasangan.length > 0) await simpanPemetaanLid(pasangan, sumber);
};

/**
 * Nama dari buku kontak hanya disimpan untuk orang yang memang muncul di arsip
 * percakapan nomor ini. Buku kontak ponsel pribadi karyawan berisi banyak
 * orang yang tidak pernah muncul di percakapan yang dipantau; nama mereka tidak
 * dibutuhkan untuk menampilkan arsip, jadi tidak ikut dikumpulkan (minimisasi
 * data pribadi, UU PDP). Nomor yang LID-nya ada di arsip ikut dihitung.
 */
const hanyaYangAdaDiArsip = async (accountId: string, entri: EntriKontak[]): Promise<EntriKontak[]> => {
  const nomor = [...new Set(entri.flatMap((e) => (e.nomor ? [e.nomor] : [])))];
  const lidDariNomor = new Map<string, string[]>();
  for (let i = 0; i < nomor.length; i += 500) {
    for (const m of await prisma.whatsAppLidMap.findMany({ where: { pn: { in: nomor.slice(i, i + 500) } }, select: { lid: true, pn: true } })) {
      lidDariNomor.set(m.pn, [...(lidDariNomor.get(m.pn) ?? []), m.lid]);
    }
  }
  const kunci = [...new Set(entri.flatMap((e) => [e.nomor, e.lid, ...(e.nomor ? (lidDariNomor.get(e.nomor) ?? []) : [])].filter((x): x is string => Boolean(x))))];
  if (kunci.length === 0) return [];

  const ada = new Set<string>();
  for (let i = 0; i < kunci.length; i += 500) {
    const potong = kunci.slice(i, i + 500);
    const baris = await prisma.whatsAppConversation.findMany({
      where: {
        accountId,
        OR: [
          { contactNumber: { in: potong } },
          { contactLid: { in: potong } },
          { participantNumber: { in: potong } },
          { participantLid: { in: potong } },
        ],
      },
      select: { contactNumber: true, contactLid: true, participantNumber: true, participantLid: true },
      distinct: ['contactNumber', 'contactLid', 'participantNumber', 'participantLid'],
    });
    for (const b of baris) for (const v of [b.contactNumber, b.contactLid, b.participantNumber, b.participantLid]) if (v) ada.add(v);
  }
  return entri.filter(
    (e) =>
      (e.nomor && (ada.has(e.nomor) || (lidDariNomor.get(e.nomor) ?? []).some((l) => ada.has(l)))) ||
      (e.lid && ada.has(e.lid))
  );
};

const catatNamaKontak = async (sesi: Sesi, terbaca: KontakTerbaca[]) => {
  const peta = await selesaikanLid(
    sesi,
    terbaca.flatMap((k) => (!k.nomor && k.lid ? [k.lid] : []))
  );

  const entri: EntriKontak[] = [];
  for (const k of terbaca) {
    if (!k.savedName && !k.pushName && !k.verifiedName) continue;
    const nomor = k.nomor ?? (k.lid ? (peta.get(k.lid) ?? null) : null);
    // Nama nomor yang dipantau sendiri bukan nama kontak.
    if (nomor && nomor === sesi.phoneNumber) continue;
    entri.push({ nomor, lid: k.lid, savedName: k.savedName, pushName: k.pushName, verifiedName: k.verifiedName, timpa: true });
  }
  if (entri.length === 0) return;
  await simpanKontak(sesi.accountId, await hanyaYangAdaDiArsip(sesi.accountId, entri));
};

const catatKontak = async (sesi: Sesi, daftar: KontakBaileys[], sumber: SumberLid) => {
  const terbaca = bacaSemuaKontak(daftar);
  if (terbaca.length === 0) return;
  await pelajariPasanganKontak(terbaca, sumber);
  await catatNamaKontak(sesi, terbaca);
};

const tanganiKontak = async (sesi: Sesi, muatan: unknown) => {
  if (!Array.isArray(muatan) || muatan.length === 0) return;
  await catatKontak(sesi, muatan as KontakBaileys[], 'kontak');
};

/**
 * @param opsi.live pesan yang baru tiba ('notify'). Pesan susulan dan
 *   riwayat bisa jauh lebih tua, jadi nama pengirimnya hanya mengisi nama
 *   kontak yang masih kosong.
 */
const arsipkanPesan = async (sesi: Sesi, messages: PesanBaileys[], opsi: { live: boolean }) => {
  // Tanpa nomor sendiri, arah pesan tidak bisa ditentukan. Ini hanya terjadi
  // bila pesan datang sebelum koneksi dilaporkan terbuka — sangat jarang.
  if (!sesi.phoneNumber) {
    catat(`pesan untuk akun ${sesi.accountId} datang sebelum nomornya diketahui; dilewati`);
    return;
  }
  const nomorSendiri = sesi.phoneNumber;

  // LID diselesaikan sekali per batch, bukan per pesan.
  const peta = await selesaikanLid(sesi, messages.flatMap(lidDalamPesan));

  // Pesan live membawa nomor asli di sebelah LID-nya. Dipelajari lebih dulu,
  // supaya pesan lain di batch yang sama ikut terselesaikan.
  const dipelajari: PasanganLid[] = [];
  for (const mentah of messages) {
    const h = normalizeBaileysMessage(mentah, nomorSendiri, peta);
    if (h.status === 'ok') dipelajari.push(...h.pasangan);
  }
  if (dipelajari.length > 0) {
    for (const p of dipelajari) peta.set(p.lid, p.pn);
    try {
      await simpanPemetaanLid(dipelajari, 'alt');
    } catch (error) {
      catat(`gagal menyimpan pemetaan LID akun ${sesi.accountId}`, error);
    }
  }

  const siap = messages.flatMap((mentah) => {
    const h = normalizeBaileysMessage(mentah, nomorSendiri, peta);
    return h.status === 'ok' ? [{ mentah, h }] : [];
  });
  if (siap.length === 0) return;

  const entri: EntriKontak[] = siap.flatMap(({ h }) =>
    h.pengirim && (h.pengirim.pushName || h.pengirim.verifiedName)
      ? [
          {
            nomor: h.pengirim.nomor,
            lid: h.pengirim.lid,
            pushName: h.pengirim.pushName,
            verifiedName: h.pengirim.verifiedName,
            timpa: opsi.live,
          },
        ]
      : []
  );
  // Di latar: antrean kontak bisa sedang sibuk (sinkronisasi buku kontak saat
  // baru tertaut), dan arsip pesan tidak boleh ikut menunggu.
  if (entri.length > 0) amanDijalankan('kontak pengirim', () => simpanKontak(sesi.accountId, entri));

  // Pesan yang sudah ada di arsip tidak diunduh ulang berkasnya — hanya
  // ditambal (lihat ingest.ts). Tanpa ini, setiap "Tarik riwayat" mengunduh
  // ulang semua media lama dan meninggalkan berkas yatim di disk.
  let sudahAda = new Set<string>();
  try {
    const ada = await prisma.whatsAppConversation.findMany({
      where: { accountId: sesi.accountId, externalMessageId: { in: siap.map(({ h }) => h.pesan.externalMessageId) } },
      select: { externalMessageId: true },
    });
    sudahAda = new Set(ada.map((b) => b.externalMessageId));
  } catch (error) {
    // Tanpa daftar ini pesan tetap diarsipkan; duplikatnya dikenali ingest.
    catat(`gagal memeriksa pesan yang sudah diarsipkan di akun ${sesi.accountId}`, error);
  }

  for (const { mentah, h } of siap) {
    const pesan = h.pesan;
    if (pesan.grup) {
      pesan.grup.nama = await namaGrupUntuk(sesi, pesan.grup.jid);
    }

    const lama = sudahAda.has(pesan.externalMessageId);
    const berkas = pesan.media && !lama ? await unduhBerkas(sesi, mentah, pesan.media) : undefined;

    // Tiap pesan berdiri sendiri. Tanpa ini, satu kegagalan database di
    // tengah batch akan membuang seluruh pesan sesudahnya tanpa jejak —
    // dan WhatsApp tidak mengirim ulang pesan yang sudah diterima, jadi
    // yang hilang hilang untuk selamanya.
    try {
      const disimpan = await ingestMessage(pesan, { accountId: sesi.accountId, berkas, sudahAda: lama });
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

  await arsipkanPesan(sesi, messages, { live: type === 'notify' });
};

/**
 * Riwayat lama yang dikirim WhatsApp setelah diminta lewat tarikRiwayat().
 *
 * Event yang sama juga dipakai WhatsApp saat perangkat baru ditautkan; karena
 * syncFullHistory dimatikan, yang datang tanpa diminta hanya sedikit.
 */
const tanganiRiwayat = async (sesi: Sesi, muatan: unknown) => {
  const { messages, contacts } = (muatan ?? {}) as { messages?: PesanBaileys[]; contacts?: KontakBaileys[] };

  // Pasangan LID -> nomor dari kontak lebih dulu: dipakai pesan-pesan di
  // bawahnya. Namanya baru dicatat sesudah pesan diarsipkan, karena nama hanya
  // disimpan untuk orang yang ada di arsip. Kegagalan kontak tidak boleh ikut
  // membuang pesannya.
  const kontak = Array.isArray(contacts) ? bacaSemuaKontak(contacts) : [];
  if (kontak.length > 0) {
    try {
      await pelajariPasanganKontak(kontak, 'riwayat');
    } catch (error) {
      catat(`gagal mencatat pasangan kontak riwayat akun ${sesi.accountId}`, error);
    }
  }

  if (Array.isArray(messages) && messages.length > 0) {
    catat(`riwayat masuk untuk akun ${sesi.accountId}: ${messages.length} pesan`);
    await arsipkanPesan(sesi, messages, { live: false });
  }

  if (kontak.length > 0) {
    try {
      await catatNamaKontak(sesi, kontak);
    } catch (error) {
      catat(`gagal mencatat nama kontak riwayat akun ${sesi.accountId}`, error);
    }
  }
};

/**
 * Daftar grup yang diikuti nomor ini. Peserta ber-LID membawa nomor aslinya
 * di sini — sumber pemetaan terbesar untuk pengirim grup — dan Baileys tidak
 * menyimpannya sendiri. Nama grupnya sekalian menyegarkan cache nama.
 */
const sinkronGrup = async (sesi: Sesi) => {
  const sock = sesi.sock;
  if (!sock?.groupFetchAllParticipating) return;
  await pelajariGrup(sesi, Object.values((await sock.groupFetchAllParticipating()) ?? {}));
};

/**
 * Nama grup dan pasangan LID -> nomor peserta dari metadata grup: daftar
 * lengkap (sinkronGrup), grup baru (groups.upsert), perubahan nama
 * (groups.update), dan peserta yang masuk/keluar (group-participants.update).
 */
const pelajariGrup = async (sesi: Sesi, daftar: unknown[]) => {
  const pasangan: PasanganLid[] = [];
  for (const g of daftar) {
    if (!g || typeof g !== 'object') continue;
    const { id, subject, participants } = g as { id?: unknown; subject?: unknown; participants?: unknown };
    // Cache nama ikut diperbarui: tanpa ini grup yang ganti nama tetap
    // tercatat dengan nama lamanya selama sesi hidup.
    if (typeof id === 'string' && typeof subject === 'string' && subject) sesi.namaGrup.set(id, subject);
    for (const p of Array.isArray(participants) ? participants : []) {
      const pas = pasanganDariPeserta(p);
      if (pas) pasangan.push(pas);
    }
  }
  if (pasangan.length > 0) await simpanPemetaanLid(pasangan, 'grup');
};

const tanganiGrup = async (sesi: Sesi, muatan: unknown) => {
  await pelajariGrup(sesi, Array.isArray(muatan) ? muatan : [muatan]);
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
    // Tersambung lagi sebelum masa tenggang: pemegang nomor tidak perlu tahu.
    bersihkanTimerBeritahu(sesi);
    sesi.kejadianPutusId = null;
    await applySessionEvent({ accountId: sesi.accountId, status: 'connected' });
    catat(`${sesi.phoneNumber ?? sesi.accountId} tersambung`);

    // Di latar: satu permintaan untuk semua grup, paling sering sekali per
    // 6 jam per sesi, dan kegagalannya tidak memengaruhi sambungan.
    if (
      sesi.sock?.groupFetchAllParticipating &&
      (sesi.grupDisinkronPada === null || Date.now() - sesi.grupDisinkronPada >= JEDA_SINKRON_GRUP_MS)
    ) {
      sesi.grupDisinkronPada = Date.now();
      amanDijalankan('sinkron grup', () => sinkronGrup(sesi));
    }
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
  //
  // Satu rangkaian gangguan dicatat sebagai SATU kejadian, pada putus
  // pertamanya; percobaan-percobaan berikutnya hanya memperbarui catatan di
  // memori. Dulu tiap percobaan jadi satu kejadian dan satu push ke pemegang
  // nomor: hampir seratus "sesi terputus" sehari untuk gangguan tiga detik.
  const rangkaianBaru = sesi.percobaan === 0 || !keputusan.sambungUlang || keputusan.perluScanUlang;
  if (!keputusan.tahapQr && rangkaianBaru) {
    const pulihSendiri = keputusan.sambungUlang && !keputusan.perluScanUlang;
    const hasil = await applySessionEvent({
      accountId: sesi.accountId,
      status: keputusan.perluScanUlang ? 'scan_required' : 'disconnected',
      note: keputusan.catatan,
      tundaPemberitahuan: pulihSendiri,
    });
    if (pulihSendiri && hasil.status === 'tercatat') {
      sesi.kejadianPutusId = hasil.eventId;
      jadwalkanPemberitahuanPutus(sesi);
    }
  }

  if (!keputusan.sambungUlang) {
    // Tidak ada percobaan berikutnya: timer sisa percobaan sebelumnya dibuang
    // supaya state sesi tidak menyisakan jejak yang membingungkan.
    bersihkanTimer(sesi);
    bersihkanTimerBeritahu(sesi);
    sesi.kejadianPutusId = null;
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
  jadwalkanSambungUlang(sesi, keputusan.jedaMs);
};

/**
 * Membuka soket dan, bila pembukaannya sendiri gagal (database, jaringan
 * keluar, batas waktu), menjadwalkan percobaan berikutnya. Tanpa soket tidak
 * akan ada event 'close' yang melakukannya, dan sesi akan diam di
 * 'connecting' selamanya — dulu inilah salah satu cara nomor mati senyap.
 */
const bukaSoketDenganPengaman = async (sesi: Sesi) => {
  try {
    await bukaSoket(sesi);
  } catch (error) {
    if (sesi.ditutupSengaja) return;
    catat(`gagal membuka soket ${sesi.phoneNumber ?? sesi.accountId}`, error);
    const keputusan = putuskanReconnect(undefined, sesi.percobaan, { menungguScan: sesi.status === 'pending_scan' });
    sesi.catatanTerakhir = keputusan.catatan;
    if (!keputusan.sambungUlang) {
      sesi.status = keputusan.perluScanUlang ? 'pending_scan' : 'disconnected';
      sesi.qr = null;
      sesi.qrDibuatPada = null;
      return;
    }
    sesi.status = keputusan.tahapQr ? 'pending_scan' : 'connecting';
    sesi.percobaan += 1;
    jadwalkanSambungUlang(sesi, keputusan.jedaMs);
  }
};

/**
 * Pengawas: membuka ulang sesi yang macet — 'connecting' tanpa soket dan
 * tanpa timer lebih dari batas, atau 'connected' tanpa soket. Keadaan ini
 * seharusnya tidak terjadi, tetapi sekali terjadi akibatnya nomor berhenti
 * terpantau tanpa ada yang tahu; pengawas membuatnya pulih sendiri.
 */
export const periksaSesiMacet = async (): Promise<string[]> => {
  const kini = Date.now();
  const dibukaUlang: string[] = [];
  for (const sesi of sesiAktif.values()) {
    if (sesi.ditutupSengaja || sesi.sock !== null || sesi.timerAktif) continue;
    const macet =
      sesi.status === 'connected' ||
      (sesi.status === 'connecting' && (sesi.terakhirDicoba === null || kini - sesi.terakhirDicoba > WAKTU.macetSetelahMs));
    if (!macet) continue;
    catat(`sesi ${sesi.phoneNumber ?? sesi.accountId} macet (${sesi.status}); dibuka ulang oleh pengawas`);
    sesi.status = 'connecting';
    dibukaUlang.push(sesi.accountId);
    await bukaSoketDenganPengaman(sesi);
  }
  return dibukaUlang;
};

let pengawas: NodeJS.Timeout | null = null;

export const mulaiPengawasSesi = () => {
  if (pengawas) return;
  pengawas = setInterval(() => {
    amanDijalankan('pengawas sesi', async () => {
      await periksaSesiMacet();
    });
  }, WAKTU.intervalPengawasMs);
  pengawas.unref?.();
};

export const hentikanPengawasSesi = () => {
  if (pengawas) clearInterval(pengawas);
  pengawas = null;
};

/** Melepas pairing yang salah nomor: logout supaya WhatsApp di ponsel itu ikut terputus. */
const lepasTautan = async (sesi: Sesi, catatan: string) => {
  sesi.ditutupSengaja = true;
  sesi.generasi += 1;
  bersihkanTimer(sesi);
  bersihkanTimerBeritahu(sesi);
  sesi.kejadianPutusId = null;
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
  const pembuat = buatSoket;

  const generasi = ++sesi.generasi;
  sesi.terakhirDicoba = Date.now();
  const tutupTerlambat = (dibuat: SesiDibuat) => {
    try {
      dibuat.sock.end();
    } catch {
      // Soket yang tidak jadi dipakai; gagal menutupnya tidak berarti apa-apa.
    }
  };
  const { sock, simpanKredensial } = await denganBatasWaktu(
    pembuat({ accountId: sesi.accountId }),
    WAKTU.batasBukaSoketMs,
    'membuka soket',
    tutupTerlambat
  );

  // Selama menunggu, sesi ditutup HR atau dibuka ulang oleh percobaan lain:
  // soket ini sudah tidak ada yang memiliki.
  if (generasi !== sesi.generasi || sesi.ditutupSengaja) {
    tutupTerlambat({ sock, simpanKredensial });
    return;
  }

  sesi.sock = sock;

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
  // Nama kontak: dari sinkronisasi buku kontak ponsel (upsert) dan
  // perubahan nama profil (update). id-nya bisa LID atau nomor.
  sock.ev.on('contacts.upsert', (muatan) => {
    amanDijalankan('contacts.upsert', () => tanganiKontak(sesi, muatan));
  });
  sock.ev.on('contacts.update', (muatan) => {
    amanDijalankan('contacts.update', () => tanganiKontak(sesi, muatan));
  });
  // Grup baru, ganti nama, dan peserta masuk: nama grup dan nomor asli
  // peserta ber-LID. Pemetaan dari event 'lid-mapping.update' tidak perlu
  // ditangani di sini: Baileys menyimpannya ke store, dan setiap tulisan
  // store dicerminkan ke WhatsAppLidMap (authStore.ts).
  for (const nama of ['groups.upsert', 'groups.update', 'group-participants.update']) {
    sock.ev.on(nama, (muatan) => {
      amanDijalankan(nama, () => tanganiGrup(sesi, muatan));
    });
  }
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
  if (adaSebelumnya && adaSebelumnya.status === 'connected') return ringkas(adaSebelumnya);
  if (adaSebelumnya && adaSebelumnya.status === 'connecting') {
    // Sedang menunggu jeda sambung ulang (bisa sampai 5 menit): HR yang
    // menekan "Sambungkan" tidak perlu ikut menunggu — dicoba sekarang.
    if (adaSebelumnya.timerAktif && !adaSebelumnya.sock) {
      bersihkanTimer(adaSebelumnya);
      await bukaSoketDenganPengaman(adaSebelumnya);
    }
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
    grupDisinkronPada: null,
    generasi: 0,
    terakhirDicoba: null,
    timerAktif: false,
    kejadianPutusId: null,
    timerBeritahu: null,
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
  bersihkanTimerBeritahu(sesi);
  sesi.kejadianPutusId = null;
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
  sesi.generasi += 1;
  bersihkanTimer(sesi);
  bersihkanTimerBeritahu(sesi);
  sesi.kejadianPutusId = null;

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
    sesi.generasi += 1;
    bersihkanTimer(sesi);
    bersihkanTimerBeritahu(sesi);
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
    where: {
      accountId,
      // Kontak yang nomornya belum diketahui hanya bisa disebut lewat LID-nya.
      ...(opsi.contactNumber
        ? { OR: [{ contactNumber: opsi.contactNumber }, { contactLid: opsi.contactNumber }] }
        : {}),
    },
    _min: { timestamp: true },
    _max: { timestamp: true },
    // Satu permintaan per percakapan; dibatasi supaya satu klik tidak
    // menghasilkan ratusan permintaan sekaligus ke server WhatsApp. Yang
    // dipilih percakapan yang paling baru bergerak — urutan nomor akan
    // mendahulukan grup dan LID ("1203…", "2147…") di atas nomor 62….
    orderBy: { _max: { timestamp: 'desc' } },
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
        contactLid: true,
        groupJid: true,
        groupName: true,
        participantNumber: true,
        participantLid: true,
        timestamp: true,
      },
    });
    if (!tertua) continue;

    // Chat yang dialamatkan lewat LID harus diminta dengan JID LID-nya:
    // "<lid>@s.whatsapp.net" adalah JID yang tidak ada.
    const pesertaJid = tertua.participantLid
      ? `${tertua.participantLid}@lid`
      : tertua.participantNumber
        ? `${tertua.participantNumber}@s.whatsapp.net`
        : null;
    const kunci: KunciPesanWhatsApp = {
      remoteJid:
        tertua.groupJid ??
        (tertua.contactLid ? `${tertua.contactLid}@lid` : `${tertua.contactNumber}@s.whatsapp.net`),
      id: tertua.externalMessageId,
      fromMe: tertua.direction === 'outgoing',
      ...(tertua.groupJid && pesertaJid ? { participant: pesertaJid } : {}),
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
