// src/services/whatsapp/authStore.ts
//
// Kredensial sesi Baileys di database.
//
// Bawaan Baileys (useMultiFileAuthState) menyimpan tiap sesi sebagai ribuan
// berkas kecil di satu folder, dan pembuatnya sendiri menyarankan tidak
// memakainya di produksi. Dengan banyak karyawan tertaut, folder itu mengikat
// semua sesi ke satu volume di satu server dan tidak ikut cadangan database.
// Di sini isinya disimpan di WhatsAppAuthKey, terenkripsi seperti isi pesan.
//
// Modul ini tidak mengimpor Baileys. Alat serialisasinya (BufferJSON,
// initAuthCreds, proto) disuntikkan oleh baileysDriver.ts, jadi penyimpanan
// ini bisa diuji tanpa pustakanya.
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { decryptField, encryptField } from '../../utils/fieldCrypto';
import { generateULID } from '../../utils/generateULID';

const KATEGORI_CREDS = 'creds';
const ID_CREDS = '';

/// Baris per perintah INSERT. Saat pertama tertaut Baileys menulis ratusan
/// pre-key sekaligus; satu perintah raksasa memperlambat semua akun lain.
const UKURAN_BATCH = 500;

/** Bagian Baileys yang dibutuhkan untuk mengubah kredensial menjadi teks dan sebaliknya. */
export interface AlatBaileys {
  BufferJSON: {
    replacer: (kunci: string, nilai: unknown) => unknown;
    reviver: (kunci: string, nilai: unknown) => unknown;
  };
  initAuthCreds: () => unknown;
  proto: { Message: { AppStateSyncKeyData: { fromObject: (objek: Record<string, unknown>) => unknown } } };
}

type DataKunci = Record<string, Record<string, unknown>>;

export interface AuthStateTersimpan {
  state: {
    creds: unknown;
    keys: {
      get: (jenis: string, ids: string[]) => Promise<Record<string, unknown>>;
      set: (data: DataKunci) => Promise<void>;
    };
  };
  saveCreds: () => Promise<void>;
}

// --- Urutan tulis dan generasi ---

/**
 * Generasi kredensial per akun, naik setiap kali kredensial dihapus.
 *
 * Soket lama bisa masih menulis sesaat setelah sesinya dinyatakan mati:
 * creds.update, atau kunci Signal dari pesan yang sedang diproses. Tanpa
 * penanda ini tulisan itu menghidupkan kembali kredensial yang baru dihapus,
 * dan sambungan berikutnya kembali mencoba masuk dengan identitas yang sudah
 * ditolak WhatsApp, bukan memunculkan QR.
 *
 * Disimpan di memori karena satu nomor hanya boleh dipegang satu proses
 * (lihat WHATSAPP_BAILEYS_ENABLED).
 */
const generasi = new Map<string, number>();
const generasiSaatIni = (accountId: string) => generasi.get(accountId) ?? 0;

const antrean = new Map<string, Promise<void>>();

/**
 * Semua tulisan dan penghapusan satu akun berjalan berurutan.
 *
 * Dua simpanan creds yang balapan bisa selesai terbalik, sehingga isi yang
 * lebih lama menimpa yang baru. Penghapusan juga harus menunggu tulisan yang
 * sedang berjalan, kalau tidak tulisan itu mendarat sesudahnya.
 */
const berurutan = (accountId: string, kerja: () => Promise<void>): Promise<void> => {
  const hasil = (antrean.get(accountId) ?? Promise.resolve()).then(kerja);
  const ekor = hasil.catch(() => {});
  antrean.set(accountId, ekor);
  void ekor.then(() => {
    if (antrean.get(accountId) === ekor) antrean.delete(accountId);
  });
  return hasil;
};

// --- Akses baris ---

interface BarisKunci {
  category: string;
  keyId: string;
  value: string;
}

const bacaBaris = async (accountId: string, category: string, ids: string[]) => {
  if (ids.length === 0) return new Map<string, string>();
  const baris = await prisma.whatsAppAuthKey.findMany({
    where: { accountId, category, keyId: { in: ids } },
    select: { keyId: true, value: true },
  });
  return new Map(baris.map((b) => [b.keyId, decryptField(b.value)]));
};

const terapkan = async (
  accountId: string,
  tulis: BarisKunci[],
  hapus: { category: string; keyId: string }[]
) => {
  const perintah: Prisma.PrismaPromise<unknown>[] = [];

  for (let i = 0; i < tulis.length; i += UKURAN_BATCH) {
    const potong = tulis.slice(i, i + UKURAN_BATCH);
    // Satu perintah untuk seluruh potongan, bukan upsert per baris: ratusan
    // pulang-pergi ke database per pesan akan terasa begitu banyak nomor
    // tersambung bersamaan.
    perintah.push(prisma.$executeRaw`
      INSERT INTO "WhatsAppAuthKey" ("id", "accountId", "category", "keyId", "value", "updatedAt")
      SELECT t."id", ${accountId}, t."category", t."keyId", t."value", NOW()
      FROM UNNEST(
        ${potong.map(() => generateULID())}::text[],
        ${potong.map((b) => b.category)}::text[],
        ${potong.map((b) => b.keyId)}::text[],
        ${potong.map((b) => encryptField(b.value))}::text[]
      ) AS t("id", "category", "keyId", "value")
      ON CONFLICT ("accountId", "category", "keyId")
      DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()
    `);
  }

  const hapusPerKategori = new Map<string, string[]>();
  for (const h of hapus) {
    hapusPerKategori.set(h.category, [...(hapusPerKategori.get(h.category) ?? []), h.keyId]);
  }
  for (const [category, ids] of hapusPerKategori) {
    perintah.push(prisma.whatsAppAuthKey.deleteMany({ where: { accountId, category, keyId: { in: ids } } }));
  }

  if (perintah.length === 0) return;
  // Satu transaksi: sesi Signal yang tersimpan setengah lebih buruk daripada
  // yang tidak tersimpan sama sekali.
  await prisma.$transaction(perintah);
};

// --- Antarmuka ---

/**
 * Pengganti useMultiFileAuthState: bentuk kembaliannya sama, isinya di database.
 *
 * Kredensial yang belum ada dibuat baru (initAuthCreds), yang berarti
 * sambungan berikutnya memunculkan QR.
 */
export const muatAuthState = async (accountId: string, alat: AlatBaileys): Promise<AuthStateTersimpan> => {
  const generasiAwal = generasiSaatIni(accountId);
  const masihBerlaku = () => generasiSaatIni(accountId) === generasiAwal;

  const keTeks = (nilai: unknown) => JSON.stringify(nilai, alat.BufferJSON.replacer);
  const dariTeks = (teks: string): unknown => JSON.parse(teks, alat.BufferJSON.reviver);

  const tersimpan = (await bacaBaris(accountId, KATEGORI_CREDS, [ID_CREDS])).get(ID_CREDS);
  const creds = tersimpan ? dariTeks(tersimpan) : alat.initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (jenis, ids) => {
          const baris = await bacaBaris(accountId, jenis, ids);
          const hasil: Record<string, unknown> = {};
          for (const [id, teks] of baris) {
            let nilai = dariTeks(teks);
            // Kunci sinkronisasi harus kembali menjadi objek proto; sebagai
            // objek biasa Baileys gagal membaca riwayat obrolan.
            if (jenis === 'app-state-sync-key' && nilai) {
              nilai = alat.proto.Message.AppStateSyncKeyData.fromObject(nilai as Record<string, unknown>);
            }
            hasil[id] = nilai;
          }
          return hasil;
        },
        set: async (data) => {
          const tulis: BarisKunci[] = [];
          const hapus: { category: string; keyId: string }[] = [];
          for (const category of Object.keys(data)) {
            for (const [keyId, nilai] of Object.entries(data[category])) {
              // Aturan Baileys: nilai kosong berarti kuncinya dihapus.
              if (nilai) tulis.push({ category, keyId, value: keTeks(nilai) });
              else hapus.push({ category, keyId });
            }
          }
          await berurutan(accountId, async () => {
            if (!masihBerlaku()) return;
            await terapkan(accountId, tulis, hapus);
          });
        },
      },
    },
    // Diserialkan saat gilirannya tiba, bukan saat dipanggil: simpanan
    // terakhir selalu membawa isi creds yang terbaru.
    saveCreds: () =>
      berurutan(accountId, async () => {
        if (!masihBerlaku()) return;
        await terapkan(accountId, [{ category: KATEGORI_CREDS, keyId: ID_CREDS, value: keTeks(creds) }], []);
      }),
  };
};

/**
 * Membuang seluruh kredensial satu akun, dan menolak tulisan soket lama yang
 * masih tertunda. Sambungan berikutnya mulai dari QR baru.
 */
export const hapusKredensialTersimpan = (accountId: string): Promise<void> => {
  // Dinaikkan SEBELUM masuk antrean, supaya tulisan yang sudah mengantre di
  // depannya pun ikut dibatalkan.
  generasi.set(accountId, generasiSaatIni(accountId) + 1);
  return berurutan(accountId, async () => {
    await prisma.whatsAppAuthKey.deleteMany({ where: { accountId } });
  });
};

/**
 * Akun yang punya tautan tersimpan, yaitu creds yang sudah dipasangkan dengan
 * ponsel (`me` terisi). Creds tanpa `me` hanya sisa QR yang belum dipindai:
 * membukanya memunculkan QR, bukan sesi.
 */
export const akunDenganTautanTersimpan = async (accountIds: string[]): Promise<Set<string>> => {
  if (accountIds.length === 0) return new Set();
  const baris = await prisma.whatsAppAuthKey.findMany({
    where: { accountId: { in: accountIds }, category: KATEGORI_CREDS, keyId: ID_CREDS },
    select: { accountId: true, value: true },
  });

  const hasil = new Set<string>();
  for (const b of baris) {
    try {
      const creds = JSON.parse(decryptField(b.value)) as { me?: { id?: string } | null };
      if (creds.me?.id) hasil.add(b.accountId);
    } catch {
      // Tidak terbaca (kunci enkripsi diganti, data rusak): diperlakukan
      // seperti tidak ada, supaya satu baris rusak tidak menggagalkan boot.
    }
  }
  return hasil;
};
