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
  } | null;
  message?: Record<string, unknown> | null;
  messageTimestamp?: number | string | { toNumber?: () => number } | null;
}

export type AlasanDilewati =
  | 'grup'
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

/**
 * Isi dan jenis pesan.
 *
 * Berkas medianya sendiri TIDAK diunduh. Menyimpan foto dan dokumen yang
 * dikirim pelanggan berarti menumpuk data pribadi pihak ketiga dalam jumlah
 * besar — beban UU PDP yang jauh lebih berat daripada manfaatnya untuk
 * pelacakan isu. Yang diarsipkan hanya keterangan dan nama berkasnya.
 */
export const isiDariPesan = (
  message: Record<string, unknown> | null | undefined
): { body: string; type: TipePesan } | null => {
  if (!message) return null;

  const ambil = <T>(kunci: string) => message[kunci] as T | undefined;

  const teks = ambil<string>('conversation');
  if (typeof teks === 'string') return { body: teks, type: 'text' };

  const diperluas = ambil<{ text?: string }>('extendedTextMessage');
  if (diperluas?.text !== undefined) return { body: diperluas.text, type: 'text' };

  const gambar = ambil<{ caption?: string }>('imageMessage');
  if (gambar) return { body: gambar.caption ?? '', type: 'image' };

  const video = ambil<{ caption?: string }>('videoMessage');
  if (video) return { body: video.caption ?? '', type: 'video' };

  const dokumen = ambil<{ caption?: string; fileName?: string }>('documentMessage');
  if (dokumen) return { body: dokumen.caption ?? dokumen.fileName ?? '', type: 'document' };

  // Pesan suara dan rekaman: tidak ada teks sama sekali, tapi kejadiannya
  // tetap perlu tercatat supaya urutan percakapan tidak bolong.
  if (ambil('audioMessage') || ambil('pttMessage')) return { body: '', type: 'audio' };

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

  // Percakapan grup punya banyak peserta sekaligus, sementara arsip ini
  // dibangun di atas satu lawan bicara per pesan. Memaksakannya masuk akan
  // menghasilkan arsip yang menyesatkan saat dipakai audit.
  if (jid.endsWith('@g.us')) return { status: 'dilewati', alasan: 'grup' };
  if (jid.endsWith('@broadcast') || jid.startsWith('status@')) {
    return { status: 'dilewati', alasan: 'siaran' };
  }

  const idPesan = raw.key?.id;
  if (!idPesan) return { status: 'dilewati', alasan: 'tanpa_id' };

  const lawan = nomorDariJid(jid);
  if (!lawan) return { status: 'dilewati', alasan: 'jid_tidak_valid' };

  const isi = isiDariPesan(raw.message);
  if (!isi) return { status: 'dilewati', alasan: 'jenis_tidak_didukung' };

  const dariSaya = raw.key?.fromMe === true;

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
      timestamp: waktuDariTimestamp(raw.messageTimestamp),
    },
  };
};
