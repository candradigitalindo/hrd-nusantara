import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee, makeWorkLocation, MONAS } from './helpers/db';
import { bikinApp } from './helpers/app';
import { login, auth } from './helpers/api';

const app = bikinApp();

let hrToken: string;

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
});


describe('POST /api/work-locations', () => {
  it('membuat lokasi dan menghasilkan token QR sendiri', async () => {
    const res = await request(app)
      .post('/api/work-locations')
      .set(auth(hrToken))
      .send({ name: 'Resto Pusat', ...MONAS, radiusMeters: 150 });

    expect(res.status).toBe(201);
    expect(res.body.qrSecret).toBeTruthy();
    expect(res.body.qrSecret.length).toBeGreaterThanOrEqual(24);
    // Koordinat dikirim sebagai angka, bukan string Decimal.
    expect(typeof res.body.latitude).toBe('number');
    expect(res.body.latitude).toBeCloseTo(MONAS.latitude, 6);
  });

  it('menolak qrSecret yang dikirim klien — token harus dibuat server', async () => {
    const res = await request(app)
      .post('/api/work-locations')
      .set(auth(hrToken))
      .send({ name: 'Resto Pusat', ...MONAS, qrSecret: 'token-pilihan-sendiri' });

    expect(res.status).toBe(400);
  });

  it('memberi token QR berbeda untuk tiap lokasi', async () => {
    const a = await request(app)
      .post('/api/work-locations')
      .set(auth(hrToken))
      .send({ name: 'Cabang A', ...MONAS });
    const b = await request(app)
      .post('/api/work-locations')
      .set(auth(hrToken))
      .send({ name: 'Cabang B', ...MONAS });

    expect(a.body.qrSecret).not.toBe(b.body.qrSecret);
  });

  it('menolak koordinat di luar rentang yang mungkin', async () => {
    const res = await request(app)
      .post('/api/work-locations')
      .set(auth(hrToken))
      .send({ name: 'Ngawur', latitude: 200, longitude: 500 });

    expect(res.status).toBe(400);
  });

  it('menolak radius yang terlalu kecil untuk akurasi GPS ponsel', async () => {
    const res = await request(app)
      .post('/api/work-locations')
      .set(auth(hrToken))
      .send({ name: 'Terlalu Sempit', ...MONAS, radiusMeters: 5 });

    expect(res.status).toBe(400);
  });

  it('karyawan biasa tidak boleh membuat lokasi', async () => {
    await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1' });
    const token = await login(app, 'budi@resto.id');

    const res = await request(app)
      .post('/api/work-locations')
      .set(auth(token))
      .send({ name: 'Resto Bayangan', ...MONAS });

    expect(res.status).toBe(403);
  });
});

describe('GET /api/work-locations', () => {
  it('menyembunyikan token QR dari karyawan biasa', async () => {
    await makeWorkLocation({ name: 'Resto Pusat' });
    await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1' });
    const token = await login(app, 'budi@resto.id');

    const res = await request(app).get('/api/work-locations').set(auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    // Karyawan perlu daftar lokasi untuk check-in GPS, tapi tokennya tidak:
    // siapa pun yang tahu token bisa absen tanpa berada di lokasi.
    expect(res.body.data[0]).not.toHaveProperty('qrSecret');
  });

  it('menampilkan token QR kepada HR untuk dicetak', async () => {
    await makeWorkLocation({ name: 'Resto Pusat' });

    const res = await request(app).get('/api/work-locations').set(auth(hrToken));

    expect(res.body.data[0].qrSecret).toBeTruthy();
  });

  it('menyembunyikan lokasi non-aktif secara default', async () => {
    const lokasi = await makeWorkLocation({ name: 'Cabang Tutup' });
    await prisma.workLocation.update({ where: { id: lokasi.id }, data: { isActive: false } });

    const bawaan = await request(app).get('/api/work-locations').set(auth(hrToken));
    expect(bawaan.body.pagination.total).toBe(0);

    const semua = await request(app)
      .get('/api/work-locations?includeInactive=true')
      .set(auth(hrToken));
    expect(semua.body.pagination.total).toBe(1);
  });
});

describe('POST /api/work-locations/:id/rotate-qr', () => {
  it('mengganti token QR sehingga yang lama tidak berlaku', async () => {
    const lokasi = await makeWorkLocation({ name: 'Resto Pusat' });
    const tokenLama = lokasi.qrSecret;

    const res = await request(app)
      .post(`/api/work-locations/${lokasi.id}/rotate-qr`)
      .set(auth(hrToken));

    expect(res.status).toBe(200);
    expect(res.body.workLocation.qrSecret).not.toBe(tokenLama);

    // Token lama harus benar-benar tidak bisa dipakai absen lagi.
    await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1' });
    const tokenKaryawan = await login(app, 'budi@resto.id');

    const absen = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(tokenKaryawan))
      .send({ method: 'qr', qrToken: tokenLama });

    expect(absen.status).toBe(400);
  });

  it('hanya boleh dilakukan HR', async () => {
    const lokasi = await makeWorkLocation({ name: 'Resto Pusat' });
    await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1' });
    const token = await login(app, 'budi@resto.id');

    const res = await request(app)
      .post(`/api/work-locations/${lokasi.id}/rotate-qr`)
      .set(auth(token));

    expect(res.status).toBe(403);
  });
});

describe('PUT /api/work-locations/:id', () => {
  it('memperbarui radius geofence', async () => {
    const lokasi = await makeWorkLocation({ name: 'Resto Pusat', radiusMeters: 100 });

    const res = await request(app)
      .put(`/api/work-locations/${lokasi.id}`)
      .set(auth(hrToken))
      .send({ radiusMeters: 300 });

    expect(res.status).toBe(200);
    expect(res.body.radiusMeters).toBe(300);
  });

  it('membalas 404 untuk lokasi yang tidak ada', async () => {
    const res = await request(app)
      .put('/api/work-locations/01ZZZZZZZZZZZZZZZZZZZZZZZZ')
      .set(auth(hrToken))
      .send({ radiusMeters: 300 });

    expect(res.status).toBe(404);
  });
});
