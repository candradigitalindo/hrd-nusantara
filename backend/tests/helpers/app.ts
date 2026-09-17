// tests/helpers/app.ts
import http from 'http';
import { createApp } from '../../src/app';

/**
 * Satu server yang mendengarkan, dipakai bersama oleh seluruh berkas test.
 *
 * supertest membuat server BARU lalu menutupnya untuk setiap permintaan.
 * Dengan 745 test, itu berarti ribuan siklus bind/close port dalam satu
 * putaran, dan sesekali port yang dipakai bertabrakan dengan aplikasi lain
 * di mesin yang sama — permintaan login pernah terkirim ke port milik
 * VSCode dan dijawab "401 Unauthorized", yang muncul sebagai kegagalan
 * test yang berpindah-pindah dan mustahil direproduksi.
 *
 * Kalau supertest diberi server yang SUDAH mendengarkan, ia memakai alamat
 * itu apa adanya: satu port per berkas test, bukan ribuan.
 */
export const bikinApp = (): http.Server => {
  const server = http.createServer(createApp());
  server.listen(0);
  // Jangan menahan proses tetap hidup setelah semua test selesai.
  server.unref();
  return server;
};
