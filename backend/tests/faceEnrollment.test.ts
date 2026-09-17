import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { Role } from '@prisma/client';
import {
  prisma,
  resetDatabase,
  makeEmployee,
  makeWorkLocation,
  MONAS,
} from './helpers/db';
import { login, auth } from './helpers/api';
import { bikinApp } from './helpers/app';
import { areModelsAvailable } from '../src/services/face';

const app = bikinApp();
const FIXTURES = path.resolve(__dirname, 'fixtures/faces');
const b64 = (nama: string) => fs.readFileSync(path.join(FIXTURES, nama)).toString('base64');

const describeModel = areModelsAvailable() ? describe : describe.skip;

let hrToken: string;
let karyawan: { id: string };
let lokasiId: string;

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  karyawan = await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1' });
  lokasiId = (await makeWorkLocation({ name: 'Resto Pusat' })).id;
});


const daftarkan = (employeeId: string, foto: string, token = hrToken) =>
  request(app)
    .post(`/api/employees/${employeeId}/face-enrollments`)
    .set(auth(token))
    .send({ image: b64(foto) });

describeModel('POST /api/employees/:id/face-enrollments', () => {
  it('mendaftarkan wajah karyawan', async () => {
    const res = await daftarkan(karyawan.id, 'personA_1.jpg');

    expect(res.status).toBe(201);
    expect(res.body.employeeId).toBe(karyawan.id);
    expect(res.body.dimensions).toBe(512);
    expect(res.body.isActive).toBe(true);
  });

  it('tidak pernah mengembalikan embedding lewat API', async () => {
    const res = await daftarkan(karyawan.id, 'personA_1.jpg');

    // Embedding adalah data biometrik; tidak boleh keluar dari server.
    expect(res.body).not.toHaveProperty('embedding');

    const daftar = await request(app)
      .get(`/api/employees/${karyawan.id}/face-enrollments`)
      .set(auth(hrToken));
    expect(JSON.stringify(daftar.body)).not.toContain('embedding');
  });

  it('menyimpan embedding, bukan foto, sebagai data pencocokan', async () => {
    await daftarkan(karyawan.id, 'personA_1.jpg');

    const tersimpan = await prisma.faceEnrollment.findFirstOrThrow({
      where: { employeeId: karyawan.id },
    });

    // 512 dimensi x 4 byte.
    expect(tersimpan.embedding.length).toBe(2048);
    expect(tersimpan.dimensions).toBe(512);
  });

  it('mencatat siapa yang mendaftarkan, untuk jejak audit', async () => {
    const hr = await prisma.employee.findUniqueOrThrow({ where: { email: 'hr@resto.id' } });
    const res = await daftarkan(karyawan.id, 'personA_1.jpg');

    expect(res.body.enrolledById).toBe(hr.id);
  });

  it('menolak foto tanpa wajah', async () => {
    const sharp = (await import('sharp')).default;
    const polos = (
      await sharp({
        create: { width: 400, height: 400, channels: 3, background: { r: 210, g: 190, b: 170 } },
      })
        .jpeg()
        .toBuffer()
    ).toString('base64');

    const res = await request(app)
      .post(`/api/employees/${karyawan.id}/face-enrollments`)
      .set(auth(hrToken))
      .send({ image: polos });

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('no_face');
  });

  it('menolak data yang bukan gambar', async () => {
    const res = await request(app)
      .post(`/api/employees/${karyawan.id}/face-enrollments`)
      .set(auth(hrToken))
      .send({ image: Buffer.from('x'.repeat(200)).toString('base64') });

    expect(res.status).toBe(400);
  });

  it('menolak karyawan yang tidak ada', async () => {
    const res = await daftarkan('01ZZZZZZZZZZZZZZZZZZZZZZZZ', 'personA_1.jpg');
    expect(res.status).toBe(404);
  });

  it('menggantikan pendaftaran lama bila diminta', async () => {
    await daftarkan(karyawan.id, 'personA_1.jpg');

    const res = await request(app)
      .post(`/api/employees/${karyawan.id}/face-enrollments`)
      .set(auth(hrToken))
      .send({ image: b64('personA_2.jpg'), replaceExisting: true });

    expect(res.status).toBe(201);

    const aktif = await prisma.faceEnrollment.count({
      where: { employeeId: karyawan.id, isActive: true },
    });
    expect(aktif).toBe(1);
  });

  it('karyawan tidak boleh mendaftarkan wajahnya sendiri', async () => {
    // Kalau boleh, ia juga bisa mendaftarkan wajah rekannya — dan seluruh
    // guna verifikasi wajah untuk presensi hilang.
    const token = await login(app, 'budi@resto.id');
    const res = await daftarkan(karyawan.id, 'personA_1.jpg', token);

    expect(res.status).toBe(403);
  });
});

describeModel('Check-in dengan verifikasi wajah', () => {
  const checkIn = async (foto: string, token: string) =>
    request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'face', workLocationId: lokasiId, ...MONAS, faceImage: b64(foto) });

  it('menerima presensi ketika wajah cocok', async () => {
    await daftarkan(karyawan.id, 'personA_1.jpg');
    const token = await login(app, 'budi@resto.id');

    // Foto berbeda dari yang didaftarkan — orangnya sama.
    const res = await checkIn('personA_2.jpg', token);

    expect(res.status).toBe(201);
    expect(res.body.faceVerified).toBe(true);
    expect(res.body.faceMatchScore).toBeGreaterThan(0.45);
  });

  it('menolak presensi ketika wajahnya orang lain', async () => {
    await daftarkan(karyawan.id, 'personA_1.jpg');
    const token = await login(app, 'budi@resto.id');

    const res = await checkIn('personB_1.jpg', token);

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('no_match');
    // Yang penting: tidak ada presensi yang tercatat.
    expect(await prisma.attendance.count()).toBe(0);
  });

  it('menolak presensi kalau wajahnya belum pernah didaftarkan', async () => {
    const token = await login(app, 'budi@resto.id');
    const res = await checkIn('personA_1.jpg', token);

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('not_enrolled');
    expect(await prisma.attendance.count()).toBe(0);
  });

  it('tidak menyimpan foto selfie check-in secara bawaan', async () => {
    await daftarkan(karyawan.id, 'personA_1.jpg');
    const token = await login(app, 'budi@resto.id');

    const res = await checkIn('personA_2.jpg', token);

    // Menyimpan selfie harian seluruh karyawan adalah timbunan data biometrik
    // yang tidak diperlukan; skor kemiripan sudah cukup untuk audit.
    expect(res.body.faceImageUrl).toBeNull();
  });

  it('menuntut faceImage saat metode "face" dipilih', async () => {
    const token = await login(app, 'budi@resto.id');

    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'face', workLocationId: lokasiId, ...MONAS });

    expect(res.status).toBe(400);
    expect(res.body.details.some((d: { field: string }) => d.field === 'faceImage')).toBe(true);
  });

  it('tetap memberlakukan geofence pada metode wajah', async () => {
    await daftarkan(karyawan.id, 'personA_1.jpg');
    const token = await login(app, 'budi@resto.id');

    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({
        method: 'face',
        workLocationId: lokasiId,
        latitude: -6.1853924,
        longitude: 106.8271528,
        faceImage: b64('personA_2.jpg'),
      });

    expect(res.status).toBe(422);
    expect(res.body.details.jarakMeter).toBeGreaterThan(100);
  });
});

describeModel('Anti-spoofing pada check-in', () => {
  it('menolak presensi memakai foto yang ditampilkan di layar', async () => {
    const { simulateScreenReplay } = await import('./helpers/spoof');
    await daftarkan(karyawan.id, 'personA_1.jpg');
    const token = await login(app, 'budi@resto.id');

    const palsu = await simulateScreenReplay(
      fs.readFileSync(path.join(FIXTURES, 'personA_1.jpg')),
      { bezel: 30 }
    );

    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({
        method: 'face',
        workLocationId: lokasiId,
        ...MONAS,
        faceImage: palsu.toString('base64'),
      });

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('spoof_detected');
    // Wajahnya memang cocok — yang menggagalkan adalah keaslian-hidupnya.
    expect(await prisma.attendance.count()).toBe(0);
  });

  it('menyimpan skor keaslian-hidup untuk presensi yang lolos', async () => {
    await daftarkan(karyawan.id, 'personA_1.jpg');
    const token = await login(app, 'budi@resto.id');

    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({
        method: 'face',
        workLocationId: lokasiId,
        ...MONAS,
        faceImage: b64('personA_2.jpg'),
      });

    expect(res.status).toBe(201);
    expect(res.body.livenessScore).toBeGreaterThan(0.9);
  });
});

describeModel('Pendaftaran usang setelah model diganti', () => {
  it('menandai pendaftaran dari model lain sebagai usang', async () => {
    await daftarkan(karyawan.id, 'personA_1.jpg');
    await prisma.faceEnrollment.updateMany({
      where: { employeeId: karyawan.id },
      data: { modelName: 'model_lama_v1' },
    });

    const res = await request(app)
      .get(`/api/employees/${karyawan.id}/face-enrollments`)
      .set(auth(hrToken));

    expect(res.body.data[0].stale).toBe(true);
  });

  it('menolak check-in memakai pendaftaran dari model yang berbeda', async () => {
    await daftarkan(karyawan.id, 'personA_1.jpg');
    await prisma.faceEnrollment.updateMany({
      where: { employeeId: karyawan.id },
      data: { modelName: 'model_lama_v1' },
    });

    const token = await login(app, 'budi@resto.id');
    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'face', workLocationId: lokasiId, ...MONAS, faceImage: b64('personA_2.jpg') });

    // Embedding dari model berbeda tidak sebanding — lebih baik menolak
    // daripada membandingkan angka yang tidak setara.
    expect(res.status).toBe(422);
  });
});

describeModel('DELETE /api/face-enrollments/:id', () => {
  it('menonaktifkan pendaftaran tanpa menghapus jejaknya', async () => {
    const dibuat = await daftarkan(karyawan.id, 'personA_1.jpg');

    const res = await request(app)
      .delete(`/api/face-enrollments/${dibuat.body.id}`)
      .set(auth(hrToken));

    expect(res.status).toBe(200);
    expect(res.body.enrollment.isActive).toBe(false);
    // Barisnya tetap ada: siapa mendaftarkan siapa dan kapan adalah bagian audit.
    expect(await prisma.faceEnrollment.count()).toBe(1);
  });

  it('membuat check-in wajah gagal setelah dinonaktifkan', async () => {
    const dibuat = await daftarkan(karyawan.id, 'personA_1.jpg');
    await request(app).delete(`/api/face-enrollments/${dibuat.body.id}`).set(auth(hrToken));

    const token = await login(app, 'budi@resto.id');
    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'face', workLocationId: lokasiId, ...MONAS, faceImage: b64('personA_2.jpg') });

    expect(res.status).toBe(422);
  });

  it('hanya HR yang boleh menonaktifkan', async () => {
    const dibuat = await daftarkan(karyawan.id, 'personA_1.jpg');
    const token = await login(app, 'budi@resto.id');

    const res = await request(app)
      .delete(`/api/face-enrollments/${dibuat.body.id}`)
      .set(auth(token));

    expect(res.status).toBe(403);
  });
});
