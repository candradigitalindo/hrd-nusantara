// src/lib/prisma.ts
import { PrismaClient, Prisma } from '@prisma/client';
import { env } from '../config/env';
import { generateULID } from '../utils/generateULID';

/**
 * Semua primary key memakai ULID yang dibuat di sisi aplikasi
 * (lihat arsitektur_aplikasi.md dan komentar di schema.prisma).
 *
 * Karena model sengaja tidak memakai @default, Prisma akan menolak insert
 * yang lupa mengisi id. Extension ini jaring pengamannya: satu tempat untuk
 * 24 model, jadi kelalaian tidak perlu diulang-ulang dicek di tiap controller.
 */
const ulidExtension = Prisma.defineExtension({
  name: 'ulid-primary-key',
  query: {
    $allModels: {
      create({ args, query }) {
        const data = args.data as Record<string, unknown> | undefined;
        if (data && data.id == null) data.id = generateULID();
        return query(args);
      },
      createMany({ args, query }) {
        const rows = (Array.isArray(args.data) ? args.data : [args.data]) as Record<
          string,
          unknown
        >[];
        for (const row of rows) {
          if (row && row.id == null) row.id = generateULID();
        }
        return query(args);
      },
      upsert({ args, query }) {
        const data = args.create as Record<string, unknown> | undefined;
        if (data && data.id == null) data.id = generateULID();
        return query(args);
      },
    },
  },
});

const createPrismaClient = () =>
  new PrismaClient({
    log: ['warn', 'error'],
  }).$extends(ulidExtension);

type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

/**
 * Client di dalam $transaction. Prisma.TransactionClient bawaan mengacu ke
 * client tanpa extension, sehingga tidak cocok dengan client yang sudah
 * dipasangi extension ULID.
 */
export type PrismaTransactionClient = Omit<
  ExtendedPrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// Satu instance untuk seluruh aplikasi. Sebelumnya tiap file membuat
// PrismaClient sendiri, yang berarti beberapa connection pool ke database.
const globalForPrisma = globalThis as unknown as { prisma?: ExtendedPrismaClient };

export const prisma: ExtendedPrismaClient = globalForPrisma.prisma ?? createPrismaClient();

// Di development nodemon me-reload modul berkali-kali; tanpa cache ini tiap
// reload menambah connection pool baru sampai database menolak koneksi.
//
// Saat test cache-nya juga dipakai, dan justru itu yang penting: tiap berkas
// test punya module registry sendiri, jadi tanpa cache tiap berkas membuka
// connection pool baru ke database yang sama. resetDatabase() memakai TRUNCATE
// yang menuntut lock ACCESS EXCLUSIVE, sehingga pool berkas sebelumnya yang
// belum lepas membuat TRUNCATE menunggu sampai beforeEach kehabisan waktu.
// Satu client bersama menghilangkan perebutan lock itu.
//
// Konsekuensinya: berkas test TIDAK boleh memanggil $disconnect() sendiri —
// pemutusannya dilakukan sekali di tests/global-teardown.ts.
if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') {
  globalForPrisma.prisma = prisma;
}
