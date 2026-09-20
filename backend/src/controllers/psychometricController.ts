// src/controllers/psychometricController.ts
//
// Hasil psikotes kandidat (hrd_features_doc.md bagian 5: kepribadian, sikap,
// potensi). Hanya HR: hasil tes psikologi adalah data pribadi kandidat yang
// bahkan pewawancara tidak perlu lihat mentah-mentah — yang mereka butuhkan
// adalah rekomendasinya, dan itu diputuskan HR.
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import type {
  CreateTestResultInput,
  UpdateTestResultInput,
  ListTestResultQuery,
} from '../schemas/psychometricSchema';

const resultSelect = {
  id: true,
  candidateId: true,
  testName: true,
  score: true,
  maxScore: true,
  testDate: true,
  interpretation: true,
  reportUrl: true,
  status: true,
  evaluatedById: true,
  createdAt: true,
  updatedAt: true,
  candidate: { select: { id: true, name: true, email: true, status: true } },
  evaluatedBy: { select: { id: true, nik: true, name: true } },
} satisfies Prisma.PsychometricTestResultSelect;

export const createTestResult = async (req: Request, res: Response) => {
  const input = req.body as CreateTestResultInput;
  const actor = req.user!;

  const kandidat = await prisma.candidate.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, status: true },
  });
  if (!kandidat) return res.status(404).json({ error: 'Kandidat tidak ditemukan' });

  const hasil = await prisma.psychometricTestResult.create({
    data: {
      id: generateULID(),
      candidateId: kandidat.id,
      testName: input.testName,
      score: input.score,
      maxScore: input.maxScore,
      testDate: input.testDate,
      interpretation: input.interpretation,
      reportUrl: input.reportUrl,
      status: input.status,
      evaluatedById: actor.id,
    },
    select: resultSelect,
  });

  res.locals.audit = {
    action: 'recruitment.psychometric.create',
    entity: 'PsychometricTestResult',
    entityId: hasil.id,
    summary: `Mencatat hasil ${input.testName} untuk kandidat ${kandidat.name}`,
    // Skor dan interpretasi tidak masuk audit: itu data pribadi kandidat.
    metadata: { candidateId: kandidat.id, testName: input.testName },
  };

  res.status(201).json(hasil);
};

export const listTestResults = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListTestResultQuery;

  const where: Prisma.PsychometricTestResultWhereInput = {
    ...(query.candidateId ? { candidateId: query.candidateId } : {}),
    ...(query.status ? { status: query.status } : {}),
  };

  const [total, data] = await Promise.all([
    prisma.psychometricTestResult.count({ where }),
    prisma.psychometricTestResult.findMany({
      where,
      select: resultSelect,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  res.json({
    data,
    pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) || 1 },
  });
};

export const updateTestResult = async (req: Request, res: Response) => {
  const input = req.body as UpdateTestResultInput;

  const ada = await prisma.psychometricTestResult.findUnique({
    where: { id: req.params.id },
    select: { score: true, maxScore: true },
  });
  if (!ada) return res.status(404).json({ error: 'Hasil tes tidak ditemukan' });

  // Skor dan batasnya bisa diubah terpisah; yang diperiksa adalah pasangan
  // hasil akhirnya, bukan hanya field yang dikirim.
  const skor = input.score ?? ada.score;
  const maks = input.maxScore === undefined ? ada.maxScore : input.maxScore;
  if (maks !== null && skor > maks) {
    return res.status(400).json({ error: 'Skor tidak boleh melebihi skor maksimal' });
  }

  const hasil = await prisma.psychometricTestResult.update({
    where: { id: req.params.id },
    data: input,
    select: resultSelect,
  });
  res.json(hasil);
};
