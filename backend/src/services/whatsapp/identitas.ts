// src/services/whatsapp/identitas.ts
//
// Siapa orang di balik sebuah nomor di arsip: nomor asli atau LID, nama
// kontaknya, dan apakah ia karyawan. Dipakai daftar utas dan isi utas.
import { prisma } from '../../lib/prisma';
import { tampakLid } from './baileysMessage';

export interface Identitas {
  /** Digit nomor asli; null bila yang diketahui hanya LID-nya. */
  nomor: string | null;
  /** Digit LID; null bila tidak dialamatkan lewat LID. */
  lid: string | null;
}

/**
 * Memilah nilai tersimpan (contactNumber / participantNumber) menjadi nomor
 * asli dan LID. Bila LID belum terselesaikan, kolom nomornya berisi digit LID
 * yang sama — itu bukan nomor dan tidak boleh tampil dengan "+". Arsip lama
 * yang belum ditandai dikenali dari bentuk digitnya.
 */
export const identitasDari = (tersimpan: string | null, lidTersimpan: string | null): Identitas => {
  if (!tersimpan) return { nomor: null, lid: lidTersimpan };
  const lid = lidTersimpan ?? (tampakLid(tersimpan) ? tersimpan : null);
  return { nomor: lid && tersimpan === lid ? null : tersimpan, lid };
};

export interface KunciKontak {
  accountId: string;
  nomor: string | null;
  lid: string | null;
}

export type CariNama = (k: KunciKontak) => string | null;

/**
 * Nama kontak untuk sekumpulan orang, dengan satu kueri. Urutannya: nama di
 * buku kontak pemegang nomor, nama profil WhatsApp, nama bisnis.
 */
export const muatBukuNama = async (kunci: KunciKontak[]): Promise<CariNama> => {
  const akun = [...new Set(kunci.map((k) => k.accountId))];
  const nomor = [...new Set(kunci.flatMap((k) => (k.nomor ? [k.nomor] : [])))];
  const lid = [...new Set(kunci.flatMap((k) => (k.lid ? [k.lid] : [])))];
  if (akun.length === 0 || (nomor.length === 0 && lid.length === 0)) return () => null;

  const baris = await prisma.whatsAppContact.findMany({
    where: {
      accountId: { in: akun },
      OR: [...(nomor.length ? [{ number: { in: nomor } }] : []), ...(lid.length ? [{ lid: { in: lid } }] : [])],
    },
    select: { accountId: true, number: true, lid: true, savedName: true, pushName: true, verifiedName: true },
  });

  const perNomor = new Map<string, (typeof baris)[number]>();
  const perLid = new Map<string, (typeof baris)[number]>();
  for (const b of baris) {
    if (b.number) perNomor.set(`${b.accountId}:${b.number}`, b);
    if (b.lid) perLid.set(`${b.accountId}:${b.lid}`, b);
  }

  return (k) => {
    const b = (k.nomor && perNomor.get(`${k.accountId}:${k.nomor}`)) || (k.lid && perLid.get(`${k.accountId}:${k.lid}`)) || null;
    return b ? (b.savedName ?? b.pushName ?? b.verifiedName ?? null) : null;
  };
};

/** Karyawan pemilik nomor-nomor ini (Employee.phoneNumber tersimpan dalam bentuk baku 62…). */
export const muatKaryawanPerNomor = async (nomor: (string | null)[]): Promise<Map<string, { id: string; name: string }>> => {
  const unik = [...new Set(nomor.filter((n): n is string => !!n))];
  if (unik.length === 0) return new Map();
  const baris = await prisma.employee.findMany({
    where: { phoneNumber: { in: unik } },
    select: { id: true, name: true, phoneNumber: true },
  });
  return new Map(baris.map((b) => [b.phoneNumber!, { id: b.id, name: b.name }]));
};

/** Cuplikan isi pesan untuk daftar: paling panjang 140 karakter. */
export const cuplikanDari = (isi: string): string => (isi.length > 140 ? `${isi.slice(0, 139)}…` : isi);
