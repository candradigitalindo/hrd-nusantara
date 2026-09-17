// scripts/uji-push.ts
//
// Memastikan kredensial Firebase benar-benar diterima, tanpa mengganggu
// siapa pun: tokennya sengaja palsu.
//
// Cara membaca hasilnya:
//   - token ditolak  -> kredensial SAH (Firebase menolak tokennya, bukan kita)
//   - error kredensial -> berkas service account bermasalah
//
// Jalankan: npx ts-node scripts/uji-push.ts
import { buatPengirimFcm } from '../src/services/notification/fcmDriver';

const main = async () => {
  const kirim = buatPengirimFcm();

  const hasil = await kirim(['token-palsu-yang-pasti-tidak-terdaftar-000000000000'], {
    title: 'Uji koneksi',
    body: 'Uji kredensial. Tidak dikirim ke perangkat mana pun.',
    data: { jenis: 'uji' },
  });

  console.log('hasil:', JSON.stringify(hasil));
  console.log('');

  if (hasil.tokenTidakSah.length === 1 && hasil.terkirim === 0) {
    console.log('KESIMPULAN: kredensial SAH.');
    console.log('Firebase menerima permintaannya dan menolak TOKEN-nya, bukan menolak kita.');
    return;
  }
  console.log('KESIMPULAN: jawaban di luar dugaan, perlu diperiksa.');
};

main().catch((error) => {
  console.log('GAGAL:', error instanceof Error ? error.message : String(error));
});
