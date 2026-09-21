// src/middleware/auth.ts
import { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { izinEfektif } from '../services/roles/resolve';

export interface AuthUser {
  id: string;
  nik: string;
  name: string;
  email: string;
  /** Lingkup data (diri sendiri / departemen / seluruh perusahaan). */
  role: Role;
  status: string;
  departmentId: string | null;
  positionId: string | null;
  customRoleId: string | null;
  /** Izin efektif dari peran dinamis — lihat utils/permissions.ts. */
  permissions: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export interface JwtPayload {
  sub: string;
  role: Role;
}

/**
 * Status kepegawaian yang masih boleh memakai sistem.
 * Karyawan resign/terminated/inactive langsung kehilangan akses pada request
 * berikutnya, tanpa menunggu token kedaluwarsa.
 */
export const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  'active',
  'probation',
  'contract',
  'internship',
  'on_leave',
]);

/** Membungkus handler async supaya error-nya sampai ke error handler Express. */
export const asyncHandler =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

export const authenticateToken = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;

    if (!token) {
      return res.status(401).json({ error: 'Token akses dibutuhkan' });
    }

    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    } catch {
      // 401, bukan 403: tokennya memang tidak sah, bukan soal hak akses.
      return res.status(401).json({ error: 'Token tidak valid atau sudah kedaluwarsa' });
    }

    const user = await prisma.employee.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        nik: true,
        name: true,
        email: true,
        role: true,
        status: true,
        departmentId: true,
        positionId: true,
        customRoleId: true,
        customRole: { select: { permissions: true } },
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'Token tidak valid' });
    }

    if (!ACTIVE_STATUSES.has(user.status)) {
      return res.status(403).json({ error: 'Akun Anda sudah tidak aktif' });
    }

    // Izin dibaca ulang setiap permintaan, bukan disimpan di token: suntingan
    // admin pada sebuah peran harus langsung berlaku, tanpa menunggu semua
    // pemegangnya login ulang.
    const { customRole, ...pengguna } = user;
    req.user = { ...pengguna, permissions: await izinEfektif({ role: user.role, customRole }) };
    next();
  }
);

/**
 * Penjaga rute berbasis izin — dipasang setelah authenticateToken.
 * Lolos bila pengguna memegang SALAH SATU izin yang disebut.
 */
export const requirePermission =
  (...izin: string[]): RequestHandler =>
  (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Belum terautentikasi' });
    }
    if (!izin.some((k) => req.user!.permissions.includes(k))) {
      return res.status(403).json({ error: 'Anda tidak punya akses ke resource ini' });
    }
    next();
  };

/** Apakah pengguna memegang izin ini. Untuk pemeriksaan di dalam controller. */
export const punyaIzin = (user: Pick<AuthUser, 'permissions'>, izin: string): boolean =>
  user.permissions.includes(izin);

/**
 * Akses berjenjang berdasarkan lingkup data — dipasang setelah authenticateToken.
 * Sejak peran dinamis ada, rute memakai requirePermission; ini disisakan
 * untuk pemeriksaan lingkup yang memang soal cakupan data, bukan izin.
 */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Belum terautentikasi' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Anda tidak punya akses ke resource ini' });
    }
    next();
  };
