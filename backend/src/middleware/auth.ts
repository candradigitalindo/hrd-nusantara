// src/middleware/auth.ts
import { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';

export interface AuthUser {
  id: string;
  nik: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  departmentId: string | null;
  positionId: string | null;
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
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'Token tidak valid' });
    }

    if (!ACTIVE_STATUSES.has(user.status)) {
      return res.status(403).json({ error: 'Akun Anda sudah tidak aktif' });
    }

    req.user = user;
    next();
  }
);

/** Akses berjenjang — dipasang setelah authenticateToken. */
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
