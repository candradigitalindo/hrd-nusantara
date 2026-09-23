// src/controllers/cbtAttemptController.ts
//
// Sisi peserta. Dua pintu masuk, satu alur:
//   - karyawan  : membawa JWT, penugasan dicari dari id + employeeId miliknya
//   - pelamar   : membawa token tautan, penugasan dicari dari sidik token
//
// Yang membedakan hanya cara menemukan penugasannya; sisanya dikerjakan
// services/cbt/attempt.ts supaya aturan ujian tidak pernah bercabang dua.
import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import { decodeBase64Image, InvalidImageError, saveImage } from '../utils/imageUpload';
import { encryptBytes } from '../utils/fieldCrypto';
import {
  GalatCbt,
  PenugasanLengkap,
  hashToken,
  kirimJawaban,
  mulaiAtauLanjutkan,
  penugasanLengkap,
  pengerjaanBerjalan,
  simpanJawaban,
} from '../services/cbt/attempt';
import type { ProctorEventInput, SaveAnswersInput } from '../schemas/cbtSchema';

const galat = (e: unknown, res: Response) => {
  if (e instanceof GalatCbt) return res.status(e.status).json({ error: e.message });
  throw e;
};

/** Penugasan milik karyawan yang sedang login. */
const punyaKaryawan = async (assignmentId: string, employeeId: string): Promise<PenugasanLengkap> => {
  const penugasan = await prisma.cbtAssignment.findUnique({ where: { id: assignmentId }, ...penugasanLengkap });
  // Penugasan milik orang lain dijawab "tidak ditemukan", bukan "tidak boleh":
  // keberadaan tes orang lain pun bukan urusan peserta ini.
  if (!penugasan || penugasan.employeeId !== employeeId) throw new GalatCbt(404, 'Tes tidak ditemukan');
  return penugasan;
};

/** Penugasan milik pemegang token tautan. */
const punyaToken = async (token: string): Promise<PenugasanLengkap> => {
  const penugasan = await prisma.cbtAssignment.findUnique({
    where: { accessTokenHash: hashToken(token) },
    ...penugasanLengkap,
  });
  if (!penugasan) throw new GalatCbt(404, 'Tautan tes tidak sah atau sudah diganti. Hubungi HR.');
  return penugasan;
};

// ============ Karyawan ============

/** Tes yang ditugaskan kepada saya. */
export const getMyAssignments = async (req: Request, res: Response) => {
  const data = await prisma.cbtAssignment.findMany({
    where: { employeeId: req.user!.id },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      status: true,
      note: true,
      availableFrom: true,
      availableUntil: true,
      createdAt: true,
      test: {
        select: {
          id: true,
          title: true,
          description: true,
          durationMinutes: true,
          passingScore: true,
          showResultToTaker: true,
          proctorPhotos: true,
          _count: { select: { questions: true } },
        },
      },
      attempt: {
        select: { id: true, startedAt: true, deadlineAt: true, submittedAt: true, percent: true, passed: true, gradedAt: true },
      },
    },
  });
  res.json({ data });
};

export const startMyAttempt = async (req: Request, res: Response) => {
  try {
    res.json(await mulaiAtauLanjutkan(await punyaKaryawan(req.params.id, req.user!.id)));
  } catch (e) {
    galat(e, res);
  }
};

export const saveMyAnswers = async (req: Request, res: Response) => {
  const { jawaban } = req.body as SaveAnswersInput;
  try {
    res.json(await simpanJawaban(await punyaKaryawan(req.params.id, req.user!.id), jawaban));
  } catch (e) {
    galat(e, res);
  }
};

export const submitMyAttempt = async (req: Request, res: Response) => {
  try {
    const penugasan = await punyaKaryawan(req.params.id, req.user!.id);
    const hasil = await kirimJawaban(penugasan);
    res.locals.audit = {
      action: 'cbt.kirim',
      entity: 'CbtAssignment',
      entityId: penugasan.id,
      summary: `Mengirim jawaban tes ${penugasan.test.title}`,
    };
    res.json(ringkasUntukPeserta(hasil, penugasan.test.showResultToTaker));
  } catch (e) {
    galat(e, res);
  }
};

export const recordMyEvent = async (req: Request, res: Response) => {
  try {
    await catatKejadian(await punyaKaryawan(req.params.id, req.user!.id), req.body as ProctorEventInput);
    res.status(204).send();
  } catch (e) {
    galat(e, res);
  }
};

export const saveMyPhoto = async (req: Request, res: Response) => {
  try {
    await simpanFoto(await punyaKaryawan(req.params.id, req.user!.id), (req.body as { image: string }).image);
    res.status(204).send();
  } catch (e) {
    if (e instanceof InvalidImageError) return res.status(400).json({ error: e.message });
    galat(e, res);
  }
};

/** Hasil untuk peserta sendiri — hanya bila paketnya mengizinkan. */
export const getMyResult = async (req: Request, res: Response) => {
  try {
    const penugasan = await punyaKaryawan(req.params.id, req.user!.id);
    const attempt = penugasan.attempt;
    if (!attempt?.submittedAt) return res.status(409).json({ error: 'Tes ini belum dikerjakan sampai selesai' });
    if (!penugasan.test.showResultToTaker) {
      return res.status(403).json({ error: 'Hasil tes ini hanya dibuka untuk HR' });
    }
    res.json({
      test: { title: penugasan.test.title, passingScore: penugasan.test.passingScore },
      submittedAt: attempt.submittedAt,
      menungguPenilaian: penugasan.status === 'submitted',
      nilai: penugasan.status === 'graded' ? { total: attempt.scoreTotal, maksimal: attempt.maxScore, persen: attempt.percent, lulus: attempt.passed } : null,
    });
  } catch (e) {
    galat(e, res);
  }
};

// ============ Pelamar (tautan bertoken) ============

/** Informasi ringkas sebelum tes dimulai — tanpa soal. */
export const publicInfo = async (req: Request, res: Response) => {
  try {
    const penugasan = await punyaToken(req.params.token);
    res.json({
      peserta: penugasan.candidate?.name ?? 'Peserta',
      status: penugasan.status,
      test: {
        title: penugasan.test.title,
        description: penugasan.test.description,
        durationMinutes: penugasan.test.durationMinutes,
        jumlahSoal: penugasan.test.questions.length,
        proctorPhotos: penugasan.test.proctorPhotos,
      },
      availableFrom: penugasan.availableFrom,
      availableUntil: penugasan.availableUntil,
      sudahDikirim: Boolean(penugasan.attempt?.submittedAt),
    });
  } catch (e) {
    galat(e, res);
  }
};

export const publicStart = async (req: Request, res: Response) => {
  try {
    res.json(await mulaiAtauLanjutkan(await punyaToken(req.params.token)));
  } catch (e) {
    galat(e, res);
  }
};

export const publicSaveAnswers = async (req: Request, res: Response) => {
  const { jawaban } = req.body as SaveAnswersInput;
  try {
    res.json(await simpanJawaban(await punyaToken(req.params.token), jawaban));
  } catch (e) {
    galat(e, res);
  }
};

export const publicSubmit = async (req: Request, res: Response) => {
  try {
    const penugasan = await punyaToken(req.params.token);
    const hasil = await kirimJawaban(penugasan);
    res.json(ringkasUntukPeserta(hasil, penugasan.test.showResultToTaker));
  } catch (e) {
    galat(e, res);
  }
};

export const publicEvent = async (req: Request, res: Response) => {
  try {
    await catatKejadian(await punyaToken(req.params.token), req.body as ProctorEventInput);
    res.status(204).send();
  } catch (e) {
    galat(e, res);
  }
};

export const publicPhoto = async (req: Request, res: Response) => {
  try {
    await simpanFoto(await punyaToken(req.params.token), (req.body as { image: string }).image);
    res.status(204).send();
  } catch (e) {
    if (e instanceof InvalidImageError) return res.status(400).json({ error: e.message });
    galat(e, res);
  }
};

/** Gambar soal untuk peserta bertoken; hanya soal milik paket yang dikerjakan. */
export const publicQuestionImage = async (req: Request, res: Response) => {
  try {
    const penugasan = await punyaToken(req.params.token);
    const butir = penugasan.test.questions.find((q) => q.questionId === req.params.questionId);
    if (!butir?.question.imagePath) return res.status(404).json({ error: 'Gambar tidak ditemukan' });
    const { kirimGambar } = await import('./cbtController');
    await kirimGambar(res, butir.question.imagePath, false);
  } catch (e) {
    galat(e, res);
  }
};

// ============ Bagian bersama ============

/**
 * Nilai hanya dikembalikan bila paket memang membukanya untuk peserta.
 * Untuk seleksi pelamar, mengetahui nilainya seketika sama saja membocorkan
 * ambang kelulusan perusahaan.
 */
const ringkasUntukPeserta = (
  hasil: { status: string; nilai: { total: number; maksimal: number; persen: number; lulus: boolean | null; menungguPenilaian: boolean } },
  boleh: boolean
) => ({
  status: hasil.status,
  menungguPenilaian: hasil.nilai.menungguPenilaian,
  nilai: boleh && !hasil.nilai.menungguPenilaian ? hasil.nilai : null,
});

const catatKejadian = async (penugasan: PenugasanLengkap, isi: ProctorEventInput) => {
  if (!penugasan.test.recordProctorEvents) return;
  const attempt = pengerjaanBerjalan(penugasan);
  await prisma.cbtProctorEvent.create({
    data: { id: generateULID(), attemptId: attempt.id, type: isi.type, detail: isi.detail ?? null },
  });
};

const simpanFoto = async (penugasan: PenugasanLengkap, image: string) => {
  if (!penugasan.test.proctorPhotos) throw new GalatCbt(409, 'Paket tes ini tidak memakai foto pengawasan');
  const attempt = pengerjaanBerjalan(penugasan);

  const { buffer, extension } = decodeBase64Image(image);
  // Wajah adalah data biometrik: disimpan terenkripsi, sama dengan embedding
  // wajah presensi. Berkas mentahnya tidak pernah ada di disk.
  const path = await saveImage(encryptBytes(buffer), extension, 'cbt-proktor');
  await prisma.cbtProctorPhoto.create({ data: { id: generateULID(), attemptId: attempt.id, storagePath: path } });
};
