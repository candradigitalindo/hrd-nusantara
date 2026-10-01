import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { DateTime } from 'luxon';
import { Prisma, Role } from '@prisma/client';
import {
  prisma,
  resetDatabase,
  makeEmployee,
  makeDepartment,
  makeWorkLocation,
  makeShiftRelative,
  makeHoliday,
  tungguJejakAudit,
  MONAS,
  TEST_TIMEZONE,
} from './helpers/db';
import { login, auth, expectStatus } from './helpers/api';
import { bikinApp } from './helpers/app';
import { generateULID } from '../src/utils/generateULID';
import { gatherPeriodFacts } from '../src/services/payroll';
import { HORIZON_HARI } from '../src/services/shiftAssignment';

const app = bikinApp();

const hari = (geser = 0) => DateTime.now().setZone(TEST_TIMEZONE).plus({ days: geser }).toISODate()!;
const tgl = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
/** Waktu dinding WIB sebagai titik waktu absolut. */
const wib = (isoLokal: string) => DateTime.fromISO(isoLokal, { zone: TEST_TIMEZONE }).toJSDate();

// Sekitar 1,1 km dari Monas — jelas di luar radius 100 meter.
const JAUH = { latitude: -6.1853924, longitude: 106.8271528 };

let hrToken: string;
let dapurId: string;
let budi: { id: string };
let sari: { id: string };

beforeEach(async () => {
  await resetDatabase();
  dapurId = (await makeDepartment('Dapur')).id;
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  budi = await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1', name: 'Budi', departmentId: dapurId });
  sari = await makeEmployee({ email: 'sari@resto.id', nik: 'EMP-2', name: 'Sari', departmentId: dapurId });
  await prisma.employee.update({ where: { id: sari.id }, data: { flexibleHours: true } });
});

const presensi = (data: Partial<Prisma.AttendanceUncheckedCreateInput> & { employeeId: string; checkInTime: Date }) =>
  prisma.attendance.create({
    data: { id: generateULID(), checkInMethod: 'gps', status: 'present', ...data },
  });

const jadwal = (employeeId: string, iso: string, extra: Partial<Prisma.ShiftScheduleUncheckedCreateInput> = {}) =>
  prisma.shiftSchedule.create({
    data: { id: generateULID(), employeeId, date: tgl(iso), startTime: '08:00', endTime: '16:00', status: 'confirmed', ...extra },
  });

describe('Bawaan jam fleksibel mengikuti peran Manajer', () => {
  it('migrasi menyalakan jam fleksibel untuk manajer yang sudah ada saja', async () => {
    const manajer = await makeEmployee({ email: 'mgr@resto.id', nik: 'MGR-1', role: Role.MANAGER });
    const sql = fs.readFileSync(
      path.resolve(__dirname, '../prisma/migrations/20261001120000_shift_dinamis/migration.sql'),
      'utf8'
    );
    const update = sql.split('\n').find((baris) => baris.startsWith('UPDATE "Employee"'));
    expect(update).toBeDefined();

    await prisma.$executeRawUnsafe(update!);

    expect((await prisma.employee.findUniqueOrThrow({ where: { id: manajer.id } })).flexibleHours).toBe(true);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: budi.id } })).flexibleHours).toBe(false);
  });

  it.each([
    ['MANAGER', undefined, true],
    ['EMPLOYEE', undefined, false],
    ['MANAGER', false, false],
    ['EMPLOYEE', true, true],
  ])('karyawan baru %s dengan flexibleHours=%s menjadi %s', async (role, flexibleHours, harapan) => {
    const res = await request(app)
      .post('/api/employees')
      .set(auth(hrToken))
      .send({ nik: 'BARU-1', name: 'Baru', email: 'baru@resto.id', role, ...(flexibleHours === undefined ? {} : { flexibleHours }) });

    expectStatus(res, 201);
    expect(res.body.flexibleHours).toBe(harapan);
  });

  it('naik menjadi Manajer menyalakannya dan mengakhiri penugasan; turun mematikannya', async () => {
    const pagi = await request(app)
      .post('/api/shifts/templates')
      .set(auth(hrToken))
      .send({ name: 'Pagi', startTime: '07:00', endTime: '15:00' });
    const tetapkan = await request(app)
      .post('/api/shifts/assignments')
      .set(auth(hrToken))
      .send({ employeeIds: [budi.id], templateId: pagi.body.id, startDate: hari(0), durasi: 'seterusnya', weekdays: [1, 2, 3, 4, 5] });
    const assignmentId = tetapkan.body.results[0].assignmentId as string;

    const naik = await request(app).put(`/api/employees/${budi.id}`).set(auth(hrToken)).send({ role: 'MANAGER' });
    expectStatus(naik, 200);
    expect(naik.body.flexibleHours).toBe(true);
    const penugasan = await prisma.shiftAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(penugasan.endDate?.toISOString().slice(0, 10)).toBe(hari(0));
    expect(await prisma.shiftSchedule.count({ where: { employeeId: budi.id, date: { gt: tgl(hari(0)) } } })).toBe(0);

    const turun = await request(app).put(`/api/employees/${budi.id}`).set(auth(hrToken)).send({ role: 'EMPLOYEE' });
    expect(turun.body.flexibleHours).toBe(false);
  });

  it('nilai eksplisit mengalahkan peran', async () => {
    const res = await request(app)
      .put(`/api/employees/${budi.id}`)
      .set(auth(hrToken))
      .send({ role: 'MANAGER', flexibleHours: false });

    expectStatus(res, 200);
    expect(res.body.flexibleHours).toBe(false);
  });
});

describe('PATCH /api/employees/:id/flexible-hours', () => {
  const sakelar = (id: string, body: Record<string, unknown>, token = hrToken) =>
    request(app).patch(`/api/employees/${id}/flexible-hours`).set(auth(token)).send(body);

  /** Budi: penugasan seterusnya sejak dua hari lalu, plus jadwal manual, koreksi, dan yang berpresensi. */
  const siapkanRoster = async () => {
    const pagi = await request(app)
      .post('/api/shifts/templates')
      .set(auth(hrToken))
      .send({ name: 'Pagi', startTime: '07:00', endTime: '15:00' });
    const res = await request(app)
      .post('/api/shifts/assignments')
      .set(auth(hrToken))
      .send({
        employeeIds: [budi.id],
        templateId: pagi.body.id,
        startDate: hari(-2),
        durasi: 'seterusnya',
        weekdays: [0, 1, 2, 3, 4, 5, 6],
      });
    expectStatus(res, 201);

    await jadwal(budi.id, hari(5), { startTime: '17:00', endTime: '21:00' });
    const koreksi = await prisma.shiftSchedule.findFirstOrThrow({ where: { employeeId: budi.id, date: tgl(hari(6)) } });
    await prisma.shiftSchedule.update({ where: { id: koreksi.id }, data: { isOverride: true } });
    const dipakai = await prisma.shiftSchedule.findFirstOrThrow({ where: { employeeId: budi.id, date: tgl(hari(3)) } });
    await presensi({ employeeId: budi.id, checkInTime: new Date(), shiftScheduleId: dipakai.id });

    return res.body.results[0].assignmentId as string;
  };

  it('pratinjau menghitung dampak tanpa mengubah apa pun', async () => {
    const assignmentId = await siapkanRoster();
    const sebelum = await prisma.shiftSchedule.count();

    const res = await sakelar(budi.id, { flexibleHours: true, preview: true });

    expectStatus(res, 200);
    // Hari 1–62 dari penugasan (minus satu yang berpresensi) + satu jadwal manual.
    expect(res.body).toMatchObject({
      employee: { id: budi.id, flexibleHours: false },
      assignmentsEnded: 1,
      rowsDeleted: HORIZON_HARI - 1 + 1,
    });
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: budi.id } })).flexibleHours).toBe(false);
    expect((await prisma.shiftAssignment.findUniqueOrThrow({ where: { id: assignmentId } })).endDate).toBeNull();
    expect(await prisma.shiftSchedule.count()).toBe(sebelum);
  });

  it('menyalakan: penugasan diakhiri hari ini dan jadwal ke depan dihapus, termasuk koreksi dan manual', async () => {
    const assignmentId = await siapkanRoster();

    const res = await sakelar(budi.id, { flexibleHours: true });

    expectStatus(res, 200);
    expect(res.body).toEqual({ employee: { id: budi.id, flexibleHours: true }, assignmentsEnded: 1, rowsDeleted: HORIZON_HARI });
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: budi.id } })).flexibleHours).toBe(true);
    const penugasan = await prisma.shiftAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(penugasan.endDate?.toISOString().slice(0, 10)).toBe(hari(0));

    const sisa = await prisma.shiftSchedule.findMany({ where: { employeeId: budi.id }, orderBy: { date: 'asc' } });
    expect(sisa.map((r) => r.date.toISOString().slice(0, 10))).toEqual([hari(-2), hari(-1), hari(0), hari(3)]);

    expect(await tungguJejakAudit({ action: 'employee.flexible_hours', entityId: budi.id })).not.toBeNull();
  });

  it('mematikan tidak menyentuh jadwal', async () => {
    const res = await sakelar(sari.id, { flexibleHours: false });

    expectStatus(res, 200);
    expect(res.body).toEqual({ employee: { id: sari.id, flexibleHours: false }, assignmentsEnded: 0, rowsDeleted: 0 });
  });

  it('menolak tanpa izin, untuk diri sendiri, dan untuk akun berlingkup lebih tinggi', async () => {
    const tokenBudi = await login(app, 'budi@resto.id');
    expect((await sakelar(sari.id, { flexibleHours: false }, tokenBudi)).status).toBe(403);

    const hr = await prisma.employee.findUniqueOrThrow({ where: { email: 'hr@resto.id' } });
    expect((await sakelar(hr.id, { flexibleHours: true })).status).toBe(403);

    const pemilik = await makeEmployee({ email: 'owner@resto.id', nik: 'SA-1', role: Role.SUPER_ADMIN });
    expect((await sakelar(pemilik.id, { flexibleHours: true })).status).toBe(403);

    expect((await sakelar(generateULID(), { flexibleHours: true })).status).toBe(404);
    expect((await sakelar(budi.id, { flexibleHours: true, alasan: 'x' })).status).toBe(400);
  });
});

describe('Presensi berjam fleksibel', () => {
  let tokenSari: string;
  let lokasiId: string;

  beforeEach(async () => {
    tokenSari = await login(app, 'sari@resto.id');
    lokasiId = (await makeWorkLocation({ name: 'Resto Pusat' })).id;
  });

  const checkIn = (body: Record<string, unknown> = {}, token = tokenSari) =>
    request(app)
      .post('/api/attendance/check-in')
      .set(auth(token))
      .send({ method: 'gps', workLocationId: lokasiId, ...MONAS, ...body });

  const checkOut = (token = tokenSari) =>
    request(app)
      .post('/api/attendance/check-out')
      .set(auth(token))
      .send({ method: 'gps', workLocationId: lokasiId, ...MONAS });

  it('check-in tidak mencari shift: hadir, tidak terlambat, walau ada sisa jadwal', async () => {
    // Shift yang sudah mulai sejam lalu — karyawan biasa akan tercatat terlambat.
    await makeShiftRelative(sari.id, -60, 420);

    const res = await checkIn();

    expectStatus(res, 201);
    expect(res.body).toMatchObject({ status: 'present', lateMinutes: 0, shiftScheduleId: null, isFlexible: true });
  });

  it('tetap wajib berada di lokasi kerja', async () => {
    const res = await checkIn(JAUH);
    expect(res.status).toBe(422);
    expect(await prisma.attendance.count()).toBe(0);
  });

  it('check-out tanpa lembur dan tanpa pulang cepat; jam kerja dihitung kotor', async () => {
    const shift = await makeShiftRelative(sari.id, -600, -300, 1);
    await presensi({
      employeeId: sari.id,
      checkInTime: DateTime.now().minus({ minutes: 600 }).toJSDate(),
      workLocationId: lokasiId,
      shiftScheduleId: shift.id,
      isFlexible: true,
    });

    const res = await checkOut();

    expectStatus(res, 200);
    expect(res.body.overtimeHours).toBe(0);
    expect(res.body.earlyLeaveMinutes).toBe(0);
    // Tanpa potongan istirahat satu jam dari jadwal.
    expect(res.body.workedMinutes).toBeGreaterThanOrEqual(599);
  });

  it('pulang lebih awal dari jadwal tidak dihitung pulang cepat', async () => {
    // Presensi fleksibel yang (karena data lama) masih menautkan shift yang
    // baru berakhir lima jam lagi.
    const shift = await makeShiftRelative(sari.id, -30, 300);
    await presensi({
      employeeId: sari.id,
      checkInTime: DateTime.now().minus({ minutes: 30 }).toJSDate(),
      workLocationId: lokasiId,
      shiftScheduleId: shift.id,
      isFlexible: true,
    });

    const res = await checkOut();
    expect(res.body.earlyLeaveMinutes).toBe(0);
  });

  it('presensi yang diambil sebelum jam fleksibel dinyalakan tetap dinilai sebagai presensi biasa', async () => {
    const tokenBudi = await login(app, 'budi@resto.id');
    const shift = await makeShiftRelative(budi.id, -600, -120);
    await presensi({
      employeeId: budi.id,
      checkInTime: DateTime.now().minus({ minutes: 600 }).toJSDate(),
      workLocationId: lokasiId,
      shiftScheduleId: shift.id,
    });
    await prisma.employee.update({ where: { id: budi.id }, data: { flexibleHours: true } });

    const res = await checkOut(tokenBudi);

    expectStatus(res, 200);
    expect(res.body.isFlexible).toBe(false);
    expect(res.body.overtimeHours).toBeGreaterThan(0);
  });

  it('boleh check-in lagi sesudah check-out (sesi ganda)', async () => {
    expectStatus(await checkIn(), 201);
    expectStatus(await checkOut(), 200);

    const kedua = await checkIn();

    expectStatus(kedua, 201);
    expect(kedua.body.isFlexible).toBe(true);
    expect(await prisma.attendance.count({ where: { employeeId: sari.id } })).toBe(2);
  });

  it('/auth/me dan respons login menyertakan flexibleHours', async () => {
    const me = await request(app).get('/api/auth/me').set(auth(tokenSari));
    expectStatus(me, 200);
    expect(me.body.flexibleHours).toBe(true);

    const masuk = await request(app).post('/api/auth/login').send({ email: 'budi@resto.id', password: 'RahasiaUji123' });
    expect(masuk.body.user.flexibleHours).toBe(false);
  });

  it('/shifts/me memberi tahu bahwa pemakainya berjam fleksibel', async () => {
    const res = await request(app).get('/api/shifts/me').set(auth(tokenSari));
    expectStatus(res, 200);
    expect(res.body.flexibleHours).toBe(true);
  });
});

describe('Payroll: hari kerja dan hari terjadwal', () => {
  const AWAL = tgl('2026-09-01');
  const AKHIR = tgl('2026-09-30');

  it('hari kerja dihitung per tanggal bisnis, bukan per sesi presensi', async () => {
    // Dua sesi di 1 Sep (pagi dan sore) + check-in 01:00 WIB yang di UTC masih 31 Agustus.
    await presensi({ employeeId: budi.id, checkInTime: wib('2026-09-01T01:00') });
    await presensi({ employeeId: budi.id, checkInTime: wib('2026-09-01T08:00') });
    await presensi({ employeeId: budi.id, checkInTime: wib('2026-09-01T17:00') });
    // 23:30 WIB 2 Sep tetap 2 Sep.
    await presensi({ employeeId: budi.id, checkInTime: wib('2026-09-02T23:30') });
    // 01:00 WIB 1 Okt sudah di luar periode.
    await presensi({ employeeId: budi.id, checkInTime: wib('2026-10-01T01:00') });

    // Split shift 1 Sep = satu hari terjadwal; yang dibatalkan tidak dihitung.
    await jadwal(budi.id, '2026-09-01', { startTime: '08:00', endTime: '12:00' });
    await jadwal(budi.id, '2026-09-01', { startTime: '17:00', endTime: '21:00' });
    await jadwal(budi.id, '2026-09-02');
    await jadwal(budi.id, '2026-09-03', { status: 'cancelled' });

    const fakta = await gatherPeriodFacts(budi.id, AWAL, AKHIR);

    expect(fakta.workedDays).toBe(2);
    expect(fakta.scheduledDays).toBe(2);
  });

  it('karyawan fleksibel: hari terjadwal menurut pola kerjanya, bukan roster', async () => {
    const pola = await request(app)
      .post('/api/work-patterns')
      .set(auth(hrToken))
      .send({ code: 'kantor_5hari', name: 'Kantor Senin-Jumat', type: 'fixed', workingWeekdays: [1, 2, 3, 4, 5], observesPublicHolidays: true });
    expectStatus(pola, 201);
    expectStatus(
      await request(app).patch(`/api/employees/${sari.id}/work-pattern`).set(auth(hrToken)).send({ workPatternId: pola.body.id }),
      200
    );
    await makeHoliday('2026-09-16', 'Libur Uji');
    // Sisa jadwal lama diabaikan.
    await jadwal(sari.id, '2026-09-05');

    const fakta = await gatherPeriodFacts(sari.id, AWAL, AKHIR);

    // September 2026: 22 hari Senin–Jumat, dikurangi libur Rabu 16 Sep.
    expect(fakta.scheduledDays).toBe(21);
  });
});

describe('Laporan dan presensi fleksibel', () => {
  it('produktivitas tidak menghitung presensi fleksibel terhadap shift terjadwal', async () => {
    await jadwal(budi.id, '2026-09-01');
    await jadwal(budi.id, '2026-09-02');
    await presensi({ employeeId: budi.id, checkInTime: wib('2026-09-01T08:00'), workedMinutes: 480 });
    for (const d of ['2026-09-01', '2026-09-02', '2026-09-03']) {
      await presensi({ employeeId: sari.id, checkInTime: wib(`${d}T09:00`), isFlexible: true, workedMinutes: 600 });
    }

    const res = await request(app)
      .get('/api/reports/productivity?startDate=2026-09-01&endDate=2026-09-30')
      .set(auth(hrToken));

    expectStatus(res, 200);
    expect(res.body.scheduledShifts).toBe(2);
    expect(res.body.attendanceCount).toBe(1);
    expect(res.body.flexibleAttendanceCount).toBe(3);
    expect(res.body.absencePercentage).toBe(50);
  });

  it('laporan presensi: sisa jadwal pada hari hadir fleksibel bukan mangkir', async () => {
    await jadwal(sari.id, '2026-09-01');
    await jadwal(sari.id, '2026-09-02');
    await presensi({ employeeId: sari.id, checkInTime: wib('2026-09-01T10:00'), isFlexible: true });

    const res = await request(app)
      .get('/api/attendance/reports/summary?startDate=2026-09-01&endDate=2026-09-30')
      .set(auth(hrToken));

    expectStatus(res, 200);
    const baris = res.body.data.find((d: { employee: { id: string } }) => d.employee.id === sari.id);
    expect(baris.employee.flexibleHours).toBe(true);
    expect(baris.flexibleAttendance).toBe(1);
    expect(baris.absent).toBe(1);
  });
});
