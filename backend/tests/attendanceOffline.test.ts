import request from 'supertest';
import { Role } from '@prisma/client';
import { generateULID } from '../src/utils/generateULID';
import { evaluateOfflineTime } from '../src/utils/offlineAttendance';
import { tungguStempelSelesai, barisStempel, teksKeterangan } from '../src/services/whatsapp/attendanceStamp';
import { prisma, resetDatabase, makeEmployee, makeWorkLocation, makeShiftRelative, MONAS } from './helpers/db';
import { login, auth } from './helpers/api';
import { bikinApp } from './helpers/app';

const app = bikinApp();

// Stempel WhatsApp berjalan di latar; tunggu sebelum database dikosongkan
// tes berikutnya, supaya ia tidak memperbarui presensi yang sudah terhapus.
afterEach(() => tungguStempelSelesai());

const menitLalu = (m: number) => new Date(Date.now() - m * 60_000);
const JUJUR = { mockLocation: false, mockApps: [], rooted: false, emulator: false, developerOptions: false, positionAgeSeconds: 3, platform: 'android' };

describe('evaluateOfflineTime — aturan waktu presensi offline', () => {
  const now = new Date('2026-09-24T10:00:00Z');
  const jam = (hhmm: string) => new Date(`2026-09-24T${hhmm}:00Z`);
  const maxHours = 72;

  it('jam ponsel, perkiraan jam server, dan GPS sepakat: waktu diterima tanpa penanda', () => {
    const hasil = evaluateOfflineTime({ capturedAt: jam('07:55'), serverTimeEstimate: jam('07:56'), gpsTime: jam('07:55') }, { now, maxHours });
    expect(hasil).toEqual({ ok: true, waktu: jam('07:56'), flags: [] });
  });

  it('jam ponsel dimundurkan: yang dipakai perkiraan jam server, dan ditandai', () => {
    const hasil = evaluateOfflineTime({ capturedAt: jam('06:30'), serverTimeEstimate: jam('08:10') }, { now, maxHours });
    expect(hasil).toEqual({ ok: true, waktu: jam('08:10'), flags: ['clock_mismatch'] });
  });

  it('hanya waktu GPS sebagai pembanding: jam ponsel dipakai bila sesuai, ditandai bila tidak', () => {
    expect(evaluateOfflineTime({ capturedAt: jam('07:55'), gpsTime: jam('07:57') }, { now, maxHours })).toEqual({ ok: true, waktu: jam('07:55'), flags: [] });
    expect(evaluateOfflineTime({ capturedAt: jam('07:00'), gpsTime: jam('07:57') }, { now, maxHours })).toMatchObject({ ok: true, flags: ['clock_mismatch'] });
  });

  it('tanpa pembanding sama sekali (ponsel dinyalakan ulang): diterima, ditandai belum terverifikasi', () => {
    expect(evaluateOfflineTime({ capturedAt: jam('07:55') }, { now, maxHours })).toEqual({ ok: true, waktu: jam('07:55'), flags: ['clock_unverified'] });
  });

  it('menolak waktu di masa depan dan kiriman yang melewati batas jam', () => {
    expect(evaluateOfflineTime({ capturedAt: jam('10:30'), serverTimeEstimate: jam('10:30') }, { now, maxHours })).toMatchObject({ ok: false });
    // Selisih kecil ke depan masih wajar (jam tak pernah persis sama).
    expect(evaluateOfflineTime({ capturedAt: jam('10:03'), serverTimeEstimate: jam('10:03') }, { now, maxHours })).toMatchObject({ ok: true });
    const lama = new Date(now.getTime() - 73 * 3_600_000);
    expect(evaluateOfflineTime({ capturedAt: lama, serverTimeEstimate: lama }, { now, maxHours })).toMatchObject({ ok: false, alasan: expect.stringContaining('72 jam') });
  });
});

describe('Stempel WhatsApp presensi offline', () => {
  const data = {
    jenis: 'masuk' as const,
    nama: 'Budi',
    nik: 'K-1',
    waktu: new Date('2026-09-24T00:55:00Z'),
    lokasi: 'Outlet Kemang',
    metode: 'gps',
    wajahTerverifikasi: false,
    status: 'present',
  };

  it('menampilkan waktu diambil, ditandai offline, beserta kapan terkirim', () => {
    expect(barisStempel({ ...data, diterimaServer: new Date('2026-09-24T03:10:00Z') })[1]).toBe('Kam, 24 Sep 2026 07:55 WIB · offline');
    expect(teksKeterangan({ ...data, diterimaServer: new Date('2026-09-24T03:10:00Z') })).toContain('📶 Diambil offline, terkirim Kam, 24 Sep 2026 10:10 WIB');
  });

  it('presensi online tidak berubah', () => {
    expect(barisStempel(data)[1]).toBe('Kam, 24 Sep 2026 07:55 WIB');
    expect(teksKeterangan(data)).not.toContain('offline');
  });
});

describe('Presensi offline dari antrean mobile', () => {
  let karyawan: { id: string };
  let token: string;
  let lokasiId: string;

  const kirim = (jalur: 'check-in' | 'check-out', offline: Record<string, unknown> | undefined, kunci?: string) => {
    const req = request(app).post(`/api/attendance/${jalur}`).set(auth(token));
    if (kunci) req.set('Idempotency-Key', kunci);
    return req.send({ method: 'gps', workLocationId: lokasiId, ...MONAS, integrity: JUJUR, ...(offline ? { offline } : {}) });
  };
  const diambil = (m: number) => ({ capturedAt: menitLalu(m).toISOString(), serverTimeEstimate: menitLalu(m).toISOString() });

  beforeEach(async () => {
    await resetDatabase();
    karyawan = await makeEmployee({ email: 'budi@resto.id' });
    token = await login(app, 'budi@resto.id');
    lokasiId = (await makeWorkLocation()).id;
  });

  it('tercatat pada waktu diambil, bukan saat tiba: datang tepat waktu tidak jadi terlambat', async () => {
    // Shift mulai dua jam lalu; karyawan absen dua menit sebelumnya tanpa sinyal.
    await makeShiftRelative(karyawan.id, -120, 360);
    const res = await kirim('check-in', diambil(122));

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('present');
    expect(res.body.lateMinutes).toBe(0);
    expect(Math.abs(new Date(res.body.checkInTime).getTime() - menitLalu(122).getTime())).toBeLessThan(5_000);
    expect(res.body.checkInSyncedAt).not.toBeNull();
    expect(res.body.integrityFlags).toEqual([]);
  });

  it('presensi online tetap seperti dulu: tanpa waktu sinkron', async () => {
    const res = await kirim('check-in', undefined);
    expect(res.status).toBe(201);
    expect(res.body.checkInSyncedAt).toBeNull();
  });

  it('jam ponsel dimundurkan: tercatat perkiraan jam server dan ditandai untuk HR', async () => {
    const bukti = { capturedAt: menitLalu(180).toISOString(), serverTimeEstimate: menitLalu(30).toISOString() };
    const res = await kirim('check-in', bukti);

    expect(res.status).toBe(201);
    expect(Math.abs(new Date(res.body.checkInTime).getTime() - menitLalu(30).getTime())).toBeLessThan(5_000);
    expect(res.body.integrityFlags).toContain('clock_mismatch');
    // Jam yang ditunjukkan ponsel disimpan untuk HR, di samping laporan integritasnya.
    expect(res.body.integrityReport).toEqual({ ...JUJUR, offline: bukti });
  });

  it('terlambat lebih dari batas atau bertanggal masa depan: ditolak tanpa menyimpan apa pun', async () => {
    expect((await kirim('check-in', diambil(73 * 60))).status).toBe(422);
    expect((await kirim('check-in', diambil(-30))).status).toBe(422);
    expect(await prisma.attendance.count()).toBe(0);
  });

  it('bertabrakan dengan presensi yang sudah tercatat sesudahnya: 409', async () => {
    await prisma.attendance.create({
      data: { id: generateULID(), employeeId: karyawan.id, checkInTime: menitLalu(60), checkOutTime: menitLalu(30), checkInMethod: 'gps', status: 'present' },
    });
    const res = await kirim('check-in', diambil(90));
    expect(res.status).toBe(409);
    expect(await prisma.attendance.count()).toBe(1);
  });

  it('HR bisa menyaring presensi yang diambil offline', async () => {
    const offline = await kirim('check-in', diambil(9 * 60));
    await kirim('check-out', diambil(8 * 60));
    // Presensi online karyawan lain pada hari yang sama tidak ikut.
    await makeEmployee({ email: 'siti@resto.id' });
    const tokenSiti = await login(app, 'siti@resto.id');
    await request(app).post('/api/attendance/check-in').set(auth(tokenSiti)).send({ method: 'gps', workLocationId: lokasiId, ...MONAS, integrity: JUJUR });

    await makeEmployee({ email: 'hr@resto.id', role: Role.HR_ADMIN });
    const tokenHr = await login(app, 'hr@resto.id');
    const semua = await request(app).get('/api/attendance').set(auth(tokenHr));
    const saring = await request(app).get('/api/attendance?offlineOnly=true').set(auth(tokenHr));
    expect(semua.body.data).toHaveLength(2);
    expect(saring.body.data.map((a: { id: string }) => a.id)).toEqual([offline.body.id]);
  });

  it('check-out offline: jam kerja dihitung dari waktu diambil; lebih awal dari check-in ditolak', async () => {
    expect((await kirim('check-in', diambil(9 * 60))).status).toBe(201);

    const terbalik = await kirim('check-out', diambil(10 * 60));
    expect(terbalik.status).toBe(422);

    const res = await kirim('check-out', diambil(30));
    expect(res.status).toBe(200);
    expect(res.body.workedMinutes).toBeGreaterThanOrEqual(509);
    expect(res.body.workedMinutes).toBeLessThanOrEqual(511);
    expect(res.body.checkOutSyncedAt).not.toBeNull();
  });
});

describe('Idempotency-Key: kiriman ulang tidak membuat data kedua', () => {
  let token: string;
  let lokasiId: string;

  beforeEach(async () => {
    await resetDatabase();
    await makeEmployee({ email: 'budi@resto.id' });
    token = await login(app, 'budi@resto.id');
    lokasiId = (await makeWorkLocation()).id;
  });

  const checkIn = (kunci: string) =>
    request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .set('Idempotency-Key', kunci)
      .send({ method: 'gps', workLocationId: lokasiId, ...MONAS, integrity: JUJUR });

  it('kiriman ulang menerima jawaban yang sama, bukan 409 "sudah check-in"', async () => {
    const pertama = await checkIn('antrean-01HX-presensi-1');
    const ulang = await checkIn('antrean-01HX-presensi-1');

    expect(pertama.status).toBe(201);
    expect(ulang.status).toBe(201);
    expect(ulang.body.id).toBe(pertama.body.id);
    expect(ulang.headers['idempotent-replayed']).toBe('true');
    expect(await prisma.attendance.count()).toBe(1);

    // Kunci berbeda = kiriman berbeda: aturan lama berlaku.
    expect((await checkIn('antrean-01HX-presensi-2')).status).toBe(409);
  });

  it('jawaban galat validasi juga diulang apa adanya', async () => {
    const kirim = () =>
      request(app).post('/api/attendance/check-in').set(auth(token)).set('Idempotency-Key', 'antrean-rusak-1').send({ method: 'gps' });
    const pertama = await kirim();
    const ulang = await kirim();
    expect(pertama.status).toBe(400);
    expect(ulang.status).toBe(400);
    expect(ulang.body).toEqual(pertama.body);
  });

  it('kunci yang sama untuk permintaan lain ditolak; kunci tak sah ditolak', async () => {
    await checkIn('antrean-01HX-presensi-1');
    const lain = await request(app)
      .post('/api/attendance/check-out')
      .set(auth(token))
      .set('Idempotency-Key', 'antrean-01HX-presensi-1')
      .send({ method: 'gps', ...MONAS, integrity: JUJUR });
    expect(lain.status).toBe(422);

    expect((await checkIn('pendek')).status).toBe(400);
  });

  it('kunci berlaku per karyawan: kunci yang sama milik orang lain tidak saling menjawab', async () => {
    await makeEmployee({ email: 'siti@resto.id' });
    const tokenSiti = await login(app, 'siti@resto.id');
    const budi = await checkIn('antrean-sama-persis');
    const siti = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(tokenSiti))
      .set('Idempotency-Key', 'antrean-sama-persis')
      .send({ method: 'gps', workLocationId: lokasiId, ...MONAS, integrity: JUJUR });
    expect(siti.status).toBe(201);
    expect(siti.body.id).not.toBe(budi.body.id);
    expect(siti.headers['idempotent-replayed']).toBeUndefined();
  });
});
