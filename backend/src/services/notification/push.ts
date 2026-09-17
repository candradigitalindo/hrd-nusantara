// src/services/notification/push.ts
//
// Pengiriman notifikasi ke ponsel karyawan.
//
// Pengirimnya disuntik, bukan diimpor langsung, karena dua alasan: Firebase
// butuh kredensial yang tidak ada di mesin pengembangan maupun di CI, dan
// seluruh alur — token mati, karyawan tanpa perangkat, sebagian gagal —
// harus bisa diuji tanpa benar-benar mengirim notifikasi ke siapa pun.
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';

export interface PesanPush {
  title: string;
  body: string;
  /** Muatan tambahan untuk aplikasi, semuanya string (batasan FCM). */
  data?: Record<string, string>;
}

export interface HasilKirim {
  terkirim: number;
  gagal: number;
  /** Token yang ditolak sebagai tidak sah lagi, untuk dimatikan. */
  tokenTidakSah: string[];
}

export type PengirimPush = (tokens: string[], pesan: PesanPush) => Promise<HasilKirim>;

const KOSONG: HasilKirim = { terkirim: 0, gagal: 0, tokenTidakSah: [] };

let pengirim: PengirimPush | null = null;

export const setPengirimPush = (p: PengirimPush | null) => {
  pengirim = p;
};

export const pushAktif = () => pengirim !== null;

const catat = (pesan: string, error?: unknown) => {
  if (env.NODE_ENV === 'test') return;
  if (error) console.warn(`[push] ${pesan}`, error);
  else console.log(`[push] ${pesan}`);
};

/**
 * Mengirim ke semua perangkat aktif milik seorang karyawan.
 *
 * Token FCM mati sendiri saat aplikasi dicopot atau dipasang ulang. Yang
 * ditolak dimatikan di sini juga, karena kalau tidak, tiap notifikasi
 * berikutnya akan terus menembak token mati yang sama — dan lama-lama
 * Firebase memperlakukan pengirimnya sebagai berperilaku buruk.
 */
export const kirimKeKaryawan = async (
  employeeId: string,
  pesan: PesanPush
): Promise<HasilKirim> => {
  if (!pengirim) return KOSONG;

  const perangkat = await prisma.deviceToken.findMany({
    where: { employeeId, isActive: true },
    select: { token: true },
  });
  if (perangkat.length === 0) return KOSONG;

  const token = perangkat.map((p) => p.token);
  const hasil = await pengirim(token, pesan);

  if (hasil.tokenTidakSah.length > 0) {
    await prisma.deviceToken.updateMany({
      where: { token: { in: hasil.tokenTidakSah } },
      data: { isActive: false },
    });
    catat(`${hasil.tokenTidakSah.length} token dimatikan karena ditolak FCM`);
  }

  const berhasil = token.filter((t) => !hasil.tokenTidakSah.includes(t));
  if (berhasil.length > 0) {
    await prisma.deviceToken.updateMany({
      where: { token: { in: berhasil } },
      data: { lastUsedAt: new Date() },
    });
  }

  return hasil;
};
