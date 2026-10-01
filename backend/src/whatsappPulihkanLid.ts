// src/whatsappPulihkanLid.ts
//
// Memperbaiki arsip WhatsApp yang menyimpan LID (ID samaran WhatsApp) seolah
// nomor telepon: menyalin pemetaan LID -> nomor dari store Baileys ke tabel
// permanen, mengganti LID yang sudah dikenal dengan nomor asli, menandai yang
// belum, dan menggabungkan kontak ganda. Lihat
// src/services/whatsapp/pemulihanLid.ts.
//
// Backend menjalankan ini sendiri di latar saat boot dan tiap jam; skrip ini
// untuk menjalankannya manual (mis. setelah memulihkan cadangan database).
// Aman dijalankan berulang.
//
// Jalankan: npm run whatsapp:pulihkan-lid
import { prisma } from './lib/prisma';
import { isFieldEncryptionEnabled } from './utils/fieldCrypto';
import { pulihkanLid, ringkasPemulihan } from './services/whatsapp/pemulihanLid';

const main = async () => {
  if (!isFieldEncryptionEnabled()) {
    // Pemetaan di store Baileys terenkripsi; tanpa kuncinya tidak ada yang
    // bisa disalin, dan langkah lain kehilangan sumber utamanya.
    console.error('FIELD_ENCRYPTION_KEY belum diatur; pemetaan di store Baileys tidak bisa dibaca.');
    process.exit(1);
  }

  const mulai = Date.now();
  const hasil = await pulihkanLid({ penuh: true });
  console.log(`Selesai dalam ${((Date.now() - mulai) / 1000).toFixed(1)} detik.`);
  console.log(ringkasPemulihan(hasil));
};

main()
  .catch((error) => {
    console.error('Gagal:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
