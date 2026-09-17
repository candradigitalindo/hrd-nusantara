// src/services/notification/fcmDriver.ts
//
// Satu-satunya berkas yang menyentuh Firebase. Dimuat dinamis dan hanya saat
// push dinyalakan: firebase-admin membawa google-auth-library dan seluruh
// klien Firebase Database, yang tidak ada gunanya dimuat pada instance yang
// tidak pernah mengirim notifikasi.
import fs from 'fs';
import type { PengirimPush, HasilKirim } from './push';
import { env } from '../../config/env';

/// Kode yang berarti "token ini sudah tidak sah" — aplikasi dicopot, dipasang
/// ulang, atau tokennya diperbarui. Selain ini, kegagalan dianggap sementara
/// (jaringan, kuota) dan tokennya TIDAK dimatikan.
const KODE_TOKEN_MATI = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

let terinisialisasi = false;

const siapkanFirebase = async () => {
  if (terinisialisasi) return;

  const berkasKunci = env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!berkasKunci) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_PATH belum diatur, padahal PUSH_NOTIFICATIONS_ENABLED=true.'
    );
  }
  if (!fs.existsSync(berkasKunci)) {
    throw new Error(`Berkas kredensial Firebase tidak ditemukan: ${berkasKunci}`);
  }

  const { initializeApp, cert, getApps } = await import('firebase-admin/app');

  // getApps() diperiksa karena initializeApp kedua kali melempar, dan modul
  // ini bisa dimuat ulang oleh proses yang sama saat pengembangan.
  if (getApps().length === 0) {
    initializeApp({ credential: cert(JSON.parse(fs.readFileSync(berkasKunci, 'utf8'))) });
  }
  terinisialisasi = true;
};

export const buatPengirimFcm = (): PengirimPush => async (tokens, pesan) => {
  await siapkanFirebase();

  const { getMessaging } = await import('firebase-admin/messaging');

  const jawaban = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title: pesan.title, body: pesan.body },
    data: pesan.data,
    android: { priority: 'high' },
  });

  const hasil: HasilKirim = { terkirim: 0, gagal: 0, tokenTidakSah: [] };

  jawaban.responses.forEach((r, i) => {
    if (r.success) {
      hasil.terkirim += 1;
      return;
    }
    hasil.gagal += 1;
    if (r.error && KODE_TOKEN_MATI.has(r.error.code)) hasil.tokenTidakSah.push(tokens[i]);
  });

  return hasil;
};
