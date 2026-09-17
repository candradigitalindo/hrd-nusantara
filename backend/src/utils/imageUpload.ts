// src/utils/imageUpload.ts
import fs from 'fs/promises';
import path from 'path';
import { env } from '../config/env';
import { generateULID } from './generateULID';

const DATA_URI = /^data:image\/(jpeg|jpg|png|webp);base64,/i;

/** Angka ajaib di awal berkas, satu-satunya penanda jenis gambar yang tepercaya. */
const SIGNATURES: { ext: string; bytes: number[] }[] = [
  { ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: 'webp', bytes: [0x52, 0x49, 0x46, 0x46] },
];

export class InvalidImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidImageError';
  }
}

const kenaliJenis = (buffer: Buffer): string | null =>
  SIGNATURES.find((sig) => sig.bytes.every((b, i) => buffer[i] === b))?.ext ?? null;

/**
 * Mengubah gambar base64 dari klien menjadi buffer.
 *
 * Jenis berkas ditentukan dari isi buffer, bukan dari prefiks data URI yang
 * dikirim klien — prefiks itu sekadar teks dan bisa berbohong.
 */
export const decodeBase64Image = (input: string): { buffer: Buffer; extension: string } => {
  const base64 = input.replace(DATA_URI, '');

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    throw new InvalidImageError('Data gambar bukan base64 yang sah');
  }

  if (buffer.byteLength < 100) {
    throw new InvalidImageError('Data gambar kosong atau terpotong');
  }

  const extension = kenaliJenis(buffer);
  if (!extension) {
    throw new InvalidImageError('Format gambar harus JPEG, PNG, atau WebP');
  }

  return { buffer, extension };
};

/**
 * Menyimpan gambar ke penyimpanan lokal.
 *
 * Nama berkas dibuat server dari ULID, tidak pernah dari masukan klien —
 * nama berkas kiriman klien adalah jalan masuk klasik untuk path traversal.
 */
export const saveImage = async (
  buffer: Buffer,
  extension: string,
  subDir: string
): Promise<string> => {
  const dir = path.resolve(env.UPLOAD_DIR, subDir);
  await fs.mkdir(dir, { recursive: true });

  const namaBerkas = `${generateULID()}.${extension}`;
  await fs.writeFile(path.join(dir, namaBerkas), buffer, { mode: 0o600 });

  return path.posix.join(subDir, namaBerkas);
};
