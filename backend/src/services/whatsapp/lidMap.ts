// src/services/whatsapp/lidMap.ts
//
// Pemetaan LID -> nomor asli yang permanen (tabel WhatsAppLidMap).
//
// LID ("2147…@lid") adalah ID samaran WhatsApp, bukan nomor telepon. Nomor
// aslinya hanya bisa dipelajari, tidak bisa ditanyakan: Baileys tidak punya
// cara meminta nomor dari sebuah LID ke server. Jadi setiap pemetaan yang
// pernah terlihat — dari pesan live, store Baileys, peserta grup, kontak —
// disimpan di sini, untuk semua akun sekaligus: LID melekat pada pengguna
// WhatsApp, bukan pada nomor yang memantaunya.
import { prisma, type PrismaTransactionClient } from '../../lib/prisma';
import { env } from '../../config/env';
import type { PasanganLid } from './baileysMessage';

export type SumberLid = 'authkey' | 'alt' | 'riwayat' | 'grup' | 'kontak';

type KlienDb = PrismaTransactionClient;

const UKURAN_BATCH = 500;

const catat = (pesan: string, error?: unknown) => {
  if (env.NODE_ENV === 'test') return;
  if (error) console.warn(`[whatsapp-lid] ${pesan}`, error);
  else console.log(`[whatsapp-lid] ${pesan}`);
};

const sahDigit = (nilai: unknown): nilai is string => typeof nilai === 'string' && /^\d{5,20}$/.test(nilai);

/** Pasangan yang layak disimpan, tanpa ganda per LID (yang terakhir menang). */
export const rapikanPasangan = (pasangan: Iterable<PasanganLid>): PasanganLid[] => {
  const perLid = new Map<string, string>();
  for (const p of pasangan) {
    if (!sahDigit(p.lid) || !sahDigit(p.pn) || p.lid === p.pn) continue;
    perLid.set(p.lid, p.pn);
  }
  // Urut tetap: dua tulisan yang bersamaan mengunci baris dengan urutan yang
  // sama, sehingga tidak saling menunggu (deadlock) di PostgreSQL.
  return [...perLid].map(([lid, pn]) => ({ lid, pn })).sort((a, b) => (a.lid < b.lid ? -1 : a.lid > b.lid ? 1 : 0));
};

/**
 * Semua tulisan ke WhatsAppLidMap diantrekan satu per satu. Pemetaan datang
 * dari banyak sesi sekaligus (pesan masuk, sinkron grup, cermin store
 * Baileys) dan dua INSERT ... ON CONFLICT yang berbarengan pernah saling
 * mengunci; antrean dalam proses menghilangkannya tanpa mengandalkan DB.
 */
let antreanTulis: Promise<unknown> = Promise.resolve();
const berurutan = <T>(kerja: () => Promise<T>): Promise<T> => {
  const hasil = antreanTulis.then(kerja);
  antreanTulis = hasil.catch(() => undefined);
  return hasil;
};

export interface HasilSimpanLid {
  /** Pasangan yang tertulis (baru atau berubah). */
  tersimpan: number;
  /** LID yang sebelumnya tercatat dengan nomor lain. */
  konflik: number;
}

/**
 * Menyimpan pasangan LID -> nomor. Bila LID yang sama sudah tercatat dengan
 * nomor lain (pengguna ganti nomor), yang terbaru menang dan jumlahnya
 * dicatat di log.
 */
export const simpanPemetaanLid = (
  pasangan: Iterable<PasanganLid>,
  sumber: SumberLid,
  db: KlienDb = prisma
): Promise<HasilSimpanLid> => berurutan(() => simpanPemetaanLidLangsung(pasangan, sumber, db));

const simpanPemetaanLidLangsung = async (
  pasangan: Iterable<PasanganLid>,
  sumber: SumberLid,
  db: KlienDb
): Promise<HasilSimpanLid> => {
  const rapi = rapikanPasangan(pasangan);
  const hasil: HasilSimpanLid = { tersimpan: 0, konflik: 0 };

  for (let i = 0; i < rapi.length; i += UKURAN_BATCH) {
    const potong = rapi.slice(i, i + UKURAN_BATCH);
    const lama = await db.whatsAppLidMap.findMany({
      where: { lid: { in: potong.map((p) => p.lid) } },
      select: { lid: true, pn: true },
    });
    const peta = new Map(lama.map((l) => [l.lid, l.pn]));
    const berubah = potong.filter((p) => peta.get(p.lid) !== p.pn);
    hasil.konflik += berubah.filter((p) => peta.has(p.lid)).length;
    if (berubah.length === 0) continue;

    await db.$executeRaw`
      INSERT INTO "WhatsAppLidMap" ("lid", "pn", "source", "createdAt", "updatedAt")
      SELECT t."lid", t."pn", ${sumber}, NOW(), NOW()
      FROM UNNEST(${berubah.map((p) => p.lid)}::text[], ${berubah.map((p) => p.pn)}::text[]) AS t("lid", "pn")
      ON CONFLICT ("lid") DO UPDATE
        SET "pn" = EXCLUDED."pn", "source" = EXCLUDED."source", "updatedAt" = NOW()
        WHERE "WhatsAppLidMap"."pn" IS DISTINCT FROM EXCLUDED."pn"
    `;
    hasil.tersimpan += berubah.length;
  }

  if (hasil.konflik > 0) {
    catat(`${hasil.konflik} LID berganti nomor (sumber: ${sumber}); pemetaan terbaru dipakai`);
  }
  return hasil;
};

/** Nomor asli untuk LID yang sudah dikenal. */
export const petaLidDari = async (lids: Iterable<string>, db: KlienDb = prisma): Promise<Map<string, string>> => {
  const unik = [...new Set(lids)].filter(sahDigit);
  const peta = new Map<string, string>();
  for (let i = 0; i < unik.length; i += UKURAN_BATCH) {
    const baris = await db.whatsAppLidMap.findMany({
      where: { lid: { in: unik.slice(i, i + UKURAN_BATCH) } },
      select: { lid: true, pn: true },
    });
    for (const b of baris) peta.set(b.lid, b.pn);
  }
  return peta;
};

/**
 * Pasangan dari isi kategori 'lid-mapping' store Baileys:
 * keyId "<pn>" bernilai "<lid>", keyId "<lid>_reverse" bernilai "<pn>".
 */
export const pasanganDariKunciLid = (entri: Record<string, unknown>): PasanganLid[] => {
  const hasil: PasanganLid[] = [];
  for (const [keyId, nilai] of Object.entries(entri)) {
    if (typeof nilai !== 'string' || !nilai) continue;
    if (keyId.endsWith('_reverse')) hasil.push({ lid: keyId.slice(0, -'_reverse'.length), pn: nilai });
    else hasil.push({ lid: nilai, pn: keyId });
  }
  return hasil;
};

/**
 * Mencerminkan tulisan 'lid-mapping' Baileys ke tabel permanen. Tidak pernah
 * melempar: kegagalan di sini tidak boleh menggagalkan penyimpanan kunci
 * Signal yang sedang ditangani Baileys.
 */
export const cerminkanKunciLid = async (entri: Record<string, unknown>): Promise<void> => {
  try {
    await simpanPemetaanLid(pasanganDariKunciLid(entri), 'authkey');
  } catch (error) {
    catat('gagal mencerminkan pemetaan LID dari store Baileys', error);
  }
};
