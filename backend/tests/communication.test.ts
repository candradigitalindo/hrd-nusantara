import request from 'supertest';
import { Role } from '@prisma/client';
import { createApp } from '../src/app';
import { prisma, resetDatabase, makeEmployee, makeDepartment } from './helpers/db';
import { login, auth, expectStatus } from './helpers/api';

const app = createApp();

let hrToken: string;
let budi: { id: string };
let budiToken: string;
let siti: { id: string };
let sitiToken: string;
let dapurId: string;

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  dapurId = (await makeDepartment('Kitchen')).id;
  budi = await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1', departmentId: dapurId });
  budiToken = await login(app, 'budi@resto.id');
  siti = await makeEmployee({ email: 'siti@resto.id', nik: 'EMP-2' });
  sitiToken = await login(app, 'siti@resto.id');
});


// ===== Pengumuman =====

const buatPengumuman = (ubah: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/announcements')
    .set(auth(hrToken))
    .send({ title: 'Rapat Bulanan', content: 'Rapat hari Senin pukul 09.00', ...ubah });

const terbitkan = (id: string) =>
  request(app).patch(`/api/announcements/${id}/status`).set(auth(hrToken)).send({ status: 'published' });

describe('Pengumuman', () => {
  it('dibuat sebagai draft, belum tayang', async () => {
    const res = await buatPengumuman();

    expect(res.status).toBe(201);
    // Menyimpan tidak sama dengan menayangkan.
    expect(res.body.status).toBe('draft');
    expect(res.body.publishedAt).toBeNull();
  });

  it('draft tidak terlihat karyawan', async () => {
    await buatPengumuman();

    const res = await request(app).get('/api/announcements').set(auth(budiToken));
    expect(res.body.pagination.total).toBe(0);
  });

  it('terlihat setelah ditayangkan', async () => {
    const p = await buatPengumuman();
    await terbitkan(p.body.id);

    const res = await request(app).get('/api/announcements').set(auth(budiToken));
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0].isRead).toBe(false);
  });

  it('menyaring berdasarkan departemen sasaran', async () => {
    const p = await buatPengumuman({ targetDepartmentId: dapurId });
    await terbitkan(p.body.id);

    // Budi di Kitchen, Siti tidak punya departemen.
    const budiLihat = await request(app).get('/api/announcements').set(auth(budiToken));
    expect(budiLihat.body.pagination.total).toBe(1);

    const sitiLihat = await request(app).get('/api/announcements').set(auth(sitiToken));
    expect(sitiLihat.body.pagination.total).toBe(0);
  });

  it('menyembunyikan pengumuman yang sudah kedaluwarsa', async () => {
    const p = await buatPengumuman({ expiresAt: '2020-01-01T00:00:00.000Z' });
    await terbitkan(p.body.id);

    const res = await request(app).get('/api/announcements').set(auth(budiToken));
    expect(res.body.pagination.total).toBe(0);
  });

  it('menaikkan pengumuman mendesak ke urutan atas', async () => {
    const biasa = await buatPengumuman({ title: 'Biasa', priority: 'normal' });
    await terbitkan(biasa.body.id);
    const mendesak = await buatPengumuman({ title: 'Mendesak', priority: 'urgent' });
    await terbitkan(mendesak.body.id);

    const res = await request(app).get('/api/announcements').set(auth(budiToken));

    // Papan yang semuanya setara membuat pengumuman penting tenggelam.
    expect(res.body.data[0].title).toBe('Mendesak');
  });

  it('menolak menyunting pengumuman yang sudah tayang', async () => {
    const p = await buatPengumuman();
    await terbitkan(p.body.id);

    const res = await request(app)
      .put(`/api/announcements/${p.body.id}`)
      .set(auth(hrToken))
      .send({ content: 'Isi diubah diam-diam' });

    // Karyawan yang sudah membacanya akan menyimpan isi yang berbeda.
    expect(res.status).toBe(409);
  });

  it('mencatat siapa yang sudah membaca', async () => {
    const p = await buatPengumuman();
    await terbitkan(p.body.id);

    await request(app)
      .post(`/api/announcements/${p.body.id}/read`)
      .set(auth(budiToken))
      .send({});

    const res = await request(app).get('/api/announcements').set(auth(budiToken));
    expect(res.body.data[0].isRead).toBe(true);
  });

  it('membedakan membuka dari menyatakan sudah paham', async () => {
    const p = await buatPengumuman({ requiresAcknowledgment: true });
    await terbitkan(p.body.id);

    await request(app)
      .post(`/api/announcements/${p.body.id}/read`)
      .set(auth(budiToken))
      .send({ acknowledge: false });

    let laporan = await request(app)
      .get(`/api/announcements/${p.body.id}/reads`)
      .set(auth(hrToken));
    expect(laporan.body.readCount).toBe(1);
    expect(laporan.body.acknowledgedCount).toBe(0);

    await request(app)
      .post(`/api/announcements/${p.body.id}/read`)
      .set(auth(budiToken))
      .send({ acknowledge: true });

    laporan = await request(app).get(`/api/announcements/${p.body.id}/reads`).set(auth(hrToken));
    expect(laporan.body.acknowledgedCount).toBe(1);
  });

  it('menolak pernyataan paham pada pengumuman yang tidak menuntutnya', async () => {
    const p = await buatPengumuman({ requiresAcknowledgment: false });
    await terbitkan(p.body.id);

    const res = await request(app)
      .post(`/api/announcements/${p.body.id}/read`)
      .set(auth(budiToken))
      .send({ acknowledge: true });

    expect(res.status).toBe(400);
  });

  it('laporan merinci siapa yang belum membaca', async () => {
    const p = await buatPengumuman({ targetDepartmentId: dapurId });
    await terbitkan(p.body.id);

    const res = await request(app)
      .get(`/api/announcements/${p.body.id}/reads`)
      .set(auth(hrToken));

    // Hanya Budi yang di Kitchen.
    expect(res.body.targetCount).toBe(1);
    expect(res.body.notRead).toHaveLength(1);
    expect(res.body.notRead[0].employee.id).toBe(budi.id);
  });

  it('menolak menandai baca pengumuman yang bukan sasarannya', async () => {
    const p = await buatPengumuman({ targetDepartmentId: dapurId });
    await terbitkan(p.body.id);

    const res = await request(app)
      .post(`/api/announcements/${p.body.id}/read`)
      .set(auth(sitiToken))
      .send({});

    expect(res.status).toBe(403);
  });

  it('karyawan tidak boleh membuat pengumuman', async () => {
    const res = await request(app)
      .post('/api/announcements')
      .set(auth(budiToken))
      .send({ title: 'X', content: 'X' });

    expect(res.status).toBe(403);
  });
});

// ===== Survei =====

const buatSurvei = (ubah: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/surveys')
    .set(auth(hrToken))
    .send({
      title: 'Kepuasan Karyawan Q3',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2030-12-31T00:00:00.000Z',
      questions: [
        { code: 'PUAS', text: 'Seberapa puas Anda?', type: 'scale', minScale: 1, maxScale: 5 },
        { code: 'SARAN', text: 'Saran Anda?', type: 'text', isRequired: false },
      ],
      ...ubah,
    });

const terbitkanSurvei = (id: string) =>
  request(app).patch(`/api/surveys/${id}/status`).set(auth(hrToken)).send({ status: 'published' });

describe('Survei', () => {
  it('menolak pertanyaan pilihan tanpa opsi', async () => {
    const res = await buatSurvei({
      questions: [{ code: 'PILIH', text: 'Pilih', type: 'choice' }],
    });
    expect(res.status).toBe(400);
  });

  it('menolak kode pertanyaan ganda', async () => {
    const res = await buatSurvei({
      questions: [
        { code: 'SAMA', text: 'Satu', type: 'text' },
        { code: 'SAMA', text: 'Dua', type: 'text' },
      ],
    });
    expect(res.status).toBe(400);
  });

  it('anonim secara bawaan', async () => {
    const res = await buatSurvei();
    expect(res.body.isAnonymous).toBe(true);
  });

  it('tidak menyimpan identitas responden pada survei anonim', async () => {
    const s = await buatSurvei();
    await terbitkanSurvei(s.body.id);
    const soal = s.body.questions;

    const res = await request(app)
      .post(`/api/surveys/${s.body.id}/submit`)
      .set(auth(budiToken))
      .send({ answers: [{ questionId: soal[0].id, scaleValue: 4 }] });

    expect(res.status).toBe(201);

    // Inti anonimitasnya: baris jawaban tidak bisa ditelusuri ke orangnya.
    const jawaban = await prisma.surveyResponse.findFirstOrThrow({
      where: { surveyId: s.body.id },
    });
    expect(jawaban.respondentId).toBeNull();

    // Tapi partisipasinya tercatat, supaya tidak bisa mengisi dua kali.
    const partisipasi = await prisma.surveyParticipation.findFirstOrThrow({
      where: { surveyId: s.body.id },
    });
    expect(partisipasi.employeeId).toBe(budi.id);
  });

  it('menyimpan identitas pada survei yang tidak anonim', async () => {
    const s = await buatSurvei({ isAnonymous: false });
    await terbitkanSurvei(s.body.id);

    await request(app)
      .post(`/api/surveys/${s.body.id}/submit`)
      .set(auth(budiToken))
      .send({ answers: [{ questionId: s.body.questions[0].id, scaleValue: 4 }] });

    const jawaban = await prisma.surveyResponse.findFirstOrThrow({
      where: { surveyId: s.body.id },
    });
    expect(jawaban.respondentId).toBe(budi.id);
  });

  it('mencegah pengisian ganda walau anonim', async () => {
    const s = await buatSurvei();
    await terbitkanSurvei(s.body.id);
    const isi = () =>
      request(app)
        .post(`/api/surveys/${s.body.id}/submit`)
        .set(auth(budiToken))
        .send({ answers: [{ questionId: s.body.questions[0].id, scaleValue: 4 }] });

    expectStatus(await isi(), 201);
    expectStatus(await isi(), 409);
  });

  it('menolak nilai skala di luar rentang', async () => {
    const s = await buatSurvei();
    await terbitkanSurvei(s.body.id);

    const res = await request(app)
      .post(`/api/surveys/${s.body.id}/submit`)
      .set(auth(budiToken))
      .send({ answers: [{ questionId: s.body.questions[0].id, scaleValue: 9 }] });

    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('out_of_scale');
  });

  it('menolak pertanyaan wajib yang dilewati', async () => {
    const s = await buatSurvei();
    await terbitkanSurvei(s.body.id);

    const res = await request(app)
      .post(`/api/surveys/${s.body.id}/submit`)
      .set(auth(budiToken))
      .send({ answers: [{ questionId: s.body.questions[1].id, textValue: 'Bagus' }] });

    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('missing_required');
  });

  it('menolak jawaban pada survei yang belum tayang', async () => {
    const s = await buatSurvei();

    const res = await request(app)
      .post(`/api/surveys/${s.body.id}/submit`)
      .set(auth(budiToken))
      .send({ answers: [{ questionId: s.body.questions[0].id, scaleValue: 4 }] });

    expect(res.status).toBe(409);
  });

  it('menolak jawaban setelah masa pengisian berakhir', async () => {
    const s = await buatSurvei({
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2020-12-31T00:00:00.000Z',
    });
    await terbitkanSurvei(s.body.id);

    const res = await request(app)
      .post(`/api/surveys/${s.body.id}/submit`)
      .set(auth(budiToken))
      .send({ answers: [{ questionId: s.body.questions[0].id, scaleValue: 4 }] });

    expect(res.status).toBe(409);
  });

  it('merangkum hasil tanpa membuka identitas', async () => {
    const s = await buatSurvei();
    await terbitkanSurvei(s.body.id);
    const soal = s.body.questions;

    for (const [token, nilai] of [
      [budiToken, 5],
      [sitiToken, 3],
    ] as const) {
      await request(app)
        .post(`/api/surveys/${s.body.id}/submit`)
        .set(auth(token))
        .send({
          answers: [
            { questionId: soal[0].id, scaleValue: nilai },
            { questionId: soal[1].id, textValue: `Catatan ${nilai}` },
          ],
        });
    }

    const res = await request(app)
      .get(`/api/surveys/${s.body.id}/results`)
      .set(auth(hrToken));

    expect(res.status).toBe(200);
    expect(res.body.responseCount).toBe(2);

    const puas = res.body.questions.find((q: { code: string }) => q.code === 'PUAS');
    expect(puas.average).toBe(4);
    expect(puas.distribution).toEqual({ '5': 1, '3': 1 });

    // Jawaban teks keluar tanpa identitas.
    const teks = res.body.textAnswers[0];
    expect(teks.answers).toHaveLength(2);
    expect(JSON.stringify(res.body)).not.toContain(budi.id);
  });

  it('karyawan tidak boleh melihat hasil survei', async () => {
    const s = await buatSurvei();
    const res = await request(app)
      .get(`/api/surveys/${s.body.id}/results`)
      .set(auth(budiToken));

    expect(res.status).toBe(403);
  });
});

// ===== Ruang obrolan =====

describe('Ruang obrolan', () => {
  const buatRuang = (token = budiToken, memberIds: string[] = []) =>
    request(app)
      .post('/api/chat/rooms')
      .set(auth(token))
      .send({ name: 'Kitchen', type: 'department', isPrivate: true, memberIds });

  it('pembuat otomatis menjadi moderator dan anggota', async () => {
    const res = await buatRuang();

    expect(res.status).toBe(201);
    const saya = res.body.members.find((m: { employeeId: string }) => m.employeeId === budi.id);
    expect(saya.role).toBe('moderator');
  });

  it('bukan anggota tidak bisa membaca pesan', async () => {
    const ruang = await buatRuang();
    await request(app)
      .post(`/api/chat/rooms/${ruang.body.id}/messages`)
      .set(auth(budiToken))
      .send({ message: 'Halo dapur' });

    // Tanpa keanggotaan, ruang "Kitchen" bisa dibaca seluruh perusahaan.
    const res = await request(app)
      .get(`/api/chat/rooms/${ruang.body.id}/messages`)
      .set(auth(sitiToken));

    expect(res.status).toBe(403);
  });

  it('bukan anggota tidak bisa mengirim pesan', async () => {
    const ruang = await buatRuang();

    const res = await request(app)
      .post(`/api/chat/rooms/${ruang.body.id}/messages`)
      .set(auth(sitiToken))
      .send({ message: 'Menyusup' });

    expect(res.status).toBe(403);
  });

  it('anggota yang ditambahkan bisa ikut membaca', async () => {
    const ruang = await buatRuang();
    await request(app)
      .post(`/api/chat/rooms/${ruang.body.id}/members`)
      .set(auth(budiToken))
      .send({ employeeId: siti.id });

    const res = await request(app)
      .get(`/api/chat/rooms/${ruang.body.id}/messages`)
      .set(auth(sitiToken));

    expect(res.status).toBe(200);
  });

  it('hanya moderator yang bisa menambah anggota', async () => {
    const ruang = await buatRuang();
    await request(app)
      .post(`/api/chat/rooms/${ruang.body.id}/members`)
      .set(auth(budiToken))
      .send({ employeeId: siti.id, role: 'member' });

    const lain = await makeEmployee({ email: 'lain@resto.id', nik: 'EMP-9' });
    const res = await request(app)
      .post(`/api/chat/rooms/${ruang.body.id}/members`)
      .set(auth(sitiToken))
      .send({ employeeId: lain.id });

    expect(res.status).toBe(403);
  });

  it('hanya menampilkan ruang yang diikuti', async () => {
    await buatRuang();

    const budiLihat = await request(app).get('/api/chat/rooms').set(auth(budiToken));
    expect(budiLihat.body.data).toHaveLength(1);

    const sitiLihat = await request(app).get('/api/chat/rooms').set(auth(sitiToken));
    expect(sitiLihat.body.data).toHaveLength(0);
  });

  it('pesan dihapus dengan penanda, bukan dibuang', async () => {
    const ruang = await buatRuang();
    const pesan = await request(app)
      .post(`/api/chat/rooms/${ruang.body.id}/messages`)
      .set(auth(budiToken))
      .send({ message: 'Salah kirim' });

    await request(app).delete(`/api/chat/messages/${pesan.body.id}`).set(auth(budiToken));

    const res = await request(app)
      .get(`/api/chat/rooms/${ruang.body.id}/messages`)
      .set(auth(budiToken));

    // Lubang di tengah riwayat lebih menyulitkan saat audit.
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].isDeleted).toBe(true);
    expect(res.body.data[0].message).toBeNull();
    expect(await prisma.chatMessage.count()).toBe(1);
  });

  it('tidak bisa menghapus pesan orang lain', async () => {
    const ruang = await buatRuang();
    await request(app)
      .post(`/api/chat/rooms/${ruang.body.id}/members`)
      .set(auth(budiToken))
      .send({ employeeId: siti.id });

    const pesan = await request(app)
      .post(`/api/chat/rooms/${ruang.body.id}/messages`)
      .set(auth(budiToken))
      .send({ message: 'Punya Budi' });

    const res = await request(app)
      .delete(`/api/chat/messages/${pesan.body.id}`)
      .set(auth(sitiToken));

    expect(res.status).toBe(403);
  });

  it('moderator bisa menghapus pesan anggotanya', async () => {
    const ruang = await buatRuang();
    await request(app)
      .post(`/api/chat/rooms/${ruang.body.id}/members`)
      .set(auth(budiToken))
      .send({ employeeId: siti.id });

    const pesan = await request(app)
      .post(`/api/chat/rooms/${ruang.body.id}/messages`)
      .set(auth(sitiToken))
      .send({ message: 'Tidak pantas' });

    const res = await request(app)
      .delete(`/api/chat/messages/${pesan.body.id}`)
      .set(auth(budiToken));

    expect(res.status).toBe(200);
  });
});
