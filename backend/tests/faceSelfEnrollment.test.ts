import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { Role } from '@prisma/client';
import {
  prisma,
  resetDatabase,
  makeEmployee,
  makeDepartment,
  makePosition,
  makeWorkLocation,
  tungguJejakAudit,
  MONAS,
} from './helpers/db';
import { login, auth, expectStatus } from './helpers/api';
import { bikinApp } from './helpers/app';
import { areModelsAvailable } from '../src/services/face';
import { env } from '../src/config/env';
import { generateULID } from '../src/utils/generateULID';
import { setPengirimPush, type PesanPush } from '../src/services/notification/push';
import { tungguStempelSelesai } from '../src/services/whatsapp/attendanceStamp';

/**
 * Pendaftaran wajah mandiri: karyawan mengirim selfie dari aplikasi, HR
 * menyetujui di web. Yang dijaga di sini terutama satu hal — kiriman yang
 * belum disetujui tidak pernah dipakai mencocokkan check-in, karena tanpa itu
 * karyawan A bisa mendaftarkan wajah rekan B atas nama A (titip absen).
 */

const app = bikinApp();
const FIXTURES = path.resolve(__dirname, 'fixtures/faces');
const foto = (nama: string) => fs.readFileSync(path.join(FIXTURES, nama));
const b64 = (nama: string) => foto(nama).toString('base64');

const describeModel = areModelsAvailable() ? describe : describe.skip;

// Check-in wajah menjadwalkan stempel WhatsApp di latar; tunggu sebelum
// database dikosongkan tes berikutnya.
afterEach(() => tungguStempelSelesai());

let hr: { id: string; name: string };
let hrToken: string;
let hr2Token: string;
let budi: { id: string; name: string; nik: string };
let budiToken: string;
let lokasiId: string;
let dapurId: string;

beforeEach(async () => {
  await resetDatabase();
  const dapur = await makeDepartment('Dapur');
  dapurId = dapur.id;
  const koki = await makePosition('Koki', dapur.id);
  hr = await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', name: 'Rina HR', role: Role.HR_ADMIN });
  await makeEmployee({ email: 'hr2@resto.id', nik: 'HR-2', name: 'Sari HR', role: Role.HR_ADMIN });
  budi = await makeEmployee({
    email: 'budi@resto.id',
    nik: 'EMP-1',
    name: 'Budi Cook',
    departmentId: dapur.id,
    positionId: koki.id,
  });
  hrToken = await login(app, 'hr@resto.id');
  hr2Token = await login(app, 'hr2@resto.id');
  budiToken = await login(app, 'budi@resto.id');
  lokasiId = (await makeWorkLocation({ name: 'Resto Pusat' })).id;
});

const kirimSendiri = (token: string, nama: string) =>
  request(app).post('/api/face-enrollments/me').set(auth(token)).send({ image: b64(nama) });

const statusSaya = async (token = budiToken) => {
  const res = await request(app).get('/api/face-enrollments/me').set(auth(token));
  expectStatus(res, 200);
  return res.body;
};

const setujui = (id: string, token = hrToken, body: Record<string, unknown> = {}) =>
  request(app).post(`/api/face-enrollments/${id}/approve`).set(auth(token)).send(body);

const tolak = (id: string, body: Record<string, unknown>, token = hrToken) =>
  request(app).post(`/api/face-enrollments/${id}/reject`).set(auth(token)).send(body);

const lihatFoto = (id: string, token = hrToken) =>
  request(app).get(`/api/face-enrollments/${id}/photo`).set(auth(token));

const checkInWajah = (token: string, nama: string, kunci?: string) => {
  const req = request(app).post('/api/attendance/check-in').set(auth(token));
  if (kunci) req.set('Idempotency-Key', kunci);
  return req.send({ method: 'face', workLocationId: lokasiId, ...MONAS, faceImage: b64(nama) });
};

const menitLalu = (m: number) => new Date(Date.now() - m * 60_000);

/**
 * Baris dibuat langsung di database, untuk aturan status yang tidak butuh
 * model pengenalan wajah. Bawaannya kiriman mandiri yang menunggu.
 */
const baris = (
  employeeId: string,
  ubah: {
    status?: string;
    source?: string;
    isActive?: boolean;
    modelName?: string;
    reviewNote?: string;
    reviewedAt?: Date;
    createdAt?: Date;
  } = {}
) =>
  prisma.faceEnrollment.create({
    data: {
      id: generateULID(),
      employeeId,
      embedding: Buffer.alloc(16),
      dimensions: 512,
      modelName: ubah.modelName ?? env.FACE_MODEL_NAME,
      detectionScore: 0.9,
      livenessScore: 0.99,
      status: ubah.status ?? 'pending',
      source: ubah.source ?? 'self',
      isActive: ubah.isActive ?? false,
      reviewNote: ubah.reviewNote ?? null,
      reviewedAt: ubah.reviewedAt ?? null,
      enrolledById: employeeId,
      createdAt: ubah.createdAt ?? new Date(),
    },
  });

/** Pendaftaran langsung oleh HR (perilaku lama). */
const barisHr = (employeeId: string, ubah: { createdAt?: Date; modelName?: string } = {}) =>
  baris(employeeId, { status: 'approved', source: 'hr', isActive: true, ...ubah });

describe('GET /api/face-enrollments/me', () => {
  it('belum pernah mendaftar', async () => {
    expect(await statusSaya()).toEqual({
      enrolled: false,
      pending: null,
      lastRejection: null,
      recognitionEnabled: true,
    });
  });

  it('menunggu persetujuan: belum terdaftar, kirimannya disebut', async () => {
    const kiriman = await baris(budi.id);

    const status = await statusSaya();
    expect(status.enrolled).toBe(false);
    expect(status.pending).toEqual({ id: kiriman.id, createdAt: kiriman.createdAt.toISOString() });
    expect(status.lastRejection).toBeNull();
  });

  it('terdaftar hanya bila ada pendaftaran aktif, disetujui, untuk model yang aktif', async () => {
    // Syarat yang sama dengan check-in: yang lain akan tetap ditolak saat absen.
    await barisHr(budi.id, { modelName: 'model_lama_v1' });
    await baris(budi.id, { status: 'approved', isActive: false });
    expect((await statusSaya()).enrolled).toBe(false);

    await barisHr(budi.id);
    expect(await statusSaya()).toMatchObject({ enrolled: true, pending: null, lastRejection: null });
  });

  it('ditolak: alasan dari HR ikut ditampilkan', async () => {
    const ditolak = await baris(budi.id, {
      status: 'rejected',
      reviewNote: 'Foto buram',
      reviewedAt: menitLalu(1),
    });

    const status = await statusSaya();
    expect(status.lastRejection).toEqual({
      id: ditolak.id,
      reason: 'Foto buram',
      reviewedAt: ditolak.reviewedAt!.toISOString(),
    });
  });

  it('penolakan tidak lagi ditampilkan setelah ada kiriman ulang', async () => {
    await baris(budi.id, { status: 'rejected', reviewNote: 'Foto buram', createdAt: menitLalu(10) });
    const ulang = await baris(budi.id, { createdAt: menitLalu(1) });

    const status = await statusSaya();
    expect(status.lastRejection).toBeNull();
    expect(status.pending.id).toBe(ulang.id);
  });

  it('penolakan tidak lagi ditampilkan setelah HR mendaftarkan langsung', async () => {
    await baris(budi.id, { status: 'rejected', reviewNote: 'Foto buram', createdAt: menitLalu(10) });
    await barisHr(budi.id, { createdAt: menitLalu(1) });

    expect(await statusSaya()).toMatchObject({ enrolled: true, lastRejection: null });
  });

  it('penolakan atas "perbarui foto" tetap ditampilkan walau sudah terdaftar', async () => {
    await barisHr(budi.id, { createdAt: menitLalu(10) });
    await baris(budi.id, { status: 'rejected', reviewNote: 'Bukan wajah Anda', createdAt: menitLalu(1) });

    const status = await statusSaya();
    expect(status.enrolled).toBe(true);
    expect(status.lastRejection.reason).toBe('Bukan wajah Anda');
  });

  it('hanya memuat milik sendiri', async () => {
    const siti = await makeEmployee({ email: 'siti@resto.id' });
    await baris(siti.id);
    await baris(siti.id, { status: 'rejected', reviewNote: 'Foto buram', createdAt: menitLalu(5) });
    await barisHr(siti.id);

    expect(await statusSaya()).toMatchObject({ enrolled: false, pending: null, lastRejection: null });
  });
});

describe('GET /api/face-enrollments/pending', () => {
  it('HR melihat antrean, paling lama menunggu lebih dulu, lengkap dengan data karyawan', async () => {
    const siti = await makeEmployee({ email: 'siti@resto.id', nik: 'EMP-2', name: 'Siti' });
    const baru = await baris(budi.id, { createdAt: menitLalu(1) });
    const lama = await baris(siti.id, { createdAt: menitLalu(30) });
    // Yang sudah diproses tidak ikut.
    await baris(budi.id, { status: 'cancelled', createdAt: menitLalu(40) });
    await baris(siti.id, { status: 'rejected', createdAt: menitLalu(50) });
    await barisHr(siti.id);

    const res = await request(app).get('/api/face-enrollments/pending').set(auth(hrToken));

    expectStatus(res, 200);
    expect(res.body.data.map((k: { id: string }) => k.id)).toEqual([lama.id, baru.id]);
    expect(res.body.pagination).toEqual({ page: 1, limit: 25, total: 2, totalPages: 1 });
    expect(res.body.data[1]).toEqual({
      id: baru.id,
      employeeId: budi.id,
      employee: {
        id: budi.id,
        name: 'Budi Cook',
        nik: 'EMP-1',
        department: { id: dapurId, name: 'Dapur' },
        position: { id: expect.any(String), name: 'Koki' },
      },
      detectionScore: 0.9,
      livenessScore: 0.99,
      createdAt: baru.createdAt.toISOString(),
      stale: false,
    });
    // Data biometrik dan lokasi foto tidak pernah ikut.
    expect(JSON.stringify(res.body)).not.toMatch(/embedding|imageUrl/);
  });

  it('menandai kiriman dari model lama sebagai usang', async () => {
    await baris(budi.id, { modelName: 'model_lama_v1' });
    const res = await request(app).get('/api/face-enrollments/pending').set(auth(hrToken));
    expect(res.body.data[0].stale).toBe(true);
  });

  it('karyawan biasa tidak boleh melihat antrean maupun memutuskan', async () => {
    const siti = await makeEmployee({ email: 'siti@resto.id' });
    const kiriman = await baris(siti.id);

    expect((await request(app).get('/api/face-enrollments/pending').set(auth(budiToken))).status).toBe(403);
    expect((await lihatFoto(kiriman.id, budiToken)).status).toBe(403);
    expect((await setujui(kiriman.id, budiToken)).status).toBe(403);
    expect((await tolak(kiriman.id, { reason: 'Foto buram' }, budiToken)).status).toBe(403);
    expect((await prisma.faceEnrollment.findUniqueOrThrow({ where: { id: kiriman.id } })).status).toBe('pending');
  });

  it('rute /me dan /pending tidak tertangkap sebagai :id', async () => {
    // Kalau tertangkap, validasi id ULID menjawab 400.
    expectStatus(await request(app).get('/api/face-enrollments/me').set(auth(hrToken)), 200);
    expectStatus(await request(app).get('/api/face-enrollments/pending').set(auth(hrToken)), 200);
  });
});

describe('POST /api/face-enrollments/:id/approve', () => {
  it('mengaktifkan kiriman dan mencatat siapa yang menyetujui', async () => {
    const kiriman = await baris(budi.id);

    const res = await setujui(kiriman.id);

    expectStatus(res, 200);
    expect(res.body).toMatchObject({
      id: kiriman.id,
      employeeId: budi.id,
      status: 'approved',
      source: 'self',
      isActive: true,
      livenessScore: 0.99,
      reviewedBy: { id: hr.id, name: 'Rina HR' },
      stale: false,
    });
    expect(res.body.reviewedAt).not.toBeNull();
    expect(res.body).not.toHaveProperty('embedding');
    expect(res.body).not.toHaveProperty('imageUrl');
    expect((await statusSaya()).enrolled).toBe(true);

    const jejak = await tungguJejakAudit({ action: 'employee.face.approve', entityId: kiriman.id });
    expect(jejak?.summary).toBe('Menyetujui foto wajah Budi Cook');
    expect(jejak?.metadata).toMatchObject({ employeeId: budi.id, replaceExisting: false, deactivatedCount: 0 });
  });

  it('HR tidak boleh menyetujui wajahnya sendiri; HR lain boleh', async () => {
    const kiriman = await baris(hr.id);

    const sendiri = await setujui(kiriman.id, hrToken);
    expect(sendiri.status).toBe(403);
    expect(sendiri.body.error).toBe('Wajah Anda sendiri harus disetujui HR lain');

    expectStatus(await setujui(kiriman.id, hr2Token), 200);
  });

  it('kiriman yang sudah diproses tidak bisa diputuskan lagi', async () => {
    const kiriman = await baris(budi.id);
    expectStatus(await setujui(kiriman.id), 200);

    const lagi = await setujui(kiriman.id, hr2Token);
    expect(lagi.status).toBe(409);
    expect(lagi.body.error).toBe('Kiriman ini sudah diproses');
    expect((await tolak(kiriman.id, { reason: 'Foto buram' })).status).toBe(409);

    // Yang dibatalkan dan yang ditolak juga tidak bisa disetujui belakangan.
    const batal = await baris(budi.id, { status: 'cancelled' });
    const ditolak = await baris(budi.id, { status: 'rejected' });
    expect((await setujui(batal.id)).status).toBe(409);
    expect((await setujui(ditolak.id)).status).toBe(409);
  });

  it('dua HR memutuskan bersamaan: hanya satu yang berlaku', async () => {
    const kiriman = await baris(budi.id);

    const [a, b] = await Promise.all([
      setujui(kiriman.id, hrToken),
      tolak(kiriman.id, { reason: 'Bukan wajah karyawan ini' }, hr2Token),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const akhir = await prisma.faceEnrollment.findUniqueOrThrow({ where: { id: kiriman.id } });
    expect(akhir.isActive).toBe(akhir.status === 'approved');
  });

  it('replaceExisting menonaktifkan pendaftaran lama milik karyawan itu saja', async () => {
    const lama = await barisHr(budi.id, { createdAt: menitLalu(60) });
    const siti = await makeEmployee({ email: 'siti@resto.id' });
    const milikSiti = await barisHr(siti.id);
    const kiriman = await baris(budi.id);

    expectStatus(await setujui(kiriman.id, hrToken, { replaceExisting: true }), 200);

    const aktif = await prisma.faceEnrollment.findMany({ where: { isActive: true }, select: { id: true } });
    expect(aktif.map((r) => r.id).sort()).toEqual([milikSiti.id, kiriman.id].sort());
    expect((await prisma.faceEnrollment.findUniqueOrThrow({ where: { id: lama.id } })).isActive).toBe(false);

    const jejak = await tungguJejakAudit({ action: 'employee.face.approve', entityId: kiriman.id });
    expect(jejak?.metadata).toMatchObject({ replaceExisting: true, deactivatedCount: 1 });
  });

  it('tanpa replaceExisting, foto lama tetap aktif berdampingan', async () => {
    await barisHr(budi.id, { createdAt: menitLalu(60) });
    const kiriman = await baris(budi.id);

    expectStatus(await setujui(kiriman.id), 200);
    expect(await prisma.faceEnrollment.count({ where: { employeeId: budi.id, isActive: true } })).toBe(2);
  });

  it('menolak menyetujui kiriman dari model yang sudah diganti', async () => {
    const kiriman = await baris(budi.id, { modelName: 'model_lama_v1' });

    const res = await setujui(kiriman.id);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Model pengenalan wajah sudah berganti. Minta karyawan mengirim foto ulang.');
    expect((await prisma.faceEnrollment.findUniqueOrThrow({ where: { id: kiriman.id } })).isActive).toBe(false);
  });

  it('404 untuk kiriman yang tidak ada; body asing ditolak', async () => {
    expect((await setujui('01ZZZZZZZZZZZZZZZZZZZZZZZZ')).status).toBe(404);

    const kiriman = await baris(budi.id);
    expect((await setujui(kiriman.id, hrToken, { isActive: true })).status).toBe(400);
  });
});

describe('POST /api/face-enrollments/:id/reject', () => {
  it('alasan wajib, 3–300 karakter setelah dipangkas', async () => {
    const kiriman = await baris(budi.id);

    expect((await tolak(kiriman.id, {})).status).toBe(400);
    expect((await tolak(kiriman.id, { reason: '  ab  ' })).status).toBe(400);
    expect((await tolak(kiriman.id, { reason: 'x'.repeat(301) })).status).toBe(400);
    expect((await prisma.faceEnrollment.findUniqueOrThrow({ where: { id: kiriman.id } })).status).toBe('pending');
  });

  it('menolak kiriman dan alasannya sampai ke karyawan', async () => {
    const kiriman = await baris(budi.id);

    const res = await tolak(kiriman.id, { reason: '  Bukan wajah karyawan ini ' });

    expectStatus(res, 200);
    expect(res.body).toEqual({
      id: kiriman.id,
      status: 'rejected',
      reviewNote: 'Bukan wajah karyawan ini',
      reviewedAt: expect.any(String),
    });
    const tersimpan = await prisma.faceEnrollment.findUniqueOrThrow({ where: { id: kiriman.id } });
    expect(tersimpan).toMatchObject({ status: 'rejected', isActive: false, reviewedById: hr.id });

    const status = await statusSaya();
    expect(status).toMatchObject({ enrolled: false, pending: null });
    expect(status.lastRejection).toEqual({
      id: kiriman.id,
      reason: 'Bukan wajah karyawan ini',
      reviewedAt: res.body.reviewedAt,
    });

    const jejak = await tungguJejakAudit({ action: 'employee.face.reject', entityId: kiriman.id });
    expect(jejak?.metadata).toMatchObject({ employeeId: budi.id, reason: 'Bukan wajah karyawan ini' });
  });

  it('HR boleh menolak kirimannya sendiri', async () => {
    const kiriman = await baris(hr.id);
    expectStatus(await tolak(kiriman.id, { reason: 'Salah foto' }), 200);
  });
});

describe('Kiriman menunggu di jalur HR yang sudah ada', () => {
  it('DELETE kiriman yang menunggu: 409, diarahkan ke Tolak', async () => {
    const kiriman = await baris(budi.id);

    const res = await request(app).delete(`/api/face-enrollments/${kiriman.id}`).set(auth(hrToken));

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Kiriman yang menunggu persetujuan ditolak lewat tombol Tolak');
    expect((await prisma.faceEnrollment.findUniqueOrThrow({ where: { id: kiriman.id } })).status).toBe('pending');
  });

  it('daftar pendaftaran karyawan menyebut kiriman yang menunggu terpisah dari yang aktif', async () => {
    const aktif = await barisHr(budi.id, { createdAt: menitLalu(60) });
    await baris(budi.id, { status: 'cancelled', createdAt: menitLalu(30) });
    const kiriman = await baris(budi.id);

    const res = await request(app).get(`/api/employees/${budi.id}/face-enrollments`).set(auth(hrToken));

    expectStatus(res, 200);
    expect(res.body.data.map((r: { id: string }) => r.id)).toEqual([aktif.id]);
    expect(res.body.data[0]).toMatchObject({ status: 'approved', source: 'hr', reviewedBy: null });
    expect(res.body.pending).toEqual({
      id: kiriman.id,
      createdAt: kiriman.createdAt.toISOString(),
      detectionScore: 0.9,
      livenessScore: 0.99,
      stale: false,
    });

    const kosong = await request(app).get(`/api/employees/${hr.id}/face-enrollments`).set(auth(hrToken));
    expect(kosong.body.pending).toBeNull();
  });

  it('daftar karyawan: Terdaftar / Menunggu / Belum', async () => {
    const siti = await makeEmployee({ email: 'siti@resto.id' });
    const kiriman = await baris(budi.id);
    await barisHr(siti.id);

    const daftar = async () => {
      const res = await request(app).get('/api/employees?limit=100').set(auth(hrToken));
      expectStatus(res, 200);
      return res.body.data as { id: string; faceEnrolled?: boolean; facePending?: boolean }[];
    };

    let isi = await daftar();
    expect(isi.find((k) => k.id === budi.id)).toMatchObject({ faceEnrolled: false, facePending: true });
    expect(isi.find((k) => k.id === siti.id)).toMatchObject({ faceEnrolled: true, facePending: false });
    expect(isi.find((k) => k.id === hr.id)).toMatchObject({ faceEnrolled: false, facePending: false });

    await setujui(kiriman.id);
    isi = await daftar();
    expect(isi.find((k) => k.id === budi.id)).toMatchObject({ faceEnrolled: true, facePending: false });
  });

  it('status wajah tidak ikut bagi yang tidak memegang izin wajah', async () => {
    await makeEmployee({ email: 'manajer@resto.id', role: Role.MANAGER, departmentId: dapurId });
    await baris(budi.id);

    const res = await request(app).get('/api/employees?limit=100').set(auth(await login(app, 'manajer@resto.id')));

    expect(res.body.data.some((k: { id: string }) => k.id === budi.id)).toBe(true);
    expect(res.body.data.every((k: object) => !('facePending' in k) && !('faceEnrolled' in k))).toBe(true);
  });
});

describe('Notifikasi push ke karyawan', () => {
  let terkirim: PesanPush[];

  beforeEach(async () => {
    terkirim = [];
    setPengirimPush(async (tokens, pesan) => {
      terkirim.push(pesan);
      return { terkirim: tokens.length, gagal: 0, tokenTidakSah: [] };
    });
    await prisma.deviceToken.create({
      data: { id: generateULID(), employeeId: budi.id, token: 'fcm-token-budi-aaaaaaaaaaaaaaaa', platform: 'android' },
    });
  });

  afterEach(() => setPengirimPush(null));

  /** Push dikirim setelah jawaban, jadi ditunggu datanya, bukan waktunya. */
  const tungguPush = async () => {
    const tenggat = Date.now() + 5000;
    while (terkirim.length === 0 && Date.now() < tenggat) {
      await new Promise((lanjut) => setTimeout(lanjut, 25));
    }
    return terkirim;
  };

  it('memberi tahu saat disetujui', async () => {
    const kiriman = await baris(budi.id);
    expectStatus(await setujui(kiriman.id), 200);

    expect(await tungguPush()).toEqual([
      {
        title: 'Wajah disetujui',
        body: 'Anda sekarang bisa check-in dengan Verifikasi Wajah.',
        data: { jenis: 'wajah', status: 'approved' },
      },
    ]);
  });

  it('memberi tahu alasan saat ditolak', async () => {
    const kiriman = await baris(budi.id);
    expectStatus(await tolak(kiriman.id, { reason: 'Foto buram' }), 200);

    expect(await tungguPush()).toEqual([
      { title: 'Foto wajah ditolak', body: 'Foto buram', data: { jenis: 'wajah', status: 'rejected' } },
    ]);
  });

  it('push yang gagal tidak membatalkan keputusan HR', async () => {
    setPengirimPush(async () => {
      throw new Error('FCM tidak terjangkau');
    });
    const kiriman = await baris(budi.id);

    expectStatus(await setujui(kiriman.id), 200);
    expect((await statusSaya()).enrolled).toBe(true);
  });
});

describeModel('Kiriman mandiri dari aplikasi (dengan model)', () => {
  it('tersimpan sebagai menunggu dan tidak membocorkan embedding maupun lokasi foto', async () => {
    const res = await kirimSendiri(budiToken, 'personA_1.jpg');

    expectStatus(res, 201);
    expect(res.body).toEqual({ id: expect.any(String), status: 'pending', createdAt: expect.any(String) });

    const tersimpan = await prisma.faceEnrollment.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(tersimpan).toMatchObject({
      employeeId: budi.id,
      enrolledById: budi.id,
      status: 'pending',
      source: 'self',
      isActive: false,
      dimensions: 512,
      modelName: env.FACE_MODEL_NAME,
    });
    // Keaslian-hidup diperiksa — tidak ada HR yang menyaksikan foto diambil.
    expect(tersimpan.livenessScore).toBeGreaterThan(0.9);
    expect(tersimpan.imageUrl).toMatch(/^face-enrollments\//);
    expect(fs.existsSync(path.resolve(env.UPLOAD_DIR, tersimpan.imageUrl!))).toBe(true);

    const jejak = await tungguJejakAudit({ action: 'employee.face.self_submit', entityId: res.body.id });
    expect(jejak?.summary).toBe('Mengirim foto wajah untuk disetujui (Budi Cook)');
    expect(jejak?.metadata).toMatchObject({ employeeId: budi.id, cancelledCount: 0 });
    expect(JSON.stringify(jejak?.metadata)).not.toMatch(/base64|\/9j\//);
  });

  it('kiriman yang belum disetujui tidak dipakai check-in', async () => {
    await kirimSendiri(budiToken, 'personA_1.jpg');

    const res = await checkInWajah(budiToken, 'personA_2.jpg');

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('not_enrolled');
    expect(res.body.error).toContain('Profil › Wajah untuk Presensi');
    expect(await prisma.attendance.count()).toBe(0);
  });

  it('kiriman kedua membatalkan kiriman pertama yang masih menunggu', async () => {
    const pertama = await kirimSendiri(budiToken, 'personA_1.jpg');
    const kedua = await kirimSendiri(budiToken, 'personA_2.jpg');

    expectStatus(kedua, 201);
    expect(await prisma.faceEnrollment.findUniqueOrThrow({ where: { id: pertama.body.id } })).toMatchObject({
      status: 'cancelled',
      reviewNote: 'Digantikan kiriman baru',
      isActive: false,
    });
    expect((await statusSaya()).pending.id).toBe(kedua.body.id);
    expect((await setujui(pertama.body.id)).status).toBe(409);

    const jejak = await tungguJejakAudit({ action: 'employee.face.self_submit', entityId: kedua.body.id });
    expect(jejak?.metadata).toMatchObject({ cancelledCount: 1 });
  });

  it('kirim ulang setelah ditolak menghapus tampilan penolakan', async () => {
    const pertama = await kirimSendiri(budiToken, 'personA_1.jpg');
    await tolak(pertama.body.id, { reason: 'Foto buram' });
    expect((await statusSaya()).lastRejection.reason).toBe('Foto buram');

    const ulang = await kirimSendiri(budiToken, 'personA_2.jpg');
    const status = await statusSaya();
    expect(status.lastRejection).toBeNull();
    expect(status.pending.id).toBe(ulang.body.id);
    // Yang sudah ditolak tetap ditolak, bukan ikut "dibatalkan".
    expect((await prisma.faceEnrollment.findUniqueOrThrow({ where: { id: pertama.body.id } })).status).toBe('rejected');
  });

  it('menolak foto yang ditampilkan di layar', async () => {
    const { simulateScreenReplay } = await import('./helpers/spoof');
    const palsu = await simulateScreenReplay(foto('personA_1.jpg'), { bezel: 30 });

    const res = await request(app)
      .post('/api/face-enrollments/me')
      .set(auth(budiToken))
      .send({ image: palsu.toString('base64') });

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('spoof_detected');
    expect(await prisma.faceEnrollment.count()).toBe(0);
  });

  it('menolak foto tanpa wajah, data yang bukan gambar, dan field asing', async () => {
    const sharp = (await import('sharp')).default;
    const polos = await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 210, g: 190, b: 170 } },
    })
      .jpeg()
      .toBuffer();

    const tanpaWajah = await request(app)
      .post('/api/face-enrollments/me')
      .set(auth(budiToken))
      .send({ image: polos.toString('base64') });
    expect(tanpaWajah.status).toBe(422);
    expect(tanpaWajah.body.reason).toBe('no_face');

    const bukanGambar = await request(app)
      .post('/api/face-enrollments/me')
      .set(auth(budiToken))
      .send({ image: Buffer.from('x'.repeat(200)).toString('base64') });
    expect(bukanGambar.status).toBe(400);

    // Hanya foto: pemilik kiriman selalu si pengirim, tidak bisa dititipkan.
    const asing = await request(app)
      .post('/api/face-enrollments/me')
      .set(auth(budiToken))
      .send({ image: b64('personA_1.jpg'), employeeId: hr.id });
    expect(asing.status).toBe(400);
    expect(await prisma.faceEnrollment.count()).toBe(0);
  });

  it('foto bisa dilihat HR mana pun selama menunggu, dan tercatat di jejak audit', async () => {
    const kiriman = await kirimSendiri(budiToken, 'personA_1.jpg');

    const res = await lihatFoto(kiriman.body.id);
    expectStatus(res, 200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(res.body as Buffer, foto('personA_1.jpg'))).toBe(0);

    expectStatus(await lihatFoto(kiriman.body.id, hr2Token), 200);

    const jejak = await tungguJejakAudit({ action: 'employee.face.photo_view', entityId: kiriman.body.id });
    expect(jejak?.summary).toBe('Melihat foto wajah kiriman Budi Cook');
    expect(jejak?.metadata).toMatchObject({ employeeId: budi.id });
  });

  it('foto tidak bisa dibuka lagi setelah diputuskan', async () => {
    const kiriman = await kirimSendiri(budiToken, 'personA_1.jpg');
    await setujui(kiriman.body.id);

    const res = await lihatFoto(kiriman.body.id);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Foto hanya bisa dilihat selama menunggu persetujuan');
  });

  it('setelah disetujui, check-in wajah berhasil', async () => {
    const kiriman = await kirimSendiri(budiToken, 'personA_1.jpg');
    expectStatus(await setujui(kiriman.body.id), 200);

    // Foto berbeda dari yang dikirim — orangnya sama.
    const res = await checkInWajah(budiToken, 'personA_2.jpg');

    expectStatus(res, 201);
    expect(res.body.faceVerified).toBe(true);
  });

  it('wajah orang lain yang dikirim lalu ditolak tidak pernah bisa dipakai', async () => {
    // Skenario titip absen: Budi mengirim wajah rekan (personB) atas namanya.
    const kiriman = await kirimSendiri(budiToken, 'personB_1.jpg');
    await tolak(kiriman.body.id, { reason: 'Bukan wajah karyawan ini' });

    const res = await checkInWajah(budiToken, 'personB_1.jpg');
    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('not_enrolled');
  });

  it('HR yang mengirim wajahnya sendiri tetap harus disetujui HR lain', async () => {
    const kiriman = await kirimSendiri(hrToken, 'personB_1.jpg');
    expectStatus(kiriman, 201);

    expect((await setujui(kiriman.body.id, hrToken)).status).toBe(403);
    expectStatus(await setujui(kiriman.body.id, hr2Token), 200);
  });

  it('presensi offline yang ditolak "belum terdaftar" bisa dikirim ulang dengan kunci yang sama setelah disetujui', async () => {
    const KUNCI = 'antrean-wajah-01HX-1';

    const ditolak = await checkInWajah(budiToken, 'personA_2.jpg', KUNCI);
    expect(ditolak.status).toBe(422);
    expect(ditolak.body.reason).toBe('not_enrolled');

    const kiriman = await kirimSendiri(budiToken, 'personA_1.jpg');
    expectStatus(await setujui(kiriman.body.id), 200);

    const ulang = await checkInWajah(budiToken, 'personA_2.jpg', KUNCI);
    expectStatus(ulang, 201);
    expect(ulang.headers['idempotent-replayed']).toBeUndefined();

    // Setelah berhasil, kunci yang sama kembali memutar jawaban tersimpan.
    const lagi = await checkInWajah(budiToken, 'personA_2.jpg', KUNCI);
    expect(lagi.status).toBe(201);
    expect(lagi.headers['idempotent-replayed']).toBe('true');
    expect(lagi.body.id).toBe(ulang.body.id);
    expect(await prisma.attendance.count()).toBe(1);
  });

  it('penolakan wajah lain (tidak cocok) tetap diputar ulang apa adanya', async () => {
    const kiriman = await kirimSendiri(budiToken, 'personA_1.jpg');
    await setujui(kiriman.body.id);
    const KUNCI = 'antrean-wajah-01HX-2';

    const pertama = await checkInWajah(budiToken, 'personB_1.jpg', KUNCI);
    expect(pertama.status).toBe(422);
    expect(pertama.body.reason).toBe('no_match');

    const ulang = await checkInWajah(budiToken, 'personB_1.jpg', KUNCI);
    expect(ulang.status).toBe(422);
    expect(ulang.headers['idempotent-replayed']).toBe('true');
  });
});
