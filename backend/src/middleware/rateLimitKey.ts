// src/middleware/rateLimitKey.ts
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env';
import type { JwtPayload } from './auth';

export interface KunciPembatas {
  /** "user:<id>" untuk permintaan bertoken sah, "ip:<alamat>" untuk sisanya. */
  kunci: string;
  berSesi: boolean;
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

  let hasil: KunciPembatas = { kunci: `ip:${ipKeyGenerator(req.ip ?? '')}`, berSesi: false };
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (token) {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
      if (typeof payload.sub === 'string' && payload.sub) {
        hasil = { kunci: `user:${payload.sub}`, berSesi: true };
      }
    } catch {
      // Token kedaluwarsa atau palsu: biarkan middleware auth yang menolaknya;
      // untuk pembatas, permintaan ini dihitung pada jatah IP.
    }
  }
  r[SIMPANAN] = hasil;
  return hasil;
};
