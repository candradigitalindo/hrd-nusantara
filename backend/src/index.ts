// src/index.ts
import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { mulaiDriverWhatsApp, hentikanDriverWhatsApp } from './services/whatsapp/bootstrap';
import { mulaiPush, hentikanPush } from './services/notification/bootstrap';
import { pastikanPeranSistem } from './services/roles/system';
import { mulaiPembersihLokasi, hentikanPembersihLokasi } from './controllers/locationTrackingController';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`HRD API berjalan di port ${env.PORT} (${env.NODE_ENV})`);

  // Sengaja setelah listen: koneksi WhatsApp bisa lama tersambung, dan API
  // tidak boleh ikut menunggu. Kegagalannya pun tidak menjatuhkan server —
  // modul HRD lainnya tetap harus melayani.
  // Peran sistem harus ada sebelum ada yang menambah karyawan; kalau gagal,
  // izin bawaan yang dikodekan tetap berlaku (lihat services/roles/resolve.ts).
  pastikanPeranSistem().catch((error) => {
    console.warn('[peran] gagal membuat peran sistem:', error);
  });

  mulaiPush();
  mulaiPembersihLokasi();

  mulaiDriverWhatsApp().catch((error) => {
    console.warn('[whatsapp] driver gagal dinyalakan:', error);
  });
});

const shutdown = (signal: string) => {
  console.log(`\n${signal} diterima, menutup server...`);
  server.close(async () => {
    await hentikanDriverWhatsApp();
    hentikanPush();
    hentikanPembersihLokasi();
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
