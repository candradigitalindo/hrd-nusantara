// src/services/sesiMobile.ts
//
// Sesi aplikasi mobile yang bisa diperpanjang tanpa login ulang.
//
// Token akses (JWT) tetap berumur pendek. Aplikasi mobile yang login dengan
// menyebut perangkatnya juga menerima refresh token untuk menukar token
// akses baru — supaya antrean presensi offline tetap bisa terkirim walau
// ponsel berhari-hari tanpa sinyal, dan karyawan tidak terlempar keluar
// setiap JWT_EXPIRES_IN.
//
// Refresh token berputar setiap dipakai; hanya hash-nya yang disimpan.
// Token lama yang dipakai lagi berarti salah satu dari dua hal:
// - jawaban putaran sebelumnya hilang di jaringan (terjadi dalam hitungan
//   detik) → dilayani dengan putaran baru;
// - token itu dicuri dan dipakai belakangan → seluruh sesi dicabut.
import { createHash, randomBytes } from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { generateULID } from '../utils/generateULID';
import { ACTIVE_STATUSES } from '../middleware/auth';

/** Token lama masih dilayani selama ini setelah berputar. */
export const JEDA_PAKAI_ULANG_DETIK = 120;

export type AlasanCabut = 'logout' | 'password_changed' | 'password_reset' | 'deactivated' | 'token_reuse';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const tokenBaru = () => randomBytes(32).toString('base64url');
const kedaluwarsa = (dari: Date) => new Date(dari.getTime() + env.MOBILE_SESSION_DAYS * 86_400_000);

export const tandaTanganAkses = (employee: { id: string; role: Role }, sid?: string) =>
  jwt.sign({ sub: employee.id, role: employee.role, ...(sid ? { sid } : {}) }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });

export const buatSesi = async (employeeId: string, perangkat: { platform?: string; name?: string }) => {
  const refreshToken = tokenBaru();
  const sekarang = new Date();
  const sesi = await prisma.mobileSession.create({
    data: {
      id: generateULID(),
      employeeId,
      tokenHash: hash(refreshToken),
      platform: perangkat.platform,
      deviceName: perangkat.name,
      lastUsedAt: sekarang,
      expiresAt: kedaluwarsa(sekarang),
    },
  });
  return { sesi, refreshToken };
};

export type HasilPutar =
  | { ok: true; token: string; refreshToken: string; refreshExpiresAt: Date; employeeId: string }
  | { ok: false; status: 401 | 403 | 409; error: string; dicabutKarenaDipakaiUlang?: boolean; employeeId?: string };

export const putarSesi = async (refreshToken: string): Promise<HasilPutar> => {
  const h = hash(refreshToken);
  const sekarang = new Date();
  const sesi = await prisma.mobileSession.findFirst({
    where: { OR: [{ tokenHash: h }, { previousTokenHash: h }] },
    include: { employee: { select: { id: true, role: true, status: true } } },
  });

  if (!sesi || sesi.revokedAt || sesi.expiresAt <= sekarang) {
    return { ok: false, status: 401, error: 'Sesi sudah berakhir. Silakan login lagi.' };
  }
  if (!ACTIVE_STATUSES.has(sesi.employee.status)) {
    await cabutSesi({ id: sesi.id }, 'deactivated');
    return { ok: false, status: 403, error: 'Akun Anda sudah tidak aktif. Hubungi HR.' };
  }

  if (sesi.previousTokenHash === h) {
    const baruBerputar =
      sesi.rotatedAt !== null && sekarang.getTime() - sesi.rotatedAt.getTime() <= JEDA_PAKAI_ULANG_DETIK * 1000;
    if (!baruBerputar) {
      await cabutSesi({ id: sesi.id }, 'token_reuse');
      return {
        ok: false,
        status: 401,
        error: 'Sesi diakhiri demi keamanan. Silakan login lagi.',
        dicabutKarenaDipakaiUlang: true,
        employeeId: sesi.employeeId,
      };
    }
  }

  const berikutnya = tokenBaru();
  // Bersyarat pada token yang barusan dibaca: dua putaran bersamaan tidak
  // boleh sama-sama berhasil lalu saling membatalkan token hasilnya.
  const diputar = await prisma.mobileSession.updateMany({
    where: { id: sesi.id, tokenHash: sesi.tokenHash, revokedAt: null },
    data: {
      tokenHash: hash(berikutnya),
      // Dari token yang berlaku: ia menjadi "sebelumnya". Dari token
      // sebelumnya (jawaban hilang): tetap token itu yang jadi pembanding.
      previousTokenHash: h,
      rotatedAt: sekarang,
      lastUsedAt: sekarang,
      expiresAt: kedaluwarsa(sekarang),
    },
  });
  if (diputar.count === 0) {
    return { ok: false, status: 409, error: 'Sesi sedang diperbarui. Coba lagi.' };
  }

  return {
    ok: true,
    token: tandaTanganAkses(sesi.employee, sesi.id),
    refreshToken: berikutnya,
    refreshExpiresAt: kedaluwarsa(sekarang),
    employeeId: sesi.employeeId,
  };
};

/** Mencabut sesi yang masih aktif. Token akses dengan sid-nya langsung ditolak. */
export const cabutSesi = (
  where: { id?: string; employeeId?: string; idKecuali?: string },
  alasan: AlasanCabut
) =>
  prisma.mobileSession.updateMany({
    where: {
      revokedAt: null,
      ...(where.id ? { id: where.id } : {}),
      ...(where.employeeId ? { employeeId: where.employeeId } : {}),
      ...(where.idKecuali ? { id: { not: where.idKecuali } } : {}),
    },
    data: { revokedAt: new Date(), revokeReason: alasan },
  });

export const cabutSesiDariToken = async (refreshToken: string) => {
  const h = hash(refreshToken);
  return prisma.mobileSession.updateMany({
    where: { revokedAt: null, OR: [{ tokenHash: h }, { previousTokenHash: h }] },
    data: { revokedAt: new Date(), revokeReason: 'logout' },
  });
};
