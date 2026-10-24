import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { Prisma, RecruitmentPublication } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import type { PublicationInput, RecruitmentPlatform } from '../schemas/recruitmentIntegrationSchema';
import { PLATFORMS, IntegrationError, integrationConfiguration, requireConfiguration, testPlatform, buildPublicationPayload, sendPublication, checkPublication } from '../services/recruitment/platforms';

const dto = (row: RecruitmentPublication) => ({
  id: row.id, jobPostingId: row.jobPostingId, platform: row.platform, operation: row.operation,
  status: row.status, remoteId: row.remoteId, remoteUrl: row.remoteUrl, error: row.error,
  checkedAt: row.checkedAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
});
const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try { await fn(req, res); } catch (error) {
    if (!(error instanceof IntegrationError)) throw error;
    res.status(error.statusCode).json({ error: error.message });
  }
};

export const getRecruitmentIntegrations = handle(async (_req, res) => {
  res.json({ data: PLATFORMS.map(integrationConfiguration) });
});
export const testRecruitmentIntegration = handle(async (req, res) => {
  res.json(await testPlatform(req.params.platform as RecruitmentPlatform));
});
export const getJobPublications = handle(async (req, res) => {
  const id = req.params.id as string;
  if (!await prisma.jobPosting.findUnique({ where: { id }, select: { id: true } })) throw new IntegrationError('Lowongan tidak ditemukan', 404);
  // Lease yang lewat berarti proses bisa berhenti setelah provider menerima kiriman.
  await prisma.recruitmentPublication.updateMany({
    where: { jobPostingId: id, status: 'sending', leaseUntil: { lt: new Date() } },
    data: { status: 'uncertain', leaseUntil: null, error: 'Pengiriman terputus. Periksa status platform sebelum mengirim ulang.' },
  });
  const rows = await prisma.recruitmentPublication.findMany({ where: { jobPostingId: id }, orderBy: { createdAt: 'asc' } });
  res.json({ data: rows.map(dto) });
});

const claim = async (jobPostingId: string, platform: RecruitmentPlatform, input: PublicationInput) => prisma.$transaction(async (tx) => {
  // Kunci hanya saat menyimpan niat pengiriman. Panggilan jaringan dilakukan setelah commit.
  await tx.$queryRaw`SELECT id FROM "JobPosting" WHERE id = ${jobPostingId} FOR UPDATE`;
  const job = await tx.jobPosting.findUnique({ where: { id: jobPostingId } });
  if (!job) throw new IntegrationError('Lowongan tidak ditemukan', 404);
  const where = { jobPostingId_platform: { jobPostingId, platform } };
  const previous = await tx.recruitmentPublication.findUnique({ where });
  if (previous?.status === 'sending' || previous?.status === 'pending') throw new IntegrationError('Pengiriman sedang diproses. Periksa status terlebih dahulu.', 409);
  const operation = input.action === 'close' ? 'CLOSE' : 'CREATE';
  let payload: Prisma.InputJsonValue;
  let requestKey: string = randomUUID();
  if (operation === 'CREATE') {
    if (job.status !== 'open' || (job.deadline && job.deadline < new Date())) throw new IntegrationError('Hanya lowongan terbuka yang belum melewati tenggat yang dapat dikirim.', 400);
    if (previous && ['published', 'closed', 'processed'].includes(previous.status)) throw new IntegrationError('Lowongan ini sudah dikirim. Periksa publikasi yang ada di platform.', 409);
    if (previous?.operation === 'CLOSE') throw new IntegrationError('Lowongan sudah memiliki proses penutupan di platform.', 409);
    if (previous?.status === 'uncertain') {
      if (platform !== 'jobstreet') throw new IntegrationError('Hasil pengiriman belum pasti. Periksa di LinkedIn sebelum mengambil tindakan lanjutan.', 409);
      requestKey = previous.requestKey;
      payload = previous.payload as Prisma.InputJsonValue;
    } else {
      payload = buildPublicationPayload(platform, job, requestKey, input.seek);
    }
  } else {
    if (!previous || previous.status === 'closed') throw new IntegrationError('Tidak ada publikasi aktif untuk ditutup.', 409);
    if (previous.status !== 'published' && !(previous.operation === 'CLOSE' && previous.status === 'failed')) throw new IntegrationError('Periksa status publikasi sebelum menutupnya.', 409);
    if (platform === 'jobstreet') {
      if (!previous.remoteId) throw new IntegrationError('ID publikasi JobStreet belum tersedia.', 409);
      payload = { positionProfile: { profileId: previous.remoteId } };
    } else {
      const original = previous.payload as { elements: Prisma.InputJsonObject[] };
      payload = { elements: [{ ...original.elements[0], jobPostingOperationType: 'CLOSE' }] };
    }
  }
  const data = { operation, status: 'sending', requestKey, payload, error: null, taskId: null, leaseUntil: new Date(Date.now() + 60_000) };
  return previous
    ? tx.recruitmentPublication.update({ where, data })
    : tx.recruitmentPublication.create({ data: { ...data, id: generateULID(), jobPostingId, platform } });
});

export const changeJobPublication = handle(async (req, res) => {
  const id = req.params.id as string, platform = req.params.platform as RecruitmentPlatform;
  const input = req.body as PublicationInput;
  requireConfiguration(platform);
  if (input.action === 'refresh') {
    const previous = await prisma.recruitmentPublication.findUnique({ where: { jobPostingId_platform: { jobPostingId: id, platform } } });
    if (!previous) throw new IntegrationError('Publikasi tidak ditemukan', 404);
    // Platform menghapus profil/tugas lama; konfirmasi penutupan yang sudah
    // tersimpan tetap berlaku setelah referensi remote kedaluwarsa.
    if (previous.status === 'closed') return res.json(dto(previous));
    if (previous.status === 'sending' && previous.leaseUntil && previous.leaseUntil > new Date()) throw new IntegrationError('Pengiriman masih berjalan. Coba periksa status sesaat lagi.', 409);
    const result = await checkPublication(platform, previous);
    const changed = await prisma.recruitmentPublication.updateMany({
      where: { id: previous.id, updatedAt: previous.updatedAt },
      data: { ...result, error: result.error ?? null, leaseUntil: null, checkedAt: new Date() },
    });
    if (!changed.count) throw new IntegrationError('Publikasi berubah saat diperiksa. Muat ulang status.', 409);
    const row = await prisma.recruitmentPublication.findUniqueOrThrow({ where: { id: previous.id } });
    return res.json(dto(row));
  }
  const row = await claim(id, platform, input);
  res.locals.audit = { entity: 'RecruitmentPublication', entityId: row.id, metadata: { platform, operation: row.operation, jobPostingId: id } };
  try {
    const result = await sendPublication(platform, row.operation, row.payload);
    const saved = await prisma.recruitmentPublication.update({ where: { id: row.id }, data: { ...result, leaseUntil: null, checkedAt: new Date() } });
    res.status(202).json(dto(saved));
  } catch (error) {
    if (!(error instanceof IntegrationError)) throw error;
    const saved = await prisma.recruitmentPublication.update({ where: { id: row.id }, data: { status: error.uncertain ? 'uncertain' : 'failed', error: error.message, leaseUntil: null, checkedAt: new Date() } });
    res.status(error.statusCode).json({ error: error.message, publication: dto(saved) });
  }
});
