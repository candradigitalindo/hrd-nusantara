import request from 'supertest';
import type http from 'http';
import type { Express } from 'express';
import { DEFAULT_PASSWORD } from './db';

/** Express app maupun server yang sudah mendengarkan; keduanya diterima supertest. */
export type AppUji = Express | http.Server;

/** Menghitung rute yang benar-benar terpasang pada sebuah app Express. */
const hitungRute = (app: AppUji): string => {
  try {
    // Kalau yang diberikan sebuah http.Server, app Express-nya ada sebagai
    // penangan event 'request'.
    const mungkinServer = app as unknown as { _events?: { request?: unknown } };
    const express = (mungkinServer._events?.request ?? app) as {
      _router?: { stack?: unknown[] };
    };
    const stack = express._router?.stack;
    if (!Array.isArray(stack)) return 'router-tidak-ada';

    const punyaAuth = stack.some((lapis) => {
      const r = lapis as { regexp?: RegExp };
      return r.regexp?.toString().includes('auth') ?? false;
    });

    return `lapisan=${stack.length} punyaAuth=${punyaAuth}`;
  } catch {
    return 'gagal-dibaca';
  }
};

export const login = async (app: AppUji, email: string, password = DEFAULT_PASSWORD) => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password });

  if (res.status !== 200) {
    // Pesan dibuat selengkap mungkin karena kegagalan di sini muncul
    // sesekali dan sulit direproduksi: sekali tertangkap harus langsung
    // bisa didiagnosis, bukan menyisakan "401 {}" tanpa petunjuk.
    const rincian = [
      `status=${res.status}`,
      `body=${JSON.stringify(res.body)}`,
      `text=${JSON.stringify((res.text ?? '').slice(0, 300))}`,
      `contentType=${res.headers['content-type'] ?? '-'}`,
      `ratelimit=${res.headers['ratelimit'] ?? '-'}`,
      `retryAfter=${res.headers['retry-after'] ?? '-'}`,
      // Membedakan "app salah konfigurasi" dari "permintaan nyasar ke
      // server lain": kalau rutenya terpasang tapi jawabannya 404 HTML,
      // berarti respons itu bukan berasal dari app ini.
      `app=${hitungRute(app)}`,
      // Ke mana permintaan ini SEBENARNYA dikirim. Kalau jawabannya datang
      // dari server lain, inilah satu-satunya petunjuk yang membedakannya
      // dari bug di aplikasi sendiri.
      `url=${(res as unknown as { request?: { url?: string } }).request?.url ?? '-'}`,
    ].join(' ');

    throw new Error(`Login gagal untuk ${email}: ${rincian}`);
  }

  return res.body.token as string;
};

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * Memeriksa status HTTP sambil menyertakan body pada pesan gagal.
 *
 * `expect(res.status).toBe(403)` hanya melaporkan "expected 403, received 201"
 * — tidak cukup untuk menelusuri kegagalan yang jarang muncul dan sulit
 * direproduksi. Dengan body ikut tercetak, sekali gagal saja sudah memberi
 * petunjuk apa yang sebenarnya dikembalikan server.
 */
export const expectStatus = (
  res: { status: number; body: unknown },
  expected: number
): void => {
  if (res.status !== expected) {
    throw new Error(
      `Diharapkan status ${expected}, dapat ${res.status}. Body: ${JSON.stringify(res.body)}`
    );
  }
};
