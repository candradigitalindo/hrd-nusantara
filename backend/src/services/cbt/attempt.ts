// src/services/cbt/attempt.ts
//
// Alur pengerjaan satu tes, dipakai dua pintu masuk sekaligus: karyawan yang
// membawa JWT dan pelamar yang membawa token tautan. Keduanya mendarat pada
// objek penugasan yang sama, jadi aturan mainnya hanya ditulis sekali di sini.
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { generateULID } from '../../utils/generateULID';
import { acak, bacaPilihan, dinilaiOtomatis, hitungNilai, nilaiButir, sisaDetik } from '../../utils/cbt';

/** Penugasan beserta paket dan soalnya — bentuk yang dibutuhkan seluruh alur. */
export const penugasanLengkap = {
  include: {
    test: { include: { questions: { include: { question: true }, orderBy: { sortOrder: 'asc' } } } },
    attempt: { include: { answers: true } },
    employee: { select: { id: true, name: true, nik: true } },
    candidate: { select: { id: true, name: true, email: true } },
  },
} satisfies Prisma.CbtAssignmentDefaultArgs;

export type PenugasanLengkap = Prisma.CbtAssignmentGetPayload<typeof penugasanLengkap>;

export class GalatCbt extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'GalatCbt';
  }
}

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * Pengacakan pilihan yang stabil: benih diturunkan dari id pengerjaan dan id
 * soal, jadi urutannya sama setiap kali halaman dimuat ulang tanpa perlu
 * disimpan. Kalau urutannya berubah di tengah jalan, jawaban yang sudah
 * dipilih peserta akan tampak berpindah.
 */
const rngTerbenih = (benih: string): (() => number) => {
  let x = createHash('sha256').update(benih).digest().readUInt32BE(0) || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x100000000;
  };
};

/** Bobot butir di paket ini: bobot khusus paket menang atas bobot bawaan soal. */
const bobot = (butir: { points: number | null; question: { points: number } }) => butir.points ?? butir.question.points;

const dalamJendela = (p: PenugasanLengkap, sekarang: Date) => {
  if (p.availableFrom && sekarang < p.availableFrom) return 'belum_mulai' as const;
  if (p.availableUntil && sekarang > p.availableUntil) return 'kedaluwarsa' as const;
  return 'boleh' as const;
};

/**
 * Bentuk soal yang dikirim ke peserta. Kunci jawaban, rubrik, dan pembahasan
 * TIDAK pernah ikut: satu-satunya cara mencegahnya bocor lewat alat pengembang
 * peramban adalah tidak mengirimkannya sama sekali.
 */
const soalUntukPeserta = (
  butir: PenugasanLengkap['test']['questions'][number],
  attemptId: string,
  acakPilihan: boolean
) => {
  const pilihan = bacaPilihan(butir.question.options);
  return {
    id: butir.questionId,
    type: butir.question.type,
    category: butir.question.category,
    text: butir.question.text,
    imagePath: butir.question.imagePath,
    points: bobot(butir),
    options: acakPilihan ? acak(pilihan, rngTerbenih(attemptId + butir.questionId)) : pilihan,
  };
};

export interface PaketPengerjaan {
  assignmentId: string;
  attemptId: string;
  test: {
    id: string;
    title: string;
    description: string | null;
    durationMinutes: number;
    recordProctorEvents: boolean;
    proctorPhotos: boolean;
    proctorPhotoIntervalSec: number;
  };
  peserta: { nama: string; jenis: 'karyawan' | 'pelamar' };
  deadlineAt: string;
  sisaDetik: number;
  questions: ReturnType<typeof soalUntukPeserta>[];
  answers: { questionId: string; chosen: string[]; text: string | null }[];
  submittedAt: string | null;
}

/** Memulai pengerjaan, atau melanjutkan yang sudah berjalan. */
export const mulaiAtauLanjutkan = async (penugasan: PenugasanLengkap): Promise<PaketPengerjaan> => {
  const sekarang = new Date();

  if (penugasan.attempt?.submittedAt) {
    throw new GalatCbt(409, 'Tes ini sudah dikirim dan tidak bisa dibuka lagi.');
  }
  const jendela = dalamJendela(penugasan, sekarang);
  if (jendela === 'belum_mulai') {
    throw new GalatCbt(403, `Tes baru bisa dikerjakan mulai ${penugasan.availableFrom!.toISOString()}`);
  }
  if (jendela === 'kedaluwarsa' && !penugasan.attempt) {
    await prisma.cbtAssignment.update({ where: { id: penugasan.id }, data: { status: 'expired' } });
    throw new GalatCbt(403, 'Masa pengerjaan tes ini sudah lewat.');
  }
  if (penugasan.test.questions.length === 0) {
    throw new GalatCbt(409, 'Paket tes ini belum punya soal. Hubungi HR.');
  }

  let attempt = penugasan.attempt;
  if (!attempt) {
    const urutan = penugasan.test.shuffleQuestions
      ? acak(penugasan.test.questions.map((q) => q.questionId))
      : penugasan.test.questions.map((q) => q.questionId);
    const maksimal = penugasan.test.questions.reduce((n, q) => n + bobot(q), 0);

    // Batas waktu dihitung server sekali, saat mulai. Hitung mundur di layar
    // peserta hanya tampilan; jam di komputernya tidak menentukan apa pun.
    const deadline = new Date(sekarang.getTime() + penugasan.test.durationMinutes * 60_000);
    const batas = penugasan.availableUntil && penugasan.availableUntil < deadline ? penugasan.availableUntil : deadline;

    const dibuat = await prisma.$transaction(async (tx) => {
      const a = await tx.cbtAttempt.create({
        data: {
          id: generateULID(),
          assignmentId: penugasan.id,
          startedAt: sekarang,
          deadlineAt: batas,
          questionOrder: urutan,
          maxScore: maksimal,
        },
        include: { answers: true },
      });
      await tx.cbtAssignment.update({ where: { id: penugasan.id }, data: { status: 'in_progress' } });
      return a;
    });
    attempt = dibuat;
  }

  const petaSoal = new Map(penugasan.test.questions.map((q) => [q.questionId, q]));
  const urut = attempt.questionOrder.length > 0 ? attempt.questionOrder : penugasan.test.questions.map((q) => q.questionId);

  return {
    assignmentId: penugasan.id,
    attemptId: attempt.id,
    test: {
      id: penugasan.test.id,
      title: penugasan.test.title,
      description: penugasan.test.description,
      durationMinutes: penugasan.test.durationMinutes,
      recordProctorEvents: penugasan.test.recordProctorEvents,
      proctorPhotos: penugasan.test.proctorPhotos,
      proctorPhotoIntervalSec: penugasan.test.proctorPhotoIntervalSec,
    },
    peserta: {
      nama: penugasan.employee?.name ?? penugasan.candidate?.name ?? 'Peserta',
      jenis: penugasan.employeeId ? 'karyawan' : 'pelamar',
    },
    deadlineAt: attempt.deadlineAt.toISOString(),
    sisaDetik: sisaDetik(attempt.deadlineAt, sekarang),
    questions: urut
      .map((id) => petaSoal.get(id))
      .filter((b): b is NonNullable<typeof b> => Boolean(b))
      .map((b) => soalUntukPeserta(b, attempt!.id, penugasan.test.shuffleOptions)),
    answers: attempt.answers.map((j) => ({ questionId: j.questionId, chosen: j.chosen, text: j.text })),
    submittedAt: attempt.submittedAt?.toISOString() ?? null,
  };
};

/** Pengerjaan yang masih berjalan, atau galat yang menjelaskan kenapa tidak. */
export const pengerjaanBerjalan = (penugasan: PenugasanLengkap) => {
  const attempt = penugasan.attempt;
  if (!attempt) throw new GalatCbt(409, 'Tes belum dimulai.');
  if (attempt.submittedAt) throw new GalatCbt(409, 'Tes ini sudah dikirim.');
  return attempt;
};

export const simpanJawaban = async (
  penugasan: PenugasanLengkap,
  jawaban: readonly { questionId: string; chosen: string[]; text?: string | null }[]
): Promise<{ tersimpan: number; sisaDetik: number } | { tersimpan: 0; dikirimOtomatis: true }> => {
  const attempt = pengerjaanBerjalan(penugasan);

  if (new Date() > attempt.deadlineAt) {
    // Waktu habis sementara jawaban masih dikirim: yang sudah tersimpan tetap
    // dinilai, kiriman terakhir ini tidak. Lebih jujur daripada menerima
    // jawaban yang datang setelah bel.
    await kirimJawaban(penugasan, { otomatis: true });
    return { tersimpan: 0, dikirimOtomatis: true };
  }

  const milikPaket = new Set(penugasan.test.questions.map((q) => q.questionId));
  const asing = jawaban.filter((j) => !milikPaket.has(j.questionId));
  if (asing.length > 0) throw new GalatCbt(404, 'Ada jawaban untuk soal yang tidak ada di paket tes ini.');

  await prisma.$transaction(
    jawaban.map((j) =>
      prisma.cbtAnswer.upsert({
        where: { attemptId_questionId: { attemptId: attempt.id, questionId: j.questionId } },
        create: {
          id: generateULID(),
          attemptId: attempt.id,
          questionId: j.questionId,
          chosen: j.chosen,
          text: j.text ?? null,
        },
        update: { chosen: j.chosen, text: j.text ?? null },
      })
    )
  );

  return { tersimpan: jawaban.length, sisaDetik: sisaDetik(attempt.deadlineAt) };
};

/**
 * Menutup pengerjaan: soal objektif dinilai sekarang juga, esai menunggu
 * penguji. Nilai akhir baru muncul setelah semuanya dinilai.
 */
export const kirimJawaban = async (
  penugasan: PenugasanLengkap,
  opsi: { otomatis?: boolean } = {}
): Promise<{ status: string; nilai: ReturnType<typeof hitungNilai> }> => {
  const attempt = pengerjaanBerjalan(penugasan);
  const jawaban = new Map(attempt.answers.map((j) => [j.questionId, j]));

  const butirNilai = penugasan.test.questions.map((butir) => {
    const poin = butir.points ?? butir.question.points;
    const j = jawaban.get(butir.questionId) ?? null;
    const hasil = nilaiButir(
      { tipe: butir.question.type, kunci: butir.question.answerKey, poin },
      j ? { dipilih: j.chosen, teks: j.text } : null
    );
    return { butir, poin, jawabanId: j?.id ?? null, hasil };
  });

  const ringkasan = hitungNilai(
    butirNilai.map((b) => ({ tipe: b.butir.question.type, poin: b.poin, poinDiperoleh: b.hasil.poin })),
    penugasan.test.passingScore
  );
  const statusBaru = ringkasan.menungguPenilaian ? 'submitted' : 'graded';

  await prisma.$transaction(async (tx) => {
    for (const b of butirNilai) {
      if (!dinilaiOtomatis(b.butir.question.type)) continue;
      if (b.jawabanId) {
        await tx.cbtAnswer.update({
          where: { id: b.jawabanId },
          data: { isCorrect: b.hasil.benar, points: b.hasil.poin },
        });
      } else {
        // Soal yang dilewati tetap dicatat sebagai baris bernilai nol, supaya
        // rekap "berapa soal tidak dijawab" bisa dihitung tanpa menebak.
        await tx.cbtAnswer.create({
          data: {
            id: generateULID(),
            attemptId: attempt.id,
            questionId: b.butir.questionId,
            chosen: [],
            isCorrect: false,
            points: 0,
          },
        });
      }
    }

    await tx.cbtAttempt.update({
      where: { id: attempt.id },
      data: {
        submittedAt: new Date(),
        autoSubmitted: Boolean(opsi.otomatis),
        scoreObjective: ringkasan.objektif,
        scoreEssay: ringkasan.esai,
        scoreTotal: ringkasan.total,
        maxScore: ringkasan.maksimal,
        percent: ringkasan.persen,
        passed: ringkasan.lulus,
      },
    });
    await tx.cbtAssignment.update({ where: { id: penugasan.id }, data: { status: statusBaru } });
  });

  return { status: statusBaru, nilai: ringkasan };
};

/** Menghitung ulang nilai setelah penguji menilai esai. */
export const hitungUlangNilai = async (attemptId: string, penilaiId: string) => {
  const attempt = await prisma.cbtAttempt.findUnique({
    where: { id: attemptId },
    include: {
      answers: true,
      assignment: { include: { test: { include: { questions: { include: { question: true } } } } } },
    },
  });
  if (!attempt) throw new GalatCbt(404, 'Pengerjaan tidak ditemukan');

  const jawaban = new Map(attempt.answers.map((j) => [j.questionId, j]));
  const ringkasan = hitungNilai(
    attempt.assignment.test.questions.map((butir) => ({
      tipe: butir.question.type,
      poin: butir.points ?? butir.question.points,
      poinDiperoleh: jawaban.get(butir.questionId)?.points ?? null,
    })),
    attempt.assignment.test.passingScore
  );
  const statusBaru = ringkasan.menungguPenilaian ? 'submitted' : 'graded';

  await prisma.$transaction([
    prisma.cbtAttempt.update({
      where: { id: attemptId },
      data: {
        scoreObjective: ringkasan.objektif,
        scoreEssay: ringkasan.esai,
        scoreTotal: ringkasan.total,
        maxScore: ringkasan.maksimal,
        percent: ringkasan.persen,
        passed: ringkasan.lulus,
        gradedById: statusBaru === 'graded' ? penilaiId : null,
        gradedAt: statusBaru === 'graded' ? new Date() : null,
      },
    }),
    prisma.cbtAssignment.update({ where: { id: attempt.assignmentId }, data: { status: statusBaru } }),
  ]);

  return { status: statusBaru, nilai: ringkasan };
};
