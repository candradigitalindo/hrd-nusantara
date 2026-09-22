import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee, makeDepartment, makePosition } from './helpers/db';
import { bikinApp } from './helpers/app';
import { login, auth, expectStatus } from './helpers/api';

const app = bikinApp();

// Selalu di masa depan, supaya batas pendaftaran tidak pernah lewat.
const MULAI = '2027-03-01T02:00:00.000Z';
const SELESAI = '2027-03-01T09:00:00.000Z';

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


const buatProgram = (ubah: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/training/programs')
    .set(auth(hrToken))
    .send({
      code: 'HYGIENE',
      name: 'Hygiene & Sanitasi',
      isMandatory: true,
      passingScore: 70,
      validityMonths: 12,
      ...ubah,
    });

const buatSesi = (programId: string, ubah: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/training/sessions')
    .set(auth(hrToken))
    .send({
      programId,
      title: 'Hygiene Batch 1',
      trainer: 'Chef Andi',
      startDateTime: MULAI,
      endDateTime: SELESAI,
      ...ubah,
    });

const daftar = (sessionId: string, token: string, body: Record<string, unknown> = {}) =>
  request(app).post(`/api/training/sessions/${sessionId}/register`).set(auth(token)).send(body);

/** Menyiapkan program + sesi, lalu Budi mendaftar dan hadir. */
const sampaiHadir = async (programUbah: Record<string, unknown> = {}) => {
  const program = await buatProgram(programUbah);
  const sesi = await buatSesi(program.body.id);
  const pendaftaran = await daftar(sesi.body.id, budiToken);

  await request(app)
    .post(`/api/training/sessions/${sesi.body.id}/attendance`)
    .set(auth(hrToken))
    .send({ entries: [{ registrationId: pendaftaran.body.id, attended: true }] });

  return {
    programId: program.body.id as string,
    sessionId: sesi.body.id as string,
    registrationId: pendaftaran.body.id as string,
  };
};

describe('Program pelatihan', () => {
  it('membedakan program wajib dari opsional', async () => {
    const wajib = await buatProgram();
    expect(wajib.status).toBe(201);
    expect(wajib.body.isMandatory).toBe(true);

    const opsional = await buatProgram({ code: 'BARISTA', name: 'Barista Dasar', isMandatory: false });
    expect(opsional.body.isMandatory).toBe(false);
  });

  it('menolak kode program ganda', async () => {
    await buatProgram();
    expect((await buatProgram()).status).toBe(409);
  });

  it('menolak sasaran ganda jabatan dan departemen sekaligus', async () => {
    const posisi = await makePosition('Waiter');
    const dept = await makeDepartment('Kitchen');

    const res = await buatProgram({ targetPositionId: posisi.id, targetDepartmentId: dept.id });
    expect(res.status).toBe(400);
  });

  it('karyawan boleh melihat daftar program, tapi tidak membuatnya', async () => {
    await buatProgram();

    expectStatus(await request(app).get('/api/training/programs').set(auth(budiToken)), 200);

    const buat = await request(app)
      .post('/api/training/programs')
      .set(auth(budiToken))
      .send({ code: 'PALSU', name: 'Palsu' });
    expectStatus(buat, 403);
  });
});

describe('Sesi pelatihan', () => {
  it('menolak waktu selesai sebelum waktu mulai', async () => {
    const program = await buatProgram();
    const res = await buatSesi(program.body.id, { endDateTime: '2027-03-01T01:00:00.000Z' });
    expect(res.status).toBe(400);
  });

  it('menolak batas pendaftaran setelah pelatihan dimulai', async () => {
    const program = await buatProgram();
    const res = await buatSesi(program.body.id, {
      registrationDeadline: '2027-03-02T00:00:00.000Z',
    });
    expect(res.status).toBe(400);
  });

  it('sunting program menerima sasaran jabatan/departemen, termasuk null untuk melepasnya', async () => {
    // Regresi: formulir sunting selalu mengirim targetPositionId dan
    // targetDepartmentId, dan skema update .strict() menolak keduanya.
    const dept = await makeDepartment('Kitchen');
    const program = await buatProgram();

    const pasang = await request(app)
      .put(`/api/training/programs/${program.body.id}`)
      .set(auth(hrToken))
      .send({ name: program.body.name, targetPositionId: null, targetDepartmentId: dept.id });
    expect(pasang.status).toBe(200);
    expect(pasang.body.targetDepartmentId).toBe(dept.id);

    const lepas = await request(app)
      .put(`/api/training/programs/${program.body.id}`)
      .set(auth(hrToken))
      .send({ targetDepartmentId: null });
    expect(lepas.status).toBe(200);
    expect(lepas.body.targetDepartmentId).toBeNull();

    const takAda = await request(app)
      .put(`/api/training/programs/${program.body.id}`)
      .set(auth(hrToken))
      .send({ targetDepartmentId: '01ZZZZZZZZZZZZZZZZZZZZZZZZ' });
    expect(takAda.status).toBe(404);
  });

  it('menolak sesi untuk program yang tidak aktif', async () => {
    const program = await buatProgram();
    await request(app)
      .put(`/api/training/programs/${program.body.id}`)
      .set(auth(hrToken))
      .send({ isActive: false });

    const res = await buatSesi(program.body.id);
    expect(res.status).toBe(404);
  });
});

describe('Pendaftaran dan daftar tunggu', () => {
  it('menerima pendaftar selama kuota tersedia', async () => {
    const program = await buatProgram();
    const sesi = await buatSesi(program.body.id, { maxParticipants: 2 });

    const a = await daftar(sesi.body.id, budiToken);
    const b = await daftar(sesi.body.id, sitiToken);

    expect(a.body.status).toBe('registered');
    expect(b.body.status).toBe('registered');
  });

  it('memasukkan pendaftar berlebih ke daftar tunggu, bukan menolaknya', async () => {
    const program = await buatProgram();
    const sesi = await buatSesi(program.body.id, { maxParticipants: 1 });

    await daftar(sesi.body.id, budiToken);
    const kedua = await daftar(sesi.body.id, sitiToken);

    expect(kedua.status).toBe(201);
    expect(kedua.body.status).toBe('waitlisted');
  });

  it('mempromosikan antrean terdepan saat ada yang membatalkan', async () => {
    const program = await buatProgram();
    const sesi = await buatSesi(program.body.id, { maxParticipants: 1 });

    const budiDaftar = await daftar(sesi.body.id, budiToken);
    const sitiDaftar = await daftar(sesi.body.id, sitiToken);
    expect(sitiDaftar.body.status).toBe('waitlisted');

    const batal = await request(app)
      .patch(`/api/training/registrations/${budiDaftar.body.id}/cancel`)
      .set(auth(budiToken));

    // Tanpa promosi otomatis, kursi kosong itu harus dipantau HR manual.
    expect(batal.body.promotedFromWaitlist).not.toBeNull();
    expect(batal.body.promotedFromWaitlist.employeeId).toBe(siti.id);
    expect(batal.body.promotedFromWaitlist.status).toBe('registered');
  });

  it('menolak pendaftaran ganda di sesi yang sama', async () => {
    const program = await buatProgram();
    const sesi = await buatSesi(program.body.id);

    await daftar(sesi.body.id, budiToken);
    expect((await daftar(sesi.body.id, budiToken)).status).toBe(409);
  });

  it('karyawan tidak bisa mendaftarkan orang lain', async () => {
    const program = await buatProgram();
    const sesi = await buatSesi(program.body.id);

    const res = await daftar(sesi.body.id, budiToken, { employeeId: siti.id });
    expect(res.status).toBe(403);
  });

  it('HR bisa mendaftarkan karyawan lain', async () => {
    const program = await buatProgram();
    const sesi = await buatSesi(program.body.id);

    const res = await daftar(sesi.body.id, hrToken, { employeeId: budi.id });
    expect(res.status).toBe(201);
    expect(res.body.employeeId).toBe(budi.id);
  });

  it('membatalkan sesi ikut membatalkan pendaftarannya', async () => {
    const program = await buatProgram();
    const sesi = await buatSesi(program.body.id);
    const pendaftaran = await daftar(sesi.body.id, budiToken);

    await request(app)
      .patch(`/api/training/sessions/${sesi.body.id}/status`)
      .set(auth(hrToken))
      .send({ status: 'cancelled' });

    // Pendaftaran menggantung pada sesi yang tak pernah terjadi akan membuat
    // laporan kepatuhan mengira orangnya masih terjadwal.
    const setelah = await prisma.trainingRegistration.findUniqueOrThrow({
      where: { id: pendaftaran.body.id },
    });
    expect(setelah.status).toBe('cancelled');
  });
});

describe('Kehadiran dan evaluasi', () => {
  it('mencatat kehadiran dan ketidakhadiran', async () => {
    const program = await buatProgram();
    const sesi = await buatSesi(program.body.id);
    const a = await daftar(sesi.body.id, budiToken);
    const b = await daftar(sesi.body.id, sitiToken);

    const res = await request(app)
      .post(`/api/training/sessions/${sesi.body.id}/attendance`)
      .set(auth(hrToken))
      .send({
        entries: [
          { registrationId: a.body.id, attended: true },
          { registrationId: b.body.id, attended: false },
        ],
      });

    expect(res.status).toBe(200);
    const hadir = await prisma.trainingRegistration.findUniqueOrThrow({ where: { id: a.body.id } });
    const absen = await prisma.trainingRegistration.findUniqueOrThrow({ where: { id: b.body.id } });
    expect(hadir.status).toBe('attended');
    expect(absen.status).toBe('no_show');
  });

  it('menolak pendaftaran dari sesi lain', async () => {
    const program = await buatProgram();
    const sesiA = await buatSesi(program.body.id);
    const sesiB = await buatSesi(program.body.id, { title: 'Batch 2' });
    const pendaftaran = await daftar(sesiB.body.id, budiToken);

    const res = await request(app)
      .post(`/api/training/sessions/${sesiA.body.id}/attendance`)
      .set(auth(hrToken))
      .send({ entries: [{ registrationId: pendaftaran.body.id, attended: true }] });

    expect(res.status).toBe(400);
  });

  it('meluluskan nilai di atas ambang dan memberi masa berlaku', async () => {
    const { registrationId } = await sampaiHadir();

    const res = await request(app)
      .post(`/api/training/registrations/${registrationId}/evaluate`)
      .set(auth(hrToken))
      .send({ score: 85 });

    expect(res.status).toBe(200);
    expect(res.body.passed).toBe(true);
    expect(res.body.status).toBe('completed');
    expect(res.body.expiresAt).not.toBeNull();
  });

  it('menggagalkan nilai di bawah ambang tanpa masa berlaku', async () => {
    const { registrationId } = await sampaiHadir();

    const res = await request(app)
      .post(`/api/training/registrations/${registrationId}/evaluate`)
      .set(auth(hrToken))
      .send({ score: 50 });

    expect(res.body.passed).toBe(false);
    expect(res.body.status).toBe('failed');
    // Yang tidak lulus tidak punya apa pun untuk kedaluwarsa.
    expect(res.body.expiresAt).toBeNull();
  });

  it('meluluskan pelatihan tanpa ujian hanya dari kehadiran', async () => {
    const { registrationId } = await sampaiHadir({ code: 'ORIENTASI', passingScore: null });

    const res = await request(app)
      .post(`/api/training/registrations/${registrationId}/evaluate`)
      .set(auth(hrToken))
      .send({});

    expect(res.body.passed).toBe(true);
  });

  it('menolak evaluasi peserta yang tidak hadir', async () => {
    const program = await buatProgram();
    const sesi = await buatSesi(program.body.id);
    const pendaftaran = await daftar(sesi.body.id, budiToken);

    // Menilai orang yang tidak datang membuat riwayat pelatihannya
    // tidak bisa dipercaya.
    const res = await request(app)
      .post(`/api/training/registrations/${pendaftaran.body.id}/evaluate`)
      .set(auth(hrToken))
      .send({ score: 90 });

    expect(res.status).toBe(409);
  });

  it('karyawan tidak bisa mengevaluasi dirinya sendiri', async () => {
    const { registrationId } = await sampaiHadir();

    const res = await request(app)
      .post(`/api/training/registrations/${registrationId}/evaluate`)
      .set(auth(budiToken))
      .send({ score: 100 });

    expect(res.status).toBe(403);
  });
});

describe('Riwayat pelatihan', () => {
  it('karyawan hanya melihat riwayatnya sendiri', async () => {
    const program = await buatProgram();
    const sesi = await buatSesi(program.body.id);
    await daftar(sesi.body.id, budiToken);
    await daftar(sesi.body.id, sitiToken);

    const budiLihat = await request(app)
      .get('/api/training/registrations')
      .set(auth(budiToken));
    expect(budiLihat.body.pagination.total).toBe(1);
    expect(budiLihat.body.data[0].employeeId).toBe(budi.id);

    const hrLihat = await request(app).get('/api/training/registrations').set(auth(hrToken));
    expect(hrLihat.body.pagination.total).toBe(2);
  });
});

describe('Laporan kepatuhan pelatihan wajib', () => {
  it('menandai karyawan yang belum pernah ikut', async () => {
    await buatProgram();

    const res = await request(app).get('/api/training/compliance').set(auth(hrToken));

    expect(res.status).toBe(200);
    const program = res.body.programs[0];
    // HR, Budi, dan Siti semuanya belum ikut.
    expect(program.requiredFor).toBe(3);
    expect(program.summary.neverCompleted).toBe(3);
    expect(program.needsAction).toHaveLength(3);
  });

  it('menandai patuh setelah lulus', async () => {
    const { registrationId } = await sampaiHadir();
    await request(app)
      .post(`/api/training/registrations/${registrationId}/evaluate`)
      .set(auth(hrToken))
      .send({ score: 85 });

    const res = await request(app).get('/api/training/compliance').set(auth(hrToken));
    const program = res.body.programs[0];

    expect(program.summary.compliant).toBe(1);
    expect(program.summary.neverCompleted).toBe(2);
    // Yang sudah patuh tidak perlu ditindaklanjuti.
    expect(program.needsAction.map((b: { employee: { id: string } }) => b.employee.id)).not.toContain(
      budi.id
    );
  });

  it('yang gagal tetap dihitung belum patuh', async () => {
    const { registrationId } = await sampaiHadir();
    await request(app)
      .post(`/api/training/registrations/${registrationId}/evaluate`)
      .set(auth(hrToken))
      .send({ score: 40 });

    const res = await request(app).get('/api/training/compliance').set(auth(hrToken));
    expect(res.body.programs[0].summary.neverCompleted).toBe(3);
  });

  it('memperingatkan sertifikat yang akan kedaluwarsa', async () => {
    const { registrationId } = await sampaiHadir();
    await request(app)
      .post(`/api/training/registrations/${registrationId}/evaluate`)
      .set(auth(hrToken))
      .send({ score: 85 });

    // Dimajukan sehingga tinggal 10 hari lagi.
    await prisma.trainingRegistration.update({
      where: { id: registrationId },
      data: { expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) },
    });

    const res = await request(app)
      .get('/api/training/compliance?warningDays=30')
      .set(auth(hrToken));

    // HR perlu menjadwalkan ulang SEBELUM sertifikatnya mati.
    expect(res.body.programs[0].summary.expiringSoon).toBe(1);
  });

  it('menandai sertifikat yang sudah mati', async () => {
    const { registrationId } = await sampaiHadir();
    await request(app)
      .post(`/api/training/registrations/${registrationId}/evaluate`)
      .set(auth(hrToken))
      .send({ score: 85 });

    await prisma.trainingRegistration.update({
      where: { id: registrationId },
      data: { expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    const res = await request(app).get('/api/training/compliance').set(auth(hrToken));
    expect(res.body.programs[0].summary.expired).toBe(1);
  });

  it('hanya menghitung karyawan yang disasar program', async () => {
    const dapur = await makeDepartment('Kitchen');
    await prisma.employee.update({ where: { id: budi.id }, data: { departmentId: dapur.id } });

    await buatProgram({ targetDepartmentId: dapur.id });

    const res = await request(app).get('/api/training/compliance').set(auth(hrToken));

    // Pelatihan Hygiene untuk staf dapur tidak relevan bagi bagian lain.
    expect(res.body.programs[0].requiredFor).toBe(1);
  });

  it('mengabaikan program yang tidak wajib', async () => {
    await buatProgram({ code: 'BARISTA', isMandatory: false });

    const res = await request(app).get('/api/training/compliance').set(auth(hrToken));
    expect(res.body.programs).toHaveLength(0);
  });

  it('karyawan biasa tidak boleh melihat laporan kepatuhan', async () => {
    const res = await request(app).get('/api/training/compliance').set(auth(budiToken));
    expect(res.status).toBe(403);
  });
});
