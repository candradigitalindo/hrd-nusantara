// src/middleware/authPelamar.ts
//
// Autentikasi portal karier, terpisah dari akun karyawan.
//
// Dua arah pemisahan, keduanya harus dijaga:
//   - Token pelamar TIDAK boleh membuka rute internal. authenticateToken
//     mencari Employee dengan id dari token; id akun pelamar tidak pernah
//     cocok, jadi arah ini sudah tertutup dengan sendirinya.
//   - Token karyawan TIDAK boleh membuka rute pelamar. Karena itu token
//     pelamar membawa klaim `tipe` dan di sini klaim itu diwajibkan — token
//     karyawan yang tidak memilikinya langsung ditolak.
import { Request, Response, NextFunction } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { asyncHandler } from './auth';

export const TIPE_PELAMAR = 'pelamar';

export interface PelamarAuth {
  id: string;
  email: string;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      pelamar?: PelamarAuth;
    }
  }
}

interface PayloadPelamar {
  sub: string;
  tipe: string;
}

export const buatTokenPelamar = (akunId: string): string =>
  jwt.sign({ sub: akunId, tipe: TIPE_PELAMAR }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });

export const authPelamar = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: 'Silakan masuk lebih dulu' });

  let payload: PayloadPelamar;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as PayloadPelamar;
  } catch {
    return res.status(401).json({ error: 'Sesi Anda sudah berakhir. Silakan masuk lagi.' });
  }
  if (payload.tipe !== TIPE_PELAMAR) {
    // Token karyawan yang dipakai di portal pelamar: ditolak, bukan diterima
    // dengan hak seadanya.
    return res.status(401).json({ error: 'Token ini bukan untuk portal karier' });
  }

  const akun = await prisma.candidateAccount.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true },
  });
  if (!akun) return res.status(401).json({ error: 'Akun tidak ditemukan' });

  req.pelamar = akun;
  next();
});
