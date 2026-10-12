import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee, makePosition } from './helpers/db';
import { bikinApp } from './helpers/app';
import { login, auth, expectStatus } from './helpers/api';
import { pastikanPeranSistem } from '../src/services/roles/system';
import { tutupPengerjaanKedaluwarsa } from '../src/services/cbt/attempt';
import { generateULID } from '../src/utils/generateULID';

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

describe('Bank soal: penyuntingan', () => {
  it('menyunting tetap memeriksa bentuk soal terhadap tipenya', async () => {
    const pg = await buatSoal();
    // Melepas semua kunci: dulu tersimpan, lalu soal ini selalu dinilai salah.
    expectStatus(await request(app).put(`/api/cbt/soal/${pg.body.id}`).set(auth(hr)).send({ answerKey: [] }), 400);
    expectStatus(await request(app).put(`/api/cbt/soal/${pg.body.id}`).set(auth(hr)).send({ answerKey: ['z'] }), 400);
    expectStatus(await request(app).put(`/api/cbt/soal/${pg.body.id}`).set(auth(hr)).send({ type: 'banyak_jawaban', answerKey: ['a', 'b'] }), 200);
    expectStatus(await request(app).put(`/api/cbt/soal/${pg.body.id}`).set(auth(hr)).send({ type: 'esai' }), 400);
    // Perbaikan teks saja tidak memeriksa ulang bentuknya.
    expectStatus(await request(app).put(`/api/cbt/soal/${pg.body.id}`).set(auth(hr)).send({ text: 'Teks diperbaiki' }), 200);
  });

  it('soal nonaktif bisa diaktifkan lagi walau sudah dipakai', async () => {
    const { pgId } = await paketSiap();
    expectStatus(await request(app).delete(`/api/cbt/soal/${pgId}`).set(auth(hr)), 200);
    expectStatus(await request(app).put(`/api/cbt/soal/${pgId}`).set(auth(hr)).send({ isActive: true }), 200);
    expect((await prisma.cbtQuestion.findUniqueOrThrow({ where: { id: pgId } })).isActive).toBe(true);
  });
});

describe('Bank soal: saringan soal nonaktif', () => {
  it('includeInactive=false benar-benar menyembunyikan soal nonaktif', async () => {
    const { pgId } = await paketSiap();
    expectStatus(await request(app).delete(`/api/cbt/soal/${pgId}`).set(auth(hr)), 200);

    const tanpa = await request(app).get('/api/cbt/soal?includeInactive=false').set(auth(hr));
    expect(tanpa.body.data.map((q: { id: string }) => q.id)).not.toContain(pgId);
    const dengan = await request(app).get('/api/cbt/soal?includeInactive=true').set(auth(hr));
    expect(dengan.body.data.map((q: { id: string }) => q.id)).toContain(pgId);
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

  it('pengacakan pilihan ikut terkunci setelah ditugaskan; pengawasan tetap boleh diubah', async () => {
    const { paketId } = await paketSiap();
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId] }), 201);

    expectStatus(await request(app).put(`/api/cbt/tes/${paketId}`).set(auth(hr)).send({ shuffleOptions: false }), 409);
    const awas = await request(app)
      .put(`/api/cbt/tes/${paketId}`)
      .set(auth(hr))
      .send({ recordProctorEvents: false, proctorPhotos: true, proctorPhotoIntervalSec: 60 });
    expectStatus(awas, 200);
    expect(awas.body).toMatchObject({ recordProctorEvents: false, proctorPhotos: true, proctorPhotoIntervalSec: 60 });
  });

  it('paket yang memuat soal nonaktif tidak bisa ditayangkan atau ditugaskan sampai disusun ulang', async () => {
    const pg = await buatSoal();
    const cadangan = await buatSoal({ text: 'Soal pengganti yang masih aktif' });
    const paket = await buatPaket({ code: 'NON-1' });
    expectStatus(
      await request(app).put(`/api/cbt/tes/${paket.body.id}/soal`).set(auth(hr)).send({ questions: [{ questionId: pg.body.id }, { questionId: cadangan.body.id }] }),
      200
    );
    // Dipakai paket → dihapus berarti dinonaktifkan, tetapi masih tersusun di paket.
    expectStatus(await request(app).delete(`/api/cbt/soal/${pg.body.id}`).set(auth(hr)), 200);

    const tayang = await request(app).put(`/api/cbt/tes/${paket.body.id}`).set(auth(hr)).send({ status: 'published' });
    expectStatus(tayang, 409);
    expect(tayang.body.error).toMatch(/nonaktif/);

    expectStatus(await request(app).put(`/api/cbt/tes/${paket.body.id}/soal`).set(auth(hr)).send({ questions: [{ questionId: cadangan.body.id }] }), 200);
    expectStatus(await request(app).put(`/api/cbt/tes/${paket.body.id}`).set(auth(hr)).send({ status: 'published' }), 200);
    expectStatus(await tugaskan(paket.body.id, { employeeIds: [budiId] }), 201);
  });

  it('soal yang dinonaktifkan setelah paket ditugaskan tidak diujikan ke peserta baru', async () => {
    const { paketId, pgId } = await paketSiap({ code: 'NON-2' });
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId] }), 201);
    expectStatus(await request(app).delete(`/api/cbt/soal/${pgId}`).set(auth(hr)), 200);

    const siti = await makeEmployee({ email: 'siti@resto.id', nik: 'K-2' });
    const res = await tugaskan(paketId, { employeeIds: [siti.id] });
    expectStatus(res, 409);
    expect(res.body.error).toMatch(/paket baru/);
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

  it('kiriman akhir membawa jawaban yang belum sempat tersimpan, dan jawaban itu ikut dinilai', async () => {
    const { paketId, pgId, esaiId } = await paketSiap({ code: 'KRM-1' });
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId] }), 201);
    const budi = await login(app, 'budi@resto.id');
    const id = (await request(app).get('/api/cbt/saya').set(auth(budi))).body.data[0].id;
    expectStatus(await request(app).post(`/api/cbt/saya/${id}/mulai`).set(auth(budi)), 200);
    // Simpan-otomatis sempat menyimpan jawaban salah, lalu peserta mengganti
    // jawabannya tepat sebelum menekan Kirim (simpannya belum sampai).
    expectStatus(await request(app).put(`/api/cbt/saya/${id}/jawaban`).set(auth(budi)).send({ jawaban: [{ questionId: pgId, chosen: ['a'] }] }), 200);

    const kirim = await request(app)
      .post(`/api/cbt/saya/${id}/kirim`)
      .set(auth(budi))
      .send({ jawaban: [{ questionId: pgId, chosen: ['b'] }, { questionId: esaiId, chosen: [], text: 'Basahi, sabuni, gosok, bilas, keringkan, tutup keran.' }] });
    expectStatus(kirim, 200);

    const jawaban = await prisma.cbtAnswer.findMany({ select: { questionId: true, chosen: true, text: true, isCorrect: true, points: true } });
    expect(jawaban.find((j) => j.questionId === pgId)).toMatchObject({ chosen: ['b'], isCorrect: true, points: 2 });
    expect(jawaban.find((j) => j.questionId === esaiId)).toMatchObject({ text: 'Basahi, sabuni, gosok, bilas, keringkan, tutup keran.', points: null });
    const attempt = await prisma.cbtAttempt.findFirstOrThrow();
    expect(attempt).toMatchObject({ scoreObjective: 2, autoSubmitted: false });
  });

  it('kiriman bersamaan: satu menang, yang lain 409 — bukan galat server', async () => {
    const { paketId, pgId } = await paketSiap({ code: 'KRM-4' });
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId] }), 201);
    const budi = await login(app, 'budi@resto.id');
    const id = (await request(app).get('/api/cbt/saya').set(auth(budi))).body.data[0].id;
    expectStatus(await request(app).post(`/api/cbt/saya/${id}/mulai`).set(auth(budi)), 200);

    // Dua tab, atau tombol Kirim berbarengan dengan pengatur waktu.
    const kiriman = await Promise.all(
      [1, 2, 3].map(() => request(app).post(`/api/cbt/saya/${id}/kirim`).set(auth(budi)).send({ jawaban: [{ questionId: pgId, chosen: ['b'] }] }))
    );
    expect(kiriman.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await prisma.cbtAnswer.count({ where: { questionId: pgId } })).toBe(1);
  });

  it('simpan yang berpacu dengan kirim: jawabannya ikut dinilai, atau ditolak — tidak pernah tersimpan tanpa nilai', async () => {
    const { paketId, pgId } = await paketSiap({ code: 'KRM-5' });
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId] }), 201);
    const budi = await login(app, 'budi@resto.id');
    const id = (await request(app).get('/api/cbt/saya').set(auth(budi))).body.data[0].id;
    expectStatus(await request(app).post(`/api/cbt/saya/${id}/mulai`).set(auth(budi)), 200);

    const [simpan, kirim] = await Promise.all([
      request(app).put(`/api/cbt/saya/${id}/jawaban`).set(auth(budi)).send({ jawaban: [{ questionId: pgId, chosen: ['b'] }] }),
      request(app).post(`/api/cbt/saya/${id}/kirim`).set(auth(budi)),
    ]);
    expectStatus(kirim, 200);
    expect([200, 409]).toContain(simpan.status);
    const jawaban = await prisma.cbtAnswer.findFirstOrThrow({ where: { questionId: pgId } });
    if (simpan.status === 200) {
      expect(jawaban).toMatchObject({ chosen: ['b'], isCorrect: true, points: 2 });
    } else {
      expect(jawaban).toMatchObject({ chosen: [], points: 0 });
    }
  });

  it('pengatur waktu di layar peserta menandai kirimannya "waktu habis"', async () => {
    const { paketId } = await paketSiap({ code: 'KRM-6' });
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId] }), 201);
    const budi = await login(app, 'budi@resto.id');
    const id = (await request(app).get('/api/cbt/saya').set(auth(budi))).body.data[0].id;
    expectStatus(await request(app).post(`/api/cbt/saya/${id}/mulai`).set(auth(budi)), 200);

    expectStatus(await request(app).post(`/api/cbt/saya/${id}/kirim`).set(auth(budi)).send({ jawaban: [], otomatis: true }), 200);
    expect((await prisma.cbtAttempt.findFirstOrThrow()).autoSubmitted).toBe(true);
  });

  it('kiriman akhir tanpa isi tetap diterima, dan jawaban untuk soal di luar paket ditolak', async () => {
    const { paketId } = await paketSiap({ code: 'KRM-2' });
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId] }), 201);
    const budi = await login(app, 'budi@resto.id');
    const id = (await request(app).get('/api/cbt/saya').set(auth(budi))).body.data[0].id;
    expectStatus(await request(app).post(`/api/cbt/saya/${id}/mulai`).set(auth(budi)), 200);

    const asing = await buatSoal({ text: 'Soal yang tidak ada di paket ini' });
    expectStatus(await request(app).post(`/api/cbt/saya/${id}/kirim`).set(auth(budi)).send({ jawaban: [{ questionId: asing.body.id, chosen: ['a'] }] }), 404);
    expectStatus(await request(app).post(`/api/cbt/saya/${id}/kirim`).set(auth(budi)), 200);
  });

  it('kiriman yang tiba setelah batas waktu: jawabannya diabaikan dan tercatat waktu habis', async () => {
    const { paketId, pgId } = await paketSiap({ code: 'KRM-3' });
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId] }), 201);
    const budi = await login(app, 'budi@resto.id');
    const id = (await request(app).get('/api/cbt/saya').set(auth(budi))).body.data[0].id;
    expectStatus(await request(app).post(`/api/cbt/saya/${id}/mulai`).set(auth(budi)), 200);
    expectStatus(await request(app).put(`/api/cbt/saya/${id}/jawaban`).set(auth(budi)).send({ jawaban: [{ questionId: pgId, chosen: ['a'] }] }), 200);
    await prisma.cbtAttempt.updateMany({ data: { deadlineAt: new Date(Date.now() - 1000) } });

    expectStatus(await request(app).post(`/api/cbt/saya/${id}/kirim`).set(auth(budi)).send({ jawaban: [{ questionId: pgId, chosen: ['b'] }] }), 200);

    const attempt = await prisma.cbtAttempt.findFirstOrThrow();
    // Pengatur waktu di layar peserta yang mengirim terlambat pun tercatat "waktu habis".
    expect(attempt.autoSubmitted).toBe(true);
    expect(attempt.scoreObjective).toBe(0);
    expect(await prisma.cbtAnswer.findFirst({ where: { questionId: pgId }, select: { chosen: true } })).toEqual({ chosen: ['a'] });
  });

  it('pengerjaan yang ditinggalkan setelah batas waktu ditutup dan muncul di Hasil', async () => {
    const { paketId, pgId } = await paketSiap({ code: 'TGL-1' });
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId] }), 201);
    const budi = await login(app, 'budi@resto.id');
    const id = (await request(app).get('/api/cbt/saya').set(auth(budi))).body.data[0].id;
    expectStatus(await request(app).post(`/api/cbt/saya/${id}/mulai`).set(auth(budi)), 200);
    expectStatus(await request(app).put(`/api/cbt/saya/${id}/jawaban`).set(auth(budi)).send({ jawaban: [{ questionId: pgId, chosen: ['b'] }] }), 200);
    // Peserta menutup tab; batas waktunya lewat (melebihi tenggang) tanpa pernah menekan Kirim.
    await prisma.cbtAttempt.updateMany({ data: { deadlineAt: new Date(Date.now() - 2 * 60_000) } });

    const hasil = await request(app).get('/api/cbt/hasil').set(auth(hr));
    expectStatus(hasil, 200);
    expect(hasil.body.data).toHaveLength(1);
    // Paket memuat esai, jadi menunggu penilaian; jawaban objektif yang tersimpan sudah dinilai.
    expect(hasil.body.data[0]).toMatchObject({ status: 'submitted', attempt: { autoSubmitted: true, scoreTotal: 2 } });
  });

  it('penyapu berkala menutup pengerjaan yang ditinggalkan, dan Tes Saya tidak lagi menampilkannya "sedang dikerjakan"', async () => {
    const { paketId } = await paketSiap({ code: 'TGL-2' });
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId] }), 201);
    const budi = await login(app, 'budi@resto.id');
    const id = (await request(app).get('/api/cbt/saya').set(auth(budi))).body.data[0].id;
    expectStatus(await request(app).post(`/api/cbt/saya/${id}/mulai`).set(auth(budi)), 200);
    expect(await tutupPengerjaanKedaluwarsa()).toBe(0);

    // Baru lewat sedetik: masih dalam tenggang, pengatur waktu peserta yang mengirim sendiri.
    await prisma.cbtAttempt.updateMany({ data: { deadlineAt: new Date(Date.now() - 1000) } });
    expect(await tutupPengerjaanKedaluwarsa()).toBe(0);

    await prisma.cbtAttempt.updateMany({ data: { deadlineAt: new Date(Date.now() - 2 * 60_000) } });
    expect(await tutupPengerjaanKedaluwarsa()).toBe(1);
    expect(await tutupPengerjaanKedaluwarsa()).toBe(0);
    expect((await prisma.cbtAttempt.findFirstOrThrow()).autoSubmitted).toBe(true);

    const saya = await request(app).get('/api/cbt/saya').set(auth(budi));
    expect(saya.body.data[0].status).toBe('submitted');
  });

  it('membuka lagi pengerjaan yang batas waktunya lewat menutupnya, bukan membukanya', async () => {
    const { paketId } = await paketSiap({ code: 'TGL-3' });
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId] }), 201);
    const budi = await login(app, 'budi@resto.id');
    const id = (await request(app).get('/api/cbt/saya').set(auth(budi))).body.data[0].id;
    expectStatus(await request(app).post(`/api/cbt/saya/${id}/mulai`).set(auth(budi)), 200);
    await prisma.cbtAttempt.updateMany({ data: { deadlineAt: new Date(Date.now() - 1000) } });

    const lagi = await request(app).post(`/api/cbt/saya/${id}/mulai`).set(auth(budi));
    expectStatus(lagi, 409);
    expect(lagi.body.error).toMatch(/Waktu pengerjaan sudah habis/);
    expect((await prisma.cbtAttempt.findFirstOrThrow()).autoSubmitted).toBe(true);
  });

  it('penugasan yang kedaluwarsa tanpa pernah dimulai boleh dibatalkan; yang sudah dimulai tidak', async () => {
    const { paketId } = await paketSiap({ code: 'BTL-1' });
    const siti = await makeEmployee({ email: 'siti@resto.id', nik: 'K-2' });
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId, siti.id] }), 201);
    const [milikBudi, milikSiti] = await Promise.all([
      prisma.cbtAssignment.findFirstOrThrow({ where: { employeeId: budiId } }),
      prisma.cbtAssignment.findFirstOrThrow({ where: { employeeId: siti.id } }),
    ]);

    // Siti mulai mengerjakan; Budi melewatkan batas akhirnya.
    const tokenSiti = await login(app, 'siti@resto.id');
    expectStatus(await request(app).post(`/api/cbt/saya/${milikSiti.id}/mulai`).set(auth(tokenSiti)), 200);
    await prisma.cbtAssignment.update({ where: { id: milikBudi.id }, data: { availableUntil: new Date(Date.now() - 60_000) } });
    const budi = await login(app, 'budi@resto.id');
    expectStatus(await request(app).post(`/api/cbt/saya/${milikBudi.id}/mulai`).set(auth(budi)), 403);
    expect((await prisma.cbtAssignment.findUniqueOrThrow({ where: { id: milikBudi.id } })).status).toBe('expired');

    expectStatus(await request(app).delete(`/api/cbt/penugasan/${milikBudi.id}`).set(auth(hr)), 204);
    const ditolak = await request(app).delete(`/api/cbt/penugasan/${milikSiti.id}`).set(auth(hr));
    expectStatus(ditolak, 409);
    expect(ditolak.body.error).toMatch(/sudah dimulai/);
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

describe('Penugasan: jendela waktu', () => {
  it('menolak batas akhir yang sudah lewat', async () => {
    const { paketId } = await paketSiap({ code: 'JDL-1' });
    const res = await tugaskan(paketId, { employeeIds: [budiId], availableUntil: new Date(Date.now() - 60_000).toISOString() });
    expectStatus(res, 400);
    expect(await prisma.cbtAssignment.count()).toBe(0);
  });

  it('tes yang belum dibuka menyebut waktu mulainya dalam WIB, bukan cap waktu UTC mentah', async () => {
    const { paketId } = await paketSiap({ code: 'JDL-2' });
    expectStatus(await tugaskan(paketId, { employeeIds: [budiId], availableFrom: '2030-01-02T01:30:00.000Z' }), 201);
    const budi = await login(app, 'budi@resto.id');
    const id = (await request(app).get('/api/cbt/saya').set(auth(budi))).body.data[0].id;

    const res = await request(app).post(`/api/cbt/saya/${id}/mulai`).set(auth(budi));
    expectStatus(res, 403);
    expect(res.body.error).toMatch(/08[.:]30 WIB/);
    expect(res.body.error).not.toMatch(/T01:30/);
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
    // Daftar paket memuat draf, ambang lulus, dan setelan pengawasan: hanya untuk pengelola.
    expectStatus(await request(app).get('/api/cbt/tes').set(auth(budi)), 403);
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

describe('Inventori kepribadian (paket standar Big Five)', () => {
  const buatStandar = () => request(app).post('/api/cbt/tes/standar/kepribadian-big5').set(auth(hr));

  it('dibuat sekali: 50 butir skala dalam lima dimensi, paket langsung tayang; panggilan kedua mengembalikan yang sama', async () => {
    const pertama = await buatStandar();
    expectStatus(pertama, 201);
    expect(pertama.body).toMatchObject({ code: 'KEPRIBADIAN-BIG5', status: 'published', passingScore: null, shuffleOptions: false, kind: 'kepribadian', dibuat: true });
    expect(pertama.body._count.questions).toBe(50);

    const kedua = await buatStandar();
    expectStatus(kedua, 200);
    expect(kedua.body.id).toBe(pertama.body.id);
    expect(kedua.body.dibuat).toBe(false);

    const kategori = await request(app).get('/api/cbt/soal/kategori').set(auth(hr));
    expect(kategori.body.data).toEqual(
      expect.arrayContaining([
        { category: 'Ekstraversi', jumlah: 10 },
        { category: 'Keramahan', jumlah: 10 },
        { category: 'Kesungguhan', jumlah: 10 },
        { category: 'Kestabilan Emosi', jumlah: 10 },
        { category: 'Keterbukaan', jumlah: 10 },
      ])
    );
    const daftar = await request(app).get('/api/cbt/tes').set(auth(hr));
    expect(daftar.body.data.find((p: { id: string }) => p.id === pertama.body.id).kind).toBe('kepribadian');
  });

  it('peserta menerima skala berurutan tanpa nilai; hasilnya profil per dimensi, tanpa kelulusan', async () => {
    const paket = await buatStandar();
    expectStatus(await tugaskan(paket.body.id, { employeeIds: [budiId] }), 201);
    const budi = await login(app, 'budi@resto.id');
    const saya = await request(app).get('/api/cbt/saya').set(auth(budi));
    expect(saya.body.data[0].test.kind).toBe('kepribadian');
    const assignmentId = saya.body.data[0].id;

    const ruang = await request(app).post(`/api/cbt/saya/${assignmentId}/mulai`).set(auth(budi));
    expectStatus(ruang, 200);
    expect(ruang.body.test.jenis).toBe('kepribadian');
    expect(ruang.body.questions).toHaveLength(50);
    for (const q of ruang.body.questions) {
      expect(q.type).toBe('skala');
      expect(q.options.map((o: { kode: string }) => o.kode)).toEqual(['1', '2', '3', '4', '5']);
      expect(q.options.every((o: Record<string, unknown>) => !('nilai' in o))).toBe(true);
    }

    // Semua "Netral": tiap dimensi tepat di tengah rentang 10–50 → 50% ternormalisasi.
    const jawaban = ruang.body.questions.map((q: { id: string }) => ({ questionId: q.id, chosen: ['3'] }));
    expectStatus(await request(app).put(`/api/cbt/saya/${assignmentId}/jawaban`).set(auth(budi)).send({ jawaban }), 200);
    const kirim = await request(app).post(`/api/cbt/saya/${assignmentId}/kirim`).set(auth(budi));
    expectStatus(kirim, 200);
    expect(kirim.body).toMatchObject({ status: 'graded', jenis: 'kepribadian', menungguPenilaian: false, nilai: null });

    const hasil = await request(app).get('/api/cbt/hasil').set(auth(hr));
    const baris = hasil.body.data.find((a: { id: string }) => a.id === assignmentId);
    expect(baris.test.kind).toBe('kepribadian');
    expect(baris.attempt.passed).toBeNull();
    // Daftar penugasan (panel pelamar, karyawan) juga membawa jenisnya.
    const penugasan = await request(app).get(`/api/cbt/penugasan?testId=${paket.body.id}`).set(auth(hr));
    expect(penugasan.body.data[0].test.kind).toBe('kepribadian');

    const rinci = await request(app).get(`/api/cbt/hasil/${baris.attempt.id}`).set(auth(hr));
    expectStatus(rinci, 200);
    expect(rinci.body.jenis).toBe('kepribadian');
    expect(rinci.body.perKategori).toHaveLength(5);
    for (const k of rinci.body.perKategori) {
      expect(k).toMatchObject({ maksimal: 50, minimal: 10, diperoleh: 30, persenSkala: 50 });
    }
    expect(rinci.body.profil).toHaveLength(5);
    expect(rinci.body.profil.every((d: { tingkat: string; keterangan: string | null }) => d.tingkat === 'sedang' && typeof d.keterangan === 'string')).toBe(true);
    expect(rinci.body.butir.every((b: { isCorrect: boolean | null; points: number }) => b.isCorrect === null && b.points === 3)).toBe(true);
  });

  it('butir terbalik dihitung terbalik: "sangat sesuai" pada butir Ekstraversi terbalik menurunkan dimensi itu', async () => {
    const paket = await buatStandar();
    expectStatus(await tugaskan(paket.body.id, { employeeIds: [budiId] }), 201);
    const budi = await login(app, 'budi@resto.id');
    const assignmentId = (await request(app).get('/api/cbt/saya').set(auth(budi))).body.data[0].id;
    const ruang = await request(app).post(`/api/cbt/saya/${assignmentId}/mulai`).set(auth(budi));
    // Semua butir Ekstraversi dijawab "sangat sesuai": 5 butir lurus = 25, 5 butir terbalik = 5 → 30 dari 50.
    const ekstra = ruang.body.questions.filter((q: { category: string }) => q.category === 'Ekstraversi');
    expect(ekstra).toHaveLength(10);
    const jawaban = ekstra.map((q: { id: string }) => ({ questionId: q.id, chosen: ['5'] }));
    expectStatus(await request(app).put(`/api/cbt/saya/${assignmentId}/jawaban`).set(auth(budi)).send({ jawaban }), 200);
    const kirim = await request(app).post(`/api/cbt/saya/${assignmentId}/kirim`).set(auth(budi));
    expectStatus(kirim, 200);
    const hasil = await request(app).get(`/api/cbt/hasil?testId=${paket.body.id}`).set(auth(hr));
    const rinci = await request(app).get(`/api/cbt/hasil/${hasil.body.data[0].attempt.id}`).set(auth(hr));
    const ekstraversi = rinci.body.perKategori.find((k: { kategori: string }) => k.kategori === 'Ekstraversi');
    expect(ekstraversi).toMatchObject({ diperoleh: 30, persenSkala: 50 });
    // Dimensi lain tidak dijawab sama sekali → tidak ditafsirkan, bukan "rendah".
    const keramahan = rinci.body.perKategori.find((k: { kategori: string }) => k.kategori === 'Keramahan');
    expect(keramahan).toMatchObject({ diperoleh: 0, persenSkala: null, dilewati: 10 });
    expect(rinci.body.profil.find((d: { kategori: string }) => d.kategori === 'Keramahan')).toMatchObject({ tingkat: null, persen: null, dilewati: 10 });
  });

  it('pernyataan yang dilewati tidak menurunkan skor dimensinya', async () => {
    const paket = await buatStandar();
    expectStatus(await tugaskan(paket.body.id, { employeeIds: [budiId] }), 201);
    const budi = await login(app, 'budi@resto.id');
    const assignmentId = (await request(app).get('/api/cbt/saya').set(auth(budi))).body.data[0].id;
    const ruang = await request(app).post(`/api/cbt/saya/${assignmentId}/mulai`).set(auth(budi));
    // Semua "Netral" kecuali satu pernyataan Keterbukaan yang dilewati.
    const dilewati = ruang.body.questions.find((q: { category: string }) => q.category === 'Keterbukaan').id;
    const jawaban = ruang.body.questions.filter((q: { id: string }) => q.id !== dilewati).map((q: { id: string }) => ({ questionId: q.id, chosen: ['3'] }));
    expectStatus(await request(app).put(`/api/cbt/saya/${assignmentId}/jawaban`).set(auth(budi)).send({ jawaban }), 200);
    expectStatus(await request(app).post(`/api/cbt/saya/${assignmentId}/kirim`).set(auth(budi)), 200);

    const hasil = await request(app).get(`/api/cbt/hasil?testId=${paket.body.id}`).set(auth(hr));
    const rinci = await request(app).get(`/api/cbt/hasil/${hasil.body.data[0].attempt.id}`).set(auth(hr));
    // Dulu 42.5 ("sedang" yang condong rendah): butir terlewat dihitung 0, di bawah nilai terendah skala.
    expect(rinci.body.perKategori.find((k: { kategori: string }) => k.kategori === 'Keterbukaan')).toMatchObject({ persenSkala: 50, dilewati: 1 });
    expect(rinci.body.profil.find((d: { kategori: string }) => d.kategori === 'Keterbukaan')).toMatchObject({ persen: 50, tingkat: 'sedang', dilewati: 1 });
    expect(rinci.body.profil.find((d: { kategori: string }) => d.kategori === 'Ekstraversi')).toMatchObject({ persen: 50, dilewati: 0 });
  });

  /** Butir skala 1–5 buatan HR di bank soal. */
  const butirSkala = (n: number) =>
    buatSoal({
      type: 'skala',
      category: 'Ketelitian',
      text: `Pernyataan ketelitian ${n}`,
      options: ['Sangat tidak sesuai', 'Tidak sesuai', 'Netral', 'Sesuai', 'Sangat sesuai'].map((teks, i) => ({ kode: String(i + 1), teks, nilai: i + 1 })),
      answerKey: [],
    });

  it('paket skala buatan HR: tanpa kelulusan walau berambang, skala tidak diacak, nilai tidak dibuka', async () => {
    const butir = [await butirSkala(1), await butirSkala(2), await butirSkala(3)];
    // Form paket baru berbawaan ambang 70 dan acak pilihan menyala.
    const paket = await buatPaket({ code: 'SKL-1', passingScore: 70, shuffleOptions: true, showResultToTaker: true });
    expectStatus(await request(app).put(`/api/cbt/tes/${paket.body.id}/soal`).set(auth(hr)).send({ questions: butir.map((b) => ({ questionId: b.body.id })) }), 200);
    expectStatus(await request(app).put(`/api/cbt/tes/${paket.body.id}`).set(auth(hr)).send({ status: 'published' }), 200);
    expectStatus(await tugaskan(paket.body.id, { employeeIds: [budiId] }), 201);
    const budi = await login(app, 'budi@resto.id');
    const id = (await request(app).get('/api/cbt/saya').set(auth(budi))).body.data[0].id;
    const ruang = await request(app).post(`/api/cbt/saya/${id}/mulai`).set(auth(budi));
    for (const q of ruang.body.questions) expect(q.options.map((o: { kode: string }) => o.kode)).toEqual(['1', '2', '3', '4', '5']);

    const kirim = await request(app).post(`/api/cbt/saya/${id}/kirim`).set(auth(budi)).send({ jawaban: butir.map((b) => ({ questionId: b.body.id, chosen: ['2'] })) });
    expect(kirim.body).toMatchObject({ jenis: 'kepribadian', nilai: null });
    const hasil = await request(app).get(`/api/cbt/hasil?testId=${paket.body.id}`).set(auth(hr));
    // Dulu "Belum lulus" dari persen mentah Likert.
    expect(hasil.body.data[0].attempt.passed).toBeNull();
    const hasilSaya = await request(app).get(`/api/cbt/saya/${id}/hasil`).set(auth(budi));
    expect(hasilSaya.body).toMatchObject({ jenis: 'kepribadian', nilai: null });
  });

  it('butir skala tidak bisa dicampur dengan soal berkunci, dan bobotnya tidak bisa diatur per paket', async () => {
    const skala = await butirSkala(1);
    const pg = await buatSoal();
    const paket = await buatPaket({ code: 'SKL-2' });
    const campur = await request(app).put(`/api/cbt/tes/${paket.body.id}/soal`).set(auth(hr)).send({ questions: [{ questionId: skala.body.id }, { questionId: pg.body.id }] });
    expectStatus(campur, 400);
    expect(campur.body.error).toMatch(/dicampur/);
    expectStatus(await request(app).put(`/api/cbt/tes/${paket.body.id}/soal`).set(auth(hr)).send({ questions: [{ questionId: skala.body.id, points: 10 }] }), 400);
    expectStatus(await request(app).put(`/api/cbt/tes/${paket.body.id}/soal`).set(auth(hr)).send({ questions: [{ questionId: skala.body.id }] }), 200);
  });

  it('kiriman otomatis saat menyimpan setelah waktu habis membawa ringkasan hasil', async () => {
    const paket = await buatStandar();
    expectStatus(await tugaskan(paket.body.id, { employeeIds: [budiId] }), 201);
    const budi = await login(app, 'budi@resto.id');
    const id = (await request(app).get('/api/cbt/saya').set(auth(budi))).body.data[0].id;
    const ruang = await request(app).post(`/api/cbt/saya/${id}/mulai`).set(auth(budi));
    await prisma.cbtAttempt.updateMany({ data: { deadlineAt: new Date(Date.now() - 1000) } });

    const telat = await request(app).put(`/api/cbt/saya/${id}/jawaban`).set(auth(budi)).send({ jawaban: [{ questionId: ruang.body.questions[0].id, chosen: ['3'] }] });
    expectStatus(telat, 200);
    // Layar selesai peserta memakai ini: inventori kepribadian, bukan "menunggu penilaian esai".
    expect(telat.body).toMatchObject({ dikirimOtomatis: true, hasil: { jenis: 'kepribadian', menungguPenilaian: false, nilai: null } });
  });

  it('paket standar dibuat ulang setelah dihapus memakai butir yang sudah ada, bukan menggandakannya', async () => {
    const pertama = await buatStandar();
    expectStatus(await request(app).delete(`/api/cbt/tes/${pertama.body.id}`).set(auth(hr)), 204);
    const kedua = await buatStandar();
    expectStatus(kedua, 201);
    expect(await prisma.cbtQuestion.count({ where: { type: 'skala' } })).toBe(50);
    expect(kedua.body._count.questions).toBe(50);
  });

  it('dua permintaan paket standar bersamaan tidak menghasilkan galat server', async () => {
    const [a, b] = await Promise.all([buatStandar(), buatStandar()]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.id).toBe(b.body.id);
    expect(await prisma.cbtTest.count({ where: { code: 'KEPRIBADIAN-BIG5' } })).toBe(1);
    expect(await prisma.cbtQuestion.count({ where: { type: 'skala' } })).toBe(50);
  });

  it('membuat paket standar butuh izin bank soal, karena ikut menulis 50 butir', async () => {
    const peran = await prisma.customRole.create({ data: { id: generateULID(), name: 'Penyusun Paket', baseRole: Role.MANAGER, permissions: ['cbt.lihat', 'cbt.buat', 'cbt.ubah'] } });
    await makeEmployee({ email: 'penyusun@resto.id', nik: 'K-9', role: Role.MANAGER, customRoleId: peran.id });
    const penyusun = await login(app, 'penyusun@resto.id');
    expectStatus(await request(app).post('/api/cbt/tes/standar/kepribadian-big5').set(auth(penyusun)), 403);
    expect(await prisma.cbtQuestion.count()).toBe(0);
  });

  it('bank soal: butir skala wajib bernilai per pilihan dan tanpa kunci; bobotnya mengikuti nilai tertinggi', async () => {
    const skala = [
      { kode: '1', teks: 'Sangat tidak sesuai', nilai: 1 },
      { kode: '2', teks: 'Tidak sesuai', nilai: 2 },
      { kode: '3', teks: 'Sesuai', nilai: 3 },
    ];
    expectStatus(await buatSoal({ type: 'skala', category: 'Ketelitian', text: 'Saya memeriksa ulang pekerjaan saya.', options: skala.map(({ kode, teks }) => ({ kode, teks })), answerKey: [] }), 400);
    expectStatus(await buatSoal({ type: 'skala', category: 'Ketelitian', text: 'Saya memeriksa ulang pekerjaan saya.', options: skala, answerKey: ['3'] }), 400);
    const sah = await buatSoal({ type: 'skala', category: 'Ketelitian', text: 'Saya memeriksa ulang pekerjaan saya.', options: skala, answerKey: [], points: 1 });
    expectStatus(sah, 201);
    expect(sah.body.points).toBe(3);
    expect(sah.body.options).toEqual(skala);
  });
});
