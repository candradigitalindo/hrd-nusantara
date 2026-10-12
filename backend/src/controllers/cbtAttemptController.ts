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
  jenisPaketDari,
  kirimJawaban,
  mulaiAtauLanjutkan,
  penugasanLengkap,
  pengerjaanBerjalan,
  ringkasUntukPeserta,
  simpanJawaban,
  tutupPengerjaanKedaluwarsa,
} from '../services/cbt/attempt';
import { jenisPaket, type JenisPaket } from '../utils/cbt';
import type { ProctorEventInput, SaveAnswersInput, SubmitAttemptInput } from '../schemas/cbtSchema';

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
  // Pengerjaan saya yang ditinggalkan setelah batas waktu ditutup lebih dulu,
  // supaya daftar ini tidak memperlihatkan "sedang dikerjakan" yang abadi.
  await tutupPengerjaanKedaluwarsa({ assignment: { employeeId: req.user!.id } });

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
          questions: { select: { question: { select: { type: true } } } },
        },
      },
      attempt: {
        select: { id: true, startedAt: true, deadlineAt: true, submittedAt: true, percent: true, passed: true, gradedAt: true },
      },
    },
  });
  res.json({
    data: data.map(({ test, ...sisa }) => {
      const { questions, ...tes } = test;
      return { ...sisa, test: { ...tes, kind: jenisPaket(questions.map((q) => q.question.type)) } };
    }),
  });
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
  const { jawaban, otomatis } = (req.body ?? {}) as SubmitAttemptInput;
  try {
    const penugasan = await punyaKaryawan(req.params.id, req.user!.id);
    const hasil = await kirimJawaban(penugasan, { jawabanAkhir: jawaban, otomatis });
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
    const jenis = jenisPaketDari(penugasan);
    res.json({
      test: { title: penugasan.test.title, passingScore: jenis === 'kepribadian' ? null : penugasan.test.passingScore },
      jenis,
      submittedAt: attempt.submittedAt,
      menungguPenilaian: penugasan.status === 'submitted',
      // Inventori kepribadian tidak punya nilai atau kelulusan untuk dibuka.
      nilai:
        penugasan.status === 'graded' && jenis !== 'kepribadian'
          ? { total: attempt.scoreTotal, maksimal: attempt.maxScore, persen: attempt.percent, lulus: attempt.passed }
          : null,
    });
  } catch (e) {
    galat(e, res);
  }
};

// ============ Pelamar (tautan bertoken) ============

/** Informasi ringkas sebelum tes dimulai — tanpa soal. */
export const publicInfo = async (req: Request, res: Response) => {
  try {
    let penugasan = await punyaToken(req.params.token);
    // Pengerjaan yang ditinggalkan setelah batas waktu ditutup di sini, supaya
    // halaman tautan langsung berkata "sudah dikerjakan", bukan menawarkan
    // tombol Lanjutkan yang pasti ditolak. Tenggangnya sama dengan penyapu.
    if (penugasan.attempt && !penugasan.attempt.submittedAt) {
      const ditutup = await tutupPengerjaanKedaluwarsa({ id: penugasan.attempt.id });
      if (ditutup > 0) penugasan = await punyaToken(req.params.token);
    }
    res.json({
      peserta: penugasan.candidate?.name ?? 'Peserta',
      status: penugasan.status,
      test: {
        title: penugasan.test.title,
        description: penugasan.test.description,
        descriptionHtml: penugasan.test.descriptionHtml,
        durationMinutes: penugasan.test.durationMinutes,
        jumlahSoal: penugasan.test.questions.length,
        proctorPhotos: penugasan.test.proctorPhotos,
        kind: jenisPaketDari(penugasan),
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
  const { jawaban, otomatis } = (req.body ?? {}) as SubmitAttemptInput;
  try {
    const penugasan = await punyaToken(req.params.token);
    const hasil = await kirimJawaban(penugasan, { jawabanAkhir: jawaban, otomatis });
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
