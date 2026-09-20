import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee, makePosition } from './helpers/db';
import { bikinApp } from './helpers/app';
import { login, auth, expectStatus } from './helpers/api';

const app = bikinApp();

let hrToken: string;
let budi: { id: string };
let budiToken: string;
let siti: { id: string };
let sitiToken: string;

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  budi = await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1' });
  budiToken = await login(app, 'budi@resto.id');
  siti = await makeEmployee({ email: 'siti@resto.id', nik: 'EMP-2' });
  sitiToken = await login(app, 'siti@resto.id');
});


const buatFormulir = (criteria?: unknown[]) =>
  request(app)
    .post('/api/performance/templates')
    .set(auth(hrToken))
    .send({
      name: 'KPI Waiter',
      criteria: criteria ?? [
        { code: 'KECEPATAN', name: 'Kecepatan Pelayanan', weight: 60, maxScore: 5 },
        { code: 'KERAPIAN', name: 'Kerapian', weight: 40, maxScore: 5 },
      ],
    });

const buatSiklus = (code = '2026-Q3') =>
  request(app)
    .post('/api/performance/cycles')
    .set(auth(hrToken))
    .send({
      code,
      name: `Penilaian ${code}`,
      periodType: 'quarterly',
      periodStart: '2026-07-01',
      periodEnd: '2026-09-30',
    });

const bukaSiklus = (id: string) =>
  request(app)
    .patch(`/api/performance/cycles/${id}/status`)
    .set(auth(hrToken))
    .send({ status: 'open' });

/** Menyiapkan siklus terbuka + formulir, lalu menugaskan Siti menilai Budi. */
const siapkanPenugasan = async (reviewerType = 'manager', reviewerId?: string) => {
  const formulir = await buatFormulir();
  const siklus = await buatSiklus();
  await bukaSiklus(siklus.body.id);

  const review = await request(app)
    .post('/api/performance/reviews')
    .set(auth(hrToken))
    .send({
      cycleId: siklus.body.id,
      revieweeId: budi.id,
      reviewerId: reviewerId ?? siti.id,
      reviewerType,
      formTemplateId: formulir.body.id,
    });

  return {
    cycleId: siklus.body.id as string,
    templateId: formulir.body.id as string,
    criteria: formulir.body.criteria as { id: string; code: string }[],
    reviewId: review.body.id as string,
    review,
  };
};

describe('Formulir penilaian', () => {
  it('menolak bobot yang tidak berjumlah 100', () => {
    return buatFormulir([
      { code: 'SATU', name: 'Satu', weight: 50, maxScore: 5 },
      { code: 'DUA', name: 'Dua', weight: 30, maxScore: 5 },
    ]).then((res) => {
      // Formulir berbobot 80 memberi nilai lebih rendah untuk kinerja yang
      // sama — tidak bisa dibandingkan antar-jabatan.
      expect(res.status).toBe(400);
    });
  });

  it('menolak kode kriteria ganda', async () => {
    const res = await buatFormulir([
      { code: 'SAMA', name: 'Satu', weight: 50, maxScore: 5 },
      { code: 'SAMA', name: 'Dua', weight: 50, maxScore: 5 },
    ]);

    expect(res.status).toBe(400);
    // Dipastikan gagal karena kode ganda, bukan karena aturan lain —
    // test yang lolos karena alasan keliru lebih buruk daripada test gagal.
    expect(JSON.stringify(res.body.details)).toContain('ganda');
  });

  it('menyimpan kriteria beserta bobotnya', async () => {
    const res = await buatFormulir();

    expect(res.status).toBe(201);
    expect(res.body.criteria).toHaveLength(2);
    expect(res.body.criteria[0]).toMatchObject({ code: 'KECEPATAN', weight: 60, maxScore: 5 });
  });

  it('bisa diikat ke jabatan tertentu', async () => {
    const posisi = await makePosition('Waiter');

    const res = await request(app)
      .post('/api/performance/templates')
      .set(auth(hrToken))
      .send({
        name: 'KPI Waiter',
        positionId: posisi.id,
        criteria: [{ code: 'MUTU', name: 'Mutu Kerja', weight: 100, maxScore: 5 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.positionId).toBe(posisi.id);
  });

  it('karyawan biasa tidak boleh membuat formulir', async () => {
    const res = await request(app)
      .post('/api/performance/templates')
      .set(auth(budiToken))
      .send({ name: 'X', criteria: [{ code: 'MUTU', name: 'Mutu Kerja', weight: 100 }] });

    expect(res.status).toBe(403);
  });
});

describe('Siklus penilaian', () => {
  it('dibuat sebagai draft', async () => {
    const res = await buatSiklus();
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
  });

  it('menolak penugasan pada siklus yang belum dibuka', async () => {
    const formulir = await buatFormulir();
    const siklus = await buatSiklus();

    const res = await request(app)
      .post('/api/performance/reviews')
      .set(auth(hrToken))
      .send({
        cycleId: siklus.body.id,
        revieweeId: budi.id,
        reviewerId: siti.id,
        reviewerType: 'manager',
        formTemplateId: formulir.body.id,
      });

    expect(res.status).toBe(409);
  });

  it('tidak bisa membuka kembali siklus yang sudah ditutup', async () => {
    const siklus = await buatSiklus();
    await bukaSiklus(siklus.body.id);
    await request(app)
      .patch(`/api/performance/cycles/${siklus.body.id}/status`)
      .set(auth(hrToken))
      .send({ status: 'closed' });

    const res = await bukaSiklus(siklus.body.id);
    expect(res.status).toBe(409);
  });

  it('menolak kode siklus ganda', async () => {
    await buatSiklus('2026-Q3');
    const res = await buatSiklus('2026-Q3');
    expect(res.status).toBe(409);
  });
});

describe('Penugasan penilaian 360 derajat', () => {
  it('menugaskan penilai dengan sudut pandangnya', async () => {
    const { review } = await siapkanPenugasan('manager');

    expect(review.status).toBe(201);
    expect(review.body.reviewerType).toBe('manager');
    expect(review.body.status).toBe('draft');
  });

  it('menuntut reviewerType "self" saat menilai diri sendiri', async () => {
    const formulir = await buatFormulir();
    const siklus = await buatSiklus();
    await bukaSiklus(siklus.body.id);

    const res = await request(app)
      .post('/api/performance/reviews')
      .set(auth(hrToken))
      .send({
        cycleId: siklus.body.id,
        revieweeId: budi.id,
        reviewerId: budi.id,
        reviewerType: 'manager',
        formTemplateId: formulir.body.id,
      });

    // Kalau tercampur, nilai penilaian diri masuk ke rata-rata atasan.
    expect(res.status).toBe(400);
  });

  it('menolak penugasan ganda dari sudut pandang yang sama', async () => {
    const { cycleId, templateId } = await siapkanPenugasan('peer');

    const res = await request(app)
      .post('/api/performance/reviews')
      .set(auth(hrToken))
      .send({
        cycleId,
        revieweeId: budi.id,
        reviewerId: siti.id,
        reviewerType: 'peer',
        formTemplateId: templateId,
      });

    expect(res.status).toBe(409);
  });
});

describe('Pengisian penilaian', () => {
  it('menghitung nilai berbobot di server', async () => {
    const { reviewId, criteria } = await siapkanPenugasan();

    const res = await request(app)
      .post(`/api/performance/reviews/${reviewId}/submit`)
      .set(auth(sitiToken))
      .send({
        scores: [
          { criterionId: criteria[0].id, score: 4 }, // bobot 60
          { criterionId: criteria[1].id, score: 3 }, // bobot 40
        ],
        feedback: 'Perlu lebih teliti',
      });

    expect(res.status).toBe(200);
    // (4/5 × 60) + (3/5 × 40) = 72.
    expect(res.body.totalScore).toBe(72);
    expect(res.body.rating).toBe(3.6);
    expect(res.body.status).toBe('submitted');
  });

  it('menyimpan nilai per kriteria, bukan satu gumpalan', async () => {
    const { reviewId, criteria } = await siapkanPenugasan();

    await request(app)
      .post(`/api/performance/reviews/${reviewId}/submit`)
      .set(auth(sitiToken))
      .send({
        scores: [
          { criterionId: criteria[0].id, score: 5, comment: 'Sangat cepat' },
          { criterionId: criteria[1].id, score: 2 },
        ],
      });

    const res = await request(app)
      .get(`/api/performance/reviews/${reviewId}`)
      .set(auth(sitiToken));

    expect(res.body.scores).toHaveLength(2);
    const kecepatan = res.body.scores.find(
      (s: { criterion: { code: string } }) => s.criterion.code === 'KECEPATAN'
    );
    expect(kecepatan).toMatchObject({ score: 5, comment: 'Sangat cepat' });
  });

  it('menolak bila ada kriteria yang belum dinilai', async () => {
    const { reviewId, criteria } = await siapkanPenugasan();

    const res = await request(app)
      .post(`/api/performance/reviews/${reviewId}/submit`)
      .set(auth(sitiToken))
      .send({ scores: [{ criterionId: criteria[0].id, score: 4 }] });

    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('missing_score');
  });

  it('menolak nilai di luar rentang kriteria', async () => {
    const { reviewId, criteria } = await siapkanPenugasan();

    const res = await request(app)
      .post(`/api/performance/reviews/${reviewId}/submit`)
      .set(auth(sitiToken))
      .send({
        scores: [
          { criterionId: criteria[0].id, score: 99 },
          { criterionId: criteria[1].id, score: 3 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('out_of_range');
  });

  it('hanya penilai yang ditugaskan yang bisa mengisi', async () => {
    const { reviewId, criteria } = await siapkanPenugasan();

    const isi = (token: string) =>
      request(app)
        .post(`/api/performance/reviews/${reviewId}/submit`)
        .set(auth(token))
        .send({
          scores: [
            { criterionId: criteria[0].id, score: 4 },
            { criterionId: criteria[1].id, score: 4 },
          ],
        });

    // Bahkan HR tidak menggantikan penilaian orang: yang tercatat harus
    // benar-benar pendapat penilainya.
    expectStatus(await isi(hrToken), 403);
    expectStatus(await isi(budiToken), 403);
    expectStatus(await isi(sitiToken), 200);
  });

  it('menolak pengisian ganda', async () => {
    const { reviewId, criteria } = await siapkanPenugasan();
    const isian = {
      scores: [
        { criterionId: criteria[0].id, score: 4 },
        { criterionId: criteria[1].id, score: 4 },
      ],
    };

    await request(app)
      .post(`/api/performance/reviews/${reviewId}/submit`)
      .set(auth(sitiToken))
      .send(isian);

    const res = await request(app)
      .post(`/api/performance/reviews/${reviewId}/submit`)
      .set(auth(sitiToken))
      .send(isian);

    expect(res.status).toBe(409);
  });

  it('menolak pengisian setelah siklus ditutup', async () => {
    const { reviewId, criteria, cycleId } = await siapkanPenugasan();
    await request(app)
      .patch(`/api/performance/cycles/${cycleId}/status`)
      .set(auth(hrToken))
      .send({ status: 'closed' });

    const res = await request(app)
      .post(`/api/performance/reviews/${reviewId}/submit`)
      .set(auth(sitiToken))
      .send({
        scores: [
          { criterionId: criteria[0].id, score: 4 },
          { criterionId: criteria[1].id, score: 4 },
        ],
      });

    expect(res.status).toBe(409);
  });
});

describe('Akses dan pengakuan', () => {
  const isiPenilaian = async () => {
    const { reviewId, criteria, cycleId } = await siapkanPenugasan();
    await request(app)
      .post(`/api/performance/reviews/${reviewId}/submit`)
      .set(auth(sitiToken))
      .send({
        scores: [
          { criterionId: criteria[0].id, score: 4 },
          { criterionId: criteria[1].id, score: 3 },
        ],
      });
    return { reviewId, cycleId };
  };

  it('karyawan yang dinilai bisa mengakui penilaiannya', async () => {
    const { reviewId } = await isiPenilaian();

    const res = await request(app)
      .post(`/api/performance/reviews/${reviewId}/acknowledge`)
      .set(auth(budiToken));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('acknowledged');
  });

  it('menutup siklus memfinalkan penilaian yang terkirim, draf tetap draf', async () => {
    const { reviewId, criteria, cycleId, templateId } = await siapkanPenugasan();
    await request(app)
      .post(`/api/performance/reviews/${reviewId}/submit`)
      .set(auth(sitiToken))
      .send({ scores: [{ criterionId: criteria[0].id, score: 4 }, { criterionId: criteria[1].id, score: 3 }] });

    // Penilaian diri yang belum sempat diisi.
    const draf = await request(app)
      .post('/api/performance/reviews')
      .set(auth(hrToken))
      .send({ cycleId, revieweeId: budi.id, reviewerId: budi.id, reviewerType: 'self', formTemplateId: templateId });
    expect(draf.status).toBe(201);

    const tutup = await request(app)
      .patch(`/api/performance/cycles/${cycleId}/status`)
      .set(auth(hrToken))
      .send({ status: 'closed' });
    expect(tutup.status).toBe(200);
    expect(tutup.body.status).toBe('closed');

    const daftar = await request(app)
      .get(`/api/performance/reviews?cycleId=${cycleId}`)
      .set(auth(hrToken));
    const status = Object.fromEntries(
      daftar.body.data.map((r: { reviewerType: string; status: string }) => [r.reviewerType, r.status])
    );
    expect(status).toEqual({ manager: 'finalized', self: 'draft' });

    // Yang sudah final tidak bisa diakui lagi — tidak ada lagi yang berubah.
    const akui = await request(app)
      .post(`/api/performance/reviews/${reviewId}/acknowledge`)
      .set(auth(budiToken));
    expect(akui.status).toBe(409);
  });

  it('penilai tidak bisa mengakui atas nama yang dinilai', async () => {
    const { reviewId } = await isiPenilaian();

    const res = await request(app)
      .post(`/api/performance/reviews/${reviewId}/acknowledge`)
      .set(auth(sitiToken));

    expect(res.status).toBe(403);
  });

  it('penilai bukan HR mendapat kriteria formulir dari detail penilaian draf', async () => {
    const { reviewId } = await siapkanPenugasan();

    const res = await request(app)
      .get(`/api/performance/reviews/${reviewId}`)
      .set(auth(sitiToken));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('draft');
    expect(res.body.scores).toHaveLength(0);
    expect(res.body.criteria).toHaveLength(2);
    expect(res.body.criteria[0]).toMatchObject({ code: expect.any(String), maxScore: expect.any(Number) });
    expect(typeof res.body.criteria[0].weight).toBe('number');
  });

  it('pihak ketiga tidak bisa membuka penilaian orang lain', async () => {
    const { reviewId } = await isiPenilaian();
    await makeEmployee({ email: 'lain@resto.id', nik: 'EMP-9' });
    const lainToken = await login(app, 'lain@resto.id');

    const res = await request(app)
      .get(`/api/performance/reviews/${reviewId}`)
      .set(auth(lainToken));

    expect(res.status).toBe(403);
  });

  it('karyawan hanya melihat penilaian yang melibatkan dirinya', async () => {
    await isiPenilaian();
    await makeEmployee({ email: 'lain@resto.id', nik: 'EMP-9' });
    const lainToken = await login(app, 'lain@resto.id');

    const budiLihat = await request(app).get('/api/performance/reviews').set(auth(budiToken));
    expect(budiLihat.body.pagination.total).toBe(1);

    const lainLihat = await request(app).get('/api/performance/reviews').set(auth(lainToken));
    expect(lainLihat.body.pagination.total).toBe(0);
  });

  it('kedua pihak bisa menambah catatan diskusi', async () => {
    const { reviewId } = await isiPenilaian();

    const dariPenilai = await request(app)
      .post(`/api/performance/reviews/${reviewId}/discussions`)
      .set(auth(sitiToken))
      .send({ note: 'Sudah dibahas dalam sesi evaluasi' });
    expect(dariPenilai.status).toBe(201);

    const dariDinilai = await request(app)
      .post(`/api/performance/reviews/${reviewId}/discussions`)
      .set(auth(budiToken))
      .send({ note: 'Saya akan perbaiki kerapian' });
    expect(dariDinilai.status).toBe(201);

    const detail = await request(app)
      .get(`/api/performance/reviews/${reviewId}`)
      .set(auth(budiToken));
    expect(detail.body.discussions).toHaveLength(2);
  });
});

describe('Rangkuman 360 derajat', () => {
  it('merata-ratakan per sudut pandang, bukan per penilai', async () => {
    const formulir = await buatFormulir();
    const siklus = await buatSiklus();
    await bukaSiklus(siklus.body.id);
    const kriteria = formulir.body.criteria as { id: string }[];

    // Dua rekan sejawat menilai tinggi, satu atasan menilai rendah.
    const penilai = [
      { employee: siti, type: 'peer', score: 5, token: sitiToken },
    ];

    const rekan2 = await makeEmployee({ email: 'rekan@resto.id', nik: 'EMP-3' });
    const rekan2Token = await login(app, 'rekan@resto.id');
    penilai.push({ employee: rekan2, type: 'peer', score: 5, token: rekan2Token });

    const atasan = await makeEmployee({ email: 'atasan@resto.id', nik: 'EMP-4' });
    const atasanToken = await login(app, 'atasan@resto.id');
    penilai.push({ employee: atasan, type: 'manager', score: 1, token: atasanToken });

    for (const p of penilai) {
      const r = await request(app)
        .post('/api/performance/reviews')
        .set(auth(hrToken))
        .send({
          cycleId: siklus.body.id,
          revieweeId: budi.id,
          reviewerId: p.employee.id,
          reviewerType: p.type,
          formTemplateId: formulir.body.id,
        });

      await request(app)
        .post(`/api/performance/reviews/${r.body.id}/submit`)
        .set(auth(p.token))
        .send({
          scores: [
            { criterionId: kriteria[0].id, score: p.score },
            { criterionId: kriteria[1].id, score: p.score },
          ],
        });
    }

    const res = await request(app)
      .get(`/api/performance/summary/${siklus.body.id}/${budi.id}`)
      .set(auth(hrToken));

    expect(res.status).toBe(200);
    expect(res.body.submittedReviews).toBe(3);

    // peer rata-rata 100, manager 20. Rata-rata langsung akan 73,3;
    // dengan pembobotan per sudut pandang: 60.
    expect(res.body.overall).toBe(60);

    const peer = res.body.byReviewerType.find(
      (k: { reviewerType: string }) => k.reviewerType === 'peer'
    );
    expect(peer).toMatchObject({ count: 2, averageScore: 100 });
  });

  it('menghitung penilaian yang belum diisi', async () => {
    const { cycleId } = await siapkanPenugasan();

    const res = await request(app)
      .get(`/api/performance/summary/${cycleId}/${budi.id}`)
      .set(auth(hrToken));

    expect(res.body.submittedReviews).toBe(0);
    expect(res.body.pendingReviews).toBe(1);
    expect(res.body.overall).toBeNull();
  });

  it('karyawan bisa melihat rangkuman dirinya sendiri', async () => {
    const { cycleId } = await siapkanPenugasan();

    const res = await request(app)
      .get(`/api/performance/summary/${cycleId}/${budi.id}`)
      .set(auth(budiToken));

    expect(res.status).toBe(200);
  });

  it('karyawan tidak bisa melihat rangkuman orang lain', async () => {
    const { cycleId } = await siapkanPenugasan();

    const res = await request(app)
      .get(`/api/performance/summary/${cycleId}/${siti.id}`)
      .set(auth(budiToken));

    expect(res.status).toBe(403);
  });
});

describe('Umpan balik berkelanjutan', () => {
  it('bisa diberikan antar rekan kerja tanpa menunggu siklus', async () => {
    const res = await request(app)
      .post('/api/feedback')
      .set(auth(sitiToken))
      .send({ recipientId: budi.id, type: 'praise', message: 'Sigap membantu tamu tadi malam' });

    expect(res.status).toBe(201);
    expect(res.body.authorId).toBe(siti.id);
  });

  it('menolak umpan balik ke diri sendiri', async () => {
    const res = await request(app)
      .post('/api/feedback')
      .set(auth(budiToken))
      .send({ recipientId: budi.id, message: 'Saya hebat' });

    expect(res.status).toBe(400);
  });

  it('karyawan melihat umpan balik untuk dirinya sendiri', async () => {
    await request(app)
      .post('/api/feedback')
      .set(auth(sitiToken))
      .send({ recipientId: budi.id, message: 'Bagus' });

    const res = await request(app).get('/api/feedback').set(auth(budiToken));

    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0].message).toBe('Bagus');
  });

  it('karyawan tidak bisa melihat umpan balik orang lain', async () => {
    const res = await request(app)
      .get(`/api/feedback?recipientId=${siti.id}`)
      .set(auth(budiToken));

    expect(res.status).toBe(403);
  });

  it('HR bisa melihat umpan balik siapa pun', async () => {
    await request(app)
      .post('/api/feedback')
      .set(auth(sitiToken))
      .send({ recipientId: budi.id, message: 'Bagus' });

    const res = await request(app)
      .get(`/api/feedback?recipientId=${budi.id}`)
      .set(auth(hrToken));

    expect(res.body.pagination.total).toBe(1);
  });
});
