// src/services/cbt/penyapu.ts
//
// Penutup berkala untuk pengerjaan CBT yang ditinggalkan setelah batas waktu.
// Daftar hasil/penugasan juga menutupnya secara malas saat dibuka; penyapu ini
// menjamin hasilnya tetap keluar walau tidak ada yang membuka halaman itu.
import { env } from '../../config/env';
import { tutupPengerjaanKedaluwarsa } from './attempt';

let penyapu: NodeJS.Timeout | null = null;

export const mulaiPenyapuCbt = () => {
  // Test memanggil tutupPengerjaanKedaluwarsa sendiri; timer di latar hanya
  // akan menulis ke database test di tengah test lain.
  if (env.NODE_ENV === 'test') return;
  const jalan = () =>
    tutupPengerjaanKedaluwarsa({}, { batasJumlah: 200 })
      .then((n) => {
        if (n > 0) console.log(`[cbt] ${n} pengerjaan yang ditinggalkan ditutup otomatis`);
      })
      .catch((e) => console.warn('[cbt] gagal menutup pengerjaan kedaluwarsa:', e));
  void jalan();
  penyapu = setInterval(jalan, 5 * 60 * 1000);
  penyapu.unref();
};

export const hentikanPenyapuCbt = () => {
  if (penyapu) clearInterval(penyapu);
  penyapu = null;
};
