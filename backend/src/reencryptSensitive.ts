// src/reencryptSensitive.ts
//
// Mengenkripsi embedding wajah (data biometrik) yang terlanjur tersimpan
// terbuka. Aman dijalankan berulang: yang sudah terenkripsi dilewati.
//
// Koordinat presensi tidak ditangani di sini: kolom terbukanya sudah
// dihapus oleh migrasi drop_plain_coordinates. Basis data yang sudah
// berisi presensi sebelum migrasi itu harus memindahkan koordinatnya
// SEBELUM migrasi dijalankan (lihat komentar di berkas migrasinya).
//
// Jalankan: npm run sensitive:reencrypt
import { prisma } from './lib/prisma';
import { encryptBytes, isEncryptedBytes, isFieldEncryptionEnabled } from './utils/fieldCrypto';

const BATCH = 200;

const embeddingWajah = async () => {
  let cursor: string | undefined;
  let dienkripsi = 0;
  let dilewati = 0;
  for (;;) {
    const batch = await prisma.faceEnrollment.findMany({
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, embedding: true },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    for (const b of batch) {
      const buf = Buffer.from(b.embedding);
      if (isEncryptedBytes(buf)) { dilewati += 1; continue; }
      await prisma.faceEnrollment.update({ where: { id: b.id }, data: { embedding: encryptBytes(buf) } });
      dienkripsi += 1;
    }
  }
  console.log(`Embedding wajah : ${dienkripsi} dienkripsi, ${dilewati} sudah terenkripsi.`);
};

const main = async () => {
  if (!isFieldEncryptionEnabled()) {
    console.error('FIELD_ENCRYPTION_KEY belum diatur. Generate: openssl rand -base64 32');
    process.exit(1);
  }
  await embeddingWajah();
};

main()
  .catch((e) => { console.error('Gagal:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
