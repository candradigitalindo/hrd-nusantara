// src/controllers/cbtController.ts
//
// Sisi pengelola CBT: bank soal, paket tes, penugasan, hasil, dan penilaian
// esai. Sisi peserta ada di cbtAttemptController.ts.
import fs from 'fs/promises';
import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import { pasanganTeks } from '../utils/richText';
import { decodeBase64Image, InvalidImageError, saveImage } from '../utils/imageUpload';
import { resolveDocumentPath } from '../utils/documentUpload';
import { decryptBytes } from '../utils/fieldCrypto';
import { bacaPilihan, dinilaiOtomatis } from '../utils/cbt';
import { GalatCbt, hashToken, hitungUlangNilai } from '../services/cbt/attempt';
import type {
  CreateAssignmentInput,
  CreateQuestionInput,
  CreateTestInput,
  GradeAttemptInput,
  ListAssignmentQuery,
  ListQuestionQuery,
  SetTestQuestionsInput,
  UpdateQuestionInput,
  UpdateTestInput,
} from '../schemas/cbtSchema';

// ============ Bank soal ============

const soalSelect = {
  id: true,
  category: true,
  difficulty: true,
  type: true,
  text: true,
  textHtml: true,
  imagePath: true,
  options: true,
  answerKey: true,
  rubric: true,
  points: true,
  explanation: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
  _count: { select: { tests: true, answers: true } },
} satisfies Prisma.CbtQuestionSelect;

const simpanGambar = async (image: string | null | undefined): Promise<string | null | undefined> => {
  if (image === undefined) return undefined;
  if (image === null || image === '') return null;
  const { buffer, extension } = decodeBase64Image(image);
  return saveImage(buffer, extension, 'cbt-soal');
};

export const getQuestions = async (req: Request, res: Response) => {
  const { page, limit, category, type, difficulty, search, includeInactive } =
    req.query as unknown as ListQuestionQuery;

  const where: Prisma.CbtQuestionWhereInput = {};
  if (!includeInactive) where.isActive = true;
  if (category) where.category = category;
  if (type) where.type = type;
  if (difficulty) where.difficulty = difficulty;
  if (search) where.text = { contains: search, mode: 'insensitive' };

  const [total, data] = await Promise.all([
    prisma.cbtQuestion.count({ where }),
    prisma.cbtQuestion.findMany({
      where,
      select: soalSelect,
      orderBy: [{ category: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } });
};

/** Kategori yang sudah dipakai, untuk saringan dan penyusunan paket. */
export const getQuestionCategories = async (_req: Request, res: Response) => {
  const kategori = await prisma.cbtQuestion.groupBy({
    by: ['category'],
    where: { isActive: true },
    _count: { _all: true },
    orderBy: { category: 'asc' },
  });
  res.json({ data: kategori.map((k) => ({ category: k.category, jumlah: k._count._all })) });
};

export const createQuestion = async (req: Request, res: Response) => {
  const input = req.body as CreateQuestionInput;
  const aktor = req.user!;

  const isiSoal = pasanganTeks(input.textHtml, input.text);
  if (!isiSoal || isiSoal.teks.trim().length < 3) return res.status(400).json({ error: 'Pertanyaan wajib diisi' });

  let imagePath: string | null | undefined;
  try {
    imagePath = await simpanGambar(input.image);
  } catch (e) {
    if (e instanceof InvalidImageError) return res.status(400).json({ error: e.message });
    throw e;
  }

  const soal = await prisma.cbtQuestion.create({
    data: {
      id: generateULID(),
      category: input.category,
      difficulty: input.difficulty,
      type: input.type,
      text: isiSoal.teks,
      textHtml: isiSoal.html,
      imagePath: imagePath ?? null,
      options: input.options ? (input.options as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      answerKey: input.answerKey,
      rubric: input.rubric ?? null,
      points: input.points,
      explanation: input.explanation ?? null,
      isActive: input.isActive,
      createdById: aktor.id,
    },
    select: soalSelect,
  });

  res.locals.audit = {
    action: 'cbt.soal.buat',
    entity: 'CbtQuestion',
    entityId: soal.id,
    summary: `Menambah soal ${soal.category} (${soal.type})`,
  };
  res.status(201).json(soal);
};

export const updateQuestion = async (req: Request, res: Response) => {
  const input = req.body as UpdateQuestionInput;

  const lama = await prisma.cbtQuestion.findUnique({ where: { id: req.params.id }, select: soalSelect });
  if (!lama) return res.status(404).json({ error: 'Soal tidak ditemukan' });

  // Soal yang sudah pernah dijawab tidak boleh berubah bentuk atau kuncinya:
  // hasil yang sudah keluar dihitung dengan kunci lama, dan mengubahnya
  // membuat nilai lama tidak bisa dipertanggungjawabkan. Nonaktifkan lalu
  // buat versi baru.
  const menyentuhPenilaian =
    input.type !== undefined || input.answerKey !== undefined || input.options !== undefined || input.points !== undefined;
  if (lama._count.answers > 0 && menyentuhPenilaian) {
    return res.status(409).json({
      error: `Soal ini sudah dijawab ${lama._count.answers} kali. Kunci, pilihan, tipe, dan bobotnya tidak bisa diubah — nonaktifkan soal ini lalu buat versi barunya.`,
    });
  }

  let imagePath: string | null | undefined;
  try {
    imagePath = await simpanGambar(input.image);
  } catch (e) {
    if (e instanceof InvalidImageError) return res.status(400).json({ error: e.message });
    throw e;
  }

  const data: Prisma.CbtQuestionUpdateInput = {};
  if (input.category !== undefined) data.category = input.category;
  if (input.difficulty !== undefined) data.difficulty = input.difficulty;
  if (input.type !== undefined) data.type = input.type;
  const isiSoal = pasanganTeks(input.textHtml, input.text);
  if (isiSoal) {
    data.text = isiSoal.teks;
    data.textHtml = isiSoal.html;
  }
  if (imagePath !== undefined) data.imagePath = imagePath;
  if (input.options !== undefined) data.options = input.options as unknown as Prisma.InputJsonValue;
  if (input.answerKey !== undefined) data.answerKey = input.answerKey;
  if (input.rubric !== undefined) data.rubric = input.rubric;
  if (input.points !== undefined) data.points = input.points;
  if (input.explanation !== undefined) data.explanation = input.explanation;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  const soal = await prisma.cbtQuestion.update({ where: { id: req.params.id }, data, select: soalSelect });

  res.locals.audit = {
    action: 'cbt.soal.ubah',
    entity: 'CbtQuestion',
    entityId: soal.id,
    summary: `Mengubah soal ${soal.category}`,
    metadata: { fieldBerubah: Object.keys(input) },
  };
  res.json(soal);
};

export const deleteQuestion = async (req: Request, res: Response) => {
  const soal = await prisma.cbtQuestion.findUnique({ where: { id: req.params.id }, select: soalSelect });
  if (!soal) return res.status(404).json({ error: 'Soal tidak ditemukan' });

  // Soal yang pernah dijawab adalah bagian dari hasil yang sudah terbit:
  // dinonaktifkan supaya tidak terpakai lagi, tapi barisnya tetap ada.
  if (soal._count.answers > 0 || soal._count.tests > 0) {
    await prisma.cbtQuestion.update({ where: { id: soal.id }, data: { isActive: false } });
    res.locals.audit = {
      action: 'cbt.soal.nonaktif',
      entity: 'CbtQuestion',
      entityId: soal.id,
      summary: `Menonaktifkan soal ${soal.category} (sudah dipakai)`,
    };
    return res.json({ message: 'Soal dinonaktifkan karena sudah dipakai paket atau sudah pernah dijawab', question: { ...soal, isActive: false } });
  }

  await prisma.cbtQuestion.delete({ where: { id: soal.id } });
  res.locals.audit = {
    action: 'cbt.soal.hapus',
    entity: 'CbtQuestion',
    entityId: soal.id,
    summary: `Menghapus soal ${soal.category}`,
  };
  res.status(204).send();
};

/** Gambar soal. Dipakai pengelola maupun peserta, jadi izinnya cukup cbt.lihat. */
export const getQuestionImage = async (req: Request, res: Response) => {
  const soal = await prisma.cbtQuestion.findUnique({ where: { id: req.params.id }, select: { imagePath: true } });
  if (!soal?.imagePath) return res.status(404).json({ error: 'Soal ini tidak punya gambar' });
  await kirimGambar(res, soal.imagePath, false);
};

/** Mengirim berkas gambar dari UPLOAD_DIR, dengan atau tanpa lapisan enkripsi. */
export const kirimGambar = async (res: Response, storagePath: string, terenkripsi: boolean) => {
  let isi: Buffer;
  try {
    isi = await fs.readFile(resolveDocumentPath(storagePath));
  } catch {
    return res.status(500).json({ error: 'Berkas gambar tidak ditemukan di penyimpanan. Hubungi administrator.' });
  }
  const data = terenkripsi ? decryptBytes(isi) : isi;
  res.setHeader('Content-Type', storagePath.endsWith('.png') ? 'image/png' : storagePath.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(data);
};

// ============ Paket tes ============

const paketSelect = {
  id: true,
  code: true,
  title: true,
  description: true,
  descriptionHtml: true,
  audience: true,
  durationMinutes: true,
  passingScore: true,
  shuffleQuestions: true,
  shuffleOptions: true,
  showResultToTaker: true,
  recordProctorEvents: true,
  proctorPhotos: true,
  proctorPhotoIntervalSec: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
  _count: { select: { questions: true, assignments: true } },
} satisfies Prisma.CbtTestSelect;

export const getTests = async (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const data = await prisma.cbtTest.findMany({
    where: status ? { status } : {},
    select: paketSelect,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });
  res.json({ data });
};

export const getTestById = async (req: Request, res: Response) => {
  const paket = await prisma.cbtTest.findUnique({
    where: { id: req.params.id },
    select: {
      ...paketSelect,
      questions: {
        orderBy: { sortOrder: 'asc' },
        select: {
          sortOrder: true,
          points: true,
          question: { select: soalSelect },
        },
      },
    },
  });
  if (!paket) return res.status(404).json({ error: 'Paket tes tidak ditemukan' });

  const totalPoin = paket.questions.reduce((n, q) => n + (q.points ?? q.question.points), 0);
  res.json({ ...paket, totalPoin });
};

export const createTest = async (req: Request, res: Response) => {
  const input = req.body as CreateTestInput;
  try {
    const paket = await prisma.cbtTest.create({
      data: {
        id: generateULID(),
        code: input.code,
        title: input.title,
        description: pasanganTeks(input.descriptionHtml, input.description)?.teks ?? input.description ?? null,
        descriptionHtml: pasanganTeks(input.descriptionHtml, input.description)?.html ?? null,
        audience: input.audience,
        durationMinutes: input.durationMinutes,
        passingScore: input.passingScore ?? null,
        shuffleQuestions: input.shuffleQuestions,
        shuffleOptions: input.shuffleOptions,
        showResultToTaker: input.showResultToTaker,
        recordProctorEvents: input.recordProctorEvents,
        proctorPhotos: input.proctorPhotos,
        proctorPhotoIntervalSec: input.proctorPhotoIntervalSec,
        createdById: req.user!.id,
      },
      select: paketSelect,
    });
    res.locals.audit = { action: 'cbt.tes.buat', entity: 'CbtTest', entityId: paket.id, summary: `Membuat paket tes ${paket.title}` };
    res.status(201).json(paket);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'Kode paket tes sudah dipakai' });
    }
    throw error;
  }
};

export const updateTest = async (req: Request, res: Response) => {
  const input = req.body as UpdateTestInput;

  const lama = await prisma.cbtTest.findUnique({ where: { id: req.params.id }, select: paketSelect });
  if (!lama) return res.status(404).json({ error: 'Paket tes tidak ditemukan' });

  // Aturan main yang berubah di tengah jalan akan membuat dua peserta
  // dinilai dengan ukuran berbeda pada tes yang sama.
  const menyentuhAturan =
    input.durationMinutes !== undefined || input.passingScore !== undefined || input.shuffleQuestions !== undefined;
  if (lama._count.assignments > 0 && menyentuhAturan) {
    return res.status(409).json({
      error: 'Paket ini sudah ditugaskan. Durasi, ambang lulus, dan pengacakan tidak bisa diubah lagi — arsipkan lalu buat paket baru.',
    });
  }
  if (input.status === 'published' && lama._count.questions === 0) {
    return res.status(409).json({ error: 'Paket tanpa soal tidak bisa ditayangkan' });
  }

  try {
    const paket = await prisma.cbtTest.update({
      where: { id: req.params.id },
      data: {
        ...(input.code !== undefined && { code: input.code }),
        ...(input.title !== undefined && { title: input.title }),
        ...(() => {
          const isi = pasanganTeks(input.descriptionHtml, input.description);
          return isi ? { description: isi.teks, descriptionHtml: isi.html } : {};
        })(),
        ...(input.audience !== undefined && { audience: input.audience }),
        ...(input.durationMinutes !== undefined && { durationMinutes: input.durationMinutes }),
        ...(input.passingScore !== undefined && { passingScore: input.passingScore }),
        ...(input.shuffleQuestions !== undefined && { shuffleQuestions: input.shuffleQuestions }),
        ...(input.shuffleOptions !== undefined && { shuffleOptions: input.shuffleOptions }),
        ...(input.showResultToTaker !== undefined && { showResultToTaker: input.showResultToTaker }),
        ...(input.recordProctorEvents !== undefined && { recordProctorEvents: input.recordProctorEvents }),
        ...(input.proctorPhotos !== undefined && { proctorPhotos: input.proctorPhotos }),
        ...(input.proctorPhotoIntervalSec !== undefined && { proctorPhotoIntervalSec: input.proctorPhotoIntervalSec }),
        ...(input.status !== undefined && { status: input.status }),
      },
      select: paketSelect,
    });
    res.locals.audit = {
      action: 'cbt.tes.ubah',
      entity: 'CbtTest',
      entityId: paket.id,
      summary: `Mengubah paket tes ${paket.title}${input.status ? ` (status ${lama.status} → ${paket.status})` : ''}`,
      metadata: { fieldBerubah: Object.keys(input) },
    };
    res.json(paket);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'Kode paket tes sudah dipakai' });
    }
    throw error;
  }
};

export const deleteTest = async (req: Request, res: Response) => {
  const paket = await prisma.cbtTest.findUnique({ where: { id: req.params.id }, select: paketSelect });
  if (!paket) return res.status(404).json({ error: 'Paket tes tidak ditemukan' });
  if (paket._count.assignments > 0) {
    return res.status(409).json({ error: 'Paket yang sudah ditugaskan tidak bisa dihapus. Arsipkan saja supaya hasilnya tetap bisa dibuka.' });
  }

  await prisma.$transaction([
    prisma.cbtTestQuestion.deleteMany({ where: { testId: paket.id } }),
    prisma.cbtTest.delete({ where: { id: paket.id } }),
  ]);
  res.locals.audit = { action: 'cbt.tes.hapus', entity: 'CbtTest', entityId: paket.id, summary: `Menghapus paket tes ${paket.title}` };
  res.status(204).send();
};

/** Mengganti seluruh isi paket sekaligus; urutan mengikuti urutan kiriman. */
export const setTestQuestions = async (req: Request, res: Response) => {
  const { questions } = req.body as SetTestQuestionsInput;

  const paket = await prisma.cbtTest.findUnique({ where: { id: req.params.id }, select: paketSelect });
  if (!paket) return res.status(404).json({ error: 'Paket tes tidak ditemukan' });
  if (paket._count.assignments > 0) {
    return res.status(409).json({ error: 'Isi paket tidak bisa diubah setelah ditugaskan. Arsipkan lalu buat paket baru.' });
  }

  const id = questions.map((q) => q.questionId);
  if (new Set(id).size !== id.length) return res.status(400).json({ error: 'Ada soal yang dimasukkan dua kali' });

  const ada = await prisma.cbtQuestion.findMany({ where: { id: { in: id } }, select: { id: true, isActive: true } });
  if (ada.length !== id.length) return res.status(400).json({ error: 'Ada soal yang tidak ditemukan' });
  const nonaktif = ada.filter((s) => !s.isActive);
  if (nonaktif.length > 0) return res.status(400).json({ error: 'Soal nonaktif tidak bisa dimasukkan ke paket' });

  await prisma.$transaction([
    prisma.cbtTestQuestion.deleteMany({ where: { testId: paket.id } }),
    prisma.cbtTestQuestion.createMany({
      data: questions.map((q, i) => ({
        id: generateULID(),
        testId: paket.id,
        questionId: q.questionId,
        sortOrder: i,
        points: q.points ?? null,
      })),
    }),
  ]);

  res.locals.audit = {
    action: 'cbt.tes.soal',
    entity: 'CbtTest',
    entityId: paket.id,
    summary: `Menyusun ${questions.length} soal pada paket ${paket.title}`,
  };
  res.json({ message: `${questions.length} soal tersimpan di paket ${paket.title}` });
};

// ============ Penugasan ============

const penugasanSelect = {
  id: true,
  testId: true,
  status: true,
  note: true,
  availableFrom: true,
  availableUntil: true,
  createdAt: true,
  test: { select: { id: true, code: true, title: true, durationMinutes: true, passingScore: true } },
  employee: { select: { id: true, name: true, nik: true } },
  candidate: { select: { id: true, name: true, email: true } },
  assignedBy: { select: { id: true, name: true } },
  attempt: {
    select: {
      id: true,
      startedAt: true,
      submittedAt: true,
      autoSubmitted: true,
      scoreTotal: true,
      maxScore: true,
      percent: true,
      passed: true,
      gradedAt: true,
      _count: { select: { events: true, photos: true } },
    },
  },
} satisfies Prisma.CbtAssignmentSelect;

export const getAssignments = async (req: Request, res: Response) => {
  const { page, limit, testId, employeeId, candidateId, status } = req.query as unknown as ListAssignmentQuery;
  const where: Prisma.CbtAssignmentWhereInput = {
    ...(testId && { testId }),
    ...(employeeId && { employeeId }),
    ...(candidateId && { candidateId }),
    ...(status && { status }),
  };

  const [total, data] = await Promise.all([
    prisma.cbtAssignment.count({ where }),
    prisma.cbtAssignment.findMany({
      where,
      select: penugasanSelect,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } });
};

/** Token tautan ujian: 32 byte acak, base64url — 43 karakter. */
const buatToken = () => randomBytes(32).toString('base64url');

export const createAssignments = async (req: Request, res: Response) => {
  const input = req.body as CreateAssignmentInput;
  const aktor = req.user!;

  const paket = await prisma.cbtTest.findUnique({ where: { id: input.testId }, select: paketSelect });
  if (!paket) return res.status(404).json({ error: 'Paket tes tidak ditemukan' });
  if (paket.status !== 'published') return res.status(409).json({ error: 'Hanya paket yang sudah ditayangkan yang bisa ditugaskan' });
  if (paket._count.questions === 0) return res.status(409).json({ error: 'Paket ini belum punya soal' });
  if (input.employeeIds.length > 0 && paket.audience === 'pelamar') {
    return res.status(400).json({ error: 'Paket ini hanya untuk pelamar' });
  }
  if (input.candidateIds.length > 0 && paket.audience === 'karyawan') {
    return res.status(400).json({ error: 'Paket ini hanya untuk karyawan' });
  }

  const [karyawan, pelamar] = await Promise.all([
    prisma.employee.findMany({ where: { id: { in: input.employeeIds } }, select: { id: true, name: true } }),
    prisma.candidate.findMany({ where: { id: { in: input.candidateIds } }, select: { id: true, name: true } }),
  ]);
  if (karyawan.length !== input.employeeIds.length) return res.status(400).json({ error: 'Ada karyawan yang tidak ditemukan' });
  if (pelamar.length !== input.candidateIds.length) return res.status(400).json({ error: 'Ada pelamar yang tidak ditemukan' });

  // Penugasan ganda pada paket yang sama hanya menimbulkan kebingungan
  // "yang mana yang harus dikerjakan"; ujian ulang diberikan setelah yang
  // lama selesai, bukan berbarengan.
  const sudahAda = await prisma.cbtAssignment.findMany({
    where: {
      testId: paket.id,
      status: { in: ['assigned', 'in_progress'] },
      OR: [{ employeeId: { in: input.employeeIds } }, { candidateId: { in: input.candidateIds } }],
    },
    select: { employeeId: true, candidateId: true },
  });
  const lewatiKaryawan = new Set(sudahAda.map((a) => a.employeeId).filter(Boolean) as string[]);
  const lewatiPelamar = new Set(sudahAda.map((a) => a.candidateId).filter(Boolean) as string[]);

  const tautan: { assignmentId: string; nama: string; token: string }[] = [];
  const dibuat: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const k of karyawan) {
      if (lewatiKaryawan.has(k.id)) continue;
      const a = await tx.cbtAssignment.create({
        data: {
          id: generateULID(),
          testId: paket.id,
          employeeId: k.id,
          availableFrom: input.availableFrom ?? null,
          availableUntil: input.availableUntil ?? null,
          note: input.note ?? null,
          assignedById: aktor.id,
        },
        select: { id: true },
      });
      dibuat.push(a.id);
    }
    for (const p of pelamar) {
      if (lewatiPelamar.has(p.id)) continue;
      // Pelamar belum punya akun: tautan bertoken adalah kunci masuknya.
      // Yang disimpan hanya sidik SHA-256-nya, seperti kata sandi.
      const token = buatToken();
      const a = await tx.cbtAssignment.create({
        data: {
          id: generateULID(),
          testId: paket.id,
          candidateId: p.id,
          accessTokenHash: hashToken(token),
          availableFrom: input.availableFrom ?? null,
          availableUntil: input.availableUntil ?? null,
          note: input.note ?? null,
          assignedById: aktor.id,
        },
        select: { id: true },
      });
      dibuat.push(a.id);
      tautan.push({ assignmentId: a.id, nama: p.name, token });
    }
  });

  res.locals.audit = {
    action: 'cbt.tugaskan',
    entity: 'CbtTest',
    entityId: paket.id,
    summary: `Menugaskan tes ${paket.title} ke ${dibuat.length} peserta`,
    metadata: { karyawan: karyawan.length - lewatiKaryawan.size, pelamar: pelamar.length - lewatiPelamar.size },
  };

  res.status(201).json({
    dibuat: dibuat.length,
    dilewati: lewatiKaryawan.size + lewatiPelamar.size,
    // Token hanya muncul SEKALI di sini; setelah ini hanya sidiknya yang tersimpan.
    tautan,
  });
};

/** Membuat ulang tautan pelamar, mis. karena tautan lama hilang atau bocor. */
export const regenerateAssignmentToken = async (req: Request, res: Response) => {
  const penugasan = await prisma.cbtAssignment.findUnique({
    where: { id: req.params.id },
    select: { id: true, candidateId: true, status: true, candidate: { select: { name: true } } },
  });
  if (!penugasan) return res.status(404).json({ error: 'Penugasan tidak ditemukan' });
  if (!penugasan.candidateId) return res.status(400).json({ error: 'Tautan hanya untuk peserta pelamar; karyawan masuk lewat akunnya' });
  if (penugasan.status === 'submitted' || penugasan.status === 'graded') {
    return res.status(409).json({ error: 'Tes ini sudah dikerjakan' });
  }

  const token = buatToken();
  await prisma.cbtAssignment.update({ where: { id: penugasan.id }, data: { accessTokenHash: hashToken(token) } });

  res.locals.audit = {
    action: 'cbt.tautan',
    entity: 'CbtAssignment',
    entityId: penugasan.id,
    summary: `Membuat ulang tautan tes untuk ${penugasan.candidate?.name ?? 'pelamar'}`,
  };
  res.json({ assignmentId: penugasan.id, token });
};

export const deleteAssignment = async (req: Request, res: Response) => {
  const penugasan = await prisma.cbtAssignment.findUnique({
    where: { id: req.params.id },
    select: { id: true, status: true, test: { select: { title: true } } },
  });
  if (!penugasan) return res.status(404).json({ error: 'Penugasan tidak ditemukan' });
  if (penugasan.status !== 'assigned') {
    return res.status(409).json({ error: 'Penugasan yang sudah dikerjakan tidak bisa dibatalkan; hasilnya bagian dari riwayat.' });
  }

  await prisma.cbtAssignment.delete({ where: { id: penugasan.id } });
  res.locals.audit = {
    action: 'cbt.tugaskan.batal',
    entity: 'CbtAssignment',
    entityId: penugasan.id,
    summary: `Membatalkan penugasan tes ${penugasan.test.title}`,
  };
  res.status(204).send();
};

// ============ Hasil & penilaian ============

export const getResults = async (req: Request, res: Response) => {
  const { page, limit, testId, employeeId, candidateId, status } = req.query as unknown as ListAssignmentQuery;
  const where: Prisma.CbtAssignmentWhereInput = {
    status: status ?? { in: ['submitted', 'graded'] },
    ...(testId && { testId }),
    ...(employeeId && { employeeId }),
    ...(candidateId && { candidateId }),
  };

  const [total, data] = await Promise.all([
    prisma.cbtAssignment.count({ where }),
    prisma.cbtAssignment.findMany({
      where,
      select: penugasanSelect,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } });
};

export const getResultDetail = async (req: Request, res: Response) => {
  const attempt = await prisma.cbtAttempt.findUnique({
    where: { id: req.params.id },
    include: {
      assignment: { select: penugasanSelect },
      answers: true,
      events: { orderBy: { at: 'asc' } },
      photos: { orderBy: { takenAt: 'asc' }, select: { id: true, takenAt: true } },
      gradedBy: { select: { id: true, name: true } },
    },
  });
  if (!attempt) return res.status(404).json({ error: 'Hasil tidak ditemukan' });

  const paket = await prisma.cbtTest.findUniqueOrThrow({
    where: { id: attempt.assignment.testId },
    include: { questions: { include: { question: true }, orderBy: { sortOrder: 'asc' } } },
  });

  const jawaban = new Map(attempt.answers.map((j) => [j.questionId, j]));
  const butir = paket.questions.map((b) => {
    const j = jawaban.get(b.questionId);
    return {
      questionId: b.questionId,
      type: b.question.type,
      category: b.question.category,
      text: b.question.text,
      textHtml: b.question.textHtml,
      imagePath: b.question.imagePath,
      options: bacaPilihan(b.question.options),
      answerKey: b.question.answerKey,
      rubric: b.question.rubric,
      explanation: b.question.explanation,
      maxPoints: b.points ?? b.question.points,
      otomatis: dinilaiOtomatis(b.question.type),
      chosen: j?.chosen ?? [],
      answerText: j?.text ?? null,
      isCorrect: j?.isCorrect ?? null,
      points: j?.points ?? null,
      graderNote: j?.graderNote ?? null,
    };
  });

  // Rincian per kategori menjawab pertanyaan yang sebenarnya ditanyakan HR:
  // lemahnya di mana, bukan sekadar berapa nilainya.
  const perKategori = [...new Set(butir.map((b) => b.category))].map((kategori) => {
    const isi = butir.filter((b) => b.category === kategori);
    const maks = isi.reduce((n, b) => n + b.maxPoints, 0);
    const dapat = isi.reduce((n, b) => n + (b.points ?? 0), 0);
    return { kategori, maksimal: maks, diperoleh: Math.round(dapat * 100) / 100, persen: maks > 0 ? Math.round((dapat / maks) * 10000) / 100 : 0 };
  });

  res.json({ attempt: { ...attempt, answers: undefined }, butir, perKategori });
};

export const gradeAttempt = async (req: Request, res: Response) => {
  const { scores } = req.body as GradeAttemptInput;
  const aktor = req.user!;

  const attempt = await prisma.cbtAttempt.findUnique({
    where: { id: req.params.id },
    include: {
      answers: true,
      assignment: { include: { test: { include: { questions: { include: { question: true } } } } } },
    },
  });
  if (!attempt) return res.status(404).json({ error: 'Hasil tidak ditemukan' });
  if (!attempt.submittedAt) return res.status(409).json({ error: 'Tes ini belum dikirim peserta' });

  const butir = new Map(attempt.assignment.test.questions.map((b) => [b.questionId, b]));
  for (const nilai of scores) {
    const b = butir.get(nilai.questionId);
    if (!b) return res.status(400).json({ error: 'Ada soal yang bukan bagian dari tes ini' });
    if (dinilaiOtomatis(b.question.type)) {
      return res.status(400).json({ error: 'Soal objektif dinilai otomatis dan tidak bisa dinilai manual' });
    }
    const maks = b.points ?? b.question.points;
    if (nilai.points > maks) return res.status(400).json({ error: `Nilai melebihi bobot soal (maksimal ${maks})` });
  }

  await prisma.$transaction(
    scores.map((n) =>
      prisma.cbtAnswer.upsert({
        where: { attemptId_questionId: { attemptId: attempt.id, questionId: n.questionId } },
        create: {
          id: generateULID(),
          attemptId: attempt.id,
          questionId: n.questionId,
          chosen: [],
          points: n.points,
          isCorrect: null,
          graderNote: n.graderNote ?? null,
        },
        update: { points: n.points, graderNote: n.graderNote ?? null },
      })
    )
  );

  const hasil = await hitungUlangNilai(attempt.id, aktor.id);

  res.locals.audit = {
    action: 'cbt.nilai',
    entity: 'CbtAttempt',
    entityId: attempt.id,
    summary: `Menilai ${scores.length} jawaban esai (nilai akhir ${hasil.nilai.total}/${hasil.nilai.maksimal})`,
  };
  res.json(hasil);
};

/** Bukti pengawasan. Berkasnya terenkripsi di penyimpanan. */
export const getProctorPhoto = async (req: Request, res: Response) => {
  const foto = await prisma.cbtProctorPhoto.findUnique({
    where: { id: req.params.photoId },
    select: { id: true, attemptId: true, storagePath: true },
  });
  if (!foto || foto.attemptId !== req.params.id) return res.status(404).json({ error: 'Foto tidak ditemukan' });

  // Membuka wajah orang adalah akses ke data pribadi: dicatat walau ini GET.
  res.locals.audit = {
    action: 'cbt.bukti.lihat',
    entity: 'CbtAttempt',
    entityId: foto.attemptId,
    summary: 'Membuka foto pengawasan ujian',
  };
  await kirimGambar(res, foto.storagePath, true);
};

export const tanganiGalatCbt = (e: unknown, res: Response): boolean => {
  if (e instanceof GalatCbt) {
    res.status(e.status).json({ error: e.message });
    return true;
  }
  return false;
};
