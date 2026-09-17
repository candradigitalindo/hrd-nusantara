// src/utils/fieldCrypto.ts
//
// Enkripsi kolom untuk data pribadi yang tersimpan di database.
//
// Dipakai pertama kali untuk isi pesan WhatsApp, tapi sengaja dibuat umum:
// kolom lain yang sama sensitifnya (titik lokasi presensi, catatan medis)
// bisa memakai fungsi yang sama tanpa menulis ulang.
//
// Persoalan yang harus dipecahkan bersamaan: UU PDP 27/2022 menuntut isi
// pesan tidak tersimpan terbuka, sementara dokumen fitur menuntut arsipnya
// bisa DICARI untuk pelacakan isu. Ciphertext AES tidak bisa dicari dengan
// LIKE, jadi di samping ciphertext disimpan "indeks buta": tiap kata diubah
// menjadi HMAC dengan kunci rahasia. Yang memegang database melihat deretan
// hex tanpa arti dan tidak bisa membalikkannya menjadi kata, tapi pencarian
// tetap jalan karena kata yang dicari di-HMAC dengan kunci yang sama.
//
// Konsekuensi yang harus diterima: pencarian menjadi per KATA UTUH, bukan
// potongan kata. Mencari "keluhan" menemukan "Keluhan: pesanan lama";
// mencari "keluh" tidak. Itu harga yang dibayar untuk enkripsi, dan untuk
// pelacakan isu per topik hasilnya masih memadai.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'crypto';
import { env } from '../config/env';

const VERSI = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // ukuran baku GCM
const KEY_BYTES = 32;

/// Garam tetap. Kunci induk sudah acak 32 byte, jadi garam di sini hanya
/// memisahkan ruang turunan, bukan menambah entropi.
const SALT = Buffer.from('hrd-nusantara-field-crypto');

/// Satu kunci induk di environment, dua kunci turunan yang tidak saling
/// membocorkan: kalau indeks buta bocor, kunci enkripsi tetap aman.
const INFO_ENKRIPSI = 'enkripsi-kolom-v1';
const INFO_INDEKS = 'indeks-buta-v1';

let cache: { enkripsi: Buffer; indeks: Buffer } | null = null;

const kunci = () => {
  if (cache) return cache;
  if (!env.FIELD_ENCRYPTION_KEY) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY belum diatur, padahal ada kolom terenkripsi yang mau ditulis. ' +
        'Generate dengan: openssl rand -base64 32'
    );
  }
  const induk = Buffer.from(env.FIELD_ENCRYPTION_KEY, 'base64');
  cache = {
    enkripsi: Buffer.from(hkdfSync('sha256', induk, SALT, INFO_ENKRIPSI, KEY_BYTES)),
    indeks: Buffer.from(hkdfSync('sha256', induk, SALT, INFO_INDEKS, KEY_BYTES)),
  };
  return cache;
};

export const isFieldEncryptionEnabled = () => Boolean(env.FIELD_ENCRYPTION_KEY);

/// Hanya untuk test yang mengganti kunci di tengah jalan.
export const resetFieldCryptoCache = () => {
  cache = null;
};

const POLA_CIPHERTEXT = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

/**
 * Apakah nilai ini hasil encryptField? Dipakai supaya baris lama yang
 * terlanjur tersimpan terbuka — ditulis sebelum enkripsi ada — tetap
 * terbaca alih-alih melempar error saat didekripsi.
 */
export const isCiphertext = (nilai: string) => POLA_CIPHERTEXT.test(nilai);

/**
 * AES-256-GCM. Tag autentikasi ikut disimpan, jadi ciphertext yang diubah
 * orang langsung di database akan ditolak saat dibaca, bukan menghasilkan
 * teks sampah yang diam-diam dipercaya.
 */
export const encryptField = (teks: string): string => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, kunci().enkripsi, iv);
  const ct = Buffer.concat([cipher.update(teks, 'utf8'), cipher.final()]);
  return [
    VERSI,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ct.toString('base64url'),
  ].join('.');
};

export const decryptField = (tersimpan: string): string => {
  if (!isCiphertext(tersimpan)) return tersimpan;

  const [, ivB64, tagB64, ctB64] = tersimpan.split('.');
  const decipher = createDecipheriv(ALGO, kunci().enkripsi, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
};

// --- Indeks buta ---

const PANJANG_TOKEN_MIN = 2;

/// Pesan bisa sepanjang 20.000 karakter. Tanpa batas ini satu pesan spam
/// bisa menaruh ribuan token dalam satu baris dan membuat indeks GIN
/// membengkak tanpa guna.
const TOKEN_MAKS = 200;

/// Panjang HMAC dipotong jadi 20 hex (80 bit). Cukup jauh dari tabrakan
/// untuk arsip sebesar apa pun, dan memangkas ukuran indeks lebih dari
/// separuh dibanding 64 hex penuh.
const PANJANG_HMAC = 20;

/** Memecah teks menjadi kata unik, huruf kecil, tanpa tanda baca. */
export const tokenizeText = (teks: string): string[] => {
  const kata = teks
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((k) => k.length >= PANJANG_TOKEN_MIN);
  return [...new Set(kata)].slice(0, TOKEN_MAKS);
};

export const blindIndex = (kata: string): string =>
  createHmac('sha256', kunci().indeks).update(kata).digest('hex').slice(0, PANJANG_HMAC);

/** Token yang disimpan bersama ciphertext, untuk dicari belakangan. */
export const buildSearchTokens = (teks: string): string[] => tokenizeText(teks).map(blindIndex);
