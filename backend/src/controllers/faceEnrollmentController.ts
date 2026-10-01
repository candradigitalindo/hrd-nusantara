// src/controllers/faceEnrollmentController.ts
import fs from 'fs/promises';
import path from 'path';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { encryptBytes } from '../utils/fieldCrypto';
import { env } from '../config/env';
import { generateULID } from '../utils/generateULID';
import { decodeBase64Image, saveImage, InvalidImageError } from '../utils/imageUpload';
import { resolveDocumentPath } from '../utils/documentUpload';
import { kirimKeKaryawan, type PesanPush } from '../services/notification/push';
import {
  extractForEnrollment,
  embeddingToBuffer,
  FaceProcessingError,
  FaceModelError,
} from '../services/face';
import type {
  EnrollFaceInput,
  ListFaceEnrollmentQuery,
  KirimWajahSendiriInput,
  ListWajahMenungguQuery,
  SetujuiWajahInput,
  TolakWajahInput,
} from '../schemas/faceSchema';

// Status pendaftaran wajah (kolom FaceEnrollment.status):
// - pending: kiriman mandiri dari aplikasi, menunggu HR. Belum dipakai check-in.
// - approved: dipakai check-in selama isActive. Semua pendaftaran oleh HR.
// - rejected: ditolak HR; alasannya di reviewNote dan dikirim ke karyawan.
// - cancelled: digantikan kiriman mandiri yang lebih baru sebelum ditinjau.

/** Embedding tidak pernah ikut keluar lewat API — itu data biometrik. */
const enrollmentSelect = {
  id: true,
  employeeId: true,
  dimensions: true,
  modelName: true,
  detectionScore: true,
  isActive: true,
  status: true,
  source: true,
  livenessScore: true,
  enrolledById: true,
  enrolledBy: { select: { id: true, name: true } },
  reviewedAt: true,
  reviewedBy: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FaceEnrollmentSelect;

/**
 * Pendaftaran dari model lain tidak bisa dibandingkan dengan model yang
 * sedang aktif — check-in akan menolaknya, jadi HR perlu tahu.
 */
const usang = (modelName: string) => modelName !== env.FACE_MODEL_NAME;

/**
 * Menerjemahkan kegagalan pemrosesan wajah menjadi status HTTP.
 * Dipakai bersama oleh pendaftaran dan check-in supaya aplikasi mobile
 * melihat kode yang konsisten.
 */
export const handleFaceError = (error: unknown, res: Response): boolean => {
  if (error instanceof FaceModelError) {
    // 503: masalah kesiapan server, bukan kesalahan pengguna.
    res.status(503).json({
      error: 'Model pengenalan wajah belum siap di server',
      detail: error.message,
    });
    return true;
  }

  if (error instanceof FaceProcessingError) {
    const status = error.reason === 'recognition_disabled' ? 503 : 422;
    res.status(status).json({ error: error.message, reason: error.reason });
    return true;
  }

  if (error instanceof InvalidImageError) {
    res.status(400).json({ error: error.message });
    return true;
  }

  return false;
};

export const enrollFace = async (req: Request, res: Response) => {
  const { image, replaceExisting } = req.body as EnrollFaceInput;
  const employeeId = req.params.id;

  // Aturan yang sama dengan persetujuan kiriman: kalau pemegang izin ini boleh
  // mendaftarkan wajahnya sendiri, ia bisa memotret rekan lalu menyimpannya
  // sebagai wajah dirinya tanpa ada yang memeriksa — persis titip absen yang
  // dicegah persetujuan HR. Wajah sendiri didaftarkan HR lain, atau dikirim
  // dari aplikasi lalu disetujui HR lain.
  if (employeeId === req.user!.id) {
    return res.status(403).json({
      error: 'Wajah Anda sendiri harus didaftarkan HR lain, atau kirim selfie dari aplikasi untuk disetujui HR lain',
    });
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, name: true },
  });

  if (!employee) {
    return res.status(404).json({ error: 'Karyawan tidak ditemukan' });
  }

  try {
    const { buffer, extension } = decodeBase64Image(image);
    const hasil = await extractForEnrollment(buffer);

    const imageUrl = await saveImage(buffer, extension, 'face-enrollments');

    const { enrollment, digantikan } = await prisma.$transaction(async (tx) => {
      const lama = replaceExisting
        ? await tx.faceEnrollment.updateMany({
            where: { employeeId, isActive: true },
            data: { isActive: false },
          })
        : { count: 0 };

      const baru = await tx.faceEnrollment.create({
        data: {
          id: generateULID(),
          employeeId,
          // Data biometrik tidak pernah menyentuh database dalam bentuk terbuka.
          embedding: encryptBytes(embeddingToBuffer(hasil.embedding)),
          dimensions: hasil.embedding.length,
          modelName: hasil.modelName,
          detectionScore: hasil.detectionScore,
          imageUrl,
          enrolledById: req.user!.id,
        },
        select: enrollmentSelect,
      });
      return { enrollment: baru, digantikan: lama.count };
    });

    res.locals.audit = {
      action: 'employee.face.enroll',
      entity: 'FaceEnrollment',
      entityId: enrollment.id,
      summary: `Mendaftarkan wajah ${employee.name}`,
      metadata: {
        employeeId,
        modelName: enrollment.modelName,
        detectionScore: enrollment.detectionScore,
        replaceExisting,
        deactivatedCount: digantikan,
      },
    };

    res.status(201).json({ ...enrollment, stale: usang(enrollment.modelName) });
  } catch (error) {
    if (handleFaceError(error, res)) return;
    throw error;
  }
};

export const getFaceEnrollments = async (req: Request, res: Response) => {
  const { page, limit, includeInactive } = req.query as unknown as ListFaceEnrollmentQuery;
  const employeeId = req.params.id;

  const where: Prisma.FaceEnrollmentWhereInput = { employeeId };
  if (!includeInactive) where.isActive = true;

  const [total, rows, menunggu] = await Promise.all([
    prisma.faceEnrollment.count({ where }),
    prisma.faceEnrollment.findMany({
      where,
      select: enrollmentSelect,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    // Terpisah dari daftar: kiriman yang menunggu belum aktif, jadi tidak
    // muncul di daftar bawaan, padahal justru itu yang perlu ditindaklanjuti.
    prisma.faceEnrollment.findFirst({
      where: { employeeId, status: 'pending' },
      select: { id: true, createdAt: true, detectionScore: true, livenessScore: true, modelName: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }),
  ]);

  res.json({
    data: rows.map((row) => ({
      ...row,
      // Pendaftaran dari model lain tidak bisa dibandingkan dengan model
      // yang sedang aktif, jadi statusnya ditandai agar HR bisa mendaftar ulang.
      stale: usang(row.modelName),
    })),
    pending: menunggu
      ? {
          id: menunggu.id,
          createdAt: menunggu.createdAt,
          detectionScore: menunggu.detectionScore,
          livenessScore: menunggu.livenessScore,
          stale: usang(menunggu.modelName),
        }
      : null,
    activeModel: env.FACE_MODEL_NAME,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
};

/**
 * Pendaftaran wajah dinonaktifkan, bukan dihapus — jejak siapa mendaftarkan
 * siapa dan kapan adalah bagian dari audit sistem biometrik.
 */
export const deactivateFaceEnrollment = async (req: Request, res: Response) => {
  // Kiriman yang menunggu belum aktif; "menonaktifkannya" tidak mengubah apa
  // pun dan membuatnya tetap menggantung di antrean persetujuan. Jalurnya
  // Tolak, yang juga memberi tahu karyawan alasannya.
  const ada = await prisma.faceEnrollment.findUnique({
    where: { id: req.params.id },
    select: { status: true },
  });
  if (ada?.status === 'pending') {
    return res
      .status(409)
      .json({ error: 'Kiriman yang menunggu persetujuan ditolak lewat tombol Tolak' });
  }

  try {
    const { employee, ...enrollment } = await prisma.faceEnrollment.update({
      where: { id: req.params.id },
      data: { isActive: false },
      select: { ...enrollmentSelect, employee: { select: { name: true } } },
    });

    res.locals.audit = {
      action: 'employee.face.deactivate',
      entity: 'FaceEnrollment',
      entityId: enrollment.id,
      summary: `Menonaktifkan pendaftaran wajah ${employee.name}`,
      metadata: { employeeId: enrollment.employeeId, modelName: enrollment.modelName },
    };

    res.json({ message: 'Pendaftaran wajah dinonaktifkan', enrollment });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({ error: 'Pendaftaran wajah tidak ditemukan' });
    }
    throw error;
  }
};

// ============ Pendaftaran mandiri dari aplikasi mobile ============
//
// Karyawan mengirim selfie sendiri, lalu HR menyetujuinya di web. Kiriman
// tidak pernah langsung dipakai check-in: tanpa persetujuan, karyawan A bisa
// mendaftarkan wajah rekan B atas nama A lalu B yang absen untuk A. HR
// melihat fotonya dan memastikan orangnya benar.

/** Kiriman sudah disetujui/ditolak/dibatalkan oleh permintaan lain. */
class KirimanSudahDiproses extends Error {}

const SUDAH_DIPROSES = { error: 'Kiriman ini sudah diproses' };

/**
 * Notifikasi ke karyawan setelah jawaban terkirim. Kegagalan push tidak boleh
 * membatalkan keputusan HR yang sudah tersimpan; status terbaru tetap terlihat
 * saat karyawan membuka layar wajah di aplikasi.
 */
const beritahuKaryawan = (employeeId: string, pesan: PesanPush) => {
  kirimKeKaryawan(employeeId, pesan).catch((error) => {
    if (env.NODE_ENV !== 'test') console.warn('[wajah] Notifikasi push gagal dikirim:', error);
  });
};

/** Status pendaftaran wajah milik sendiri, untuk layar wajah di aplikasi. */
export const getWajahSaya = async (req: Request, res: Response) => {
  const employeeId = req.user!.id;

  const [siap, menunggu, terakhir] = await Promise.all([
    // Syaratnya sama persis dengan check-in, supaya "terdaftar" di aplikasi
    // berarti check-in wajah memang akan dicocokkan.
    prisma.faceEnrollment.findFirst({
      where: { employeeId, isActive: true, status: 'approved', modelName: env.FACE_MODEL_NAME },
      select: { id: true },
    }),
    prisma.faceEnrollment.findFirst({
      where: { employeeId, status: 'pending' },
      select: { id: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }),
    // Penolakan hanya relevan selama belum ada yang lebih baru — kiriman
    // ulang atau pendaftaran oleh HR. Yang dibatalkan selalu lebih tua dari
    // kiriman penggantinya, jadi tidak pernah menjadi yang terakhir.
    prisma.faceEnrollment.findFirst({
      where: { employeeId, status: { not: 'cancelled' } },
      select: { id: true, status: true, source: true, reviewNote: true, reviewedAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }),
  ]);

  const ditolak = terakhir?.status === 'rejected' && terakhir.source === 'self' ? terakhir : null;

  res.json({
    enrolled: siap !== null,
    pending: menunggu,
    lastRejection: ditolak
      ? { id: ditolak.id, reason: ditolak.reviewNote, reviewedAt: ditolak.reviewedAt }
      : null,
    recognitionEnabled: env.FACE_RECOGNITION_ENABLED,
  });
};

/**
 * Karyawan mengirim foto wajahnya sendiri untuk disetujui HR.
 *
 * Berbeda dari pendaftaran oleh HR, keaslian-hidupnya diperiksa: tidak ada HR
 * yang menyaksikan foto diambil, jadi foto rekan yang ditampilkan di layar
 * ponsel ditolak di sini, sebelum sampai ke meja HR.
 */
export const kirimWajahSendiri = async (req: Request, res: Response) => {
  const { image } = req.body as KirimWajahSendiriInput;
  const pengirim = req.user!;

  try {
    const { buffer, extension } = decodeBase64Image(image);
    const hasil = await extractForEnrollment(buffer, { periksaHidup: true });

    // Disimpan karena HR harus melihat fotonya untuk memutuskan.
    const imageUrl = await saveImage(buffer, extension, 'face-enrollments');

    const { kiriman, dibatalkan } = await prisma.$transaction(async (tx) => {
      // Mengunci baris karyawan supaya dua kiriman yang tiba bersamaan
      // (ketukan ganda, aplikasi terpasang di dua ponsel) tidak sama-sama lolos dan
      // meninggalkan dua kiriman menunggu. NO KEY UPDATE: presensi dan data
      // lain yang merujuk karyawan ini tetap bisa ditulis selama itu.
      await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${pengirim.id} FOR NO KEY UPDATE`;

      // Hanya kiriman terbaru yang ditinjau: foto lama yang menunggu
      // dibatalkan, bukan ditumpuk di antrean HR.
      const lama = await tx.faceEnrollment.updateMany({
        where: { employeeId: pengirim.id, status: 'pending' },
        data: { status: 'cancelled', reviewNote: 'Digantikan kiriman baru' },
      });

      const baru = await tx.faceEnrollment.create({
        data: {
          id: generateULID(),
          employeeId: pengirim.id,
          // Data biometrik tidak pernah menyentuh database dalam bentuk terbuka.
          embedding: encryptBytes(embeddingToBuffer(hasil.embedding)),
          dimensions: hasil.embedding.length,
          modelName: hasil.modelName,
          detectionScore: hasil.detectionScore,
          livenessScore: hasil.livenessScore,
          imageUrl,
          enrolledById: pengirim.id,
          status: 'pending',
          source: 'self',
          // Belum dipakai check-in sampai HR menyetujui.
          isActive: false,
        },
        select: { id: true, status: true, createdAt: true },
      });
      return { kiriman: baru, dibatalkan: lama.count };
    });

    res.locals.audit = {
      action: 'employee.face.self_submit',
      entity: 'FaceEnrollment',
      entityId: kiriman.id,
      summary: `Mengirim foto wajah untuk disetujui (${pengirim.name})`,
      metadata: {
        employeeId: pengirim.id,
        detectionScore: hasil.detectionScore,
        livenessScore: hasil.livenessScore,
        cancelledCount: dibatalkan,
      },
    };

    // Embedding dan lokasi foto tidak ikut: karyawan tidak membutuhkannya,
    // dan foto hanya boleh dibuka HR yang meninjau.
    res.status(201).json(kiriman);
  } catch (error) {
    if (handleFaceError(error, res)) return;
    throw error;
  }
};

/** Antrean kiriman yang menunggu, paling lama menunggu lebih dulu. */
export const getWajahMenunggu = async (req: Request, res: Response) => {
  const { page, limit } = req.query as unknown as ListWajahMenungguQuery;
  const where: Prisma.FaceEnrollmentWhereInput = { status: 'pending' };

  const [total, rows] = await Promise.all([
    prisma.faceEnrollment.count({ where }),
    prisma.faceEnrollment.findMany({
      where,
      select: {
        id: true,
        employeeId: true,
        employee: {
          select: {
            id: true,
            name: true,
            nik: true,
            department: { select: { id: true, name: true } },
            position: { select: { id: true, name: true } },
          },
        },
        detectionScore: true,
        livenessScore: true,
        modelName: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data: rows.map(({ modelName, ...row }) => ({ ...row, stale: usang(modelName) })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
};

const TIPE_FOTO: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/**
 * Foto kiriman, untuk HR yang meninjau.
 *
 * Hanya selama menunggu: setelah diputuskan, foto wajah tidak lagi punya
 * alasan untuk dibuka, dan setiap pembukaan adalah akses ke data biometrik.
 */
export const getFotoWajah = async (req: Request, res: Response) => {
  const kiriman = await prisma.faceEnrollment.findUnique({
    where: { id: req.params.id },
    select: { id: true, status: true, imageUrl: true, employeeId: true, employee: { select: { name: true } } },
  });

  if (!kiriman) {
    return res.status(404).json({ error: 'Kiriman wajah tidak ditemukan' });
  }
  if (kiriman.status !== 'pending' || !kiriman.imageUrl) {
    return res.status(404).json({ error: 'Foto hanya bisa dilihat selama menunggu persetujuan' });
  }

  let isi: Buffer;
  try {
    // resolveDocumentPath menolak lokasi yang keluar dari UPLOAD_DIR: imageUrl
    // dibuat server, tapi kalau basis datanya disusupi, ini lapis keduanya.
    isi = await fs.readFile(resolveDocumentPath(kiriman.imageUrl));
  } catch {
    // Barisnya ada tapi berkasnya tidak: penyimpanan rusak atau volume tidak
    // terpasang. Ini keadaan yang harus terlihat, bukan 404 biasa.
    return res
      .status(500)
      .json({ error: 'Berkas foto tidak ditemukan di penyimpanan. Hubungi administrator.' });
  }

  // Akses ke data biometrik: dicatat walau ini GET.
  res.locals.audit = {
    action: 'employee.face.photo_view',
    entity: 'FaceEnrollment',
    entityId: kiriman.id,
    summary: `Melihat foto wajah kiriman ${kiriman.employee.name}`,
    metadata: { employeeId: kiriman.employeeId },
  };

  const ekstensi = path.extname(kiriman.imageUrl).toLowerCase();
  res.setHeader('Content-Type', TIPE_FOTO[ekstensi] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(isi);
};

const cariKiriman = (id: string) =>
  prisma.faceEnrollment.findUnique({
    where: { id },
    select: { id: true, employeeId: true, status: true, modelName: true, employee: { select: { name: true } } },
  });

/** HR menyetujui kiriman: mulai saat itu wajah ini dipakai mencocokkan check-in. */
export const setujuiWajah = async (req: Request, res: Response) => {
  const { replaceExisting } = req.body as SetujuiWajahInput;
  const peninjau = req.user!;

  const kiriman = await cariKiriman(req.params.id);
  if (!kiriman) {
    return res.status(404).json({ error: 'Kiriman wajah tidak ditemukan' });
  }
  // Prinsip empat mata: kalau HR boleh menyetujui wajahnya sendiri, ia juga
  // bisa menyetujui wajah rekan yang dikirim atas namanya.
  if (kiriman.employeeId === peninjau.id) {
    return res.status(403).json({ error: 'Wajah Anda sendiri harus disetujui HR lain' });
  }
  if (kiriman.status !== 'pending') {
    return res.status(409).json(SUDAH_DIPROSES);
  }
  if (usang(kiriman.modelName)) {
    // Embedding-nya tidak akan pernah cocok dengan check-in di model sekarang.
    return res
      .status(409)
      .json({ error: 'Model pengenalan wajah sudah berganti. Minta karyawan mengirim foto ulang.' });
  }

  const hasil = await prisma
    .$transaction(async (tx) => {
      // Bersyarat status: dua HR yang menekan Setujui/Tolak bersamaan —
      // hanya yang pertama berlaku, yang lain mendapat 409. Dilempar (bukan
      // dikembalikan) supaya penonaktifan foto lama ikut dibatalkan.
      const disetujui = await tx.faceEnrollment.updateMany({
        where: { id: kiriman.id, status: 'pending' },
        data: { status: 'approved', isActive: true, reviewedById: peninjau.id, reviewedAt: new Date() },
      });
      if (disetujui.count === 0) throw new KirimanSudahDiproses();

      const lama = replaceExisting
        ? await tx.faceEnrollment.updateMany({
            where: { employeeId: kiriman.employeeId, isActive: true, id: { not: kiriman.id } },
            data: { isActive: false },
          })
        : { count: 0 };

      const enrollment = await tx.faceEnrollment.findUniqueOrThrow({
        where: { id: kiriman.id },
        select: enrollmentSelect,
      });
      return { enrollment, dinonaktifkan: lama.count };
    })
    .catch((error: unknown) => {
      if (error instanceof KirimanSudahDiproses) return null;
      throw error;
    });
  if (!hasil) return res.status(409).json(SUDAH_DIPROSES);

  res.locals.audit = {
    action: 'employee.face.approve',
    entity: 'FaceEnrollment',
    entityId: kiriman.id,
    summary: `Menyetujui foto wajah ${kiriman.employee.name}`,
    metadata: { employeeId: kiriman.employeeId, replaceExisting, deactivatedCount: hasil.dinonaktifkan },
  };

  res.json({ ...hasil.enrollment, stale: usang(hasil.enrollment.modelName) });

  beritahuKaryawan(kiriman.employeeId, {
    title: 'Wajah disetujui',
    body: 'Anda sekarang bisa check-in dengan Verifikasi Wajah.',
    data: { jenis: 'wajah', status: 'approved' },
  });
};

/**
 * HR menolak kiriman, misalnya karena bukan wajah karyawan itu atau fotonya
 * buram. Menolak kiriman sendiri tidak dilarang: tidak ada yang bisa
 * disalahgunakan dari menolak.
 */
export const tolakWajah = async (req: Request, res: Response) => {
  const { reason } = req.body as TolakWajahInput;
  const peninjau = req.user!;

  const kiriman = await cariKiriman(req.params.id);
  if (!kiriman) {
    return res.status(404).json({ error: 'Kiriman wajah tidak ditemukan' });
  }
  if (kiriman.status !== 'pending') {
    return res.status(409).json(SUDAH_DIPROSES);
  }

  const reviewedAt = new Date();
  const ditolak = await prisma.faceEnrollment.updateMany({
    where: { id: kiriman.id, status: 'pending' },
    data: { status: 'rejected', reviewNote: reason, reviewedById: peninjau.id, reviewedAt },
  });
  if (ditolak.count === 0) return res.status(409).json(SUDAH_DIPROSES);

  res.locals.audit = {
    action: 'employee.face.reject',
    entity: 'FaceEnrollment',
    entityId: kiriman.id,
    summary: `Menolak foto wajah ${kiriman.employee.name}`,
    metadata: { employeeId: kiriman.employeeId, reason },
  };

  res.json({ id: kiriman.id, status: 'rejected', reviewNote: reason, reviewedAt });

  beritahuKaryawan(kiriman.employeeId, {
    title: 'Foto wajah ditolak',
    body: reason,
    data: { jenis: 'wajah', status: 'rejected' },
  });
};
