// src/utils/whatsappRules.ts
import { createHmac, timingSafeEqual } from 'crypto';

export const MESSAGE_DIRECTIONS = ['incoming', 'outgoing'] as const;
export const SESSION_EVENT_TYPES = ['connected', 'disconnected', 'scan_required'] as const;

/**
 * Membakukan nomor telepon Indonesia ke bentuk E.164 tanpa tanda plus.
 *
 * Nomor yang sama bisa datang sebagai 081234567890, +6281234567890, atau
 * 6281234567890 — bahkan dengan spasi dan tanda hubung. Tanpa pembakuan,
 * pencocokan terhadap daftar nomor perusahaan akan meleset, dan pesan yang
 * seharusnya diarsipkan justru tertolak.
 */
export const normalizePhoneNumber = (raw: string): string | null => {
  // Buang semua selain angka. Tanda plus di depan ikut hilang; kode negara
  // ditangani di bawah.
  const angka = raw.replace(/\D/g, '');

  // Nomor telepon lengkap berkode negara paling sedikit 10 digit. Yang lebih
  // pendek hampir pasti salah ketik, dan menerimanya berarti nomor rusak bisa
  // masuk daftar nomor perusahaan — daftar yang justru menjadi penegak
  // ruang lingkup pemantauan.
  const MINIMAL_DIGIT = 10;

  if (angka.length < MINIMAL_DIGIT) return null;

  // 0812... -> 62812...
  if (angka.startsWith('0')) {
    const tanpaNol = angka.slice(1);
    return tanpaNol.length >= 9 ? `62${tanpaNol}` : null;
  }

  // Sudah berkode negara Indonesia.
  if (angka.startsWith('62')) return angka;

  // Nomor asing dibiarkan apa adanya: pelanggan dari luar negeri tetap
  // menghubungi nomor perusahaan, dan pesannya sah untuk diarsipkan.
  return angka;
};

export const samePhoneNumber = (a: string, b: string): boolean => {
  const na = normalizePhoneNumber(a);
  const nb = normalizePhoneNumber(b);
  return na !== null && nb !== null && na === nb;
};

export type ScopeRejection = 'not_company_number' | 'invalid_number' | 'both_unknown';

export interface ScopeResult {
  allowed: boolean;
  rejection?: ScopeRejection;
  /** Nomor perusahaan yang terlibat, dalam bentuk baku. */
  companyNumber?: string;
  /** Lawan bicara. */
  contactNumber?: string;
  direction?: 'incoming' | 'outgoing';
}

/**
 * Menentukan apakah sebuah pesan berada dalam ruang lingkup pemantauan.
 *
 * Aturannya satu: salah satu pihak harus nomor perusahaan yang terdaftar.
 * Percakapan antar dua nomor pribadi tidak pernah masuk arsip — batasan itu
 * yang membedakan pemantauan kanal kerja dari penyadapan komunikasi pribadi.
 */
export const resolveScope = (params: {
  from: string;
  to: string;
  companyNumbers: Set<string>;
}): ScopeResult => {
  const from = normalizePhoneNumber(params.from);
  const to = normalizePhoneNumber(params.to);

  if (from === null || to === null) {
    return { allowed: false, rejection: 'invalid_number' };
  }

  const fromPerusahaan = params.companyNumbers.has(from);
  const toPerusahaan = params.companyNumbers.has(to);

  if (!fromPerusahaan && !toPerusahaan) {
    return { allowed: false, rejection: 'not_company_number' };
  }

  // Bila keduanya nomor perusahaan (percakapan antar outlet), pengirim
  // diperlakukan sebagai pemilik arsip dan arahnya keluar.
  if (fromPerusahaan) {
    return { allowed: true, companyNumber: from, contactNumber: to, direction: 'outgoing' };
  }

  return { allowed: true, companyNumber: to, contactNumber: from, direction: 'incoming' };
};

/**
 * Memverifikasi tanda tangan webhook Belly's.
 *
 * Endpoint webhook tidak memakai token JWT karena dipanggil mesin, bukan
 * pengguna. Tanpa tanda tangan, siapa pun yang tahu alamatnya bisa menyisipkan
 * percakapan palsu ke arsip yang dipakai audit.
 *
 * Perbandingannya memakai timingSafeEqual: perbandingan string biasa berhenti
 * pada byte pertama yang berbeda, dan selisih waktunya bisa dipakai menebak
 * tanda tangan yang benar.
 */
export const verifyWebhookSignature = (params: {
  rawBody: Buffer | string;
  signature: string | undefined;
  secret: string;
}): boolean => {
  if (!params.signature) return false;

  const diharapkan = createHmac('sha256', params.secret)
    .update(params.rawBody)
    .digest('hex');

  // Buang awalan bergaya "sha256=" bila ada.
  const diterima = params.signature.replace(/^sha256=/i, '').trim();

  const a = Buffer.from(diharapkan, 'utf8');
  const b = Buffer.from(diterima, 'utf8');

  // timingSafeEqual melempar bila panjangnya berbeda, jadi diperiksa dulu.
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
};
