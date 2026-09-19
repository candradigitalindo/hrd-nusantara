// src/utils/documentUpload.ts
//
// Unggahan dokumen karyawan. Mengikuti pola imageUpload.ts: jenis berkas
// dikenali dari angka ajaib di isi buffer — bukan dari nama berkas atau
// prefiks data URI yang dikirim klien, keduanya sekadar teks dan bisa
// berbohong — dan nama di penyimpanan dibuat server dari ULID.
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { env } from '../config/env';
import { generateULID } from './generateULID';

const DATA_URI = /^data:[a-z0-9.+/-]+;base64,/i;

export interface JenisBerkas {
  extension: string;
  mimeType: string;
}

const cocok = (buffer: Buffer, bytes: number[], offset = 0) =>
  bytes.every((b, i) => buffer[offset + i] === b);

/**
 * Jenis yang diterima, dikenali dari isinya.
 *
 * DOCX adalah arsip ZIP; tanda "PK" saja tidak cukup karena berlaku untuk
 * semua ZIP, jadi ekstensi nama asli ikut diperiksa untuk yang satu ini.
 */
export const kenaliDokumen = (buffer: Buffer, originalName: string): JenisBerkas | null => {
  if (cocok(buffer, [0x25, 0x50, 0x44, 0x46])) return { extension: 'pdf', mimeType: 'application/pdf' };
  if (cocok(buffer, [0xff, 0xd8, 0xff])) return { extension: 'jpg', mimeType: 'image/jpeg' };
  if (cocok(buffer, [0x89, 0x50, 0x4e, 0x47])) return { extension: 'png', mimeType: 'image/png' };
  if (cocok(buffer, [0x52, 0x49, 0x46, 0x46]) && cocok(buffer, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { extension: 'webp', mimeType: 'image/webp' };
  }
  if (cocok(buffer, [0x50, 0x4b, 0x03, 0x04]) && /\.docx$/i.test(originalName)) {
    return {
      extension: 'docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
  return null;
};

export class InvalidDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDocumentError';
  }
}

export const decodeBase64Document = (
  input: string,
  originalName: string
): { buffer: Buffer; jenis: JenisBerkas; sha256: string } => {
  const base64 = input.replace(DATA_URI, '');
  const buffer = Buffer.from(base64, 'base64');

  if (buffer.byteLength < 32) throw new InvalidDocumentError('Berkas kosong atau terpotong');
  if (buffer.byteLength > env.DOCUMENT_MAX_BYTES) {
    throw new InvalidDocumentError(
      `Berkas terlalu besar (${(buffer.byteLength / 1_000_000).toFixed(1)} MB). Maksimal ${(env.DOCUMENT_MAX_BYTES / 1_000_000).toFixed(0)} MB.`
    );
  }

  const jenis = kenaliDokumen(buffer, originalName);
  if (!jenis) throw new InvalidDocumentError('Format harus PDF, JPEG, PNG, WebP, atau DOCX');

  return { buffer, jenis, sha256: createHash('sha256').update(buffer).digest('hex') };
};

export const saveDocument = async (
  buffer: Buffer,
  extension: string,
  employeeId: string
): Promise<string> => {
  const subDir = path.posix.join('documents', employeeId);
  const dir = path.resolve(env.UPLOAD_DIR, subDir);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });

  const namaBerkas = `${generateULID()}.${extension}`;
  await fs.writeFile(path.join(dir, namaBerkas), buffer, { mode: 0o600 });

  return path.posix.join(subDir, namaBerkas);
};

/** Path absolut berkas, dipastikan tetap di dalam UPLOAD_DIR. */
export const resolveDocumentPath = (storagePath: string): string => {
  const akar = path.resolve(env.UPLOAD_DIR);
  const penuh = path.resolve(akar, storagePath);
  // Pertahanan lapis kedua: storagePath dibuat server, tapi kalau suatu saat
  // basis datanya disusupi, ini yang mencegah "../../etc/passwd" terbaca.
  if (!penuh.startsWith(akar + path.sep)) {
    throw new InvalidDocumentError('Lokasi berkas tidak sah');
  }
  return penuh;
};

/**
 * Nama untuk header Content-Disposition. Karakter yang bisa memutus header
 * atau menipu penyimpanan di sisi klien dibuang.
 */
export const namaUnduhanAman = (originalName: string, extension: string): string => {
  const dasar = originalName
    .replace(/[\\/:*?"<>|\r\n\t]/g, '')
    .replace(/\.\.+/g, '.')
    // Titik di awal membuat berkas tersembunyi di Unix, dan "." atau ".."
    // sendirian adalah nama direktori — keduanya tidak boleh lolos.
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, 120);
  const bersih = dasar || 'dokumen';
  return bersih.toLowerCase().endsWith(`.${extension}`) ? bersih : `${bersih}.${extension}`;
};
