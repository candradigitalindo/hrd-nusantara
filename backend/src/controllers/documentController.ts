// src/controllers/documentController.ts
//
// Dokumen digital karyawan (hrd_features_doc.md bagian 1 dan 13).
//
// Isinya data pribadi yang paling sensitif di sistem ini setelah wajah:
// KTP, NPWP, SKCK, kontrak berikut gajinya. Karena itu:
//   - berkas tidak pernah disajikan statis; selalu lewat endpoint yang
//     memeriksa siapa yang meminta,
//   - karyawan hanya bisa melihat miliknya sendiri, manajer tidak bisa
//     melihat milik anak buahnya (SKCK dan NPWP bukan urusan atasan),
//   - setiap unduhan tercatat di jejak audit sebagai akses ke data pribadi.
import { Request, Response } from 'express';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import {
  decodeBase64Document,
  saveDocument,
  resolveDocumentPath,
  namaUnduhanAman,
  InvalidDocumentError,
} from '../utils/documentUpload';
import type {
  UploadDocumentInput,
  UpdateDocumentInput,
  ListDocumentQuery,
  ExpiringDocumentQuery,
} from '../schemas/documentSchema';

const isHr = (role: Role) => role === Role.SUPER_ADMIN || role === Role.HR_ADMIN;

/// storagePath dan sha256 sengaja tidak ikut: lokasi di disk bukan urusan
/// klien, dan sidik jarinya hanya dipakai saat audit.
const documentSelect = {
  id: true,
  employeeId: true,
  type: true,
  title: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  issuedAt: true,
  expiresAt: true,
  notes: true,
  uploadedById: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EmployeeDocumentSelect;

const bolehLihat = (actor: { id: string; role: Role }, employeeId: string) =>
  isHr(actor.role) || actor.id === employeeId;

// ============ Unggah ============

export const uploadDocument = async (req: Request, res: Response) => {
  const { id: employeeId } = req.params;
  const input = req.body as UploadDocumentInput;
  const actor = req.user!;

  const karyawan = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, name: true } });
  if (!karyawan) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });

  let didekode;
  try {
    didekode = decodeBase64Document(input.file, input.fileName);
  } catch (error) {
    if (error instanceof InvalidDocumentError) return res.status(400).json({ error: error.message });
    throw error;
  }

  const storagePath = await saveDocument(didekode.buffer, didekode.jenis.extension, employeeId);

  const dokumen = await prisma.employeeDocument.create({
    data: {
      id: generateULID(),
      employeeId,
      type: input.type,
      title: input.title,
      originalName: input.fileName,
      storagePath,
      mimeType: didekode.jenis.mimeType,
      sizeBytes: didekode.buffer.byteLength,
      sha256: didekode.sha256,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      notes: input.notes,
      uploadedById: actor.id,
    },
    select: documentSelect,
  });

  res.locals.audit = {
    action: 'employee.document.upload',
    entity: 'EmployeeDocument',
    entityId: dokumen.id,
    summary: `Mengunggah ${input.type} untuk ${karyawan.name}`,
    metadata: { employeeId, type: input.type, sizeBytes: dokumen.sizeBytes, sha256: didekode.sha256 },
  };

  res.status(201).json(dokumen);
};

// ============ Daftar & unduh ============

export const listDocuments = async (req: Request, res: Response) => {
  const { id: employeeId } = req.params;
  const query = req.query as unknown as ListDocumentQuery;
  const actor = req.user!;

  if (!bolehLihat(actor, employeeId)) {
    return res.status(403).json({ error: 'Anda hanya bisa melihat dokumen milik sendiri' });
  }

  const data = await prisma.employeeDocument.findMany({
    where: {
      employeeId,
      ...(query.type ? { type: query.type } : {}),
      // Yang sudah dihapus hanya terlihat oleh HR, dan hanya bila diminta.
      ...(query.includeDeleted && isHr(actor.role) ? {} : { deletedAt: null }),
    },
    select: documentSelect,
    orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
  });

  res.json({ data });
};

export const downloadDocument = async (req: Request, res: Response) => {
  const actor = req.user!;

  const dokumen = await prisma.employeeDocument.findUnique({
    where: { id: req.params.id },
    include: { employee: { select: { id: true, name: true } } },
  });
  if (!dokumen || (dokumen.deletedAt && !isHr(actor.role))) {
    return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
  }
  if (!bolehLihat(actor, dokumen.employeeId)) {
    return res.status(403).json({ error: 'Anda hanya bisa mengunduh dokumen milik sendiri' });
  }

  let lokasi: string;
  try {
    lokasi = resolveDocumentPath(dokumen.storagePath);
    await fs.access(lokasi);
  } catch {
    // Metadata ada tapi berkasnya tidak: penyimpanan rusak atau volume
    // tidak terpasang. Ini keadaan yang harus terlihat, bukan 404 biasa.
    return res.status(500).json({ error: 'Berkas dokumen tidak ditemukan di penyimpanan. Hubungi administrator.' });
  }

  // Akses ke data pribadi: dicatat walau ini GET.
  res.locals.audit = {
    action: 'employee.document.download',
    entity: 'EmployeeDocument',
    entityId: dokumen.id,
    summary: `Mengunduh ${dokumen.type} milik ${dokumen.employee.name}`,
    metadata: { employeeId: dokumen.employeeId, type: dokumen.type, sha256: dokumen.sha256 },
  };

  const ekstensi = dokumen.storagePath.split('.').pop() ?? 'bin';
  const nama = namaUnduhanAman(dokumen.originalName, ekstensi);

  res.setHeader('Content-Type', dokumen.mimeType);
  res.setHeader('Content-Length', String(dokumen.sizeBytes));
  // filename* menangani nama ber-unicode; filename biasa untuk klien lama.
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${nama.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(nama)}`
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  createReadStream(lokasi).pipe(res);
};

// ============ Ubah & hapus ============

export const updateDocument = async (req: Request, res: Response) => {
  const input = req.body as UpdateDocumentInput;

  try {
    const dokumen = await prisma.employeeDocument.update({
      where: { id: req.params.id, deletedAt: null },
      data: input,
      select: documentSelect,
    });
    res.json(dokumen);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
    }
    throw error;
  }
};

/**
 * Soft delete. Berkasnya tetap di disk dan barisnya tetap di tabel — kontrak
 * kerja adalah bukti, dan bukti yang lenyap dari sistem justru pertanyaan
 * pertama saat sengketa.
 */
export const deleteDocument = async (req: Request, res: Response) => {
  const actor = req.user!;

  const hasil = await prisma.employeeDocument.updateMany({
    where: { id: req.params.id, deletedAt: null },
    data: { deletedAt: new Date(), deletedById: actor.id },
  });
  if (hasil.count === 0) return res.status(404).json({ error: 'Dokumen tidak ditemukan' });

  res.status(204).send();
};

// ============ Pelacakan masa berlaku ============

/**
 * Dokumen yang akan atau sudah kedaluwarsa: kontrak yang perlu diperpanjang,
 * SKCK dan sertifikat (Food Handler, First Aid) yang perlu diperbarui.
 */
export const listExpiringDocuments = async (req: Request, res: Response) => {
  const query = req.query as unknown as ExpiringDocumentQuery;
  const batas = new Date(Date.now() + query.days * 24 * 60 * 60 * 1000);

  const where: Prisma.EmployeeDocumentWhereInput = {
    deletedAt: null,
    expiresAt: { lte: batas },
    ...(query.type ? { type: query.type } : {}),
    ...(query.departmentId ? { employee: { departmentId: query.departmentId } } : {}),
  };

  const [total, data] = await Promise.all([
    prisma.employeeDocument.count({ where }),
    prisma.employeeDocument.findMany({
      where,
      select: {
        ...documentSelect,
        employee: { select: { id: true, nik: true, name: true, department: { select: { id: true, name: true } } } },
      },
      orderBy: { expiresAt: 'asc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  res.json({
    data,
    pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) || 1 },
  });
};
