// src/services/whatsapp/baileysMessage.ts
//
// Menerjemahkan bentuk pesan Baileys menjadi bentuk baku arsip.
//
// Sengaja tidak mengimpor apa pun dari pustaka Baileys: bentuk yang dipakai
// dijelaskan ulang sebagai tipe lokal. Dua alasannya: modul ini jadi bisa
// diuji tanpa membuka koneksi WhatsApp sungguhan, dan pergantian versi
// pustaka — 7.x masih berstatus RC — tidak langsung merembet ke sini.
//
// Soal LID. WhatsApp makin sering menyebut orang lewat LID ("2147…@lid"),
// ID samaran yang BUKAN nomor telepon. Nomor aslinya hanya ikut pada pesan
// live (key.remoteJidAlt / key.participantAlt) atau sudah dipelajari
// sebelumnya (peta LID -> nomor yang disiapkan pemanggil). LID yang belum
// terselesaikan tetap disimpan apa adanya, tapi ditandai lewat contactLid /
// participantLid supaya tidak pernah ditampilkan sebagai "+2147…".
import type { PesanMasuk, TipePesan } from './ingest';

/** Kunci pesan Baileys (WAMessageKey), hanya bagian yang dipakai. */
export interface KunciBaileys {
  remoteJid?: string | null;
  /** Alamat lain lawan bicara chat pribadi: nomor asli bila remoteJid LID, dan sebaliknya. Hanya pada pesan live. */
  remoteJidAlt?: string | null;
  fromMe?: boolean | null;
  id?: string | null;
  /** Peserta grup yang mengirim; hanya terisi pada pesan grup. */
  participant?: string | null;
  /** Alamat lain peserta grup (nomor asli bila participant LID). Hanya pada pesan live. */
  participantAlt?: string | null;
  /** 'lid' | 'pn' — cara WhatsApp mengalamatkan pesan ini. */
  addressingMode?: string | null;
}

/** Bagian dari objek pesan Baileys yang benar-benar dipakai. */
export interface PesanBaileys {
  key?: KunciBaileys | null;
  /**
   * Pengirim pesan grup pada pesan riwayat (WebMessageInfo field 5). Pesan
   * dari history sync sering menaruh pengirimnya di sini, bukan di
   * key.participant.
   */
  participant?: string | null;
  message?: Record<string, unknown> | null;
  messageTimestamp?: number | string | { toNumber?: () => number } | null;
  /** Nama profil WhatsApp pengirim. */
  pushName?: string | null;
  verifiedBizName?: string | null;
}

export type AlasanDilewati =
  | 'siaran'
  | 'jid_tidak_valid'
  | 'tanpa_id'
  | 'jenis_tidak_didukung';

/** Pasangan LID -> nomor asli, dalam digit tanpa domain. */
export interface PasanganLid {
  lid: string;
  pn: string;
}

/** Pengirim pesan masuk, untuk dicatat sebagai kontak. */
export interface PengirimPesan {
  /** Nomor asli; null bila baru LID-nya yang diketahui. */
  nomor: string | null;
  lid: string | null;
  pushName: string | null;
  verifiedName: string | null;
}

export type HasilNormalisasi =
  | {
      status: 'ok';
      pesan: PesanMasuk;
      /** Pemetaan LID -> nomor yang dipelajari dari pesan ini (remoteJidAlt/participantAlt). */
      pasangan: PasanganLid[];
      /** null untuk pesan keluar, atau pesan grup yang pengirimnya tidak disebut. */
      pengirim: PengirimPesan | null;
    }
  | { status: 'dilewati'; alasan: AlasanDilewati };

// --- JID ---

export type JenisJid = 'pn' | 'lid' | 'grup' | 'siaran';

/**
 * Jenis alamat WhatsApp:
 * - 'pn'     nomor telepon (@s.whatsapp.net, @c.us, @hosted)
 * - 'lid'    ID samaran (@lid, @hosted.lid)
 * - 'grup'   grup (@g.us)
 * - 'siaran' status, daftar siaran, dan kanal (@broadcast, status@, @newsletter)
 * null untuk yang tidak dikenal.
 */
export const jenisJid = (jid: string | null | undefined): JenisJid | null => {
  if (!jid) return null;
  const at = jid.lastIndexOf('@');
  if (at < 0) return null;
  if (jid.startsWith('status@')) return 'siaran';
  switch (jid.slice(at + 1).toLowerCase()) {
    case 's.whatsapp.net':
    case 'c.us':
    case 'hosted':
      return 'pn';
    case 'lid':
    case 'hosted.lid':
      return 'lid';
    case 'g.us':
      return 'grup';
    case 'broadcast':
    case 'newsletter':
      return 'siaran';
    default:
      return null;
  }
};

/**
 * Digit pengguna dari sebuah JID: tanpa domain, tanpa nomor perangkat
 * (":12"), dan tanpa agen ("_1"). "628111111111:12@s.whatsapp.net" ->
 * "628111111111"; "2147483647123:3@lid" -> "2147483647123".
 */
export const digitJid = (jid: string): string | null => {
  const pengguna = jid.split('@')[0];
  // Urutan potongnya mengikuti jidDecode Baileys: perangkat dulu, lalu agen.
  const inti = pengguna.split(':')[0].split('_')[0].split('.')[0];
  const angka = inti.replace(/\D/g, '');
  return angka.length > 0 ? angka : null;
};

/** Nama lama digitJid; masih dipakai untuk nomor yang dilaporkan WhatsApp saat tertaut. */
export const nomorDariJid = digitJid;

/**
 * Digit yang TAMPAK seperti LID, bukan nomor telepon: 15 digit atau lebih,
 * atau 14 digit yang tidak diawali 62. Hanya untuk arsip lama yang tidak
 * mencatat jenis alamatnya; data baru selalu memakai contactLid /
 * participantLid. Nomor Indonesia paling panjang 14 digit (62 + 12).
 */
export const tampakLid = (digit: string | null | undefined): boolean =>
  !!digit && /^\d+$/.test(digit) && (digit.length >= 15 || (digit.length === 14 && !digit.startsWith('62')));

/** Nomor asli dari nilai yang bisa berupa JID nomor ("628…@s.whatsapp.net") atau digit polos. */
const nomorDariNilai = (nilai: string | null | undefined): string | null => {
  if (!nilai) return null;
  if (nilai.includes('@')) return jenisJid(nilai) === 'pn' ? digitJid(nilai) : null;
  const angka = nilai.replace(/[\s+\-()]/g, '');
  return /^\d{6,}$/.test(angka) ? angka : null;
};

/** LID dari nilai berupa JID LID. */
const lidDariNilai = (nilai: string | null | undefined): string | null =>
  nilai && jenisJid(nilai) === 'lid' ? digitJid(nilai) : null;

const BATAS_NAMA = 200;

/** Nama yang layak disimpan: dipangkas, tidak kosong, dibatasi panjangnya. */
export const rapikanNama = (nama: unknown): string | null => {
  if (typeof nama !== 'string') return null;
  const rapi = nama.replace(/\s+/g, ' ').trim();
  return rapi.length > 0 ? rapi.slice(0, BATAS_NAMA) : null;
};

// --- Isi pesan ---

export interface IsiPesan {
  body: string;
  type: TipePesan;
  /**
   * Keterangan berkas yang menyertai pesan. Gambar, video, dan pesan suara
   * tidak punya teks, jadi tanpa berkasnya arsip hanya berisi tanda kurung
   * kosong. Berkasnya sendiri diunduh terpisah oleh pemegang soket.
   */
  media?: { mimeType: string | null; fileName: string | null };
}

/**
 * Pembungkus yang isinya pesan biasa: pesan sementara (disappearing),
 * sekali lihat, dan dokumen berketerangan. Tanpa dibuka, pesan di chat yang
 * menyalakan pesan sementara tidak pernah terarsip sama sekali.
 */
const PEMBUNGKUS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
] as const;

const bukaBungkus = (message: Record<string, unknown>): Record<string, unknown> | null => {
  let isi: Record<string, unknown> | null = message;
  // Dibatasi: bungkus bisa bersarang (pesan sementara yang sekali lihat),
  // tapi tidak pernah dalam.
  for (let i = 0; i < 4 && isi; i += 1) {
    const sekarang: Record<string, unknown> = isi;
    const kunci = PEMBUNGKUS.find((k) => {
      const b = sekarang[k] as { message?: unknown } | null | undefined;
      return !!b && typeof b === 'object' && !!b.message && typeof b.message === 'object';
    });
    if (!kunci) break;
    isi = (sekarang[kunci] as { message: Record<string, unknown> }).message;
  }
  return isi;
};

/** Isi dan jenis pesan, beserta keterangan berkas bila ada. */
export const isiDariPesan = (
  pesanMentah: Record<string, unknown> | null | undefined
): IsiPesan | null => {
  if (!pesanMentah) return null;
  const message = bukaBungkus(pesanMentah);
  if (!message) return null;

  const ambil = <T>(kunci: string) => message[kunci] as T | undefined;

  const teks = ambil<string>('conversation');
  if (typeof teks === 'string') return { body: teks, type: 'text' };

  const diperluas = ambil<{ text?: string }>('extendedTextMessage');
  if (diperluas?.text !== undefined) return { body: diperluas.text, type: 'text' };

  const gambar = ambil<{ caption?: string; mimetype?: string }>('imageMessage');
  if (gambar) {
    return {
      body: gambar.caption ?? '',
      type: 'image',
      media: { mimeType: gambar.mimetype ?? 'image/jpeg', fileName: null },
    };
  }

  const video = ambil<{ caption?: string; mimetype?: string }>('videoMessage');
  if (video) {
    return {
      body: video.caption ?? '',
      type: 'video',
      media: { mimeType: video.mimetype ?? 'video/mp4', fileName: null },
    };
  }

  const dokumen = ambil<{ caption?: string; fileName?: string; mimetype?: string }>('documentMessage');
  if (dokumen) {
    return {
      body: dokumen.caption ?? dokumen.fileName ?? '',
      type: 'document',
      media: { mimeType: dokumen.mimetype ?? null, fileName: dokumen.fileName ?? null },
    };
  }

  // Pesan suara dan rekaman: tidak ada teks sama sekali, jadi berkasnya yang
  // menjadi isinya.
  const suara = ambil<{ mimetype?: string }>('audioMessage') ?? ambil<{ mimetype?: string }>('pttMessage');
  if (suara) {
    return { body: '', type: 'audio', media: { mimeType: suara.mimetype ?? 'audio/ogg', fileName: null } };
  }

  // Stiker, reaksi, pesan protokol, pembaruan status — bukan percakapan.
  return null;
};

/** messageTimestamp bisa datang sebagai angka, string, atau Long protobuf. */
export const waktuDariTimestamp = (nilai: PesanBaileys['messageTimestamp']): Date => {
  if (nilai === null || nilai === undefined) return new Date();

  if (typeof nilai === 'number') return new Date(nilai * 1000);
  if (typeof nilai === 'string') {
    const angka = Number.parseInt(nilai, 10);
    return Number.isFinite(angka) ? new Date(angka * 1000) : new Date();
  }
  if (typeof nilai.toNumber === 'function') return new Date(nilai.toNumber() * 1000);

  return new Date();
};

/** Semua LID yang disebut sebuah pesan: lawan bicara dan pengirim grup. */
export const lidDalamPesan = (raw: PesanBaileys): string[] => {
  const hasil: string[] = [];
  for (const jid of [raw.key?.remoteJid, raw.key?.participant, raw.participant]) {
    const lid = lidDariNilai(jid);
    if (lid) hasil.push(lid);
  }
  return hasil;
};

const PETA_KOSONG: ReadonlyMap<string, string> = new Map();

/**
 * @param nomorSendiri nomor yang sesinya sedang terhubung, dalam bentuk
 *   baku. Dipakai untuk menentukan siapa pengirim dan siapa penerima:
 *   Baileys hanya menyebut "lawan bicara" dan penanda fromMe.
 * @param petaLid pemetaan LID -> nomor asli yang sudah diketahui, untuk
 *   pesan yang tidak membawa alamat alternatif (riwayat, pesan lama).
 */
export const normalizeBaileysMessage = (
  raw: PesanBaileys,
  nomorSendiri: string,
  petaLid: ReadonlyMap<string, string> = PETA_KOSONG
): HasilNormalisasi => {
  const jid = raw.key?.remoteJid;
  if (!jid) return { status: 'dilewati', alasan: 'jid_tidak_valid' };

  // Status, siaran, dan kanal bukan percakapan: tidak ada lawan bicara yang
  // bisa dipertanggungjawabkan, dan isinya sama untuk semua penerima.
  const jenis = jenisJid(jid);
  if (jenis === 'siaran') return { status: 'dilewati', alasan: 'siaran' };
  if (jenis === null) return { status: 'dilewati', alasan: 'jid_tidak_valid' };

  const idPesan = raw.key?.id;
  if (!idPesan) return { status: 'dilewati', alasan: 'tanpa_id' };

  const isi = isiDariPesan(raw.message);
  if (!isi) return { status: 'dilewati', alasan: 'jenis_tidak_didukung' };

  const dariSaya = raw.key?.fromMe === true;
  const waktu = waktuDariTimestamp(raw.messageTimestamp);
  const pasangan: PasanganLid[] = [];
  const namaPengirim = dariSaya ? null : rapikanNama(raw.pushName);
  const namaBisnis = dariSaya ? null : rapikanNama(raw.verifiedBizName);

  if (jenis === 'grup') {
    // Di grup, lawan bicaranya adalah grup itu sendiri; yang mengirim
    // disimpan terpisah supaya tetap terlihat siapa menulis apa.
    const kunciGrup = digitJid(jid);
    if (!kunciGrup) return { status: 'dilewati', alasan: 'jid_tidak_valid' };

    let participantNumber: string | null = null;
    let participantLid: string | null = null;

    if (dariSaya) {
      participantNumber = nomorSendiri;
    } else {
      // Pesan live menaruh pengirimnya di key.participant; pesan riwayat
      // sering di field participant level atas.
      const peserta = raw.key?.participant || raw.participant || null;
      const digit = peserta ? digitJid(peserta) : null;
      const jenisPeserta = jenisJid(peserta);
      const alt = raw.key?.participantAlt;

      if (digit && jenisPeserta === 'lid') {
        participantLid = digit;
        const altNomor = jenisJid(alt) === 'pn' ? digitJid(alt!) : null;
        if (altNomor) pasangan.push({ lid: digit, pn: altNomor });
        participantNumber = altNomor ?? petaLid.get(digit) ?? digit;
      } else if (digit) {
        participantNumber = digit;
        const altLid = lidDariNilai(alt);
        if (altLid && jenisPeserta === 'pn') {
          participantLid = altLid;
          pasangan.push({ lid: altLid, pn: digit });
        }
      }
    }

    const nomorAsli = participantLid && participantNumber === participantLid ? null : participantNumber;
    return {
      status: 'ok',
      pesan: {
        externalMessageId: idPesan,
        from: dariSaya ? nomorSendiri : (participantNumber ?? kunciGrup),
        to: kunciGrup,
        body: isi.body,
        type: isi.type,
        timestamp: waktu,
        media: isi.media,
        senderName: namaPengirim,
        grup: { jid, kunci: kunciGrup, participantNumber, participantLid },
      },
      pasangan,
      pengirim:
        !dariSaya && participantNumber
          ? { nomor: nomorAsli, lid: participantLid, pushName: namaPengirim, verifiedName: namaBisnis }
          : null,
    };
  }

  const digit = digitJid(jid);
  if (!digit) return { status: 'dilewati', alasan: 'jid_tidak_valid' };

  const alt = raw.key?.remoteJidAlt;
  let nomor: string | null;
  let lid: string | null;

  if (jenis === 'lid') {
    lid = digit;
    // Pada pesan yang kita kirim, alamat alternatifnya bisa nomor kita
    // sendiri (sender_pn), bukan nomor lawan bicara.
    const altNomor = jenisJid(alt) === 'pn' ? digitJid(alt!) : null;
    const altSah = altNomor && altNomor !== nomorSendiri ? altNomor : null;
    if (altSah) pasangan.push({ lid, pn: altSah });
    nomor = altSah ?? petaLid.get(lid) ?? null;
  } else {
    nomor = digit;
    // Untuk pesan keluar, LID alternatifnya bisa LID kita sendiri; tidak
    // ada cara memastikan, jadi diabaikan.
    lid = dariSaya ? null : lidDariNilai(alt);
    if (lid) pasangan.push({ lid, pn: digit });
  }

  // LID yang belum terselesaikan tetap menjadi kunci utas — lebih baik
  // daripada membuang pesannya — dan ditandai lewat contactLid.
  const lawan = nomor ?? lid!;

  return {
    status: 'ok',
    pesan: {
      // ID apa adanya dari WhatsApp, tanpa awalan nomor akun. Kalau dua
      // nomor perusahaan saling berkirim pesan, keduanya menerima pesan
      // dengan id yang sama; tanpa awalan, yang kedua dikenali sebagai
      // duplikat dan arsipnya tidak terganda.
      externalMessageId: idPesan,
      from: dariSaya ? nomorSendiri : lawan,
      to: dariSaya ? lawan : nomorSendiri,
      body: isi.body,
      type: isi.type,
      timestamp: waktu,
      media: isi.media,
      contactLid: lid,
      senderName: namaPengirim,
    },
    pasangan,
    pengirim: dariSaya ? null : { nomor, lid, pushName: namaPengirim, verifiedName: namaBisnis },
  };
};

// --- Kontak ---

/** Bentuk kontak Baileys (contacts.upsert / contacts.update / riwayat). */
export interface KontakBaileys {
  /** LID atau nomor. */
  id?: string | null;
  lid?: string | null;
  phoneNumber?: string | null;
  /** Nama di buku kontak ponsel pemegang nomor. */
  name?: string | null;
  /** Nama profil WhatsApp (pushName). */
  notify?: string | null;
  verifiedName?: string | null;
}

export interface KontakTerbaca {
  nomor: string | null;
  lid: string | null;
  savedName: string | null;
  pushName: string | null;
  verifiedName: string | null;
}

/**
 * Membaca satu kontak Baileys. null untuk grup, kanal, dan kontak yang tidak
 * membawa nama maupun pemetaan apa pun.
 */
export const bacaKontakBaileys = (k: KontakBaileys | null | undefined): KontakTerbaca | null => {
  if (!k || typeof k !== 'object' || typeof k.id !== 'string') return null;
  const jenis = jenisJid(k.id);
  if (jenis !== 'pn' && jenis !== 'lid') return null;

  const lid = jenis === 'lid' ? digitJid(k.id) : lidDariNilai(k.lid);
  const nomor = jenis === 'pn' ? digitJid(k.id) : nomorDariNilai(k.phoneNumber);
  if (!lid && !nomor) return null;

  const hasil: KontakTerbaca = {
    nomor,
    lid,
    savedName: rapikanNama(k.name),
    pushName: rapikanNama(k.notify),
    verifiedName: rapikanNama(k.verifiedName),
  };
  const adaNama = hasil.savedName || hasil.pushName || hasil.verifiedName;
  return adaNama || (lid && nomor) ? hasil : null;
};

/** Pasangan LID -> nomor dari peserta grup (groupMetadata / groupFetchAllParticipating). */
export const pasanganDariPeserta = (peserta: unknown): PasanganLid | null => {
  if (!peserta || typeof peserta !== 'object') return null;
  const p = peserta as { id?: unknown; lid?: unknown; phoneNumber?: unknown };
  if (typeof p.id !== 'string') return null;
  const jenis = jenisJid(p.id);
  if (jenis === 'lid') {
    const lid = digitJid(p.id);
    const pn = typeof p.phoneNumber === 'string' ? nomorDariNilai(p.phoneNumber) : null;
    return lid && pn ? { lid, pn } : null;
  }
  if (jenis === 'pn') {
    const pn = digitJid(p.id);
    const lid = typeof p.lid === 'string' ? lidDariNilai(p.lid) : null;
    return lid && pn ? { lid, pn } : null;
  }
  return null;
};
