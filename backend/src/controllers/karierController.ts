// src/controllers/karierController.ts
//
// Portal karier publik: daftar lowongan yang boleh dilihat siapa saja, dan
// dashboard calon karyawan yang hanya boleh dilihat pemilik akunnya.
//
// Semua data di sini milik orang luar perusahaan, jadi aturannya dibalik dari
// modul internal: yang tidak disebut boleh, tidak keluar. Nilai tes, catatan
// penilai, dan alasan penolakan internal TIDAK pernah dikirim ke pelamar.
import fs from 'fs/promises';
import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { generateULID } from '../utils/generateULID';
import { normalizePhoneNumber } from '../utils/whatsappRules';
import { decodeBase64Document, InvalidDocumentError, resolveDocumentPath, saveDocument, namaUnduhanAman } from '../utils/documentUpload';
import { decodeBase64Image, InvalidImageError, saveImage } from '../utils/imageUpload';
import { encryptBytes } from '../utils/fieldCrypto';
import { buatTokenPelamar } from '../middleware/authPelamar';
import { GalatCbt, kirimJawaban, mulaiAtauLanjutkan, penugasanLengkap, pengerjaanBerjalan, simpanJawaban } from '../services/cbt/attempt';
import type {
  DaftarPelamarInput,
  GantiSandiPelamarInput,
  LamarInput,
  MasukPelamarInput,
  UbahProfilPelamarInput,
  UnggahCvInput,
} from '../schemas/karierSchema';

// ============ Lowongan publik ============

/** Hanya lowongan yang memang sedang dibuka dan belum lewat batas lamaran. */
const lowonganTerbuka = (): Prisma.JobPostingWhereInput => ({
  status: 'open',
  OR: [{ deadline: null }, { deadline: { gte: new Date() } }],
});

const lowonganPublikSelect = {
  id: true,
  title: true,
  description: true,
  descriptionHtml: true,
  requirements: true,
  requirementsHtml: true,
  openings: true,
  employmentType: true,
  salaryRangeMin: true,
  salaryRangeMax: true,
  location: true,
  deadline: true,
  createdAt: true,
  position: { select: { id: true, name: true, department: { select: { id: true, name: true } } } },
} satisfies Prisma.JobPostingSelect;

const angka = (n: Prisma.Decimal | null) => (n === null ? null : Number(n));

const lowonganDTO = (l: Prisma.JobPostingGetPayload<{ select: typeof lowonganPublikSelect }>) => ({
  ...l,
  salaryRangeMin: angka(l.salaryRangeMin),
  salaryRangeMax: angka(l.salaryRangeMax),
});

export const getLowonganPublik = async (req: Request, res: Response) => {
  const cari = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const lokasi = typeof req.query.lokasi === 'string' ? req.query.lokasi.trim() : '';
  const departemen = typeof req.query.departemen === 'string' ? req.query.departemen.trim() : '';

  const data = await prisma.jobPosting.findMany({
    where: {
      ...lowonganTerbuka(),
      ...(cari && { OR: [{ title: { contains: cari, mode: 'insensitive' } }, { description: { contains: cari, mode: 'insensitive' } }] }),
      ...(lokasi && { location: { contains: lokasi, mode: 'insensitive' } }),
      ...(departemen && { position: { departmentId: departemen } }),
    },
    select: lowonganPublikSelect,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  // Saringan diturunkan dari lowongan yang memang tayang, bukan dari seluruh
  // struktur organisasi: departemen yang tidak sedang membuka lowongan bukan
  // urusan pelamar.
  const semua = await prisma.jobPosting.findMany({
    where: lowonganTerbuka(),
    select: { location: true, position: { select: { department: { select: { id: true, name: true } } } } },
  });

  res.json({
    data: data.map(lowonganDTO),
    saringan: {
      lokasi: [...new Set(semua.map((l) => l.location).filter((v): v is string => Boolean(v)))].sort(),
      departemen: [
        ...new Map(
          semua
            .map((l) => l.position.department)
            .filter((d): d is { id: string; name: string } => Boolean(d))
            .map((d) => [d.id, d])
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name)),
    },
  });
};

export const getLowonganPublikById = async (req: Request, res: Response) => {
  const lowongan = await prisma.jobPosting.findFirst({
    where: { id: req.params.id, ...lowonganTerbuka() },
    select: lowonganPublikSelect,
  });
  if (!lowongan) return res.status(404).json({ error: 'Lowongan tidak ditemukan atau sudah ditutup' });
  res.json(lowonganDTO(lowongan));
};

// ============ Akun pelamar ============

const bakukanTelepon = (nomor: string | null | undefined) => {
  if (!nomor || nomor.trim() === '') return null;
  return normalizePhoneNumber(nomor) ?? nomor.trim();
};

export const daftar = async (req: Request, res: Response) => {
  const input = req.body as DaftarPelamarInput;
  // Umpan perangkap terisi = pengisi formulir otomatis. Dijawab 201 palsu
  // supaya robotnya tidak belajar kolom mana yang membongkarnya.
  if (input.situs && input.situs.trim() !== '') return res.status(201).json({ ok: true });

  const ada = await prisma.candidateAccount.findUnique({ where: { email: input.email }, select: { id: true } });
  if (ada) return res.status(409).json({ error: 'Email ini sudah terdaftar. Silakan masuk.' });

  const akun = await prisma.candidateAccount.create({
    data: {
      id: generateULID(),
      email: input.email,
      name: input.name,
      phoneNumber: bakukanTelepon(input.phoneNumber),
      password: await bcrypt.hash(input.password, env.BCRYPT_ROUNDS),
    },
    select: { id: true, email: true, name: true },
  });

  res.status(201).json({ token: buatTokenPelamar(akun.id), pelamar: akun });
};

export const masuk = async (req: Request, res: Response) => {
  const input = req.body as MasukPelamarInput;

  const akun = await prisma.candidateAccount.findUnique({ where: { email: input.email } });
  // Satu pesan untuk email tidak ada maupun sandi salah: membedakannya sama
  // dengan memberi tahu alamat mana yang terdaftar.
  const gagal = () => res.status(401).json({ error: 'Email atau kata sandi salah' });
  if (!akun) {
    // Tetap menghitung hash supaya lama jawabannya tidak membocorkan apa pun.
    await bcrypt.compare(input.password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin');
    return gagal();
  }
  if (!(await bcrypt.compare(input.password, akun.password))) return gagal();

  await prisma.candidateAccount.update({ where: { id: akun.id }, data: { lastLoginAt: new Date() } });
  res.json({
    token: buatTokenPelamar(akun.id),
    pelamar: { id: akun.id, email: akun.email, name: akun.name },
  });
};

// ============ Dashboard pelamar ============

/** Yang boleh dilihat pelamar tentang lamarannya sendiri. */
const lamaranSelect = {
  id: true,
  status: true,
  applicationDate: true,
  expectedSalary: true,
  coverLetter: true,
  cvUrl: true,
  appliedPosition: {
    select: { id: true, title: true, status: true, location: true, employmentType: true, deadline: true },
  },
  stageHistory: {
    select: { id: true, fromStage: true, toStage: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
  // Hasil, skor, dan catatan penilai sengaja TIDAK ikut: itu bahan keputusan
  // internal, bukan kabar untuk pelamar.
  interviews: {
    select: { id: true, scheduledDateTime: true, durationMinutes: true, stage: true, round: true, location: true, status: true },
    orderBy: { scheduledDateTime: 'asc' },
  },
  cbtAssignments: {
    select: {
      id: true,
      status: true,
      availableFrom: true,
      availableUntil: true,
      test: { select: { title: true, durationMinutes: true, _count: { select: { questions: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  },
} satisfies Prisma.CandidateSelect;

export const profilSaya = async (req: Request, res: Response) => {
  const [akun, lamaran] = await Promise.all([
    prisma.candidateAccount.findUniqueOrThrow({
      where: { id: req.pelamar!.id },
      select: { id: true, email: true, name: true, phoneNumber: true, cvFileName: true, createdAt: true },
    }),
    prisma.candidate.findMany({
      where: { accountId: req.pelamar!.id },
      select: lamaranSelect,
      orderBy: { applicationDate: 'desc' },
    }),
  ]);

  res.json({
    ...akun,
    punyaCv: Boolean(akun.cvFileName),
    applications: lamaran.map((l) => ({ ...l, expectedSalary: angka(l.expectedSalary) })),
  });
};

export const ubahProfil = async (req: Request, res: Response) => {
  const input = req.body as UbahProfilPelamarInput;
  const akun = await prisma.candidateAccount.update({
    where: { id: req.pelamar!.id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.phoneNumber !== undefined && { phoneNumber: bakukanTelepon(input.phoneNumber) }),
    },
    select: { id: true, email: true, name: true, phoneNumber: true },
  });
  res.json(akun);
};

export const gantiSandi = async (req: Request, res: Response) => {
  const input = req.body as GantiSandiPelamarInput;
  const akun = await prisma.candidateAccount.findUniqueOrThrow({ where: { id: req.pelamar!.id } });
  if (!(await bcrypt.compare(input.passwordLama, akun.password))) {
    return res.status(400).json({ error: 'Kata sandi lama salah' });
  }
  await prisma.candidateAccount.update({
    where: { id: akun.id },
    data: { password: await bcrypt.hash(input.passwordBaru, env.BCRYPT_ROUNDS) },
  });
  res.json({ message: 'Kata sandi diperbarui' });
};

const simpanCv = async (akunId: string, cv: string, namaBerkas: string) => {
  const { buffer, jenis } = decodeBase64Document(cv, namaBerkas);
  const path = await saveDocument(buffer, jenis.extension, `pelamar-${akunId}`);
  await prisma.candidateAccount.update({
    where: { id: akunId },
    data: { cvPath: path, cvFileName: namaUnduhanAman(namaBerkas, jenis.extension) },
  });
  return path;
};

export const unggahCv = async (req: Request, res: Response) => {
  const input = req.body as UnggahCvInput;
  try {
    await simpanCv(req.pelamar!.id, input.cv, input.cvFileName);
    res.json({ message: 'CV tersimpan dan akan dipakai untuk lamaran berikutnya' });
  } catch (e) {
    if (e instanceof InvalidDocumentError) return res.status(400).json({ error: e.message });
    throw e;
  }
};

export const lamar = async (req: Request, res: Response) => {
  const input = req.body as LamarInput;
  if (input.situs && input.situs.trim() !== '') return res.status(201).json({ ok: true });

  const akun = await prisma.candidateAccount.findUniqueOrThrow({ where: { id: req.pelamar!.id } });

  const lowongan = await prisma.jobPosting.findFirst({
    where: { id: input.jobPostingId, ...lowonganTerbuka() },
    select: { id: true, title: true },
  });
  if (!lowongan) return res.status(404).json({ error: 'Lowongan tidak ditemukan atau sudah ditutup' });

  // Satu orang satu lamaran per lowongan: kiriman berulang hanya menumpuk
  // antrean HR tanpa menambah informasi apa pun.
  const sudah = await prisma.candidate.findFirst({
    where: { accountId: akun.id, appliedPositionId: lowongan.id },
    select: { id: true },
  });
  if (sudah) return res.status(409).json({ error: 'Anda sudah melamar lowongan ini' });

  let cvPath = akun.cvPath;
  if (input.cv && input.cvFileName) {
    try {
      cvPath = await simpanCv(akun.id, input.cv, input.cvFileName);
    } catch (e) {
      if (e instanceof InvalidDocumentError) return res.status(400).json({ error: e.message });
      throw e;
    }
  }

  const pelamar = await prisma.candidate.create({
    data: {
      id: generateULID(),
      accountId: akun.id,
      name: akun.name,
      email: akun.email,
      phoneNumber: akun.phoneNumber,
      appliedPositionId: lowongan.id,
      source: 'portal-karier',
      status: 'applied',
      expectedSalary: input.expectedSalary ?? null,
      coverLetter: input.coverLetter ?? null,
    },
    select: { id: true, status: true, applicationDate: true },
  });

  // Ditunjuk ke endpoint unduhan, bukan ke path penyimpanan: HR membuka
  // berkasnya lewat API yang memeriksa izin, bukan berkas mentah. Baru bisa
  // diisi setelah id lamarannya ada.
  if (cvPath) {
    await prisma.candidate.update({ where: { id: pelamar.id }, data: { cvUrl: `/api/candidates/${pelamar.id}/cv` } });
  }
  // Riwayat tahap sengaja tidak dibuat di sini: barisnya menuntut karyawan
  // yang memindahkan tahap, dan lamaran portal belum disentuh siapa pun.

  res.status(201).json({ ...pelamar, lowongan: lowongan.title });
};

export const lamaranSaya = async (req: Request, res: Response) => {
  const lamaran = await prisma.candidate.findFirst({
    where: { id: req.params.id, accountId: req.pelamar!.id },
    select: lamaranSelect,
  });
  if (!lamaran) return res.status(404).json({ error: 'Lamaran tidak ditemukan' });
  res.json({ ...lamaran, expectedSalary: angka(lamaran.expectedSalary) });
};

/** CV yang tersimpan, diunduh pemiliknya sendiri. */
export const unduhCvSaya = async (req: Request, res: Response) => {
  const akun = await prisma.candidateAccount.findUniqueOrThrow({
    where: { id: req.pelamar!.id },
    select: { cvPath: true, cvFileName: true },
  });
  if (!akun.cvPath) return res.status(404).json({ error: 'Belum ada CV yang diunggah' });
  await kirimBerkas(res, akun.cvPath, akun.cvFileName ?? 'cv.pdf');
};

export const kirimBerkas = async (res: Response, storagePath: string, namaBerkas: string) => {
  let isi: Buffer;
  try {
    isi = await fs.readFile(resolveDocumentPath(storagePath));
  } catch {
    return res.status(500).json({ error: 'Berkas tidak ditemukan di penyimpanan' });
  }
  res.setHeader('Content-Type', storagePath.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${namaBerkas}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(isi);
};

// ============ Tes CBT dari portal ============
//
// Alur ujiannya sama persis dengan peserta lain; yang berbeda hanya cara
// menemukan penugasannya — lewat akun, bukan lewat tautan bertoken.

const penugasanPelamar = async (assignmentId: string, akunId: string) => {
  const penugasan = await prisma.cbtAssignment.findUnique({ where: { id: assignmentId }, ...penugasanLengkap });
  if (!penugasan?.candidateId) throw new GalatCbt(404, 'Tes tidak ditemukan');
  const milik = await prisma.candidate.findFirst({
    where: { id: penugasan.candidateId, accountId: akunId },
    select: { id: true },
  });
  if (!milik) throw new GalatCbt(404, 'Tes tidak ditemukan');
  return penugasan;
};

const galatCbt = (e: unknown, res: Response) => {
  if (e instanceof GalatCbt) return res.status(e.status).json({ error: e.message });
  throw e;
};

export const mulaiTes = async (req: Request, res: Response) => {
  try {
    res.json(await mulaiAtauLanjutkan(await penugasanPelamar(req.params.id, req.pelamar!.id)));
  } catch (e) {
    galatCbt(e, res);
  }
};

export const simpanJawabanTes = async (req: Request, res: Response) => {
  try {
    const { jawaban } = req.body as { jawaban: { questionId: string; chosen: string[]; text?: string | null }[] };
    res.json(await simpanJawaban(await penugasanPelamar(req.params.id, req.pelamar!.id), jawaban));
  } catch (e) {
    galatCbt(e, res);
  }
};

export const kirimTes = async (req: Request, res: Response) => {
  try {
    const penugasan = await penugasanPelamar(req.params.id, req.pelamar!.id);
    const hasil = await kirimJawaban(penugasan);
    res.json({
      status: hasil.status,
      menungguPenilaian: hasil.nilai.menungguPenilaian,
      nilai: penugasan.test.showResultToTaker && !hasil.nilai.menungguPenilaian ? hasil.nilai : null,
    });
  } catch (e) {
    galatCbt(e, res);
  }
};

export const kejadianTes = async (req: Request, res: Response) => {
  try {
    const penugasan = await penugasanPelamar(req.params.id, req.pelamar!.id);
    if (!penugasan.test.recordProctorEvents) return res.status(204).send();
    const attempt = pengerjaanBerjalan(penugasan);
    const isi = req.body as { type: string; detail?: string | null };
    await prisma.cbtProctorEvent.create({
      data: { id: generateULID(), attemptId: attempt.id, type: isi.type, detail: isi.detail ?? null },
    });
    res.status(204).send();
  } catch (e) {
    galatCbt(e, res);
  }
};

export const fotoTes = async (req: Request, res: Response) => {
  try {
    const penugasan = await penugasanPelamar(req.params.id, req.pelamar!.id);
    if (!penugasan.test.proctorPhotos) return res.status(409).json({ error: 'Tes ini tidak memakai foto pengawasan' });
    const attempt = pengerjaanBerjalan(penugasan);
    const { buffer, extension } = decodeBase64Image((req.body as { image: string }).image);
    // Wajah adalah data biometrik: disimpan terenkripsi, sama dengan peserta lain.
    const path = await saveImage(encryptBytes(buffer), extension, 'cbt-proktor');
    await prisma.cbtProctorPhoto.create({ data: { id: generateULID(), attemptId: attempt.id, storagePath: path } });
    res.status(204).send();
  } catch (e) {
    if (e instanceof InvalidImageError) return res.status(400).json({ error: e.message });
    galatCbt(e, res);
  }
};
