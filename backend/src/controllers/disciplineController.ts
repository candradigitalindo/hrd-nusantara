// src/controllers/disciplineController.ts
//
// Keluhan dan tindakan disiplin (hrd_features_doc.md bagian 13).
//
// Dua jenis kasus dengan aturan lihat yang berbeda, dan perbedaannya
// disengaja:
//
//   Tindakan disiplin  — subjeknya BERHAK tahu. Surat peringatan yang tidak
//                        disampaikan tidak sah (UU 13/2003 pasal 161).
//   Keluhan            — subjeknya TIDAK otomatis tahu. Kalau karyawan
//                        mengeluhkan manajernya dan manajer itu bisa
//                        membaca keluhannya selagi ditinjau, tidak akan ada
//                        yang berani mengeluh.
//
// Manajer melihat tindakan disiplin di departemennya, tapi keluhan hanya
// yang ia ajukan atau tangani sendiri — bukan yang ditujukan padanya.
import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import type {
  CreateComplaintInput,
  CreateDisciplinaryInput,
  UpdateCaseStatusInput,
  ListCaseQuery,
} from '../schemas/disciplineSchema';

const isHr = (role: Role) => role === Role.SUPER_ADMIN || role === Role.HR_ADMIN;

const caseSelect = {
  id: true,
  employeeId: true,
  type: true,
  title: true,
  description: true,
  status: true,
  severity: true,
  incidentDate: true,
  resolvedAt: true,
  resolutionNotes: true,
  reportedById: true,
  handledById: true,
  createdAt: true,
  updatedAt: true,
  employee: { select: { id: true, nik: true, name: true, departmentId: true, department: { select: { id: true, name: true } } } },
  reportedBy: { select: { id: true, nik: true, name: true } },
  handledBy: { select: { id: true, nik: true, name: true } },
} satisfies Prisma.ComplaintOrDisciplinaryActionSelect;

type Aktor = { id: string; role: Role; departmentId: string | null };

/** Batasan "apa yang boleh dilihat", dipakai daftar dan detail agar tidak pernah beda. */
const lingkupLihat = (actor: Aktor): Prisma.ComplaintOrDisciplinaryActionWhereInput => {
  if (isHr(actor.role)) return {};

  if (actor.role === Role.MANAGER) {
    return {
      OR: [
        { reportedById: actor.id },
        { handledById: actor.id },
        {
          type: 'disciplinary_action',
          employee: { departmentId: actor.departmentId ?? '__tanpa_departemen__' },
        },
      ],
    };
  }

  return {
    OR: [
      { reportedById: actor.id },
      { type: 'disciplinary_action', employeeId: actor.id },
    ],
  };
};

/** Transisi status yang sah. Kasus yang sudah ditutup tidak dibuka lagi lewat
 *  jalur ini — buat kasus baru yang merujuk lamanya. */
const TRANSISI: Record<string, string[]> = {
  open: ['under_review', 'resolved', 'dismissed'],
  under_review: ['resolved', 'dismissed'],
  resolved: [],
  dismissed: [],
};

const paginasi = (page: number, limit: number, total: number) => ({
  page, limit, total, totalPages: Math.ceil(total / limit) || 1,
});

// ============ Membuat ============

export const createComplaint = async (req: Request, res: Response) => {
  const input = req.body as CreateComplaintInput;
  const actor = req.user!;
  const employeeId = input.employeeId ?? actor.id;

  if (employeeId !== actor.id) {
    const ada = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
    if (!ada) return res.status(404).json({ error: 'Karyawan yang dikeluhkan tidak ditemukan' });
  }

  const kasus = await prisma.complaintOrDisciplinaryAction.create({
    data: {
      id: generateULID(),
      employeeId,
      type: 'complaint',
      title: input.title,
      description: input.description,
      incidentDate: input.incidentDate,
      reportedById: actor.id,
    },
    select: caseSelect,
  });

  res.locals.audit = {
    action: 'discipline.complaint.create',
    entity: 'ComplaintOrDisciplinaryAction',
    entityId: kasus.id,
    summary: `Mengajukan keluhan: ${input.title}`,
    // Isi keluhan tidak disalin ke audit: bisa memuat nama orang dan
    // tuduhan yang belum terbukti.
    metadata: { employeeId, tentangDiriSendiri: employeeId === actor.id },
  };

  res.status(201).json(kasus);
};

export const createDisciplinaryAction = async (req: Request, res: Response) => {
  const input = req.body as CreateDisciplinaryInput;
  const actor = req.user!;

  const subjek = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, name: true, departmentId: true },
  });
  if (!subjek) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });

  if (actor.role === Role.MANAGER && subjek.departmentId !== actor.departmentId) {
    return res.status(403).json({ error: 'Manajer hanya bisa memberi tindakan disiplin di departemennya sendiri' });
  }
  if (subjek.id === actor.id) {
    return res.status(400).json({ error: 'Tidak bisa memberi tindakan disiplin pada diri sendiri' });
  }

  // SP3 tanpa SP1 dan SP2 yang masih berlaku adalah pelanggaran prosedur
  // yang membuat PHK-nya batal di pengadilan. Diperingatkan, tidak dilarang:
  // untuk pelanggaran berat, UU memang mengizinkan langsung.
  const spSebelumnya = await prisma.complaintOrDisciplinaryAction.count({
    where: { employeeId: subjek.id, type: 'disciplinary_action', severity: { in: ['sp1', 'sp2'] }, status: { not: 'dismissed' } },
  });
  const peringatan =
    input.severity === 'sp3' && spSebelumnya === 0
      ? 'SP3 diberikan tanpa SP1/SP2 sebelumnya. Pastikan ini pelanggaran berat yang dibenarkan UU 13/2003.'
      : undefined;

  const kasus = await prisma.complaintOrDisciplinaryAction.create({
    data: {
      id: generateULID(),
      employeeId: subjek.id,
      type: 'disciplinary_action',
      title: input.title,
      description: input.description,
      severity: input.severity,
      incidentDate: input.incidentDate,
      reportedById: actor.id,
    },
    select: caseSelect,
  });

  res.locals.audit = {
    action: 'discipline.action.create',
    entity: 'ComplaintOrDisciplinaryAction',
    entityId: kasus.id,
    summary: `Memberi ${input.severity.toUpperCase()} kepada ${subjek.name}: ${input.title}`,
    metadata: { employeeId: subjek.id, severity: input.severity, spSebelumnya },
  };

  res.status(201).json({ ...kasus, ...(peringatan ? { warning: peringatan } : {}) });
};

// ============ Membaca ============

export const listCases = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListCaseQuery;
  const actor = req.user!;

  const where: Prisma.ComplaintOrDisciplinaryActionWhereInput = {
    AND: [
      lingkupLihat(actor),
      {
        ...(query.type ? { type: query.type } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.severity ? { severity: query.severity } : {}),
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(query.departmentId ? { employee: { departmentId: query.departmentId } } : {}),
      },
    ],
  };

  const [total, data] = await Promise.all([
    prisma.complaintOrDisciplinaryAction.count({ where }),
    prisma.complaintOrDisciplinaryAction.findMany({
      where,
      select: caseSelect,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  res.json({ data, pagination: paginasi(query.page, query.limit, total) });
};

export const getCase = async (req: Request, res: Response) => {
  const actor = req.user!;

  const kasus = await prisma.complaintOrDisciplinaryAction.findFirst({
    where: { AND: [{ id: req.params.id }, lingkupLihat(actor)] },
    select: caseSelect,
  });
  // 404, bukan 403: keberadaan keluhan tentang seseorang tidak boleh bocor
  // lewat perbedaan kode status.
  if (!kasus) return res.status(404).json({ error: 'Kasus tidak ditemukan' });

  // Rekam disiplin adalah data pribadi; pembacaannya dicatat.
  res.locals.audit = {
    action: 'discipline.case.read',
    entity: 'ComplaintOrDisciplinaryAction',
    entityId: kasus.id,
    summary: `Membaca ${kasus.type === 'complaint' ? 'keluhan' : 'tindakan disiplin'} ${kasus.title}`,
  };

  res.json(kasus);
};

// ============ Menindaklanjuti ============

export const updateCaseStatus = async (req: Request, res: Response) => {
  const input = req.body as UpdateCaseStatusInput;
  const actor = req.user!;

  const kasus = await prisma.complaintOrDisciplinaryAction.findUnique({
    where: { id: req.params.id },
    select: { id: true, type: true, status: true, title: true, employeeId: true, employee: { select: { departmentId: true } } },
  });
  if (!kasus) return res.status(404).json({ error: 'Kasus tidak ditemukan' });

  // Manajer menangani tindakan disiplin di departemennya. Keluhan hanya HR:
  // keluhan bisa tentang manajer itu sendiri.
  if (actor.role === Role.MANAGER) {
    if (kasus.type === 'complaint' || kasus.employee.departmentId !== actor.departmentId) {
      return res.status(403).json({ error: 'Kasus ini hanya bisa ditindaklanjuti HR' });
    }
  }

  if (!TRANSISI[kasus.status].includes(input.status)) {
    return res.status(409).json({
      error: `Kasus berstatus "${kasus.status}" tidak bisa diubah menjadi "${input.status}"`,
    });
  }

  const selesai = input.status === 'resolved' || input.status === 'dismissed';
  const hasil = await prisma.complaintOrDisciplinaryAction.update({
    where: { id: kasus.id },
    data: {
      status: input.status,
      handledById: actor.id,
      ...(input.resolutionNotes !== undefined ? { resolutionNotes: input.resolutionNotes } : {}),
      ...(selesai ? { resolvedAt: new Date() } : {}),
    },
    select: caseSelect,
  });

  res.locals.audit = {
    action: 'discipline.case.status',
    entity: 'ComplaintOrDisciplinaryAction',
    entityId: kasus.id,
    summary: `${kasus.title}: ${kasus.status} → ${input.status}`,
    metadata: { statusSebelum: kasus.status, statusSesudah: input.status, type: kasus.type },
  };

  res.json(hasil);
};
