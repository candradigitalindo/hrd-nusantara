// src/services/whatsapp/baileysMessage.ts
//
// Menerjemahkan bentuk pesan Baileys menjadi bentuk baku arsip.
//
// Sengaja tidak mengimpor apa pun dari pustaka Baileys: bentuk yang dipakai
// dijelaskan ulang sebagai tipe lokal. Dua alasannya: modul ini jadi bisa
// diuji tanpa membuka koneksi WhatsApp sungguhan, dan pergantian versi
// pustaka — 7.x masih berstatus RC — tidak langsung merembet ke sini.
import type { PesanMasuk, TipePesan } from './ingest';

/** Bagian dari objek pesan Baileys yang benar-benar dipakai. */
export interface PesanBaileys {
  key?: {
    remoteJid?: string | null;
    fromMe?: boolean | null;
    id?: string | null;
    /** Peserta grup yang mengirim; hanya terisi pada pesan grup. */
    participant?: string | null;
  } | null;
  message?: Record<string, unknown> | null;
  messageTimestamp?: number | string | { toNumber?: () => number } | null;
  pushName?: string | null;
}

export type AlasanDilewati =
  | 'siaran'
  | 'jid_tidak_valid'
  | 'tanpa_id'
  | 'jenis_tidak_didukung';

export type HasilNormalisasi =
  | { status: 'ok'; pesan: PesanMasuk }
  | { status: 'dilewati'; alasan: AlasanDilewati };

/** Mengambil nomor dari JID WhatsApp: "628111111111@s.whatsapp.net". */
export const nomorDariJid = (jid: string): string | null => {
  const sebelumAt = jid.split('@')[0];
  // JID perangkat membawa akhiran ":12"; versi multi-device juga memakai
  // titik dua untuk nomor perangkat. Keduanya bukan bagian dari nomor.
  const angka = sebelumAt.split(':')[0].replace(/\D/g, '');
  return angka.length > 0 ? angka : null;
};

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

/** Isi dan jenis pesan, beserta keterangan berkas bila ada. */
export const isiDariPesan = (
  message: Record<string, unknown> | null | undefined
): IsiPesan | null => {
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

/**
 * @param nomorSendiri nomor perusahaan yang sesinya sedang terhubung, dalam
 *   bentuk baku. Dipakai untuk menentukan siapa pengirim dan siapa penerima:
 *   Baileys hanya menyebut "lawan bicara" dan penanda fromMe.
 */
export const normalizeBaileysMessage = (
  raw: PesanBaileys,
  nomorSendiri: string
): HasilNormalisasi => {
  const jid = raw.key?.remoteJid;
  if (!jid) return { status: 'dilewati', alasan: 'jid_tidak_valid' };

  // Status dan siaran bukan percakapan: tidak ada lawan bicara yang bisa
  // dipertanggungjawabkan, dan isinya sama untuk semua penerima.
  if (jid.endsWith('@broadcast') || jid.startsWith('status@')) {
    return { status: 'dilewati', alasan: 'siaran' };
  }

  const idPesan = raw.key?.id;
  if (!idPesan) return { status: 'dilewati', alasan: 'tanpa_id' };

  const isi = isiDariPesan(raw.message);
  if (!isi) return { status: 'dilewati', alasan: 'jenis_tidak_didukung' };

  const dariSaya = raw.key?.fromMe === true;
  const waktu = waktuDariTimestamp(raw.messageTimestamp);
  const grup = jid.endsWith('@g.us');

  if (grup) {
    // Di grup, lawan bicaranya adalah grup itu sendiri; yang mengirim
    // disimpan terpisah supaya tetap terlihat siapa menulis apa.
    const kunciGrup = nomorDariJid(jid);
    if (!kunciGrup) return { status: 'dilewati', alasan: 'jid_tidak_valid' };

    const peserta = raw.key?.participant ? nomorDariJid(raw.key.participant) : null;
    const pengirim = dariSaya ? nomorSendiri : (peserta ?? kunciGrup);

    return {
      status: 'ok',
      pesan: {
        externalMessageId: idPesan,
        from: pengirim,
        to: kunciGrup,
        body: isi.body,
        type: isi.type,
        timestamp: waktu,
        media: isi.media,
        grup: { jid, kunci: kunciGrup, participantNumber: dariSaya ? nomorSendiri : peserta },
      },
    };
  }

  const lawan = nomorDariJid(jid);
  if (!lawan) return { status: 'dilewati', alasan: 'jid_tidak_valid' };

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
    },
  };
};
