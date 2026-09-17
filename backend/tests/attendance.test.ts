import request from 'supertest';
import { DateTime } from 'luxon';
import { Role } from '@prisma/client';
import {
  prisma,
  resetDatabase,
  makeEmployee,
  makeDepartment,
  makeWorkLocation,
  makeShiftRelative,
  makeOpenAttendance,
  MONAS,
  TEST_TIMEZONE,
} from './helpers/db';
import { login, auth } from './helpers/api';
import { bikinApp } from './helpers/app';

const app = bikinApp();

/** Tanggal kalender menurut zona operasional, bukan UTC. */
const hariOperasional = (d: Date) =>
  DateTime.fromJSDate(d).setZone(TEST_TIMEZONE).toISODate()!;

// Sekitar 1,1 km dari Monas — jelas di luar radius 100 meter.
const JAUH = { latitude: -6.1853924, longitude: 106.8271528 };

let karyawan: { id: string; email: string };
let token: string;
let lokasiId: string;

beforeEach(async () => {
  await resetDatabase();
  karyawan = await makeEmployee({ email: 'budi@resto.id', name: 'Budi' });
  token = await login(app, 'budi@resto.id');
  const lokasi = await makeWorkLocation({ name: 'Resto Pusat' });
  lokasiId = lokasi.id;
});


describe('POST /api/attendance/check-in — verifikasi lokasi', () => {
  it('menerima check-in GPS di dalam radius', async () => {
    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'gps', workLocationId: lokasiId, ...MONAS });

    expect(res.status).toBe(201);
    expect(res.body.workLocationId).toBe(lokasiId);
    expect(res.body.employeeId).toBe(karyawan.id);
    expect(res.body.checkOutTime).toBeNull();
  });

  it('menolak check-in di luar radius dan menyebutkan jaraknya', async () => {
    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'gps', workLocationId: lokasiId, ...JAUH });

    expect(res.status).toBe(422);
    expect(res.body.details.jarakMeter).toBeGreaterThan(100);
    expect(res.body.details.radiusMeter).toBe(100);
  });

  it('tidak menyimpan presensi apa pun saat lokasi ditolak', async () => {
    await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'gps', workLocationId: lokasiId, ...JAUH });

    expect(await prisma.attendance.count()).toBe(0);
  });

  it('menerima check-in QR memakai token lokasi', async () => {
    const lokasi = await prisma.workLocation.findUniqueOrThrow({ where: { id: lokasiId } });

    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'qr', qrToken: lokasi.qrSecret });

    expect(res.status).toBe(201);
    expect(res.body.workLocationId).toBe(lokasiId);
  });

  it('menolak token QR yang tidak dikenali', async () => {
    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'qr', qrToken: 'token-karangan' });

    expect(res.status).toBe(400);
  });

  it('tetap memeriksa koordinat pada check-in QR, karena QR bisa difoto', async () => {
    const lokasi = await prisma.workLocation.findUniqueOrThrow({ where: { id: lokasiId } });

    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'qr', qrToken: lokasi.qrSecret, ...JAUH });

    expect(res.status).toBe(422);
  });

  it('tidak pernah membocorkan token QR lewat response presensi', async () => {
    const lokasi = await prisma.workLocation.findUniqueOrThrow({ where: { id: lokasiId } });

    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'qr', qrToken: lokasi.qrSecret });

    expect(JSON.stringify(res.body)).not.toContain(lokasi.qrSecret);
  });

  it('menolak lokasi yang sudah dinonaktifkan', async () => {
    await prisma.workLocation.update({ where: { id: lokasiId }, data: { isActive: false } });

    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'gps', workLocationId: lokasiId, ...MONAS });

    expect(res.status).toBe(400);
  });

  it('menuntut workLocationId untuk metode gps', async () => {
    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'gps', ...MONAS });

    expect(res.status).toBe(400);
    expect(res.body.details.some((d: { field: string }) => d.field === 'workLocationId')).toBe(true);
  });

  it('menuntut koordinat untuk metode gps', async () => {
    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'gps', workLocationId: lokasiId });

    expect(res.status).toBe(400);
  });

  it('menolak check-in tanpa token autentikasi', async () => {
    const res = await request(app)
      .post('/api/attendance/check-in')
      .send({ method: 'gps', workLocationId: lokasiId, ...MONAS });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/attendance/check-in — aturan urutan', () => {
  const checkIn = () =>
    request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'gps', workLocationId: lokasiId, ...MONAS });

  it('menolak check-in kedua selagi yang pertama belum ditutup', async () => {
    await checkIn();
    const res = await checkIn();

    expect(res.status).toBe(409);
    expect(res.body.attendanceId).toBeDefined();
  });

  it('menandai presensi lama sebagai lupa check-out dan mengizinkan shift baru', async () => {
    const lama = await makeOpenAttendance({
      employeeId: karyawan.id,
      minutesAgo: 20 * 60, // 20 jam lalu, melewati ATTENDANCE_MAX_SHIFT_HOURS
    });

    const res = await checkIn();
    expect(res.status).toBe(201);

    const ditandai = await prisma.attendance.findUniqueOrThrow({ where: { id: lama.id } });
    expect(ditandai.status).toBe('no_checkout');
    expect(await prisma.attendance.count()).toBe(2);
  });
});

describe('Validasi otomatis terhadap jadwal shift', () => {
  it('mencatat tepat waktu kalau datang dalam toleransi', async () => {
    // Shift baru mulai 2 menit lagi.
    await makeShiftRelative(karyawan.id, 2, 8 * 60);

    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'gps', workLocationId: lokasiId, ...MONAS });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('present');
    expect(res.body.lateMinutes).toBe(0);
  });

  it('mencatat keterlambatan beserta jumlah menitnya', async () => {
    // Shift sudah mulai 90 menit lalu.
    await makeShiftRelative(karyawan.id, -90, 6 * 60);

    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'gps', workLocationId: lokasiId, ...MONAS });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('late');
    expect(res.body.lateMinutes).toBeGreaterThanOrEqual(89);
    expect(res.body.lateMinutes).toBeLessThanOrEqual(91);
  });

  it('menautkan presensi ke shift yang dijadwalkan', async () => {
    const shift = await makeShiftRelative(karyawan.id, -10, 8 * 60);

    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'gps', workLocationId: lokasiId, ...MONAS });

    expect(res.body.shiftScheduleId).toBe(shift.id);
  });

  it('tidak menautkan ke shift yang masih belasan jam lagi', async () => {
    // Shift malam yang baru mulai 14 jam lagi. Menautkannya akan membuat
    // check-out hari ini tercatat sebagai pulang cepat ratusan menit.
    await makeShiftRelative(karyawan.id, 14 * 60, 22 * 60);

    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'gps', workLocationId: lokasiId, ...MONAS });

    expect(res.status).toBe(201);
    expect(res.body.shiftScheduleId).toBeNull();
  });

  it('menautkan ke shift yang akan dimulai dalam waktu dekat', async () => {
    const shift = await makeShiftRelative(karyawan.id, 45, 8 * 60);

    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'gps', workLocationId: lokasiId, ...MONAS });

    expect(res.body.shiftScheduleId).toBe(shift.id);
  });

  it('tetap menerima presensi di luar jadwal, tanpa penilaian keterlambatan', async () => {
    const res = await request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'gps', workLocationId: lokasiId, ...MONAS });

    expect(res.status).toBe(201);
    expect(res.body.shiftScheduleId).toBeNull();
    expect(res.body.lateMinutes).toBe(0);
  });
});

describe('POST /api/attendance/check-out', () => {
  it('menolak check-out tanpa presensi terbuka', async () => {
    const res = await request(app)
      .post('/api/attendance/check-out')
      .set(auth(token))
      .send({ method: 'gps', workLocationId: lokasiId, ...MONAS });

    expect(res.status).toBe(404);
  });

  it('menghitung jam kerja setelah dikurangi istirahat', async () => {
    // Shift 8 jam dengan istirahat 1 jam, mulai 8 jam lalu.
    const shift = await makeShiftRelative(karyawan.id, -8 * 60, 0, 1);
    await makeOpenAttendance({
      employeeId: karyawan.id,
      minutesAgo: 8 * 60,
      shiftScheduleId: shift.id,
      workLocationId: lokasiId,
    });

    const res = await request(app)
      .post('/api/attendance/check-out')
      .set(auth(token))
      .send({ method: 'gps', workLocationId: lokasiId, ...MONAS });

    expect(res.status).toBe(200);
    // 480 menit dikurangi 60 menit istirahat.
    expect(res.body.workedMinutes).toBeGreaterThanOrEqual(419);
    expect(res.body.workedMinutes).toBeLessThanOrEqual(421);
    expect(res.body.checkOutTime).not.toBeNull();
  });

  it('mencatat pulang cepat', async () => {
    // Shift baru berakhir 2 jam lagi.
    const shift = await makeShiftRelative(karyawan.id, -6 * 60, 2 * 60);
    await makeOpenAttendance({
      employeeId: karyawan.id,
      minutesAgo: 6 * 60,
      shiftScheduleId: shift.id,
      workLocationId: lokasiId,
    });

    const res = await request(app)
      .post('/api/attendance/check-out')
      .set(auth(token))
      .send({ method: 'gps', workLocationId: lokasiId, ...MONAS });

    expect(res.body.earlyLeaveMinutes).toBeGreaterThanOrEqual(119);
    expect(res.body.earlyLeaveMinutes).toBeLessThanOrEqual(121);
  });

  it('mencatat lembur tapi belum menyetujuinya', async () => {
    // Shift sudah berakhir 2 jam lalu.
    const shift = await makeShiftRelative(karyawan.id, -10 * 60, -2 * 60);
    await makeOpenAttendance({
      employeeId: karyawan.id,
      minutesAgo: 10 * 60,
      shiftScheduleId: shift.id,
      workLocationId: lokasiId,
    });

    const res = await request(app)
      .post('/api/attendance/check-out')
      .set(auth(token))
      .send({ method: 'gps', workLocationId: lokasiId, ...MONAS });

    expect(res.body.overtimeHours).toBeGreaterThanOrEqual(1.9);
    expect(res.body.overtimeHours).toBeLessThanOrEqual(2.1);
    // Lembur harus diotorisasi dulu sebelum boleh masuk perhitungan gaji.
    expect(res.body.overtimeApproved).toBe(false);
  });

  it('menolak check-out dari luar radius lokasi', async () => {
    await makeOpenAttendance({
      employeeId: karyawan.id,
      minutesAgo: 60,
      workLocationId: lokasiId,
    });

    const res = await request(app)
      .post('/api/attendance/check-out')
      .set(auth(token))
      .send({ method: 'gps', workLocationId: lokasiId, ...JAUH });

    expect(res.status).toBe(422);
  });
});

describe('PATCH /api/attendance/:id/overtime', () => {
  const siapkanLembur = async () => {
    const shift = await makeShiftRelative(karyawan.id, -10 * 60, -2 * 60);
    await makeOpenAttendance({
      employeeId: karyawan.id,
      minutesAgo: 10 * 60,
      shiftScheduleId: shift.id,
      workLocationId: lokasiId,
    });
    const res = await request(app)
      .post('/api/attendance/check-out')
      .set(auth(token))
      .send({ method: 'gps', workLocationId: lokasiId, ...MONAS });
    return res.body.id as string;
  };

  it('menyetujui lembur dan mencatat siapa yang menyetujui', async () => {
    const attendanceId = await siapkanLembur();
    await makeEmployee({ email: 'hr@resto.id', role: Role.HR_ADMIN });
    const hrToken = await login(app, 'hr@resto.id');

    const res = await request(app)
      .patch(`/api/attendance/${attendanceId}/overtime`)
      .set(auth(hrToken))
      .send({ approved: true });

    expect(res.status).toBe(200);
    expect(res.body.attendance.overtimeApproved).toBe(true);
    expect(res.body.attendance.overtimeApprovedById).toBeTruthy();
  });

  it('mencegah karyawan menyetujui lemburnya sendiri', async () => {
    const attendanceId = await siapkanLembur();
    await prisma.employee.update({
      where: { id: karyawan.id },
      data: { role: Role.MANAGER },
    });
    const tokenManajer = await login(app, 'budi@resto.id');

    const res = await request(app)
      .patch(`/api/attendance/${attendanceId}/overtime`)
      .set(auth(tokenManajer))
      .send({ approved: true });

    expect(res.status).toBe(403);
  });

  it('menolak persetujuan untuk presensi tanpa jam lembur', async () => {
    const attendance = await makeOpenAttendance({
      employeeId: karyawan.id,
      minutesAgo: 60,
      workLocationId: lokasiId,
    });
    await makeEmployee({ email: 'hr@resto.id', role: Role.HR_ADMIN });
    const hrToken = await login(app, 'hr@resto.id');

    const res = await request(app)
      .patch(`/api/attendance/${attendance.id}/overtime`)
      .set(auth(hrToken))
      .send({ approved: true });

    expect(res.status).toBe(400);
  });
});

describe('Akses data presensi', () => {
  it('karyawan hanya melihat presensinya sendiri lewat /me', async () => {
    const lain = await makeEmployee({ email: 'siti@resto.id' });
    await makeOpenAttendance({ employeeId: lain.id, minutesAgo: 30 });
    await makeOpenAttendance({ employeeId: karyawan.id, minutesAgo: 30 });

    const res = await request(app).get('/api/attendance/me').set(auth(token));

    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0].employeeId).toBe(karyawan.id);
  });

  it('karyawan biasa tidak boleh melihat daftar presensi semua orang', async () => {
    const res = await request(app).get('/api/attendance').set(auth(token));
    expect(res.status).toBe(403);
  });

  it('karyawan tidak boleh membuka presensi orang lain', async () => {
    const lain = await makeEmployee({ email: 'siti@resto.id' });
    const presensi = await makeOpenAttendance({ employeeId: lain.id, minutesAgo: 30 });

    const res = await request(app).get(`/api/attendance/${presensi.id}`).set(auth(token));
    expect(res.status).toBe(403);
  });

  it('manajer hanya melihat presensi departemennya', async () => {
    const dapur = await makeDepartment('Kitchen');
    const fo = await makeDepartment('Front Office');

    const manajer = await makeEmployee({
      email: 'manajer@resto.id',
      role: Role.MANAGER,
      departmentId: dapur.id,
    });
    const koki = await makeEmployee({ email: 'koki@resto.id', departmentId: dapur.id });
    const resepsionis = await makeEmployee({ email: 'fo@resto.id', departmentId: fo.id });

    await makeOpenAttendance({ employeeId: koki.id, minutesAgo: 30 });
    await makeOpenAttendance({ employeeId: resepsionis.id, minutesAgo: 30 });
    await makeOpenAttendance({ employeeId: manajer.id, minutesAgo: 30 });

    const tokenManajer = await login(app, 'manajer@resto.id');
    const res = await request(app).get('/api/attendance').set(auth(tokenManajer));

    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(2);
  });
});

describe('GET /api/attendance/reports/summary', () => {
  it('menghitung shift terjadwal yang tidak ada presensinya sebagai absen', async () => {
    await makeEmployee({ email: 'hr@resto.id', role: Role.HR_ADMIN });
    const hrToken = await login(app, 'hr@resto.id');

    // Dua shift dijadwalkan, hanya satu yang dihadiri.
    const shiftHadir = await makeShiftRelative(karyawan.id, -8 * 60, -1 * 60);
    const shiftBolos = await makeShiftRelative(karyawan.id, 60, 8 * 60);

    await makeOpenAttendance({
      employeeId: karyawan.id,
      minutesAgo: 8 * 60,
      shiftScheduleId: shiftHadir.id,
    });

    // Rentang diambil dari tanggal shift itu sendiri, supaya test tidak
    // bergantung pada jam berapa ia kebetulan dijalankan.
    const [awal, akhir] = [
      shiftHadir.date.toISOString().slice(0, 10),
      shiftBolos.date.toISOString().slice(0, 10),
    ].sort();

    const res = await request(app)
      .get(`/api/attendance/reports/summary?startDate=${awal}&endDate=${akhir}`)
      .set(auth(hrToken));

    expect(res.status).toBe(200);
    const baris = res.body.data.find(
      (d: { employee: { id: string } }) => d.employee.id === karyawan.id
    );
    expect(baris.scheduledShifts).toBe(2);
    expect(baris.totalAttendance).toBe(1);
    // Shift kedua tidak pernah dihadiri — inilah "absen tanpa izin".
    expect(baris.absent).toBe(1);
  });

  it('tidak menghitung shift saat cuti disetujui sebagai mangkir', async () => {
    const { makeLeaveType, makeLeaveBalance } = await import('./helpers/db');
    await makeEmployee({ email: 'hr@resto.id', role: Role.HR_ADMIN });
    const hrToken = await login(app, 'hr@resto.id');

    // Satu shift dijadwalkan, karyawannya cuti pada hari itu.
    const shift = await makeShiftRelative(karyawan.id, 60, 8 * 60);
    const tipe = await makeLeaveType({ code: 'annual', name: 'Cuti Tahunan' });
    await makeLeaveBalance({
      employeeId: karyawan.id,
      leaveTypeId: tipe.id,
      year: shift.date.getUTCFullYear(),
      entitledDays: 12,
    });

    await prisma.leave.create({
      data: {
        id: (await import('../src/utils/generateULID')).generateULID(),
        employeeId: karyawan.id,
        leaveTypeId: tipe.id,
        startDate: shift.date,
        endDate: shift.date,
        totalDays: 1,
        status: 'approved',
      },
    });

    const tanggal = shift.date.toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/attendance/reports/summary?startDate=${tanggal}&endDate=${tanggal}`)
      .set(auth(hrToken));

    const baris = res.body.data.find(
      (d: { employee: { id: string } }) => d.employee.id === karyawan.id
    );

    // Tanpa ini, cuti yang sudah disetujui tetap tercatat mangkir —
    // dan itu bisa berujung potongan gaji.
    expect(baris.absent).toBe(0);
    expect(baris.onApprovedLeave).toBe(1);
  });

  it('menolak rentang tanggal terbalik', async () => {
    await makeEmployee({ email: 'hr@resto.id', role: Role.HR_ADMIN });
    const hrToken = await login(app, 'hr@resto.id');

    const res = await request(app)
      .get('/api/attendance/reports/summary?startDate=2026-03-10&endDate=2026-03-01')
      .set(auth(hrToken));

    expect(res.status).toBe(400);
  });

  it('memisahkan lembur yang sudah disetujui dari yang belum', async () => {
    await makeEmployee({ email: 'hr@resto.id', role: Role.HR_ADMIN });
    const hrToken = await login(app, 'hr@resto.id');

    const shift = await makeShiftRelative(karyawan.id, -10 * 60, -2 * 60);
    await makeOpenAttendance({
      employeeId: karyawan.id,
      minutesAgo: 10 * 60,
      shiftScheduleId: shift.id,
      workLocationId: lokasiId,
    });
    await request(app)
      .post('/api/attendance/check-out')
      .set(auth(token))
      .send({ method: 'gps', workLocationId: lokasiId, ...MONAS });

    const [awal, akhir] = [
      hariOperasional(new Date(Date.now() - 10 * 60 * 60 * 1000)),
      hariOperasional(new Date()),
    ].sort();

    const res = await request(app)
      .get(`/api/attendance/reports/summary?startDate=${awal}&endDate=${akhir}`)
      .set(auth(hrToken));

    const baris = res.body.data.find(
      (d: { employee: { id: string } }) => d.employee.id === karyawan.id
    );
    expect(baris.pendingOvertimeHours).toBeGreaterThan(0);
    expect(baris.approvedOvertimeHours).toBe(0);
  });
});
