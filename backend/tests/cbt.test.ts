import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee, makePosition } from './helpers/db';
import { bikinApp } from './helpers/app';
import { login, auth, expectStatus } from './helpers/api';
import { pastikanPeranSistem } from '../src/services/roles/system';

const app = bikinApp();

/** JPEG 1×1 piksel yang sah — cukup panjang untuk lolos batas minimum unggahan. */
const JPEG_1PX =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='

let hr: string;
let budiId: string;

beforeEach(async () => {
  await resetDatabase();
  await pastikanPeranSistem();
  const sa = await prisma.customRole.findUniqueOrThrow({ where: { code: Role.SUPER_ADMIN } });
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.SUPER_ADMIN, customRoleId: sa.id });
  hr = await login(app, 'hr@resto.id');
  budiId = (await makeEmployee({ email: 'budi@resto.id', nik: 'K-1' })).id;
});

const buatSoal = (ubah: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/cbt/soal')
    .set(auth(hr))
    .send({
      category: 'Higiene Dapur',
      type: 'pilihan_ganda',
      text: 'Suhu aman penyimpanan daging segar?',
      options: [
        { kode: 'a', teks: 'Di atas 10°C' },
        { kode: 'b', teks: 'Di bawah 4°C' },
      ],
      answerKey: ['b'],
      points: 2,
      ...ubah,
    });

const buatPaket = (ubah: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/cbt/tes')
    .set(auth(hr))
    .send({ code: 'HIG-1', title: 'Tes Higiene Dasar', durationMinutes: 30, passingScore: 60, shuffleQuestions: false, ...ubah });

/** Paket siap tugas berisi satu soal objektif dan satu esai. */
const paketSiap = async (ubahPaket: Record<string, unknown> = {}) => {
  const pg = await buatSoal();
  const esai = await buatSoal({
    type: 'esai',
    text: 'Jelaskan alur cuci tangan enam langkah.',
    options: undefined,
    answerKey: [],
    rubric: 'Menyebut enam langkah berurutan',
    points: 8,
  });
  const paket = await buatPaket(ubahPaket);
  expectStatus(paket, 201);
  expectStatus(
    await request(app)
      .put(`/api/cbt/tes/${paket.body.id}/soal`)
      .set(auth(hr))
      .send({ questions: [{ questionId: pg.body.id }, { questionId: esai.body.id }] }),
    200
  );
  expectStatus(await request(app).put(`/api/cbt/tes/${paket.body.id}`).set(auth(hr)).send({ status: 'published' }), 200);
  return { paketId: paket.body.id as string, pgId: pg.body.id as string, esaiId: esai.body.id as string };
};

const tugaskan = (paketId: string, isi: Record<string, unknown>) =>
  request(app).post('/api/cbt/penugasan').set(auth(hr)).send({ testId: paketId, ...isi });

describe('Bank soal', () => {
  it('menolak soal berpilihan yang kuncinya tidak menunjuk pilihan mana pun', async () => {
    expectStatus(await buatSoal({ answerKey: ['z'] }), 400);
    expectStatus(await buatSoal({ options: [{ kode: 'a', teks: 'Satu-satunya' }] }), 400);
    expectStatus(await buatSoal({ type: 'pilihan_ganda', answerKey: ['a', 'b'] }), 400);
    expectStatus(await buatSoal({ type: 'isian', options: undefined, answerKey: [] }), 400);
    expectStatus(await buatSoal({ type: 'esai', options: undefined, answerKey: ['bocor'] }), 400);
  });

  it('menyimpan soal dan mengelompokkannya per kategori', async () => {
    expectStatus(await buatSoal(), 201);
    expectStatus(await buatSoal({ category: 'Numerik', text: '7 × 8 = ?', options: [{ kode: 'a', teks: '54' }, { kode: 'b', teks: '56' }], answerKey: ['b'] }), 201);

    const kategori = await request(app).get('/api/cbt/soal/kategori').set(auth(hr));
    expectStatus(kategori, 200);
    expect(kategori.body.data).toEqual(
      expect.arrayContaining([{ category: 'Higiene Dapur', jumlah: 1 }, { category: 'Numerik', jumlah: 1 }])
    );
  });

  it('soal yang sudah dijawab tidak bisa diubah kunci atau bobotnya, hanya dinonaktifkan', async () => {
    const { paketId, pgId } = await paketSiap();
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId] }), 201);
    const budi = await login(app, 'budi@resto.id');
    const daftar = await request(app).get('/api/cbt/saya').set(auth(budi));
    const assignmentId = daftar.body.data[0].id;
    expectStatus(await request(app).post(`/api/cbt/saya/${assignmentId}/mulai`).set(auth(budi)), 200);
    expectStatus(
      await request(app).put(`/api/cbt/saya/${assignmentId}/jawaban`).set(auth(budi)).send({ jawaban: [{ questionId: pgId, chosen: ['b'] }] }),
      200
    );

    expectStatus(await request(app).put(`/api/cbt/soal/${pgId}`).set(auth(hr)).send({ answerKey: ['a'] }), 409);
    expectStatus(await request(app).put(`/api/cbt/soal/${pgId}`).set(auth(hr)).send({ text: 'Perbaikan salah ketik' }), 200);

    // Dihapus setelah dipakai = dinonaktifkan, barisnya tetap ada demi hasil lama.
    const hapus = await request(app).delete(`/api/cbt/soal/${pgId}`).set(auth(hr));
    expectStatus(hapus, 200);
    expect(await prisma.cbtQuestion.findUnique({ where: { id: pgId }, select: { isActive: true } })).toEqual({ isActive: false });
  });
});

describe('Paket tes', () => {
  it('tidak bisa ditayangkan tanpa soal, dan tidak bisa ditugaskan sebelum tayang', async () => {
    const paket = await buatPaket();
    expectStatus(paket, 201);
    expectStatus(await request(app).put(`/api/cbt/tes/${paket.body.id}`).set(auth(hr)).send({ status: 'published' }), 409);
    expectStatus(await tugaskan(paket.body.id, { employeeIds: [budiId] }), 409);
  });

  it('aturan main dan isi paket terkunci setelah ditugaskan', async () => {
    const { paketId, pgId } = await paketSiap();
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId] }), 201);

    expectStatus(await request(app).put(`/api/cbt/tes/${paketId}`).set(auth(hr)).send({ durationMinutes: 90 }), 409);
    expectStatus(await request(app).put(`/api/cbt/tes/${paketId}/soal`).set(auth(hr)).send({ questions: [{ questionId: pgId }] }), 409);
    expectStatus(await request(app).delete(`/api/cbt/tes/${paketId}`).set(auth(hr)), 409);
    // Yang tidak mengubah ukuran penilaian tetap boleh.
    expectStatus(await request(app).put(`/api/cbt/tes/${paketId}`).set(auth(hr)).send({ title: 'Tes Higiene Dasar 2026' }), 200);
  });
});

describe('Pengerjaan oleh karyawan', () => {
  it('alur penuh: mulai, simpan, kirim, nilai esai, hasil akhir', async () => {
    const { paketId, pgId, esaiId } = await paketSiap();
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId] }), 201);

    const budi = await login(app, 'budi@resto.id');
    const daftar = await request(app).get('/api/cbt/saya').set(auth(budi));
    expectStatus(daftar, 200);
    expect(daftar.body.data).toHaveLength(1);
    const assignmentId = daftar.body.data[0].id;

    const mulai = await request(app).post(`/api/cbt/saya/${assignmentId}/mulai`).set(auth(budi));
    expectStatus(mulai, 200);
    expect(mulai.body.questions).toHaveLength(2);
    // Kunci jawaban, rubrik, dan pembahasan tidak boleh ikut ke peserta.
    expect(JSON.stringify(mulai.body)).not.toContain('answerKey');
    expect(JSON.stringify(mulai.body)).not.toContain('Menyebut enam langkah');
    expect(mulai.body.sisaDetik).toBeGreaterThan(0);

    // Dibuka lagi: melanjutkan pengerjaan yang sama, bukan memulai baru.
    const lanjut = await request(app).post(`/api/cbt/saya/${assignmentId}/mulai`).set(auth(budi));
    expectStatus(lanjut, 200);
    expect(lanjut.body.attemptId).toBe(mulai.body.attemptId);

    expectStatus(
      await request(app)
        .put(`/api/cbt/saya/${assignmentId}/jawaban`)
        .set(auth(budi))
        .send({ jawaban: [{ questionId: pgId, chosen: ['b'] }, { questionId: esaiId, text: 'Basahi tangan, sabun, gosok, bilas, keringkan, tutup keran.' }] }),
      200
    );

    const kirim = await request(app).post(`/api/cbt/saya/${assignmentId}/kirim`).set(auth(budi));
    expectStatus(kirim, 200);
    expect(kirim.body).toMatchObject({ status: 'submitted', menungguPenilaian: true });
    // Paket ini tidak membuka nilai untuk peserta.
    expect(kirim.body.nilai).toBeNull();
    // Dikirim dua kali ditolak.
    expectStatus(await request(app).post(`/api/cbt/saya/${assignmentId}/kirim`).set(auth(budi)), 409);

    const hasil = await request(app).get('/api/cbt/hasil').set(auth(hr));
    expectStatus(hasil, 200);
    expect(hasil.body.data[0]).toMatchObject({ status: 'submitted', employee: { id: budiId } });
    const attemptId = hasil.body.data[0].attempt.id;

    const rinci = await request(app).get(`/api/cbt/hasil/${attemptId}`).set(auth(hr));
    expectStatus(rinci, 200);
    const objektif = rinci.body.butir.find((b: { questionId: string }) => b.questionId === pgId);
    expect(objektif).toMatchObject({ isCorrect: true, points: 2, otomatis: true });
    expect(rinci.body.butir.find((b: { questionId: string }) => b.questionId === esaiId)).toMatchObject({ points: null, otomatis: false });

    // Nilai esai melebihi bobot ditolak; soal objektif tidak bisa dinilai manual.
    expectStatus(await request(app).put(`/api/cbt/hasil/${attemptId}/nilai`).set(auth(hr)).send({ scores: [{ questionId: esaiId, points: 99 }] }), 400);
    expectStatus(await request(app).put(`/api/cbt/hasil/${attemptId}/nilai`).set(auth(hr)).send({ scores: [{ questionId: pgId, points: 1 }] }), 400);

    const nilai = await request(app)
      .put(`/api/cbt/hasil/${attemptId}/nilai`)
      .set(auth(hr))
      .send({ scores: [{ questionId: esaiId, points: 6, graderNote: 'Enam langkah lengkap' }] });
    expectStatus(nilai, 200);
    expect(nilai.body).toMatchObject({ status: 'graded' });
    expect(nilai.body.nilai).toMatchObject({ objektif: 2, esai: 6, total: 8, maksimal: 10, persen: 80, lulus: true });

    const rinciSesudah = await request(app).get(`/api/cbt/hasil/${attemptId}`).set(auth(hr));
    expect(rinciSesudah.body.perKategori).toEqual(
      expect.arrayContaining([expect.objectContaining({ kategori: 'Higiene Dapur', maksimal: 10, diperoleh: 8 })])
    );
  });

  it('nilai dibuka untuk peserta hanya bila paketnya mengizinkan', async () => {
    const { paketId, pgId } = await paketSiap({ code: 'HIG-2', showResultToTaker: true });
    // Paket khusus objektif supaya nilainya langsung keluar.
    await prisma.cbtTestQuestion.deleteMany({ where: { testId: paketId, question: { type: 'esai' } } });
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId] }), 201);

    const budi = await login(app, 'budi@resto.id');
    const daftar = await request(app).get('/api/cbt/saya').set(auth(budi));
    const id = daftar.body.data[0].id;
    expectStatus(await request(app).post(`/api/cbt/saya/${id}/mulai`).set(auth(budi)), 200);
    expectStatus(await request(app).put(`/api/cbt/saya/${id}/jawaban`).set(auth(budi)).send({ jawaban: [{ questionId: pgId, chosen: ['b'] }] }), 200);

    const kirim = await request(app).post(`/api/cbt/saya/${id}/kirim`).set(auth(budi));
    expectStatus(kirim, 200);
    expect(kirim.body).toMatchObject({ status: 'graded' });
    expect(kirim.body.nilai).toMatchObject({ total: 2, maksimal: 2, persen: 100, lulus: true });

    const hasilSaya = await request(app).get(`/api/cbt/saya/${id}/hasil`).set(auth(budi));
    expectStatus(hasilSaya, 200);
    expect(hasilSaya.body.nilai).toMatchObject({ persen: 100, lulus: true });
  });

  it('tes milik orang lain tidak bisa dibuka', async () => {
    const { paketId } = await paketSiap();
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId] }), 201);
    const penugasan = await prisma.cbtAssignment.findFirstOrThrow();

    await makeEmployee({ email: 'siti@resto.id', nik: 'K-2' });
    const siti = await login(app, 'siti@resto.id');
    expectStatus(await request(app).post(`/api/cbt/saya/${penugasan.id}/mulai`).set(auth(siti)), 404);
    expect((await request(app).get('/api/cbt/saya').set(auth(siti))).body.data).toHaveLength(0);
  });

  it('jawaban setelah waktu habis ditolak dan tes dikirim otomatis', async () => {
    const { paketId, pgId } = await paketSiap({ code: 'HIG-3' });
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId] }), 201);
    const budi = await login(app, 'budi@resto.id');
    const daftar = await request(app).get('/api/cbt/saya').set(auth(budi));
    const id = daftar.body.data[0].id;
    expectStatus(await request(app).post(`/api/cbt/saya/${id}/mulai`).set(auth(budi)), 200);

    // Waktu dimundurkan seolah durasi tes sudah lewat.
    await prisma.cbtAttempt.updateMany({ data: { deadlineAt: new Date(Date.now() - 1000) } });

    const telat = await request(app).put(`/api/cbt/saya/${id}/jawaban`).set(auth(budi)).send({ jawaban: [{ questionId: pgId, chosen: ['b'] }] });
    expectStatus(telat, 200);
    expect(telat.body).toMatchObject({ tersimpan: 0, dikirimOtomatis: true });

    const attempt = await prisma.cbtAttempt.findFirstOrThrow();
    expect(attempt.autoSubmitted).toBe(true);
    expect(attempt.submittedAt).not.toBeNull();
    // Jawaban yang datang setelah bel tidak ikut dinilai.
    expect(attempt.scoreObjective).toBe(0);
  });
});

describe('Pengerjaan oleh pelamar lewat tautan', () => {
  const buatPelamar = async () => {
    const positionId = (await makePosition('Waiter')).id;
    const lowongan = await request(app)
      .post('/api/job-postings')
      .set(auth(hr))
      .send({ title: 'Waiter', description: 'Melayani tamu', requirements: 'SMA', positionId, openings: 1 });
    expectStatus(lowongan, 201);
    await request(app).patch(`/api/job-postings/${lowongan.body.id}/status`).set(auth(hr)).send({ status: 'open' });
    const pelamar = await request(app)
      .post('/api/candidates')
      .set(auth(hr))
      .send({ jobPostingId: lowongan.body.id, name: 'Siti Aminah', email: 'siti@pelamar.id' });
    expectStatus(pelamar, 201);
    return pelamar.body.id as string;
  };

  it('token membuka tepat satu tes, tanpa akun, dan hanya sekali kerja', async () => {
    const { paketId, pgId, esaiId } = await paketSiap({ code: 'SEL-1', audience: 'pelamar' });
    const candidateId = await buatPelamar();

    const tugas = await tugaskan(paketId, { candidateIds: [candidateId] });
    expectStatus(tugas, 201);
    expect(tugas.body.tautan).toHaveLength(1);
    const token: string = tugas.body.tautan[0].token;
    expect(token).toHaveLength(43);
    // Yang tersimpan hanya sidiknya, bukan tokennya.
    const tersimpan = await prisma.cbtAssignment.findFirstOrThrow({ select: { accessTokenHash: true } });
    expect(tersimpan.accessTokenHash).not.toBe(token);

    const info = await request(app).get(`/api/cbt/publik/${token}`);
    expectStatus(info, 200);
    expect(info.body).toMatchObject({ peserta: 'Siti Aminah', status: 'assigned' });
    expect(info.body.test).toMatchObject({ jumlahSoal: 2 });

    const mulai = await request(app).post(`/api/cbt/publik/${token}/mulai`);
    expectStatus(mulai, 200);
    expect(mulai.body.questions).toHaveLength(2);

    expectStatus(
      await request(app).put(`/api/cbt/publik/${token}/jawaban`).send({ jawaban: [{ questionId: pgId, chosen: ['a'] }, { questionId: esaiId, text: 'Cuci tangan.' }] }),
      200
    );
    expectStatus(await request(app).post(`/api/cbt/publik/${token}/kirim`), 200);
    expectStatus(await request(app).post(`/api/cbt/publik/${token}/mulai`), 409);

    const hasil = await request(app).get('/api/cbt/hasil').set(auth(hr));
    expect(hasil.body.data[0]).toMatchObject({ status: 'submitted', candidate: { name: 'Siti Aminah' } });
  });

  it('token asal-asalan ditolak, dan tautan bisa dibuat ulang sehingga yang lama mati', async () => {
    const { paketId } = await paketSiap({ code: 'SEL-2', audience: 'pelamar' });
    const candidateId = await buatPelamar();
    const tugas = await tugaskan(paketId, { candidateIds: [candidateId] });
    const lama: string = tugas.body.tautan[0].token;

    expectStatus(await request(app).get(`/api/cbt/publik/${'x'.repeat(43)}`), 404);
    expectStatus(await request(app).get(`/api/cbt/publik/terlalu-pendek`), 400);

    const baru = await request(app).post(`/api/cbt/penugasan/${tugas.body.tautan[0].assignmentId}/tautan`).set(auth(hr));
    expectStatus(baru, 200);
    expectStatus(await request(app).get(`/api/cbt/publik/${lama}`), 404);
    expectStatus(await request(app).get(`/api/cbt/publik/${baru.body.token}`), 200);
  });

  it('paket khusus pelamar tidak bisa ditugaskan ke karyawan, dan sebaliknya', async () => {
    const { paketId } = await paketSiap({ code: 'SEL-3', audience: 'pelamar' });
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId] }), 400);

    const { paketId: internal } = await paketSiap({ code: 'INT-1', audience: 'karyawan' });
    const candidateId = await buatPelamar();
    expectStatus(await tugaskan(internal, { candidateIds: [candidateId] }), 400);
  });
});

describe('Pengawasan', () => {
  it('mencatat kejadian pindah tab dan menyimpan foto terenkripsi', async () => {
    const { paketId } = await paketSiap({ code: 'AWS-1', proctorPhotos: true });
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId] }), 201);
    const budi = await login(app, 'budi@resto.id');
    const daftar = await request(app).get('/api/cbt/saya').set(auth(budi));
    const id = daftar.body.data[0].id;
    expectStatus(await request(app).post(`/api/cbt/saya/${id}/mulai`).set(auth(budi)), 200);

    expectStatus(await request(app).post(`/api/cbt/saya/${id}/kejadian`).set(auth(budi)).send({ type: 'keluar_layar' }), 204);
    expectStatus(await request(app).post(`/api/cbt/saya/${id}/kejadian`).set(auth(budi)).send({ type: 'tidak_dikenal' }), 400);

    expectStatus(await request(app).post(`/api/cbt/saya/${id}/foto`).set(auth(budi)).send({ image: JPEG_1PX }), 204);

    const attempt = await prisma.cbtAttempt.findFirstOrThrow({ include: { events: true, photos: true } });
    expect(attempt.events).toHaveLength(1);
    expect(attempt.photos).toHaveLength(1);

    const rinci = await request(app).get(`/api/cbt/hasil/${attempt.id}`).set(auth(hr));
    expectStatus(rinci, 200);
    expect(rinci.body.attempt.events[0]).toMatchObject({ type: 'keluar_layar' });

    const foto = await request(app).get(`/api/cbt/hasil/${attempt.id}/foto/${attempt.photos[0].id}`).set(auth(hr));
    expectStatus(foto, 200);
    expect(foto.headers['content-type']).toContain('image/jpeg');
    // Yang keluar adalah gambar yang bisa dibuka, bukan blob terenkripsi.
    expect(foto.body.subarray(0, 3).toString('hex')).toBe('ffd8ff');
  });

  it('foto ditolak bila paket tidak memakai pengawasan foto', async () => {
    const { paketId } = await paketSiap({ code: 'AWS-2' });
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId] }), 201);
    const budi = await login(app, 'budi@resto.id');
    const id = (await request(app).get('/api/cbt/saya').set(auth(budi))).body.data[0].id;
    expectStatus(await request(app).post(`/api/cbt/saya/${id}/mulai`).set(auth(budi)), 200);
    expectStatus(await request(app).post(`/api/cbt/saya/${id}/foto`).set(auth(budi)).send({ image: JPEG_1PX }), 409);
  });
});

describe('Hak akses', () => {
  it('karyawan biasa hanya bisa membuka tesnya sendiri, bukan bank soal atau hasil orang lain', async () => {
    const { paketId } = await paketSiap({ code: 'IZN-1' });
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId] }), 201);
    const budi = await login(app, 'budi@resto.id');

    expectStatus(await request(app).get('/api/cbt/saya').set(auth(budi)), 200);
    expectStatus(await request(app).get('/api/cbt/soal').set(auth(budi)), 403);
    expectStatus(await request(app).get('/api/cbt/hasil').set(auth(budi)), 403);
    expectStatus(await request(app).get('/api/cbt/penugasan').set(auth(budi)), 403);
    expectStatus(await request(app).post('/api/cbt/tes').set(auth(budi)).send({ code: 'X', title: 'Coba', durationMinutes: 10 }), 403);
  });

  it('peran Karyawan menerima kunci menu cbt.lihat walau perannya dibuat sebelum fitur ini ada', async () => {
    const peran = await prisma.customRole.findUniqueOrThrow({ where: { code: Role.EMPLOYEE } });
    await prisma.customRole.update({
      where: { id: peran.id },
      data: { permissions: peran.permissions.filter((k) => !k.startsWith('cbt.')) },
    });
    await pastikanPeranSistem();
    const sesudah = await prisma.customRole.findUniqueOrThrow({ where: { code: Role.EMPLOYEE } });
    expect(sesudah.permissions).toContain('cbt.lihat');
  });
});
