// src/services/cbt/attempt.ts
//
// Alur pengerjaan satu tes, dipakai dua pintu masuk sekaligus: karyawan yang
// membawa JWT dan pelamar yang membawa token tautan. Keduanya mendarat pada
// objek penugasan yang sama, jadi aturan mainnya hanya ditulis sekali di sini.
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { generateULID } from '../../utils/generateULID';
import { acak, bacaPilihan, dinilaiOtomatis, hitungNilai, jenisPaket, nilaiButir, petaNilaiSkala, pilihanTanpaNilai, sisaDetik, type JenisPaket } from '../../utils/cbt';

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

/** Waktu untuk pesan ke peserta: "9 Okt 2026 08.21 WIB", bukan cap waktu UTC mentah. */
const waktuWib = (d: Date) =>
  `${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(d)} WIB`;

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
  // Nilai tiap pilihan butir skala tidak ikut: arah butir terbalik tidak
  // perlu terbaca peserta. Skala juga tidak pernah diacak — urutan
  // "sangat tidak sesuai … sangat sesuai" adalah makna jawabannya.
  const pilihan = pilihanTanpaNilai(bacaPilihan(butir.question.options));
  const skala = butir.question.type === 'skala';
  return {
    id: butir.questionId,
    type: butir.question.type,
    category: butir.question.category,
    text: butir.question.text,
    textHtml: butir.question.textHtml,
    imagePath: butir.question.imagePath,
    points: bobot(butir),
    options: acakPilihan && !skala ? acak(pilihan, rngTerbenih(attemptId + butir.questionId)) : pilihan,
  };
};

/** Jenis paket dari butir-butirnya: seluruhnya skala berarti inventori kepribadian. */
export const jenisPaketDari = (penugasan: PenugasanLengkap): JenisPaket => jenisPaket(penugasan.test.questions.map((q) => q.question.type));

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
    /** 'kepribadian' bila seluruh butirnya skala: tidak ada jawaban benar/salah. */
    jenis: JenisPaket;
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
    throw new GalatCbt(403, `Tes baru bisa dikerjakan mulai ${waktuWib(penugasan.availableFrom!)}.`);
  }
  if (jendela === 'kedaluwarsa' && !penugasan.attempt) {
    await prisma.cbtAssignment.update({ where: { id: penugasan.id }, data: { status: 'expired' } });
    throw new GalatCbt(403, 'Masa pengerjaan tes ini sudah lewat.');
  }
  if (penugasan.test.questions.length === 0) {
    throw new GalatCbt(409, 'Paket tes ini belum punya soal. Hubungi HR.');
  }
  // Dibuka lagi setelah batas waktu lewat: pengerjaannya ditutup di sini, bukan
  // dibiarkan pada peserta untuk "mengirim" tes yang sudah mati.
  if (penugasan.attempt && !penugasan.attempt.submittedAt && sekarang > penugasan.attempt.deadlineAt) {
    try {
      await kirimJawaban(penugasan, { otomatis: true });
    } catch (e) {
      if (!(e instanceof GalatCbt && e.status === 409)) throw e;
    }
    throw new GalatCbt(409, 'Waktu pengerjaan sudah habis; jawaban yang tersimpan telah dikirim otomatis.');
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
      jenis: jenisPaketDari(penugasan),
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
): Promise<
  | { tersimpan: number; sisaDetik: number }
  | { tersimpan: 0; dikirimOtomatis: true; hasil: ReturnType<typeof ringkasUntukPeserta> | null }
> => {
  const attempt = pengerjaanBerjalan(penugasan);

  if (new Date() > attempt.deadlineAt) {
    // Waktu habis sementara jawaban masih dikirim: yang sudah tersimpan tetap
    // dinilai, kiriman terakhir ini tidak. Lebih jujur daripada menerima
    // jawaban yang datang setelah bel. Ringkasannya ikut dikirim supaya layar
    // selesai peserta sama dengan kiriman biasa (jenis paket, nilai bila dibuka).
    try {
      const hasil = await kirimJawaban(penugasan, { otomatis: true });
      return { tersimpan: 0, dikirimOtomatis: true, hasil: ringkasUntukPeserta(hasil, penugasan.test.showResultToTaker) };
    } catch (e) {
      // Sudah ditutup lebih dulu (penyapu atau tab lain): hasilnya sama.
      if (!(e instanceof GalatCbt && e.status === 409)) throw e;
      return { tersimpan: 0, dikirimOtomatis: true, hasil: null };
    }
  }

  const milikPaket = new Set(penugasan.test.questions.map((q) => q.questionId));
  const asing = jawaban.filter((j) => !milikPaket.has(j.questionId));
  if (asing.length > 0) throw new GalatCbt(404, 'Ada jawaban untuk soal yang tidak ada di paket tes ini.');

  await prisma.$transaction(async (tx) => {
    // Baris pengerjaan dikunci dan diperiksa ulang: tanpa ini simpan yang
    // tiba bersamaan dengan pengiriman bisa tercatat SETELAH jawaban dinilai,
    // mengubah pilihan tanpa mengubah nilainya.
    const [baris] = await tx.$queryRaw<{ submittedAt: Date | null }[]>`
      SELECT "submittedAt" FROM "CbtAttempt" WHERE "id" = ${attempt.id} FOR UPDATE`;
    if (!baris || baris.submittedAt) throw new GalatCbt(409, 'Tes ini sudah dikirim.');

    for (const j of jawaban) {
      await tx.cbtAnswer.upsert({
        where: { attemptId_questionId: { attemptId: attempt.id, questionId: j.questionId } },
        create: {
          id: generateULID(),
          attemptId: attempt.id,
          questionId: j.questionId,
          chosen: j.chosen,
          text: j.text ?? null,
        },
        update: { chosen: j.chosen, text: j.text ?? null },
      });
    }
  }, { timeout: 20_000, maxWait: 10_000 });

  return { tersimpan: jawaban.length, sisaDetik: sisaDetik(attempt.deadlineAt) };
};

/**
 * Bentuk hasil yang dikirim ke peserta. Nilai hanya dibuka bila paket
 * mengizinkan dan sudah final — untuk seleksi pelamar, mengetahui nilainya
 * seketika sama saja membocorkan ambang kelulusan perusahaan. Inventori
 * kepribadian tidak punya "nilai" (profilnya dibaca HR), jadi tidak pernah
 * dibuka sebagai persen/lulus. Dipakai bersama oleh ketiga pintu masuk
 * (karyawan, tautan, portal karier).
 */
export const ringkasUntukPeserta = (
  hasil: { status: string; jenis: JenisPaket; nilai: { total: number; maksimal: number; persen: number; lulus: boolean | null; menungguPenilaian: boolean } },
  boleh: boolean
) => ({
  status: hasil.status,
  jenis: hasil.jenis,
  menungguPenilaian: hasil.nilai.menungguPenilaian,
  nilai: boleh && !hasil.nilai.menungguPenilaian && hasil.jenis !== 'kepribadian' ? hasil.nilai : null,
});

/** Ambang kelulusan yang berlaku: inventori kepribadian tidak punya kelulusan, apa pun isian paketnya. */
const ambangBerlaku = (jenis: JenisPaket, passingScore: number | null) => (jenis === 'kepribadian' ? null : passingScore);

/** Satu jawaban yang dikirim peserta, dari simpan-otomatis maupun dari permintaan kirim. */
export interface JawabanMasuk {
  questionId: string;
  chosen: string[];
  text?: string | null;
}

/**
 * Menutup pengerjaan: soal objektif dinilai sekarang juga, esai menunggu
 * penguji. Nilai akhir baru muncul setelah semuanya dinilai.
 *
 * `jawabanAkhir` adalah jawaban yang dibawa permintaan kirim itu sendiri —
 * kesempatan terakhir bagi jawaban yang simpan-otomatisnya gagal atau masih
 * berjalan saat tombol Kirim ditekan. Yang datang setelah batas waktu
 * diabaikan, sama seperti pada simpanJawaban.
 *
 * Aman untuk permintaan bersamaan (dua tab, tombol Kirim berbarengan dengan
 * pengatur waktu, penyapu): pengerjaan diklaim di dalam transaksi, dan hanya
 * satu yang menang; sisanya mendapat 409 "sudah dikirim", bukan galat server.
 */
export const kirimJawaban = async (
  penugasan: PenugasanLengkap,
  opsi: { otomatis?: boolean; jawabanAkhir?: readonly JawabanMasuk[] } = {}
): Promise<{ status: string; jenis: JenisPaket; nilai: ReturnType<typeof hitungNilai> }> => {
  const attempt = pengerjaanBerjalan(penugasan);
  const sekarang = new Date();
  const terlambat = sekarang > attempt.deadlineAt;

  const akhir = new Map<string, { chosen: string[]; text: string | null }>();
  if (opsi.jawabanAkhir && opsi.jawabanAkhir.length > 0 && !terlambat) {
    const milikPaket = new Set(penugasan.test.questions.map((q) => q.questionId));
    if (opsi.jawabanAkhir.some((j) => !milikPaket.has(j.questionId))) {
      throw new GalatCbt(404, 'Ada jawaban untuk soal yang tidak ada di paket tes ini.');
    }
    for (const j of opsi.jawabanAkhir) akhir.set(j.questionId, { chosen: j.chosen, text: j.text ?? null });
  }

  const ringkasan = await prisma.$transaction(async (tx) => {
    // Klaim: baris pengerjaan terkunci sampai transaksi selesai, jadi klaim
    // kedua menunggu lalu mendapati submittedAt sudah terisi.
    const klaim = await tx.cbtAttempt.updateMany({
      where: { id: attempt.id, submittedAt: null },
      data: { submittedAt: sekarang },
    });
    if (klaim.count === 0) throw new GalatCbt(409, 'Tes ini sudah dikirim.');

    for (const [questionId, isi] of akhir) {
      await tx.cbtAnswer.upsert({
        where: { attemptId_questionId: { attemptId: attempt.id, questionId } },
        create: { id: generateULID(), attemptId: attempt.id, questionId, chosen: isi.chosen, text: isi.text },
        update: { chosen: isi.chosen, text: isi.text },
      });
    }

    // Jawaban dibaca SETELAH klaim, di dalam transaksi: simpan yang sempat
    // masuk sebelum klaim ikut dinilai, yang datang sesudahnya ditolak.
    const jawaban = new Map(
      (await tx.cbtAnswer.findMany({ where: { attemptId: attempt.id } })).map((j) => [j.questionId, j])
    );

    const butirNilai = penugasan.test.questions.map((butir) => {
      const poin = butir.points ?? butir.question.points;
      const j = jawaban.get(butir.questionId) ?? null;
      const hasil = nilaiButir(
        {
          tipe: butir.question.type,
          kunci: butir.question.answerKey,
          poin,
          ...(butir.question.type === 'skala' ? { nilaiPilihan: petaNilaiSkala(bacaPilihan(butir.question.options)) } : {}),
        },
        j ? { dipilih: j.chosen, teks: j.text } : null
      );
      return { butir, poin, jawabanId: j?.id ?? null, hasil };
    });

    const r = hitungNilai(
      butirNilai.map((b) => ({ tipe: b.butir.question.type, poin: b.poin, poinDiperoleh: b.hasil.poin })),
      ambangBerlaku(jenisPaketDari(penugasan), penugasan.test.passingScore)
    );

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
            // Sama dengan penilaian butirnya: salah untuk soal berkunci, tanpa
            // benar/salah (null) untuk butir skala.
            isCorrect: b.hasil.benar,
            points: 0,
          },
        });
      }
    }

    await tx.cbtAttempt.update({
      where: { id: attempt.id },
      data: {
        // "Waktu habis" ditentukan jam server — kiriman yang tiba setelah
        // batas waktu tercatat otomatis — atau oleh pengatur waktu di layar
        // peserta, yang menembak sesaat sebelum bel.
        autoSubmitted: Boolean(opsi.otomatis) || terlambat,
        scoreObjective: r.objektif,
        scoreEssay: r.esai,
        scoreTotal: r.total,
        maxScore: r.maksimal,
        percent: r.persen,
        passed: r.lulus,
      },
    });
    await tx.cbtAssignment.update({
      where: { id: penugasan.id },
      data: { status: r.menungguPenilaian ? 'submitted' : 'graded' },
    });
    return r;
  }, { timeout: 20_000, maxWait: 10_000 });

  return { status: ringkasan.menungguPenilaian ? 'submitted' : 'graded', jenis: jenisPaketDari(penugasan), nilai: ringkasan };
};

/**
 * Menutup pengerjaan yang ditinggalkan: batas waktunya lewat tetapi peserta
 * tidak pernah menekan Kirim (menutup tab, koneksi putus). Tanpa ini
 * penugasannya "sedang dikerjakan" selamanya, tidak muncul di Hasil &
 * Penilaian, dan tidak bisa ditugaskan ulang. Dipanggil malas dari daftar
 * hasil/penugasan dan berkala oleh penyapu (services/cbt/penyapu.ts).
 *
 * Tenggang setelah bel memberi kesempatan pengatur waktu di layar peserta
 * mengirim sendiri, supaya peserta yang masih membuka ruang ujian melihat
 * hasilnya, bukan "tes sudah ditutup".
 */
export const tutupPengerjaanKedaluwarsa = async (
  saringan: Prisma.CbtAttemptWhereInput = {},
  { tenggangMs = 60_000, batasJumlah = 50 }: { tenggangMs?: number; batasJumlah?: number } = {}
): Promise<number> => {
  const kandidat = await prisma.cbtAttempt.findMany({
    where: { ...saringan, submittedAt: null, deadlineAt: { lt: new Date(Date.now() - tenggangMs) } },
    select: { assignmentId: true },
    orderBy: { deadlineAt: 'asc' },
    take: batasJumlah,
  });

  let ditutup = 0;
  for (const { assignmentId } of kandidat) {
    const penugasan = await prisma.cbtAssignment.findUnique({ where: { id: assignmentId }, ...penugasanLengkap });
    if (!penugasan) continue;
    try {
      await kirimJawaban(penugasan, { otomatis: true });
      ditutup += 1;
    } catch (e) {
      // Dikirim bersamaan oleh peserta atau penyapu lain: bukan masalah.
      if (!(e instanceof GalatCbt)) throw e;
    }
  }
  return ditutup;
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
    ambangBerlaku(jenisPaket(attempt.assignment.test.questions.map((q) => q.question.type)), attempt.assignment.test.passingScore)
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
