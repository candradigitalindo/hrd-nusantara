// src/middleware/rateLimitKey.ts
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env';
import { TIPE_PELAMAR } from './authPelamar';

export type JenisKunci = 'karyawan' | 'pelamar' | 'ip';

export interface KunciPembatas {
  /** "user:<id>" karyawan, "pelamar:<id>" akun portal karier, "ip:<alamat>" sisanya. */
  kunci: string;
  jenis: JenisKunci;
  /** true bila kuncinya per akun (karyawan atau pelamar), bukan per IP. */
  berSesi: boolean;
}

/** Klaim yang dibaca dari token; `tipe` hanya ada pada token pelamar. */
interface KlaimToken {
  sub?: unknown;
  tipe?: unknown;
}

const SIMPANAN = Symbol('kunciPembatas');
type RequestBerkunci = Request & { [SIMPANAN]?: KunciPembatas };

/**
 * Kunci pembatas laju: per pengguna bila tokennya sah, per IP bila tidak.
 *
 * Per IP saja tidak cocok untuk aplikasi ini: satu kantor ber-NAT atau satu
 * wifi outlet tampak sebagai satu alamat, sehingga seluruh karyawan di sana
 * berbagi satu jatah — dan satu HR dengan dua perangkat di halaman WhatsApp
 * (polling beberapa endpoint tiap 15–30 detik) sudah menghabiskannya sendiri.
 *
 * Token DIVERIFIKASI, bukan sekadar dibaca: token palsu dengan `sub` acak
 * harus tetap jatuh ke jatah IP, kalau tidak batasnya bisa dihindari dengan
 * mengganti-ganti sub. Verifikasi HMAC jauh lebih murah daripada query yang
 * dilindunginya. Hasilnya disimpan di request karena `keyGenerator` dan
 * `limit` sama-sama memanggilnya.
 */
export const kunciPembatas = (req: Request): KunciPembatas => {
  const r = req as RequestBerkunci;
  const tersimpan = r[SIMPANAN];
  if (tersimpan) return tersimpan;

  // /64 ditulis eksplisit: bawaan pustaka /56 menggabungkan beberapa pelanggan
  // ISP rumahan yang berbagi prefix ke satu jatah.
  let hasil: KunciPembatas = { kunci: `ip:${ipKeyGenerator(req.ip ?? '', 64)}`, jenis: 'ip', berSesi: false };
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (token) {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as KlaimToken;
      const sub = typeof payload.sub === 'string' ? payload.sub.slice(0, 64) : '';
      if (sub && payload.tipe === undefined) {
        hasil = { kunci: `user:${sub}`, jenis: 'karyawan', berSesi: true };
      } else if (sub && payload.tipe === TIPE_PELAMAR) {
        // Akun pelamar bisa dibuat siapa saja lewat portal publik, jadi
        // jatahnya dipisah dan lebih kecil daripada karyawan.
        hasil = { kunci: `pelamar:${sub}`, jenis: 'pelamar', berSesi: true };
      }
      // Jenis token lain (klaim tipe asing) tetap pada jatah IP.
    } catch {
      // Token kedaluwarsa atau palsu: biarkan middleware auth yang menolaknya;
      // untuk pembatas, permintaan ini dihitung pada jatah IP.
    }
  }
  r[SIMPANAN] = hasil;
  return hasil;
};
