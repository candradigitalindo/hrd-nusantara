// src/utils/whatsappMedia.ts
//
// Penyimpanan berkas media WhatsApp: gambar, video, pesan suara, dokumen.
//
// Isi pesan bertipe media tidak ada di teksnya — pesan suara sama sekali
// tidak punya teks — jadi tanpa berkas ini arsip hanya memuat tanda kurung
// kosong. Berkasnya disimpan di luar database (seperti dokumen karyawan),
// dengan nama yang dibuat server, dan hanya bisa dibuka lewat endpoint yang
// memeriksa izin serta mencatat jejak audit.
import fs from 'fs/promises';
import path from 'path';
import { env } from '../config/env';
import { generateULID } from './generateULID';

/** Ekstensi dari tipe MIME yang dikirim WhatsApp; "bin" bila tidak dikenal. */
export const ekstensiDariMime = (mimeType: string | null | undefined): string => {
  const dasar = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  const peta: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'video/quicktime': 'mov',
    // Pesan suara WhatsApp: Opus di dalam wadah Ogg.
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/amr': 'amr',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'text/plain': 'txt',
  };
  return peta[dasar] ?? 'bin';
};

/** Direktori media sebuah akun, relatif terhadap UPLOAD_DIR. */
const subDirektori = (accountId: string) => path.posix.join('whatsapp', accountId);

/**
 * Menyimpan berkas media ke disk.
 *
 * @returns lokasi relatif terhadap UPLOAD_DIR, untuk disimpan di kolom
 *   mediaPath. Nama berkasnya dibuat dari ULID: nama asli dari WhatsApp bisa
 *   mengandung apa saja, termasuk "../".
 */
export const simpanMediaWhatsApp = async (params: {
  accountId: string;
  buffer: Buffer;
  mimeType: string | null;
}): Promise<string> => {
  const subDir = subDirektori(params.accountId);
  const dir = path.resolve(env.UPLOAD_DIR, subDir);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });

  const namaBerkas = `${generateULID()}.${ekstensiDariMime(params.mimeType)}`;
  await fs.writeFile(path.join(dir, namaBerkas), params.buffer, { mode: 0o600 });

  return path.posix.join(subDir, namaBerkas);
};

export class GalatMediaWhatsApp extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GalatMediaWhatsApp';
  }
}

/** Path absolut berkas, dipastikan tetap di dalam UPLOAD_DIR. */
export const lokasiMediaWhatsApp = (mediaPath: string): string => {
  const akar = path.resolve(env.UPLOAD_DIR);
  const penuh = path.resolve(akar, mediaPath);
  // Pertahanan lapis kedua: mediaPath dibuat server, tapi kalau suatu saat
  // basis datanya disusupi, ini yang mencegah berkas lain ikut terbaca.
  if (!penuh.startsWith(akar + path.sep)) {
    throw new GalatMediaWhatsApp('Lokasi berkas tidak sah');
  }
  return penuh;
};

/** Nama berkas untuk unduhan, dibersihkan dari karakter yang memutus header. */
export const namaUnduhanMedia = (
  namaAsli: string | null,
  mimeType: string | null,
  waktu: Date
): string => {
  const ekstensi = ekstensiDariMime(mimeType);
  const dasar = (namaAsli ?? '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '')
    .replace(/\.\.+/g, '.')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, 120);

  if (dasar) {
    return dasar.toLowerCase().endsWith(`.${ekstensi}`) ? dasar : `${dasar}.${ekstensi}`;
  }
  // Tanpa nama asli — lazim untuk foto dan pesan suara — waktunya yang dipakai,
  // supaya berkas yang diunduh tidak menumpuk sebagai "media.ogg (3)".
  const cap = waktu.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `wa-${cap}.${ekstensi}`;
};
