// src/services/whatsapp/kontak.ts
//
// Nama kontak per nomor yang dipantau (tabel WhatsAppContact).
//
// Arsip tanpa nama hanya berisi deretan angka — atau lebih buruk, LID yang
// bukan nomor sama sekali. Nama datang dari tiga tempat: pushName pada
// pesan masuk (nama profil WhatsApp pengirim), kontak hasil sinkronisasi
// ponsel (nama di buku kontak pemegang nomor), dan riwayat.
//
// Aturannya satu orang satu baris per akun. Orang yang mula-mula hanya
// dikenal lewat LID-nya mendapat baris LID-saja; begitu nomornya diketahui,
// baris itu digabung ke baris bernomor.
import { Prisma } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from '../../lib/prisma';
import { generateULID } from '../../utils/generateULID';
import { env } from '../../config/env';

export interface EntriKontak {
  /** Digit nomor asli; null bila belum diketahui. */
  nomor?: string | null;
  /** Digit LID. */
  lid?: string | null;
  savedName?: string | null;
  pushName?: string | null;
  verifiedName?: string | null;
  /**
   * true: nama yang dibawa menggantikan nama lama (data terkini: pesan live,
   * sinkronisasi kontak). false: hanya mengisi yang masih kosong (pesan
   * riwayat, yang namanya bisa sudah usang).
   */
  timpa: boolean;
}

type KlienDb = PrismaTransactionClient;

const catat = (pesan: string, error?: unknown) => {
  if (env.NODE_ENV === 'test') return;
  if (error) console.warn(`[whatsapp-kontak] ${pesan}`, error);
  else console.log(`[whatsapp-kontak] ${pesan}`);
};

// --- Antrean per akun ---

const antrean = new Map<string, Promise<unknown>>();

/**
 * Tulisan kontak satu akun berjalan berurutan. Pesan masuk dan event kontak
 * untuk orang yang sama sering tiba bersamaan; tanpa antrean, keduanya
 * sama-sama membuat baris baru dan yang kedua ditolak indeks unik.
 */
const berurutan = <T>(accountId: string, kerja: () => Promise<T>): Promise<T> => {
  const hasil = (antrean.get(accountId) ?? Promise.resolve()).then(kerja);
  const ekor = hasil.catch(() => undefined);
  antrean.set(accountId, ekor);
  void ekor.then(() => {
    if (antrean.get(accountId) === ekor) antrean.delete(accountId);
  });
  return hasil;
};

// --- Penggabungan ---

const NAMA = ['savedName', 'pushName', 'verifiedName'] as const;
type BidangNama = (typeof NAMA)[number];

interface Gabungan {
  nomor: string | null;
  lid: string | null;
  nama: Record<BidangNama, { nilai: string; timpa: boolean } | null>;
}

const kosong = (): Gabungan['nama'] => ({ savedName: null, pushName: null, verifiedName: null });

/** Entri satu batch digabung per orang: nomor dan LID yang pernah muncul bersama dianggap satu. */
const gabungkanEntri = (entri: EntriKontak[]): Gabungan[] => {
  const hasil: Gabungan[] = [];
  const perNomor = new Map<string, Gabungan>();
  const perLid = new Map<string, Gabungan>();

  for (const e of entri) {
    const nomor = e.nomor || null;
    const lid = e.lid || null;
    if (!nomor && !lid) continue;

    let g = (nomor && perNomor.get(nomor)) || (lid && perLid.get(lid)) || null;
    if (!g) {
      g = { nomor: null, lid: null, nama: kosong() };
      hasil.push(g);
    }
    if (nomor && !g.nomor) g.nomor = nomor;
    if (lid && !g.lid) g.lid = lid;
    if (g.nomor) perNomor.set(g.nomor, g);
    if (g.lid) perLid.set(g.lid, g);

    for (const b of NAMA) {
      const nilai = e[b];
      if (!nilai) continue;
      const lama = g.nama[b];
      // Yang datang belakangan dalam batch dianggap lebih baru; nama
      // "isi-bila-kosong" tidak menggeser nama "timpa".
      if (!lama || e.timpa || !lama.timpa) g.nama[b] = { nilai, timpa: e.timpa || (lama?.timpa ?? false) };
    }
  }
  return hasil;
};

type BarisKontak = {
  id: string;
  number: string | null;
  lid: string | null;
  savedName: string | null;
  pushName: string | null;
  verifiedName: string | null;
  updatedAt: Date;
};

const pilihKontak = { id: true, number: true, lid: true, savedName: true, pushName: true, verifiedName: true, updatedAt: true } as const;

/** Nilai nama baru untuk satu bidang, atau undefined bila tidak berubah. */
const namaBaru = (lama: string | null, masuk: { nilai: string; timpa: boolean } | null): string | undefined => {
  if (!masuk) return undefined;
  if (lama === masuk.nilai) return undefined;
  if (lama && !masuk.timpa) return undefined;
  return masuk.nilai;
};

const simpanSatu = async (accountId: string, g: Gabungan) => {
  const baris = await prisma.whatsAppContact.findMany({
    where: {
      accountId,
      OR: [...(g.nomor ? [{ number: g.nomor }] : []), ...(g.lid ? [{ lid: g.lid }] : [])],
    },
    select: pilihKontak,
  });
  const olehNomor = g.nomor ? (baris.find((b) => b.number === g.nomor) ?? null) : null;
  const olehLid = g.lid ? (baris.find((b) => b.lid === g.lid) ?? null) : null;

  if (olehNomor && olehLid && olehNomor.id !== olehLid.id && !olehLid.number) {
    // Orang yang sama tercatat dua kali: baris LID-saja digabung ke baris
    // bernomor. Nama dari baris LID mengisi yang kosong.
    await prisma.$transaction(async (tx) => {
      await gabungkanBaris(tx, olehNomor, olehLid);
      const ulang = await tx.whatsAppContact.findUnique({ where: { id: olehNomor.id }, select: pilihKontak });
      if (ulang) await perbarui(tx, ulang, g, true);
    });
    return;
  }

  const ada = olehNomor ?? olehLid;
  if (ada) {
    // LID yang sudah melekat pada baris bernomor lain (pengguna ganti nomor)
    // tidak dipindah: barisnya tetap milik nomor lamanya.
    await perbarui(prisma, ada, g, !olehLid || olehLid.id === ada.id);
    return;
  }

  const adaNama = NAMA.some((b) => g.nama[b]);
  // Baris tanpa nama tidak berguna; pemetaan nomor<->LID-nya sudah ada di WhatsAppLidMap.
  if (!adaNama) return;

  await prisma.whatsAppContact.create({
    data: {
      id: generateULID(),
      accountId,
      number: g.nomor,
      lid: g.lid,
      savedName: g.nama.savedName?.nilai ?? null,
      pushName: g.nama.pushName?.nilai ?? null,
      verifiedName: g.nama.verifiedName?.nilai ?? null,
    },
  });
};

const perbarui = async (db: KlienDb, ada: BarisKontak, g: Gabungan, bolehIsiLid: boolean) => {
  const data: Prisma.WhatsAppContactUpdateInput = {};
  if (g.nomor && !ada.number) data.number = g.nomor;
  if (g.lid && !ada.lid && bolehIsiLid) data.lid = g.lid;
  for (const b of NAMA) {
    const v = namaBaru(ada[b], g.nama[b]);
    if (v !== undefined) data[b] = v;
  }
  if (Object.keys(data).length === 0) return;
  await db.whatsAppContact.update({ where: { id: ada.id }, data });
};

/**
 * Menggabung baris LID-saja ke baris bernomor milik orang yang sama.
 * Untuk tiap nama: yang terisi menang; bila keduanya terisi, baris yang
 * lebih baru diperbarui yang menang.
 */
export const gabungkanBaris = async (db: KlienDb, bernomor: BarisKontak, lidSaja: BarisKontak) => {
  const lidLebihBaru = lidSaja.updatedAt.getTime() > bernomor.updatedAt.getTime();
  const data: Prisma.WhatsAppContactUpdateInput = {};
  for (const b of NAMA) {
    const pakai = lidLebihBaru ? (lidSaja[b] ?? bernomor[b]) : (bernomor[b] ?? lidSaja[b]);
    if (pakai !== bernomor[b]) data[b] = pakai;
  }
  if (!bernomor.lid && lidSaja.lid) data.lid = lidSaja.lid;
  // Dihapus lebih dulu: LID-nya mungkin dipindah ke baris bernomor, dan
  // (accountId, lid) unik.
  await db.whatsAppContact.delete({ where: { id: lidSaja.id } });
  if (Object.keys(data).length > 0) await db.whatsAppContact.update({ where: { id: bernomor.id }, data });
};

/**
 * Mencatat nama kontak satu akun. Hanya menulis yang berubah, jadi aman
 * dipanggil untuk setiap pesan masuk.
 */
export const simpanKontak = (accountId: string, entri: EntriKontak[]): Promise<void> => {
  const gabungan = gabungkanEntri(entri);
  if (gabungan.length === 0) return Promise.resolve();

  return berurutan(accountId, async () => {
    for (const g of gabungan) {
      try {
        await simpanSatu(accountId, g);
      } catch (error) {
        // Nama yang gagal tersimpan bukan alasan untuk menggagalkan arsip
        // pesannya; berikutnya dicoba lagi saat orang itu menulis lagi.
        catat(`gagal menyimpan kontak di akun ${accountId}`, error);
      }
    }
  });
};
