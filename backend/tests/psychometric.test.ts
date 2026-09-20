import request from 'supertest';
import { Role } from '@prisma/client';
import { resetDatabase, makeEmployee, makePosition } from './helpers/db';
import { login, auth, expectStatus } from './helpers/api';
import { bikinApp } from './helpers/app';

const app = bikinApp();

let hrToken: string;
let budiToken: string;
let candidateId: string;

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1', role: Role.MANAGER });
  budiToken = await login(app, 'budi@resto.id');

  const posisi = await makePosition('Waiter');
  const lowongan = await request(app).post('/api/job-postings').set(auth(hrToken))
    .send({ title: 'Waiter', description: 'Melayani tamu', requirements: 'SMA', positionId: posisi.id, openings: 1 });
  expectStatus(lowongan, 201);
  expectStatus(await request(app).patch(`/api/job-postings/${lowongan.body.id}/status`).set(auth(hrToken)).send({ status: 'open' }), 200);
  const kandidat = await request(app).post('/api/candidates').set(auth(hrToken))
    .send({ jobPostingId: lowongan.body.id, name: 'Siti Aminah', email: 'siti@pelamar.id', source: 'referral' });
  expectStatus(kandidat, 201);
  candidateId = kandidat.body.id;
});

const catat = (ubah: Record<string, unknown> = {}) =>
  request(app).post(`/api/candidates/${candidateId}/psychometric-tests`).set(auth(hrToken)).send({
    testName: 'DISC',
    score: 72,
    maxScore: 100,
    interpretation: 'Dominan-Influence: cocok untuk peran layanan tamu.',
    ...ubah,
  });

describe('Hasil psikotes', () => {
  it('mencatat hasil beserta penilainya', async () => {
    const res = await catat();

    expectStatus(res, 201);
    expect(res.body.candidate.name).toBe('Siti Aminah');
    expect(res.body.evaluatedBy.nik).toBe('HR-1');
    expect(res.body.status).toBe('completed');
  });

  it('menolak skor melebihi skor maksimal', async () => {
    expect((await catat({ score: 120 })).status).toBe(400);
  });

  it('menolak skor melebihi maksimal juga saat diperbarui terpisah', async () => {
    const dibuat = await catat({ score: 90, maxScore: 100 });

    // Hanya maxScore yang dikirim; skor lama 90 kini melebihi batas baru.
    const res = await request(app).patch(`/api/psychometric-tests/${dibuat.body.id}`).set(auth(hrToken)).send({ maxScore: 80 });

    expect(res.status).toBe(400);
  });

  it('kandidat yang tidak ada -> 404', async () => {
    const res = await request(app).post('/api/candidates/01ARZ3NDEKTSV4RRFFQ69G5FAV/psychometric-tests').set(auth(hrToken))
      .send({ testName: 'DISC', score: 1 });

    expect(res.status).toBe(404);
  });

  it('hanya HR yang bisa mencatat maupun membaca', async () => {
    // Hasil tes psikologi adalah data pribadi kandidat; pewawancara cukup
    // tahu rekomendasinya.
    expect((await request(app).post(`/api/candidates/${candidateId}/psychometric-tests`).set(auth(budiToken)).send({ testName: 'DISC', score: 1 })).status).toBe(403);
    expect((await request(app).get('/api/psychometric-tests').set(auth(budiToken))).status).toBe(403);
  });

  it('menyaring per kandidat', async () => {
    await catat();
    await catat({ testName: 'Kraepelin', score: 60 });

    const res = await request(app).get(`/api/psychometric-tests?candidateId=${candidateId}`).set(auth(hrToken));

    expectStatus(res, 200);
    expect(res.body.pagination.total).toBe(2);
  });
});
