import request from 'supertest';
import { Role } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma, resetDatabase, makeEmployee, tungguJejakAudit, TEST_TIMEZONE } from './helpers/db';
import { login, auth } from './helpers/api';
import { bikinApp } from './helpers/app';
import { generateULID } from '../src/utils/generateULID';

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
    expect(konfig.body).toEqual({ enabled: false, mode: 'always', intervalMinutes: 20 });

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
    expect(s).toMatchObject({ last: null, status: null, currentAttendance: null });
    expect(await tungguJejakAudit({ action: 'lokasi.pantau.lihat' })).not.toBeNull();
  });

  it('posisi pada tanggal tertentu: titik terakhir & jumlahnya hari itu, sedangkan `last` tetap yang terbaru', async () => {
    await aktifkan();
    const zona = DateTime.now().setZone(TEST_TIMEZONE);
    const lusa = zona.minus({ days: 2 });
    const pada = (jam: number, lat: number) => ({
      latitude: lat,
      longitude: 106.8456,
      accuracyMeters: 12,
      recordedAt: lusa.set({ hour: jam, minute: 0, second: 0, millisecond: 0 }).toUTC().toISO(),
    });
    await request(app).post('/api/location-tracking/pings').set(auth(tokenBudi)).send({ pings: [pada(10, -6.31), pada(15, -6.32), titik(3, -6.2)] });
    const ambil = (q: string) => request(app).get(`/api/location-tracking/latest${q}`).set(auth(pemilik));
    const cari = (res: request.Response, nama: string) => res.body.data.find((d: { employee: { name: string } }) => d.employee.name === nama);

    const tgl = lusa.toISODate();
    const res = await ambil(`?date=${tgl}`);
    expect(res.status).toBe(200);
    expect(res.body.date).toBe(tgl);
    expect(cari(res, 'Budi').lastOnDate.latitude).toBe(-6.32);
    expect(cari(res, 'Budi').countOnDate).toBe(2);
    expect(cari(res, 'Budi').last.latitude).toBe(-6.2);
    expect(cari(res, 'Siti')).toMatchObject({ last: null, lastOnDate: null, countOnDate: 0 });

    // Tanggal tanpa titik sama sekali.
    const kosong = await ambil(`?date=${zona.minus({ days: 3 }).toISODate()}`);
    expect(cari(kosong, 'Budi')).toMatchObject({ lastOnDate: null, countOnDate: 0 });
    expect(cari(kosong, 'Budi').last.latitude).toBe(-6.2);

    // Tanpa tanggal: bentuk lama, tanpa field per tanggal.
    const lama = await ambil('');
    expect(lama.body.date).toBeNull();
    expect(cari(lama, 'Budi')).not.toHaveProperty('lastOnDate');

    expect((await ambil('?date=2026-02-31')).status).toBe(400);
    expect((await ambil('?date=kemarin')).status).toBe(400);
    expect(await tungguJejakAudit({ action: 'lokasi.pantau.lihat', summary: { contains: `tanggal ${tgl}` } })).not.toBeNull();
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

  it.each(['notifications_denied', 'unavailable'])('menerima dan mengembalikan penghalang pemantauan %s tanpa menyimpulkan izin lokasi ditolak', async (permission) => {
    const status = await request(app)
      .put('/api/location-tracking/status')
      .set(auth(tokenBudi))
      .send({ consent: true, permission, platform: 'android' });
    expect(status.status).toBe(204);
    const res = await request(app).get('/api/location-tracking/latest').set(auth(pemilik));
    const karyawan = res.body.data.find((d: { employee: { id: string } }) => d.employee.id === budi.id);
    expect(karyawan.status.permission).toBe(permission);
    expect(karyawan.status.consentAt).toBeTruthy();
    expect(karyawan.last).toBeNull();
  });

  it('status klien lama tetap diterima dan kode penghalang tak dikenal ditolak', async () => {
    for (const permission of ['granted_always', 'granted_while_in_use', 'denied', 'denied_forever', 'service_off']) {
      const res = await request(app).put('/api/location-tracking/status').set(auth(tokenBudi)).send({ consent: true, permission });
      expect(res.status).toBe(204);
    }
    expect((await request(app).put('/api/location-tracking/status').set(auth(tokenBudi)).send({ consent: true, permission: 'unknown_state' })).status).toBe(400);
  });

  it('presensi aktif memakai sesi terbaru kurang dari 16 jam, termasuk shift malam; tanggal peta tidak mengubahnya', async () => {
    await aktifkan({ mode: 'while_working' });
    const sudahPulang = await makeEmployee({ password: null });
    const terlaluLama = await makeEmployee({ password: null });
    const lupaPulang = await makeEmployee({ password: null });
    const belumMulai = await makeEmployee({ password: null });
    const sekarang = DateTime.now().setZone(TEST_TIMEZONE).startOf('day').plus({ hours: 2 });
    const jam = (h: number) => sekarang.minus({ hours: h }).toJSDate();
    const waktu = jest.spyOn(Date, 'now').mockReturnValue(sekarang.toMillis());
    try {
      await prisma.attendance.createMany({
        data: [
          { id: generateULID(), employeeId: budi.id, checkInTime: jam(8), checkInMethod: 'gps', status: 'present' },
          { id: generateULID(), employeeId: budi.id, checkInTime: jam(4), checkInMethod: 'gps', status: 'present' },
          { id: generateULID(), employeeId: sudahPulang.id, checkInTime: jam(4), checkOutTime: jam(1), checkInMethod: 'gps', status: 'present' },
          { id: generateULID(), employeeId: terlaluLama.id, checkInTime: jam(16), checkInMethod: 'gps', status: 'present' },
          { id: generateULID(), employeeId: lupaPulang.id, checkInTime: jam(4), checkInMethod: 'gps', status: 'no_checkout' },
          { id: generateULID(), employeeId: belumMulai.id, checkInTime: jam(-1), checkInMethod: 'gps', status: 'present' },
        ],
      });
      const tanggalLampau = sekarang.minus({ days: 2 }).toISODate();
      const cari = (res: request.Response, id: string) => res.body.data.find((d: { employee: { id: string } }) => d.employee.id === id);
      for (const akhir of ['', `?date=${tanggalLampau}`]) {
        const res = await request(app).get(`/api/location-tracking/latest${akhir}`).set(auth(pemilik));
        expect(res.status).toBe(200);
        expect(cari(res, budi.id).currentAttendance).toEqual({ checkIn: jam(4).toISOString() });
        for (const k of [sudahPulang, terlaluLama, lupaPulang, belumMulai]) {
          expect(cari(res, k.id).currentAttendance).toBeNull();
        }
      }
    } finally {
      waktu.mockRestore();
    }
  });
});
