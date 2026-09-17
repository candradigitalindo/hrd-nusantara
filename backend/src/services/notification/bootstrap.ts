// src/services/notification/bootstrap.ts
import { env } from '../../config/env';
import { setPengirimPush } from './push';
import { buatPengirimFcm } from './fcmDriver';

export const mulaiPush = () => {
  if (!env.PUSH_NOTIFICATIONS_ENABLED) return;

  // Kredensial baru dibaca saat notifikasi pertama dikirim, bukan sekarang:
  // Firebase yang salah konfigurasi tidak boleh menghalangi backend melayani
  // sebelas modul HRD lainnya.
  setPengirimPush(buatPengirimFcm());
  console.log('[push] notifikasi Firebase aktif');
};

export const hentikanPush = () => setPengirimPush(null);
