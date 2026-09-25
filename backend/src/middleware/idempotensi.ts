// src/middleware/idempotensi.ts
import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import { asyncHandler } from './auth';

/** Berapa lama jawaban disimpan untuk kiriman ulang. */
export const UMUR_KUNCI_HARI = 7;
const POLA_KUNCI = /^[A-Za-z0-9_-]{8,100}$/;

const hapusKedaluwarsa = () =>
  prisma.idempotencyKey
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - UMUR_KUNCI_HARI * 86_400_000) } } })
    .catch((e) => console.warn('Gagal membersihkan Idempotency-Key lama:', e));

/**
 * Kunci anti-dobel untuk kiriman dari antrean offline mobile.
 *
 * Ponsel yang sinyalnya putus sesaat setelah mengirim tidak tahu apakah
 * server sudah menyimpan; ia mengirim ulang dengan header Idempotency-Key
 * yang sama. Kiriman pertama dicatat berikut jawabannya, kiriman ulang
 * menerima jawaban itu apa adanya (header Idempotent-Replayed) — tanpa
 * presensi, cuti, atau pesan kedua.
 *
 * Tanpa header, permintaan berjalan seperti biasa (klien web). Dipasang
 * setelah authenticateToken: kuncinya berlaku per karyawan.
 */
export const idempotensi = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const kunci = req.get('Idempotency-Key');
  if (!kunci) return next();
  if (!POLA_KUNCI.test(kunci)) {
    return res.status(400).json({ error: 'Idempotency-Key harus 8–100 karakter huruf, angka, - atau _' });
  }

  const employeeId = req.user!.id;
  // Jalur nyata, bukan pola rute: kunci pembatalan cuti A tidak boleh
  // menjawab pembatalan cuti B.
  const rute = `${req.method} ${req.baseUrl}${req.path}`;
  const where = { employeeId_key: { employeeId, key: kunci } };

  // Klaim dulu, baru proses: unique (employeeId, key) memastikan dua kiriman
  // yang tiba bersamaan tidak sama-sama dijalankan. ON CONFLICT DO NOTHING
  // (skipDuplicates), bukan tangkap P2002: kiriman ulang itu hal biasa,
  // bukan galat yang pantas mengotori log.
  const klaim = await prisma.idempotencyKey.createMany({
    data: [{ id: generateULID(), employeeId, key: kunci, route: rute }],
    skipDuplicates: true,
  });
  if (klaim.count === 0) {
    const ada = await prisma.idempotencyKey.findUnique({ where });
    if (ada && ada.route !== rute) {
      return res.status(422).json({ error: 'Idempotency-Key ini sudah dipakai untuk permintaan lain' });
    }
    if (!ada || ada.statusCode === null) {
      return res.status(409).json({
        error: 'Permintaan yang sama masih diproses. Coba lagi sebentar lagi.',
        code: 'idempotency_in_progress',
      });
    }
    res.set('Idempotent-Replayed', 'true');
    return res.status(ada.statusCode).json(ada.responseBody);
  }

  if (Math.random() < 0.01) void hapusKedaluwarsa();

  // Jawaban dicatat dulu, baru dikirim: ponsel yang menerimanya lalu segera
  // mengirim ulang (mis. karena jawaban berikutnya hilang) pasti mendapat
  // jawaban tersimpan, bukan "masih diproses". 5xx tidak dicatat (kuncinya
  // dilepas) supaya kiriman ulang benar-benar dicoba lagi.
  let tercatat = false;
  const jsonAsli = res.json.bind(res);
  res.json = ((body?: unknown) => {
    if (tercatat) return jsonAsli(body);
    tercatat = true;
    const simpan =
      res.statusCode >= 500
        ? prisma.idempotencyKey.delete({ where })
        : prisma.idempotencyKey.update({
            where,
            data: { statusCode: res.statusCode, responseBody: (body ?? null) as Prisma.InputJsonValue },
          });
    simpan
      .catch((e) => console.warn('Gagal mencatat Idempotency-Key:', e))
      .finally(() => {
        try {
          jsonAsli(body);
        } catch (e) {
          console.warn('Jawaban ber-Idempotency-Key gagal dikirim:', e);
        }
      });
    return res;
  }) as Response['json'];
  // Koneksi putus sebelum ada jawaban: lepaskan kunci supaya bisa dicoba ulang.
  res.on('close', () => {
    if (!tercatat) {
      tercatat = true;
      prisma.idempotencyKey.delete({ where }).catch(() => {});
    }
  });

  next();
});
