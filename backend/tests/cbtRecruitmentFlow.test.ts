import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee, makePosition } from './helpers/db';
import { bikinApp } from './helpers/app';
import { auth, expectStatus, login } from './helpers/api';
import { pastikanPeranSistem } from '../src/services/roles/system';
import { generateULID } from '../src/utils/generateULID';

const app = bikinApp();
type Scope = 'recruitment' | 'development';
type Answer = { questionId: string; chosen?: string[]; text?: string };
type AssignmentLink = { assignmentId: string; token: string };
let hr: string;
let hrId: string;
let employeeId: string;
let sequence: number;

beforeEach(async () => {
  await resetDatabase();
  await pastikanPeranSistem();
  const role = await prisma.customRole.findUniqueOrThrow({ where: { code: Role.SUPER_ADMIN } });
  hrId = (await makeEmployee({ email: 'seleksi@resto.id', role: Role.SUPER_ADMIN, customRoleId: role.id })).id;
  hr = await login(app, 'seleksi@resto.id');
  employeeId = (await makeEmployee({ email: 'peserta@resto.id' })).id;
  sequence = 0;
});

const roleToken = async (permissions: string[]) => {
  sequence += 1;
  const role = await prisma.customRole.create({
    data: { id: generateULID(), name: `Peran uji ${sequence}`, baseRole: Role.MANAGER, permissions },
  });
  const email = `peran${sequence}@resto.id`;
  await makeEmployee({ email, role: Role.MANAGER, customRoleId: role.id });
  return login(app, email);
};

const allCbtPermissions = [
  'cbt.lihat', 'cbt.buat', 'cbt.ubah', 'cbt.hapus',
  'cbt_soal.lihat', 'cbt_soal.buat', 'cbt_soal.ubah', 'cbt_soal.hapus',
  'cbt_hasil.lihat', 'cbt_hasil.ubah',
];

const question = async (scope: Scope, essay = false) => {
  const res = await request(app).post('/api/cbt/soal').set(auth(hr)).send({
    scope, category: scope === 'recruitment' ? 'Seleksi' : 'Pengembangan',
    type: essay ? 'esai' : 'pilihan_ganda', text: essay ? 'Jelaskan pengalaman pelayanan Anda.' : 'Pilih tindakan pelayanan yang tepat.',
    options: essay ? undefined : [{ kode: 'a', teks: 'Mengabaikan tamu' }, { kode: 'b', teks: 'Menyapa tamu' }],
    answerKey: essay ? [] : ['b'], points: 5,
  });
  expectStatus(res, 201);
  return res.body.id as string;
};

const readyTest = async (scope: Scope = 'recruitment', withEssay = false) => {
  const objectiveId = await question(scope);
  const essayId = withEssay ? await question(scope, true) : undefined;
  sequence += 1;
  const created = await request(app).post('/api/cbt/tes').set(auth(hr)).send({
    scope, code: `FLOW-${sequence}`, title: 'Paket uji alur', durationMinutes: 30,
    passingScore: 80, shuffleQuestions: false,
  });
  expectStatus(created, 201);
  expect(created.body.audience).toBe(scope === 'recruitment' ? 'pelamar' : 'karyawan');
  const testId = created.body.id as string;
  expectStatus(await request(app).put(`/api/cbt/tes/${testId}/soal`).set(auth(hr)).send({
    scope, questions: [objectiveId, ...(essayId ? [essayId] : [])].map((questionId) => ({ questionId })),
  }), 200);
  expectStatus(await request(app).put(`/api/cbt/tes/${testId}`).set(auth(hr)).send({ scope, status: 'published' }), 200);
  return { testId, objectiveId, essayId };
};

const candidate = async (offer = true) => {
  sequence += 1;
  const positionId = (await makePosition(`Posisi seleksi ${sequence}`)).id;
  const job = await request(app).post('/api/job-postings').set(auth(hr)).send({
    title: 'Petugas layanan', description: 'Melayani tamu', requirements: 'Ramah', positionId, openings: 5,
  });
  expectStatus(job, 201);
  expectStatus(await request(app).patch(`/api/job-postings/${job.body.id}/status`).set(auth(hr)).send({ status: 'open' }), 200);
  const res = await request(app).post('/api/candidates').set(auth(hr)).send({
    jobPostingId: job.body.id, name: `Pelamar ${sequence}`, email: `pelamar${sequence}@contoh.id`,
  });
  expectStatus(res, 201);
  if (offer) {
    for (const stage of ['screening', 'interview', 'offer']) {
      expectStatus(await request(app).patch(`/api/candidates/${res.body.id}/stage`).set(auth(hr)).send({ stage }), 200);
    }
  }
  return res.body.id as string;
};

const assign = async (testId: string, candidateId: string, extra: Record<string, unknown> = {}) => {
  const res = await request(app).post('/api/cbt/penugasan').set(auth(hr)).send({
    scope: 'recruitment', testId, candidateIds: [candidateId], ...extra,
  });
  expectStatus(res, 201);
  return res.body.tautan[0] as AssignmentLink;
};

const start = async (link: AssignmentLink) => {
  const res = await request(app).post(`/api/cbt/publik/${link.token}/mulai`);
  expectStatus(res, 200);
  return res.body as { attemptId: string; questions: { id: string; category: string }[] };
};

const submit = async (link: AssignmentLink, answers: Answer[]) => {
  const room = await start(link);
  const res = await request(app).post(`/api/cbt/publik/${link.token}/kirim`).send({ jawaban: answers });
  expectStatus(res, 200);
  return room.attemptId;
};

const review = async (id: string, token = hr) => {
  const attempt = await prisma.cbtAttempt.findUnique({ where: { assignmentId: id }, select: { updatedAt: true } });
  return request(app).post(`/api/cbt/penugasan/${id}/review`).set(auth(token)).send({
    scope: 'recruitment', attemptUpdatedAt: (attempt?.updatedAt ?? new Date(0)).toISOString(),
  });
};

const hire = (id: string) => request(app).post(`/api/candidates/${id}/hire`).set(auth(hr)).send({
  nik: `HIRE-${id}`, joinDate: '2026-10-01',
});

const readiness = async (id: string) => {
  const res = await request(app).get(`/api/candidates/${id}`).set(auth(hr));
  expectStatus(res, 200);
  return res.body.selectionReadiness;
};

const reviewedCandidate = async (withEssay = false) => {
  const pack = await readyTest('recruitment', withEssay);
  const candidateId = await candidate();
  const link = await assign(pack.testId, candidateId);
  const attemptId = await submit(link, [
    { questionId: pack.objectiveId, chosen: ['b'] },
    ...(pack.essayId ? [{ questionId: pack.essayId, text: 'Saya melayani tamu setiap hari.' }] : []),
  ]);
  if (pack.essayId) {
    expectStatus(await request(app).put(`/api/cbt/hasil/${attemptId}/nilai`).set(auth(hr)).send({
      scope: 'recruitment', scores: [{ questionId: pack.essayId, points: 4 }],
    }), 200);
  }
  expectStatus(await review(link.assignmentId), 200);
  return { ...pack, ...link, candidateId, attemptId };
};

describe('Batas seleksi pelamar dan pengembangan karyawan', () => {
  it('memisahkan katalog, kategori, ID langsung, dan soal penyusun paket di sisi server', async () => {
    const recruitment = await readyTest();
    const development = await readyTest('development');
    for (const [scope, own, other] of [
      ['recruitment', recruitment, development], ['development', development, recruitment],
    ] as const) {
      const packages = await request(app).get('/api/cbt/tes').query({ scope }).set(auth(hr));
      expectStatus(packages, 200);
      expect(packages.body.data.map((p: { id: string }) => p.id)).toEqual([own.testId]);
      const questions = await request(app).get('/api/cbt/soal').query({ scope }).set(auth(hr));
      expectStatus(questions, 200);
      expect(questions.body.data.map((q: { id: string }) => q.id)).toEqual([own.objectiveId]);
      const categories = await request(app).get('/api/cbt/soal/kategori').query({ scope }).set(auth(hr));
      expectStatus(categories, 200);
      expect(categories.body.data).toEqual([{ category: scope === 'recruitment' ? 'Seleksi' : 'Pengembangan', jumlah: 1 }]);
      expectStatus(await request(app).get(`/api/cbt/tes/${other.testId}`).query({ scope }).set(auth(hr)), 404);
      expectStatus(await request(app).put(`/api/cbt/soal/${other.objectiveId}`).set(auth(hr)).send({ scope, text: 'Perubahan dari lingkup lain' }), 404);
      expectStatus(await request(app).put(`/api/cbt/tes/${own.testId}/soal`).set(auth(hr)).send({
        scope, questions: [{ questionId: other.objectiveId }],
      }), 400);
    }
    const defaultList = await request(app).get('/api/cbt/tes').set(auth(hr));
    expectStatus(defaultList, 200);
    expect(defaultList.body.data.map((p: { id: string }) => p.id)).toEqual([development.testId]);
    expectStatus(await request(app).post('/api/cbt/tes').set(auth(hr)).send({
      scope: 'recruitment', audience: 'keduanya', code: 'MIX-NEW', title: 'Tidak boleh bercampur', durationMinutes: 10,
    }), 400);
    expectStatus(await request(app).get('/api/cbt/tes?scope=shared').set(auth(hr)), 400);
    expectStatus(await request(app).put(`/api/cbt/tes/${recruitment.testId}?scope=development`).set(auth(hr)).send({
      scope: 'recruitment', title: 'Lingkup bertentangan',
    }), 400);
  });

  it('pelatih tanpa izin rekrutmen tidak memperoleh katalog, jawaban, foto, atau jalur mutasi seleksi', async () => {
    const selected = await reviewedCandidate(true);
    const trainer = await roleToken(allCbtPermissions);
    const photo = await prisma.cbtProctorPhoto.create({
      data: { id: generateULID(), attemptId: selected.attemptId, storagePath: 'foto-yang-tidak-boleh-dibaca.enc' },
    });
    for (const endpoint of [
      '/api/cbt/tes', '/api/cbt/soal', '/api/cbt/soal/kategori', '/api/cbt/penugasan', '/api/cbt/hasil',
      `/api/cbt/tes/${selected.testId}`, `/api/cbt/hasil/${selected.attemptId}`,
      `/api/cbt/hasil/${selected.attemptId}/foto/${photo.id}`,
    ]) {
      expectStatus(await request(app).get(endpoint).query({ scope: 'recruitment' }).set(auth(trainer)), 403);
    }
    // Menghilangkan scope tidak boleh membuka data lewat ID yang sudah diketahui.
    expectStatus(await request(app).get(`/api/cbt/hasil/${selected.attemptId}`).set(auth(trainer)), 404);
    expectStatus(await request(app).get(`/api/cbt/hasil/${selected.attemptId}/foto/${photo.id}`).set(auth(trainer)), 404);
    expectStatus(await request(app).put(`/api/cbt/hasil/${selected.attemptId}/nilai`).set(auth(trainer)).send({
      scope: 'recruitment', scores: [{ questionId: selected.essayId, points: 1 }],
    }), 403);
    expectStatus(await review(selected.assignmentId, trainer), 403);
    expectStatus(await request(app).post(`/api/cbt/penugasan/${selected.assignmentId}/tautan`).set(auth(trainer)).send({ scope: 'recruitment' }), 403);
    expectStatus(await request(app).delete(`/api/cbt/penugasan/${selected.assignmentId}`).query({ scope: 'recruitment' }).set(auth(trainer)), 403);
    expect((await request(app).get('/api/cbt/hasil').set(auth(trainer))).body.data).toEqual([]);
    expect((await request(app).get('/api/cbt/penugasan').set(auth(trainer))).body.data).toEqual([]);
    expect((await prisma.cbtAssignment.findUniqueOrThrow({ where: { id: selected.assignmentId } })).reviewedAt).not.toBeNull();
  });

  it('mempertahankan materi bersama lama tetapi melarang pelatih mengubah materi yang juga dipakai seleksi', async () => {
    const legacy = await readyTest('development');
    await prisma.cbtTest.update({ where: { id: legacy.testId }, data: { audience: 'keduanya' } });
    await prisma.cbtQuestion.update({ where: { id: legacy.objectiveId }, data: { scope: 'shared' } });
    const trainer = await roleToken(allCbtPermissions);
    for (const scope of ['recruitment', 'development']) {
      const list = await request(app).get('/api/cbt/tes').query({ scope }).set(auth(hr));
      expectStatus(list, 200);
      expect(list.body.data.map((p: { id: string }) => p.id)).toContain(legacy.testId);
    }
    expectStatus(await request(app).get(`/api/cbt/tes/${legacy.testId}`).set(auth(trainer)), 200);
    expectStatus(await request(app).put(`/api/cbt/tes/${legacy.testId}`).set(auth(trainer)).send({ title: 'Diubah pelatih' }), 403);
    expectStatus(await request(app).put(`/api/cbt/soal/${legacy.objectiveId}`).set(auth(trainer)).send({ answerKey: ['a'] }), 403);
    const candidateId = await candidate();
    const link = await assign(legacy.testId, candidateId);
    await submit(link, [{ questionId: legacy.objectiveId, chosen: ['b'] }]);
    expectStatus(await review(link.assignmentId), 200);
    expect((await readiness(candidateId)).ready).toBe(true);
  });

  it('membatasi penerima, mengunci audiens sesudah penugasan, dan memberi default wajib hanya pada pelamar', async () => {
    const recruitment = await readyTest();
    const development = await readyTest('development');
    const candidateId = await candidate();
    expectStatus(await request(app).post('/api/cbt/penugasan').set(auth(hr)).send({
      scope: 'recruitment', testId: recruitment.testId, employeeIds: [employeeId],
    }), 400);
    expectStatus(await request(app).post('/api/cbt/penugasan').set(auth(hr)).send({
      scope: 'development', testId: development.testId, candidateIds: [candidateId],
    }), 400);
    expectStatus(await request(app).post('/api/cbt/penugasan').set(auth(hr)).send({
      scope: 'recruitment', testId: recruitment.testId, candidateIds: [candidateId], employeeIds: [employeeId],
    }), 400);
    const link = await assign(recruitment.testId, candidateId);
    expectStatus(await request(app).post('/api/cbt/penugasan').set(auth(hr)).send({
      scope: 'development', testId: development.testId, employeeIds: [employeeId],
    }), 201);
    expect((await prisma.cbtAssignment.findUniqueOrThrow({ where: { id: link.assignmentId } })).required).toBe(true);
    expect((await prisma.cbtAssignment.findFirstOrThrow({ where: { employeeId } })).required).toBe(false);
    expectStatus(await request(app).put(`/api/cbt/tes/${recruitment.testId}`).set(auth(hr)).send({
      scope: 'recruitment', audience: 'karyawan',
    }), 409);
  });

  it('tautan pelamar hanya dapat menyimpan soal paketnya dan karyawan tidak dapat mengambil pengerjaan pelamar', async () => {
    const recruitment = await readyTest();
    const development = await readyTest('development');
    const candidateId = await candidate();
    const link = await assign(recruitment.testId, candidateId);
    const room = await start(link);
    expect(JSON.stringify(room)).not.toContain('answerKey');
    expectStatus(await request(app).put(`/api/cbt/publik/${link.token}/jawaban`).send({
      jawaban: [{ questionId: development.objectiveId, chosen: ['b'] }],
    }), 404);
    const employee = await login(app, 'peserta@resto.id');
    expectStatus(await request(app).post(`/api/cbt/saya/${link.assignmentId}/mulai`).set(auth(employee)), 404);
    expectStatus(await request(app).put(`/api/cbt/saya/${link.assignmentId}/jawaban`).set(auth(employee)).send({
      jawaban: [{ questionId: recruitment.objectiveId, chosen: ['b'] }],
    }), 404);
    expect(await prisma.cbtAnswer.count({ where: { attemptId: room.attemptId } })).toBe(0);
  });
});

describe('Syarat tes seleksi dan keputusan penerimaan oleh HR', () => {
  it('catatan psikotes manual dan tes opsional tidak menggantikan minimal satu tes CBT wajib', async () => {
    const candidateId = await candidate();
    await prisma.psychometricTestResult.create({ data: {
      id: generateULID(), candidateId, testName: 'Catatan lama', score: 90, maxScore: 100,
      status: 'reviewed', evaluatedById: hrId,
    } });
    expect(await readiness(candidateId)).toMatchObject({ requiredCount: 0, ready: false });
    expectStatus(await hire(candidateId), 409);
    const pack = await readyTest();
    const link = await assign(pack.testId, candidateId, { required: false });
    await submit(link, [{ questionId: pack.objectiveId, chosen: ['b'] }]);
    expectStatus(await review(link.assignmentId), 200);
    expect(await readiness(candidateId)).toMatchObject({ requiredCount: 0, ready: false });
    expectStatus(await hire(candidateId), 409);
    expect(await prisma.employee.findFirst({ where: { nik: `HIRE-${candidateId}` } })).toBeNull();
  });

  it('memblokir tiap tahap belum selesai dan menerima hanya setelah seluruh tes wajib ditinjau HR', async () => {
    const pack = await readyTest('recruitment', true);
    const candidateId = await candidate();
    const link = await assign(pack.testId, candidateId);
    expect(await readiness(candidateId)).toMatchObject({ requiredCount: 1, completedCount: 0, reviewedCount: 0, ready: false });
    expectStatus(await hire(candidateId), 409);
    expectStatus(await review(link.assignmentId), 409);
    const room = await start(link);
    expectStatus(await hire(candidateId), 409);
    expectStatus(await request(app).post(`/api/cbt/publik/${link.token}/kirim`).send({ jawaban: [
      { questionId: pack.objectiveId, chosen: ['a'] }, { questionId: pack.essayId, text: 'Menyapa tamu dengan ramah.' },
    ] }), 200);
    expectStatus(await review(link.assignmentId), 409);
    expectStatus(await hire(candidateId), 409);
    expectStatus(await request(app).put(`/api/cbt/hasil/${room.attemptId}/nilai`).set(auth(hr)).send({
      scope: 'recruitment', scores: [{ questionId: pack.essayId, points: 1 }],
    }), 200);
    expect(await readiness(candidateId)).toMatchObject({ requiredCount: 1, completedCount: 1, reviewedCount: 0, ready: false });
    expectStatus(await hire(candidateId), 409);
    const reviewed = await review(link.assignmentId);
    expectStatus(reviewed, 200);
    expect(reviewed.body).toMatchObject({ required: true, reviewedBy: { id: hrId } });
    expect(reviewed.body.reviewedAt).toEqual(expect.any(String));
    expect(await readiness(candidateId)).toMatchObject({ requiredCount: 1, completedCount: 1, reviewedCount: 1, ready: true });
    // Skor rendah tidak membuat keputusan otomatis; HR tetap memutuskan penerimaan.
    expect((await prisma.cbtAttempt.findUniqueOrThrow({ where: { id: room.attemptId } })).passed).toBe(false);
    expectStatus(await request(app).patch(`/api/candidates/${candidateId}/stage`).set(auth(hr)).send({ stage: 'hired' }), 409);
    const accepted = await hire(candidateId);
    expectStatus(accepted, 201);
    expect(accepted.body.candidate).toMatchObject({ status: 'hired', hiredEmployeeId: accepted.body.employee.id });
    expect(await prisma.cbtAssignment.count({ where: { candidateId } })).toBe(1);
    expect((await prisma.cbtAssignment.findUniqueOrThrow({ where: { id: link.assignmentId } })).reviewedAt).not.toBeNull();
    expectStatus(await hire(candidateId), 409);
  });

  it('hasil kosong yang sudah dinilai otomatis tidak dapat ditinjau atau dipakai menerima pelamar', async () => {
    const pack = await readyTest();
    const candidateId = await candidate();
    const link = await assign(pack.testId, candidateId);
    await submit(link, []);
    expect((await prisma.cbtAssignment.findUniqueOrThrow({ where: { id: link.assignmentId } })).status).toBe('graded');
    expectStatus(await review(link.assignmentId), 409);
    expect(await readiness(candidateId)).toMatchObject({ completedCount: 0, reviewedCount: 0, ready: false });
    expectStatus(await hire(candidateId), 409);
  });

  it('menuntut 80% jawaban pada setiap dimensi inventori, bukan hanya 80% keseluruhan', async () => {
    const standard = await request(app).post('/api/cbt/tes/standar/kepribadian-big5').set(auth(hr)).send({ scope: 'recruitment' });
    expectStatus(standard, 201);
    const candidateId = await candidate();
    const link = await assign(standard.body.id, candidateId);
    const room = await start(link);
    const oneCategory = room.questions[0].category;
    let omitted = 0;
    const enoughOverall = room.questions.filter((q) => {
      if (q.category === oneCategory && omitted < 3) { omitted += 1; return false; }
      return true;
    });
    expect(enoughOverall).toHaveLength(47);
    expectStatus(await request(app).post(`/api/cbt/publik/${link.token}/kirim`).send({
      jawaban: enoughOverall.map((q) => ({ questionId: q.id, chosen: ['3'] })),
    }), 200);
    expectStatus(await review(link.assignmentId), 409);
    expectStatus(await hire(candidateId), 409);

    const another = await candidate();
    const complete = await assign(standard.body.id, another);
    const nextRoom = await start(complete);
    const counts = new Map<string, number>();
    const perDimension = nextRoom.questions.filter((q) => {
      const count = (counts.get(q.category) ?? 0) + 1;
      counts.set(q.category, count);
      return count <= 8;
    });
    expect(perDimension).toHaveLength(40);
    expectStatus(await request(app).post(`/api/cbt/publik/${complete.token}/kirim`).send({
      jawaban: perDimension.map((q) => ({ questionId: q.id, chosen: ['3'] })),
    }), 200);
    expectStatus(await review(complete.assignmentId), 200);
    expect((await readiness(another)).ready).toBe(true);
  });

  it('review memerlukan kedua izin: melihat hasil dan mengubah rekrutmen', async () => {
    const pack = await readyTest();
    const candidateId = await candidate();
    const link = await assign(pack.testId, candidateId);
    await submit(link, [{ questionId: pack.objectiveId, chosen: ['b'] }]);
    const resultViewer = await roleToken(['cbt_hasil.lihat', 'rekrutmen.lihat']);
    const recruiterOnly = await roleToken(['rekrutmen.ubah']);
    const reviewer = await roleToken(['cbt_hasil.lihat', 'rekrutmen.ubah']);
    expectStatus(await review(link.assignmentId, resultViewer), 403);
    expectStatus(await review(link.assignmentId, recruiterOnly), 403);
    expectStatus(await review(link.assignmentId, reviewer), 200);
    expect((await readiness(candidateId)).ready).toBe(true);
  });

  it('penilaian ulang membatalkan tinjauan sebelumnya sampai HR meninjau hasil baru', async () => {
    const selected = await reviewedCandidate(true);
    expectStatus(await request(app).put(`/api/cbt/hasil/${selected.attemptId}/nilai`).set(auth(hr)).send({
      scope: 'recruitment', scores: [{ questionId: selected.essayId, points: 2 }],
    }), 200);
    const assignment = await prisma.cbtAssignment.findUniqueOrThrow({ where: { id: selected.assignmentId } });
    expect(assignment).toMatchObject({ reviewedAt: null, reviewedById: null });
    expect(await readiness(selected.candidateId)).toMatchObject({ completedCount: 1, reviewedCount: 0, ready: false });
    expectStatus(await hire(selected.candidateId), 409);
    expectStatus(await review(selected.assignmentId), 200);
    expectStatus(await hire(selected.candidateId), 201);
  });

  it('menolak tinjauan dari halaman hasil lama setelah penilai lain mengubah nilai', async () => {
    const selected = await reviewedCandidate(true);
    const loaded = await request(app).get(`/api/cbt/hasil/${selected.attemptId}`)
      .query({ scope: 'recruitment' }).set(auth(hr));
    expectStatus(loaded, 200);
    const oldVersion = loaded.body.attempt.updatedAt as string;
    expect(oldVersion).toEqual(expect.any(String));

    expectStatus(await request(app).put(`/api/cbt/hasil/${selected.attemptId}/nilai`).set(auth(hr)).send({
      scope: 'recruitment', scores: [{ questionId: selected.essayId, points: 1 }],
    }), 200);
    const staleReview = await request(app).post(`/api/cbt/penugasan/${selected.assignmentId}/review`)
      .set(auth(hr)).send({ scope: 'recruitment', attemptUpdatedAt: oldVersion });
    expectStatus(staleReview, 409);
    expect(staleReview.body.code).toBe('CBT_RESULT_CHANGED');
    expect(await prisma.cbtAssignment.findUniqueOrThrow({ where: { id: selected.assignmentId } }))
      .toMatchObject({ reviewedAt: null, reviewedById: null });
    expect(await readiness(selected.candidateId)).toMatchObject({ completedCount: 1, reviewedCount: 0, ready: false });
    expectStatus(await hire(selected.candidateId), 409);

    const refreshed = await request(app).get(`/api/cbt/hasil/${selected.attemptId}`)
      .query({ scope: 'recruitment' }).set(auth(hr));
    expectStatus(refreshed, 200);
    expect(refreshed.body.attempt.updatedAt).not.toBe(oldVersion);
    const freshReview = await request(app).post(`/api/cbt/penugasan/${selected.assignmentId}/review`)
      .set(auth(hr)).send({ scope: 'recruitment', attemptUpdatedAt: refreshed.body.attempt.updatedAt });
    expectStatus(freshReview, 200);
    expect((await readiness(selected.candidateId)).ready).toBe(true);
  });

  it('materi seleksi yang sudah ditinjau tetap utuh ketika bank soal disunting', async () => {
    const selected = await reviewedCandidate();
    const before = await prisma.cbtAssignment.findUniqueOrThrow({ where: { id: selected.assignmentId } });
    const update = (changes: Record<string, unknown>) => request(app)
      .put(`/api/cbt/soal/${selected.objectiveId}`).set(auth(hr)).send({ scope: 'recruitment', ...changes });
    expectStatus(await update({ category: 'Dimensi berbeda' }), 409);
    expectStatus(await update({ text: 'Pertanyaan baru sesudah jawaban ditinjau.' }), 409);
    expectStatus(await update({ rubric: 'Rubrik baru sesudah ditinjau' }), 409);
    // Menyimpan formulir tanpa perubahan tidak mengubah bukti atau membatalkan tinjauan.
    expectStatus(await update({
      category: 'Seleksi', text: 'Pilih tindakan pelayanan yang tepat.',
      type: 'pilihan_ganda', points: 5, answerKey: ['b'],
      options: [{ kode: 'a', teks: 'Mengabaikan tamu' }, { kode: 'b', teks: 'Menyapa tamu' }],
    }), 200);
    const after = await prisma.cbtAssignment.findUniqueOrThrow({ where: { id: selected.assignmentId } });
    expect(after.reviewedAt).toEqual(before.reviewedAt);
    expect(after.reviewedById).toBe(before.reviewedById);
    expect((await readiness(selected.candidateId)).ready).toBe(true);
  });

  it('perubahan syarat wajib membatalkan review dan tidak boleh dilakukan dengan hanya salah satu izin', async () => {
    const selected = await reviewedCandidate();
    const trainer = await roleToken(['cbt.ubah', 'rekrutmen.lihat']);
    const recruiter = await roleToken(['rekrutmen.ubah']);
    const change = (token: string, required: boolean) => request(app)
      .patch(`/api/cbt/penugasan/${selected.assignmentId}/selection`).set(auth(token))
      .send({ scope: 'recruitment', required, reason: 'Perubahan kebutuhan seleksi oleh HR' });
    expectStatus(await change(trainer, false), 403);
    expectStatus(await change(recruiter, false), 403);
    expectStatus(await change(hr, false), 200);
    expectStatus(await hire(selected.candidateId), 409);
    expectStatus(await change(hr, true), 200);
    expect((await prisma.cbtAssignment.findUniqueOrThrow({ where: { id: selected.assignmentId } })))
      .toMatchObject({ required: true, reviewedAt: null, reviewedById: null });
    expect(await readiness(selected.candidateId)).toMatchObject({ requiredCount: 1, completedCount: 1, reviewedCount: 0, ready: false });
    expectStatus(await review(selected.assignmentId), 200);
    expect((await readiness(selected.candidateId)).ready).toBe(true);
  });

  it.each(['hired', 'rejected', 'withdrawn'])('pelamar %s tidak dapat diberi tes baru atau ditinjau', async (status) => {
    const selected = await reviewedCandidate();
    // Fixture tahap akhir; penerimaan normal dan tautan karyawan diuji terpisah.
    await prisma.candidate.update({ where: { id: selected.candidateId }, data: { status } });
    const another = await readyTest();
    expectStatus(await request(app).post('/api/cbt/penugasan').set(auth(hr)).send({
      scope: 'recruitment', testId: another.testId, candidateIds: [selected.candidateId],
    }), 409);
    expectStatus(await review(selected.assignmentId), 409);
    expect(await prisma.cbtAssignment.count({ where: { candidateId: selected.candidateId } })).toBe(1);
  });

  it('tes ulang menyimpan percobaan lama; pengecualian wajib perlu alasan dan tidak membuka pintas semua-opsional', async () => {
    const pack = await readyTest();
    const candidateId = await candidate();
    const old = await assign(pack.testId, candidateId);
    await submit(old, []);
    const change = (reason: string) => request(app).patch(`/api/cbt/penugasan/${old.assignmentId}/selection`).set(auth(hr)).send({
      scope: 'recruitment', required: false, reason,
    });
    expectStatus(await change(''), 400);
    expectStatus(await change('Percobaan kosong diganti tes ulang'), 200);
    expectStatus(await hire(candidateId), 409);
    const replacement = await assign(pack.testId, candidateId);
    await submit(replacement, [{ questionId: pack.objectiveId, chosen: ['b'] }]);
    expectStatus(await review(replacement.assignmentId), 200);
    expect(await readiness(candidateId)).toMatchObject({ requiredCount: 1, completedCount: 1, reviewedCount: 1, ready: true });
    expectStatus(await hire(candidateId), 201);
    expect(await prisma.cbtAssignment.count({ where: { candidateId } })).toBe(2);
    expect((await prisma.cbtAssignment.findUniqueOrThrow({ where: { id: old.assignmentId } })).required).toBe(false);
  });

  it('penugasan wajib serentak dengan penerimaan tidak dapat menyisipkan tes belum selesai pada pelamar yang diterima', async () => {
    const selected = await reviewedCandidate();
    const additional = await readyTest();
    const [accepted, assigned] = await Promise.all([
      hire(selected.candidateId),
      request(app).post('/api/cbt/penugasan').set(auth(hr)).send({
        scope: 'recruitment', testId: additional.testId, candidateIds: [selected.candidateId],
      }),
    ]);
    expect([accepted.status, assigned.status].sort()).toEqual([201, 409]);
    const current = await prisma.candidate.findUniqueOrThrow({ where: { id: selected.candidateId } });
    if (accepted.status === 201) {
      expect(current.status).toBe('hired');
      expect(await prisma.cbtAssignment.count({ where: { candidateId: current.id } })).toBe(1);
    } else {
      expect(current.status).toBe('offer');
      expect(current.hiredEmployeeId).toBeNull();
      expect(await readiness(current.id)).toMatchObject({ requiredCount: 2, completedCount: 1, ready: false });
    }
  });

  it('dua penugasan serentak untuk pelamar dan paket yang sama hanya membuat satu tes aktif', async () => {
    const pack = await readyTest();
    const candidateId = await candidate();
    const assignOnce = () => request(app).post('/api/cbt/penugasan').set(auth(hr)).send({
      scope: 'recruitment', testId: pack.testId, candidateIds: [candidateId],
    });
    const responses = await Promise.all([assignOnce(), assignOnce()]);
    for (const response of responses) expectStatus(response, 201);
    expect(responses.map((res) => res.body.dibuat).sort()).toEqual([0, 1]);
    expect(responses.map((res) => res.body.dilewati).sort()).toEqual([0, 1]);
    expect(await prisma.cbtAssignment.count({ where: { candidateId, testId: pack.testId } })).toBe(1);
  });

  it('penilaian ulang serentak dengan penerimaan tidak menyisakan penerimaan dengan tinjauan yang dibatalkan', async () => {
    const selected = await reviewedCandidate(true);
    const [accepted, regraded] = await Promise.all([
      hire(selected.candidateId),
      request(app).put(`/api/cbt/hasil/${selected.attemptId}/nilai`).set(auth(hr)).send({
        scope: 'recruitment', scores: [{ questionId: selected.essayId, points: 1 }],
      }),
    ]);
    const assignment = await prisma.cbtAssignment.findUniqueOrThrow({ where: { id: selected.assignmentId } });
    if (accepted.status === 201) {
      expectStatus(regraded, 409);
      expect(assignment.reviewedAt).not.toBeNull();
      expect((await prisma.candidate.findUniqueOrThrow({ where: { id: selected.candidateId } })).status).toBe('hired');
    } else {
      expectStatus(accepted, 409);
      expectStatus(regraded, 200);
      expect(assignment.reviewedAt).toBeNull();
      expect((await prisma.candidate.findUniqueOrThrow({ where: { id: selected.candidateId } })).status).toBe('offer');
    }
  });
});
