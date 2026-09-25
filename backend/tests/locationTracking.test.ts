import request from 'supertest';
import { Role } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma, resetDatabase, makeEmployee, tungguJejakAudit, TEST_TIMEZONE } from './helpers/db';
import { login, auth } from './helpers/api';
import { bikinApp } from './helpers/app';

const app = bikinApp();

let pemilik: string;
let hr: string;
let budi: { id: string };
let tokenBudi: string;

const menitLalu = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const titik = (m: number, lat = -6.2088, lng = 106.8456) => ({ latitude: lat, longitude: lng, accuracyMeters: 12, recordedAt: menitLalu(m) });
const aktifkan = (ubah: Partial<{ enabled: boolean; mode: string; intervalMinutes: number; retentionDays: number }> = {}) =>
  request(app)
    .put('/api/location-tracking/settings')
    .set(auth(pemilik))
    .send({ enabled: true, mode: 'always', intervalMinutes: 5, retentionDays: 30, ...ubah });

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'owner@resto.id', name: 'Pemilik', role: Role.SUPER_ADMIN });
  await makeEmployee({ email: 'hr@resto.id', role: Role.HR_ADMIN });
  budi = await makeEmployee({ email: 'budi@resto.id', name: 'Budi' });
  await makeEmployee({ email: 'siti@resto.id', name: 'Siti' });
  pemilik = await login(app, 'owner@resto.id');
  hr = await login(app, 'hr@resto.id');
  tokenBudi = await login(app, 'budi@resto.id');
});

describe('Pemantauan Lokasi', () => {
  it('bawaannya nonaktif: ponsel tidak diminta mengirim, dan kiriman tidak disimpan', async () => {
    const konfig = await request(app).get('/api/location-tracking/config').set(auth(tokenBudi));
    expect(konfig.body).toEqual({ enabled: false, mode: 'always', intervalMinutes: 15 });

    const kirim = await request(app).post('/api/location-tracking/pings').set(auth(tokenBudi)).send({ pings: [titik(1)] });
    expect(kirim.body).toMatchObject({ diterima: 0, enabled: false });
    expect(await prisma.locationPing.count()).toBe(0);
  });

  it('hanya Super Admin yang bisa mengatur dan melihat — bukan HR, apalagi karyawan', async () => {
    for (const token of [hr, tokenBudi]) {
      expect((await request(app).get('/api/location-tracking/settings').set(auth(token))).status).toBe(403);
      expect((await request(app).get('/api/location-tracking/latest').set(auth(token))).status).toBe(403);
      expect((await request(app).get(`/api/location-tracking/employees/${budi.id}/trail?date=2026-09-25`).set(auth(token))).status).toBe(403);
      expect((await request(app).put('/api/location-tracking/settings').set(auth(token)).send({ enabled: true, mode: 'always', intervalMinutes: 5, retentionDays: 30 })).status).toBe(403);
    }
    const res = await aktifkan({ intervalMinutes: 10 });
    expect(res.status).toBe(200);
    expect((await request(app).get('/api/location-tracking/config').set(auth(tokenBudi))).body).toEqual({ enabled: true, mode: 'always', intervalMinutes: 10 });
    expect((await request(app).put('/api/location-tracking/settings').set(auth(pemilik)).send({ enabled: true, mode: 'always', intervalMinutes: 0, retentionDays: 30 })).status).toBe(400);
  });

  it('titik dobel, bertanggal masa depan, atau melewati masa simpan tidak disimpan; koordinat terenkripsi', async () => {
    await aktifkan({ retentionDays: 7 });
    const pertama = titik(10);
    const res = await request(app)
      .post('/api/location-tracking/pings')
      .set(auth(tokenBudi))
      .send({ pings: [pertama, pertama, titik(5), titik(-60), titik(8 * 24 * 60)] });

    expect(res.body).toEqual({ diterima: 2, dilewati: 3, enabled: true });
    const tersimpan = await prisma.locationPing.findMany();
    expect(tersimpan).toHaveLength(2);
    expect(tersimpan[0].location).not.toContain('106.8456');

    // Dikirim ulang (jawaban tadi hilang): tetap dua.
    await request(app).post('/api/location-tracking/pings').set(auth(tokenBudi)).send({ pings: [pertama] });
    expect(await prisma.locationPing.count()).toBe(2);
  });

  it('posisi terakhir tiap karyawan, termasuk yang belum mengirim dan alasannya', async () => {
    await aktifkan();
    await request(app).post('/api/location-tracking/pings').set(auth(tokenBudi)).send({ pings: [titik(30, -6.1), titik(3, -6.2)] });
    await request(app).put('/api/location-tracking/status').set(auth(tokenBudi)).send({ consent: true, permission: 'granted_always', platform: 'android', appVersion: '0.2.0+1' });

    const res = await request(app).get('/api/location-tracking/latest').set(auth(pemilik));
    expect(res.status).toBe(200);
    const b = res.body.data.find((d: { employee: { name: string } }) => d.employee.name === 'Budi');
    const s = res.body.data.find((d: { employee: { name: string } }) => d.employee.name === 'Siti');
    expect(b.last.latitude).toBe(-6.2);
    expect(b.status).toMatchObject({ permission: 'granted_always', platform: 'android' });
    expect(b.status.consentAt).toBeTruthy();
    expect(s).toMatchObject({ last: null, status: null });
    expect(await tungguJejakAudit({ action: 'lokasi.pantau.lihat' })).not.toBeNull();
  });

  it('riwayat satu hari menurut zona operasional, dan pembukaannya tercatat di audit', async () => {
    await aktifkan();
    await request(app).post('/api/location-tracking/pings').set(auth(tokenBudi)).send({ pings: [titik(20), titik(10), titik(1)] });
    const hariIni = DateTime.now().setZone(TEST_TIMEZONE).toISODate();
    const kemarin = DateTime.now().setZone(TEST_TIMEZONE).minus({ days: 1 }).toISODate();

    const res = await request(app).get(`/api/location-tracking/employees/${budi.id}/trail?date=${hariIni}`).set(auth(pemilik));
    expect(res.status).toBe(200);
    // Bila tes berjalan tepat lewat tengah malam, sebagian titik jatuh ke kemarin.
    const kemarinRes = await request(app).get(`/api/location-tracking/employees/${budi.id}/trail?date=${kemarin}`).set(auth(pemilik));
    expect(res.body.data.length + kemarinRes.body.data.length).toBe(3);
    const waktu = [...kemarinRes.body.data, ...res.body.data].map((t: { recordedAt: string }) => t.recordedAt);
    expect(waktu).toEqual([...waktu].sort());

    const jejak = await tungguJejakAudit({ action: 'lokasi.pantau.riwayat', entityId: budi.id });
    expect(jejak?.summary).toContain('Budi');
  });

  it('masa simpan dipersingkat: titik lama langsung terhapus', async () => {
    await aktifkan({ retentionDays: 30 });
    await request(app).post('/api/location-tracking/pings').set(auth(tokenBudi)).send({ pings: [titik(3 * 24 * 60), titik(60)] });
    expect(await prisma.locationPing.count()).toBe(2);

    await aktifkan({ retentionDays: 1 });
    expect(await prisma.locationPing.count()).toBe(1);
  });

  it('persetujuan karyawan: waktu pertama dipertahankan, menarik persetujuan mengosongkannya', async () => {
    const kirim = (consent: boolean) => request(app).put('/api/location-tracking/status').set(auth(tokenBudi)).send({ consent, permission: 'granted_while_in_use' });
    expect((await kirim(true)).status).toBe(204);
    const awal = (await prisma.locationTrackingStatus.findUniqueOrThrow({ where: { employeeId: budi.id } })).consentAt;
    await kirim(true);
    expect((await prisma.locationTrackingStatus.findUniqueOrThrow({ where: { employeeId: budi.id } })).consentAt).toEqual(awal);
    await kirim(false);
    expect((await prisma.locationTrackingStatus.findUniqueOrThrow({ where: { employeeId: budi.id } })).consentAt).toBeNull();
  });
});
