// src/whatsappReencrypt.ts
//
// Mengenkripsi baris arsip yang ditulis SEBELUM enkripsi kolom ada, dan
// mengisi indeks pencariannya. Tanpa ini, baris lama tetap terbaca (karena
// decryptField melewatkan teks biasa) tapi tidak akan pernah ditemukan oleh
// pencarian, karena token-nya kosong.
//
// Aman dijalankan berulang: baris yang sudah terenkripsi dilewati.
//
// Jalankan: npm run whatsapp:reencrypt
import { prisma } from './lib/prisma';
import { encryptField, buildSearchTokens, isCiphertext, isFieldEncryptionEnabled } from './utils/fieldCrypto';

const UKURAN_BATCH = 200;

const main = async () => {
  if (!isFieldEncryptionEnabled()) {
    console.error('FIELD_ENCRYPTION_KEY belum diatur. Generate: openssl rand -base64 32');
    process.exit(1);
  }

  let diproses = 0;
  let dilewati = 0;
  let cursor: string | undefined;

  // Paginasi dengan cursor, bukan skip/take: baris yang sudah diproses
  // tetap ada di tabel, jadi offsetnya tidak bergeser.
  for (;;) {
    const batch = await prisma.whatsAppConversation.findMany({
      take: UKURAN_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, messageBody: true },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;

    for (const baris of batch) {
      if (isCiphertext(baris.messageBody)) {
        dilewati += 1;
        continue;
      }
      await prisma.whatsAppConversation.update({
        where: { id: baris.id },
        data: {
          messageBody: encryptField(baris.messageBody),
          searchTokens: buildSearchTokens(baris.messageBody),
        },
      });
      diproses += 1;
    }
  }

  console.log(`Selesai. Dienkripsi: ${diproses}, sudah terenkripsi sebelumnya: ${dilewati}.`);
};

main()
  .catch((error) => {
    console.error('Gagal:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
