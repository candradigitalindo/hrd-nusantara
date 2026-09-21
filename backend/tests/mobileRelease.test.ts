import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee } from './helpers/db';
import { bikinApp } from './helpers/app';
import { login, auth, expectStatus } from './helpers/api';
import { env } from '../src/config/env';
import { isApk, MIME_APK } from '../src/controllers/mobileReleaseController';

const app = bikinApp();
let hrToken: string;
let budiToken: string;

/** Tiruan APK: arsip ZIP (tanda PK) yang menyebut AndroidManifest.xml. */
const apkPalsu = (isi = 7) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(2000, isi), Buffer.from('AndroidManifest.xml'), Buffer.alloc(600, isi + 1)]);

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1' });
  budiToken = await login(app, 'budi@resto.id');
});

afterAll(() => {
  fs.rmSync(path.resolve(env.UPLOAD_DIR, 'apk'), { recursive: true, force: true });
});

const unggah = (versionName: string, versionCode: number, badan: Buffer = apkPalsu(), token = hrToken, notes?: string) =>
  request(app)
    .post(`/api/mobile/releases?versionName=${versionName}&versionCode=${versionCode}${notes ? `&notes=${encodeURIComponent(notes)}` : ''}`)
    .set(auth(token))
    .set('Content-Type', MIME_APK)
    .send(badan);

describe('Pengenal APK (murni)', () => {
  it('menerima ZIP yang memuat AndroidManifest.xml, menolak yang lain', () => {
    expect(isApk(apkPalsu())).toBe(true);
    expect(isApk(Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(3000, 0)]))).toBe(false);
    expect(isApk(Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(3000, 0), Buffer.from('AndroidManifest.xml')]))).toBe(false);
    expect(isApk(Buffer.from('PK\x03\x04AndroidManifest.xml'))).toBe(false);
  });
});

describe('HR mengunggah rilis', () => {
  it('menyimpan berkas, sha256, ukuran, dan metadata versi', async () => {
    const badan = apkPalsu();
    const res = await unggah('1.0.0', 1, badan, hrToken, 'Rilis pertama');
    expectStatus(res, 201);
    expect(res.body).toMatchObject({ versionName: '1.0.0', versionCode: 1, sizeBytes: badan.length, fileName: 'hrd-nusantara-1.0.0.apk', notes: 'Rilis pertama', isActive: true, downloadCount: 0 });
    expect(res.body.sha256).toBe(createHash('sha256').update(badan).digest('hex'));
    expect(res.body.uploadedBy.name).toBeTruthy();

    const baris = await prisma.mobileRelease.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(fs.readFileSync(path.resolve(env.UPLOAD_DIR, baris.storagePath)).equals(badan)).toBe(true);
  });

  it('karyawan biasa tidak boleh mengunggah', async () => {
    expectStatus(await unggah('1.0.0', 1, apkPalsu(), budiToken), 403);
  });

  it('menolak berkas yang bukan APK dan format versi yang salah', async () => {
    const bukan = await unggah('1.0.0', 1, Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(3000, 0)]));
    expectStatus(bukan, 400);
    expect(bukan.body.error).toContain('bukan APK');
    expectStatus(await unggah('v1', 1), 400);
    expect(await prisma.mobileRelease.count()).toBe(0);
  });

  it('menolak versionCode yang sudah dipakai dan tidak meninggalkan berkas yatim', async () => {
    expectStatus(await unggah('1.0.0', 5), 201);
    const ganda = await unggah('1.0.1', 5);
    expectStatus(ganda, 409);
    expect(fs.readdirSync(path.resolve(env.UPLOAD_DIR, 'apk')).filter((f) => f.startsWith('5-'))).toHaveLength(1);
  });
});

describe('Karyawan mengunduh versi terbaru (publik, tanpa sesi)', () => {
  it('versi terbaru = versionCode tertinggi yang aktif; rilis nonaktif dilewati', async () => {
    expectStatus(await request(app).get('/api/mobile/releases/latest'), 404);

    await unggah('1.0.0', 1);
    const kedua = await unggah('1.1.0', 2);

    const terbaru = await request(app).get('/api/mobile/releases/latest');
    expectStatus(terbaru, 200);
    expect(terbaru.body.versionName).toBe('1.1.0');
    expect(terbaru.body.downloadPath).toBe('/api/mobile/apk/latest');
    expect(terbaru.body).not.toHaveProperty('storagePath');

    const nonaktif = await request(app).patch(`/api/mobile/releases/${kedua.body.id}`).set(auth(hrToken)).send({ isActive: false });
    expectStatus(nonaktif, 200);
    expect((await request(app).get('/api/mobile/releases/latest')).body.versionName).toBe('1.0.0');
  });

  it('mengirim berkas APK dengan tipe, nama, dan checksum yang benar, lalu menghitung unduhan', async () => {
    const badan = apkPalsu(3);
    const rilis = await unggah('2.0.0', 20, badan);

    const res = await request(app).get('/api/mobile/apk/latest').buffer(true).parse((r, cb) => {
      const potongan: Buffer[] = [];
      r.on('data', (c: Buffer) => potongan.push(c));
      r.on('end', () => cb(null, Buffer.concat(potongan)));
    });
    expectStatus(res, 200);
    expect(res.headers['content-type']).toContain(MIME_APK);
    expect(res.headers['content-disposition']).toContain('hrd-nusantara-2.0.0.apk');
    expect(res.headers['x-checksum-sha256']).toBe(rilis.body.sha256);
    expect((res.body as Buffer).equals(badan)).toBe(true);

    // Penghitung ditulis di latar; beri kesempatan selesai.
    await new Promise((r) => setTimeout(r, 50));
    expect((await prisma.mobileRelease.findUniqueOrThrow({ where: { id: rilis.body.id } })).downloadCount).toBe(1);

    const perId = await request(app).get(`/api/mobile/releases/${rilis.body.id}/apk`).buffer(true).parse((r, cb) => {
      const potongan: Buffer[] = [];
      r.on('data', (c: Buffer) => potongan.push(c));
      r.on('end', () => cb(null, Buffer.concat(potongan)));
    });
    expectStatus(perId, 200);
  });

  it('berkas yang hilang dari penyimpanan dilaporkan sebagai 500, bukan 404', async () => {
    const rilis = await unggah('3.0.0', 30);
    const baris = await prisma.mobileRelease.findUniqueOrThrow({ where: { id: rilis.body.id } });
    fs.rmSync(path.resolve(env.UPLOAD_DIR, baris.storagePath));
    expectStatus(await request(app).get('/api/mobile/apk/latest'), 500);
  });
});

describe('Daftar rilis dan QR (HR)', () => {
  it('daftar hanya untuk HR, terurut versi terbaru dulu, termasuk nonaktif', async () => {
    await unggah('1.0.0', 1);
    const b = await unggah('1.1.0', 2);
    await request(app).patch(`/api/mobile/releases/${b.body.id}`).set(auth(hrToken)).send({ isActive: false });

    expectStatus(await request(app).get('/api/mobile/releases').set(auth(budiToken)), 403);
    const res = await request(app).get('/api/mobile/releases').set(auth(hrToken));
    expectStatus(res, 200);
    expect(res.body.data.map((r: { versionName: string; isActive: boolean }) => `${r.versionName}:${r.isActive}`)).toEqual(['1.1.0:false', '1.0.0:true']);
  });

  it('QR tautan unduh hanya untuk HR', async () => {
    const res = await request(app).get('/api/mobile/qr?text=https://hrd.contoh.id/unduh').set(auth(hrToken));
    expectStatus(res, 200);
    expect(res.body.dataUrl).toMatch(/^data:image\/png;base64,/);
    expectStatus(await request(app).get('/api/mobile/qr?text=x').set(auth(budiToken)), 403);
  });
});
