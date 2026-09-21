// src/controllers/mobileReleaseController.ts
//
// Distribusi aplikasi mobile: HR mengunggah APK hasil build, karyawan
// mengunduh versi terbaru dari halaman publik (sebelum punya sesi di ponsel).
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { toDataURL } from 'qrcode';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { generateULID } from '../utils/generateULID';
import type { UploadReleaseQuery, UpdateReleaseInput, ListReleaseQuery, QrQuery } from '../schemas/mobileReleaseSchema';

export const MIME_APK = 'application/vnd.android.package-archive';
const DIR_APK = 'apk';

const releaseSelect = {
  id: true,
  versionName: true,
  versionCode: true,
  fileName: true,
  sizeBytes: true,
  sha256: true,
  notes: true,
  isActive: true,
  downloadCount: true,
  createdAt: true,
  uploadedBy: { select: { id: true, name: true } },
} satisfies Prisma.MobileReleaseSelect;

/**
 * APK adalah arsip ZIP yang memuat AndroidManifest.xml. Nama entri di
 * central directory ZIP tersimpan tanpa kompresi, jadi pencarian substring
 * pada byte-nya cukup untuk menolak berkas yang bukan APK — tanpa perlu
 * membongkar arsipnya.
 */
export const isApk = (buf: Buffer): boolean =>
  buf.length >= 1024 &&
  buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04 &&
  buf.includes('AndroidManifest.xml');

const namaBerkas = (versionName: string) => `hrd-nusantara-${versionName.replace(/[^A-Za-z0-9.+-]/g, '_')}.apk`;

const rilisTerbaru = () =>
  prisma.mobileRelease.findFirst({ where: { isActive: true }, orderBy: { versionCode: 'desc' }, select: { ...releaseSelect, storagePath: true } });

export const uploadRelease = async (req: Request, res: Response) => {
  const query = req.query as unknown as UploadReleaseQuery;
  const badan = req.body as unknown;

  if (!Buffer.isBuffer(badan) || badan.length === 0) {
    return res.status(400).json({ error: 'Badan permintaan harus berisi berkas APK mentah' });
  }
  if (!isApk(badan)) {
    return res.status(400).json({ error: 'Berkas bukan APK Android (bukan arsip ZIP dengan AndroidManifest.xml)' });
  }

  const sha256 = createHash('sha256').update(badan).digest('hex');
  const id = generateULID();
  const fileName = namaBerkas(query.versionName);
  const relatif = path.posix.join(DIR_APK, `${query.versionCode}-${id}.apk`);
  const dir = path.resolve(env.UPLOAD_DIR, DIR_APK);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.resolve(env.UPLOAD_DIR, relatif), badan, { mode: 0o600 });

  try {
    const rilis = await prisma.mobileRelease.create({
      data: {
        id,
        versionName: query.versionName,
        versionCode: query.versionCode,
        fileName,
        storagePath: relatif,
        sizeBytes: badan.length,
        sha256,
        notes: query.notes ?? null,
        uploadedById: req.user!.id,
      },
      select: releaseSelect,
    });

    res.locals.audit = {
      action: 'mobile.release.upload',
      entity: 'MobileRelease',
      entityId: rilis.id,
      summary: `Mengunggah APK versi ${rilis.versionName} (${rilis.versionCode})`,
      metadata: { sizeBytes: rilis.sizeBytes, sha256 },
    };
    res.status(201).json(rilis);
  } catch (error) {
    // Berkas yang sudah tertulis tidak boleh tertinggal tanpa catatan.
    await fs.rm(path.resolve(env.UPLOAD_DIR, relatif), { force: true });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: `versionCode ${query.versionCode} sudah dipakai rilis lain. Naikkan nomornya.` });
    }
    throw error;
  }
};

export const listReleases = async (req: Request, res: Response) => {
  const { page, limit } = req.query as unknown as ListReleaseQuery;
  const [total, data] = await Promise.all([
    prisma.mobileRelease.count(),
    prisma.mobileRelease.findMany({ select: releaseSelect, orderBy: { versionCode: 'desc' }, skip: (page - 1) * limit, take: limit }),
  ]);
  res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } });
};

export const updateRelease = async (req: Request, res: Response) => {
  const input = req.body as UpdateReleaseInput;
  const ada = await prisma.mobileRelease.findUnique({ where: { id: req.params.id }, select: { id: true, versionName: true } });
  if (!ada) return res.status(404).json({ error: 'Rilis tidak ditemukan' });

  const rilis = await prisma.mobileRelease.update({ where: { id: ada.id }, data: input, select: releaseSelect });
  res.locals.audit = {
    action: 'mobile.release.update',
    entity: 'MobileRelease',
    entityId: rilis.id,
    summary: `Mengubah rilis ${ada.versionName}: ${Object.keys(input).join(', ')}`,
    metadata: input,
  };
  res.json(rilis);
};

/** Publik: metadata versi terbaru, untuk halaman unduh dan pemeriksaan versi di aplikasi. */
export const getLatestRelease = async (_req: Request, res: Response) => {
  const rilis = await rilisTerbaru();
  if (!rilis) return res.status(404).json({ error: 'Belum ada rilis aplikasi yang tersedia' });
  const { storagePath: _abaikan, ...dto } = rilis;
  void _abaikan;
  res.json({ ...dto, downloadPath: '/api/mobile/apk/latest' });
};

const kirimApk = async (res: Response, rilis: { id: string; storagePath: string; fileName: string; sizeBytes: number; sha256: string }) => {
  const lokasi = path.resolve(env.UPLOAD_DIR, rilis.storagePath);
  try {
    await fs.access(lokasi);
  } catch {
    return res.status(500).json({ error: 'Berkas APK tidak ditemukan di penyimpanan. Hubungi administrator.' });
  }

  // Dihitung, bukan dijadikan syarat: unduhan tidak boleh gagal hanya karena
  // penghitungnya gagal ditulis.
  prisma.mobileRelease.update({ where: { id: rilis.id }, data: { downloadCount: { increment: 1 } } }).catch(() => undefined);

  res.setHeader('Content-Type', MIME_APK);
  res.setHeader('Content-Length', String(rilis.sizeBytes));
  res.setHeader('Content-Disposition', `attachment; filename="${rilis.fileName}"`);
  res.setHeader('X-Checksum-Sha256', rilis.sha256);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  createReadStream(lokasi).pipe(res);
};

/** Publik: mengunduh APK versi terbaru. */
export const downloadLatestApk = async (_req: Request, res: Response) => {
  const rilis = await rilisTerbaru();
  if (!rilis) return res.status(404).json({ error: 'Belum ada rilis aplikasi yang tersedia' });
  return kirimApk(res, rilis);
};

/** Publik: mengunduh rilis tertentu (termasuk yang nonaktif, untuk HR yang membagikan tautan lama). */
export const downloadApk = async (req: Request, res: Response) => {
  const rilis = await prisma.mobileRelease.findUnique({
    where: { id: req.params.id },
    select: { id: true, storagePath: true, fileName: true, sizeBytes: true, sha256: true },
  });
  if (!rilis) return res.status(404).json({ error: 'Rilis tidak ditemukan' });
  return kirimApk(res, rilis);
};

/** HR: gambar QR dari sebuah teks (tautan unduh), untuk dipajang di outlet. */
export const qrForText = async (req: Request, res: Response) => {
  const { text } = req.query as unknown as QrQuery;
  res.json({ dataUrl: await toDataURL(text, { width: 360, margin: 1 }) });
};
