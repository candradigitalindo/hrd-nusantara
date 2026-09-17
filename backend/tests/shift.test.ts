import request from 'supertest';
import { Role } from '@prisma/client';
import {
  prisma,
  resetDatabase,
  makeEmployee,
  makeDepartment,
  makeOpenAttendance,
} from './helpers/db';
import { login, auth } from './helpers/api';
import { bikinApp } from './helpers/app';

const app = bikinApp();

let hrToken: string;
let karyawan: { id: string };

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  karyawan = await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1' });
});


const buatShift = (body: Record<string, unknown>, token = hrToken) =>
  request(app).post('/api/shifts').set(auth(token)).send(body);

describe('POST /api/shifts', () => {
  it('membuat jadwal shift', async () => {
    const res = await buatShift({
      employeeId: karyawan.id,
      date: '2026-04-01',
      startTime: '08:00',
      endTime: '17:00',
      breakDuration: 1,
    });

    expect(res.status).toBe(201);
    expect(res.body.id).toHaveLength(26);
    expect(res.body.breakDuration).toBe(1);
  });

  it('ikut mengirim waktu absolut supaya klien tidak menebak sendiri', async () => {
    const res = await buatShift({
      employeeId: karyawan.id,
      date: '2026-04-01',
      startTime: '08:00',
      endTime: '17:00',
    });

    // 08:00 WIB = 01:00 UTC.
    expect(res.body.startsAt).toBe('2026-04-01T01:00:00.000Z');
    expect(res.body.endsAt).toBe('2026-04-01T10:00:00.000Z');
  });

  it('menandai shift malam berakhir keesokan harinya', async () => {
    const res = await buatShift({
      employeeId: karyawan.id,
      date: '2026-04-01',
      startTime: '22:00',
      endTime: '06:00',
    });

    expect(res.status).toBe(201);
    expect(res.body.startsAt).toBe('2026-04-01T15:00:00.000Z');
    expect(res.body.endsAt).toBe('2026-04-01T23:00:00.000Z');
  });

  it('menolak istirahat yang menghabiskan seluruh shift', async () => {
    const res = await buatShift({
      employeeId: karyawan.id,
      date: '2026-04-01',
      startTime: '08:00',
      endTime: '12:00',
      breakDuration: 4,
    });

    expect(res.status).toBe(400);
  });

  it('menolak format jam yang tidak valid', async () => {
    const res = await buatShift({
      employeeId: karyawan.id,
      date: '2026-04-01',
      startTime: '8:00',
      endTime: '17:00',
    });

    expect(res.status).toBe(400);
  });

  it('menolak karyawan yang tidak ada', async () => {
    const res = await buatShift({
      employeeId: '01ZZZZZZZZZZZZZZZZZZZZZZZZ',
      date: '2026-04-01',
      startTime: '08:00',
      endTime: '17:00',
    });

    expect(res.status).toBe(404);
  });
});

describe('Deteksi tabrakan jadwal', () => {
  const dasar = { date: '2026-04-01', startTime: '08:00', endTime: '17:00' };

  it('menolak shift yang tumpang tindih', async () => {
    await buatShift({ employeeId: karyawan.id, ...dasar });

    const res = await buatShift({
      employeeId: karyawan.id,
      date: '2026-04-01',
      startTime: '16:00',
      endTime: '20:00',
    });

    expect(res.status).toBe(409);
    expect(res.body.conflictingShiftId).toBeDefined();
  });

  it('mengizinkan split shift yang tidak bertabrakan di hari yang sama', async () => {
    await buatShift({
      employeeId: karyawan.id,
      date: '2026-04-01',
      startTime: '07:00',
      endTime: '11:00',
    });

    const res = await buatShift({
      employeeId: karyawan.id,
      date: '2026-04-01',
      startTime: '17:00',
      endTime: '22:00',
    });

    expect(res.status).toBe(201);
  });

  it('mendeteksi tabrakan shift malam dengan shift pagi keesokan harinya', async () => {
    // 1 April 22:00 sampai 2 April 06:00.
    await buatShift({
      employeeId: karyawan.id,
      date: '2026-04-01',
      startTime: '22:00',
      endTime: '06:00',
    });

    const res = await buatShift({
      employeeId: karyawan.id,
      date: '2026-04-02',
      startTime: '05:00',
      endTime: '13:00',
    });

    expect(res.status).toBe(409);
  });

  it('tidak menganggap shift karyawan lain sebagai tabrakan', async () => {
    const lain = await makeEmployee({ email: 'siti@resto.id', nik: 'EMP-2' });
    await buatShift({ employeeId: karyawan.id, ...dasar });

    const res = await buatShift({ employeeId: lain.id, ...dasar });
    expect(res.status).toBe(201);
  });

  it('mengabaikan shift yang sudah dibatalkan', async () => {
    const pertama = await buatShift({ employeeId: karyawan.id, ...dasar });
    await request(app)
      .put(`/api/shifts/${pertama.body.id}`)
      .set(auth(hrToken))
      .send({ status: 'cancelled' });

    const res = await buatShift({ employeeId: karyawan.id, ...dasar });
    expect(res.status).toBe(201);
  });
});

describe('POST /api/shifts/bulk', () => {
  it('membuat roster beberapa hari sekaligus', async () => {
    const res = await request(app)
      .post('/api/shifts/bulk')
      .set(auth(hrToken))
      .send({
        shifts: [
          { employeeId: karyawan.id, date: '2026-04-01', startTime: '08:00', endTime: '17:00' },
          { employeeId: karyawan.id, date: '2026-04-02', startTime: '08:00', endTime: '17:00' },
          { employeeId: karyawan.id, date: '2026-04-03', startTime: '08:00', endTime: '17:00' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.created).toBe(3);
    expect(await prisma.shiftSchedule.count()).toBe(3);
  });

  it('menolak seluruh batch kalau ada yang bertabrakan di dalam batch itu sendiri', async () => {
    const res = await request(app)
      .post('/api/shifts/bulk')
      .set(auth(hrToken))
      .send({
        shifts: [
          { employeeId: karyawan.id, date: '2026-04-01', startTime: '08:00', endTime: '17:00' },
          { employeeId: karyawan.id, date: '2026-04-01', startTime: '16:00', endTime: '20:00' },
        ],
      });

    expect(res.status).toBe(400);
    // Roster tidak boleh tersimpan setengah jadi.
    expect(await prisma.shiftSchedule.count()).toBe(0);
  });

  it('menolak batch yang bertabrakan dengan jadwal yang sudah tersimpan', async () => {
    await buatShift({
      employeeId: karyawan.id,
      date: '2026-04-01',
      startTime: '08:00',
      endTime: '17:00',
    });

    const res = await request(app)
      .post('/api/shifts/bulk')
      .set(auth(hrToken))
      .send({
        shifts: [
          { employeeId: karyawan.id, date: '2026-04-01', startTime: '10:00', endTime: '12:00' },
        ],
      });

    expect(res.status).toBe(400);
    expect(await prisma.shiftSchedule.count()).toBe(1);
  });
});

describe('Akses jadwal', () => {
  it('manajer hanya boleh menjadwalkan karyawan departemennya', async () => {
    const dapur = await makeDepartment('Kitchen');
    const fo = await makeDepartment('Front Office');

    await makeEmployee({
      email: 'manajer@resto.id',
      nik: 'MGR-1',
      role: Role.MANAGER,
      departmentId: dapur.id,
    });
    const orangLain = await makeEmployee({
      email: 'fo@resto.id',
      nik: 'FO-1',
      departmentId: fo.id,
    });

    const tokenManajer = await login(app, 'manajer@resto.id');

    const res = await buatShift(
      {
        employeeId: orangLain.id,
        date: '2026-04-01',
        startTime: '08:00',
        endTime: '17:00',
      },
      tokenManajer
    );

    expect(res.status).toBe(403);
  });

  it('karyawan biasa tidak boleh membuat jadwal', async () => {
    const token = await login(app, 'budi@resto.id');

    const res = await buatShift(
      { employeeId: karyawan.id, date: '2026-04-01', startTime: '08:00', endTime: '17:00' },
      token
    );

    expect(res.status).toBe(403);
  });

  it('karyawan bisa melihat jadwalnya sendiri lewat /me', async () => {
    const lain = await makeEmployee({ email: 'siti@resto.id', nik: 'EMP-2' });
    await buatShift({ employeeId: karyawan.id, date: '2026-04-01', startTime: '08:00', endTime: '17:00' });
    await buatShift({ employeeId: lain.id, date: '2026-04-01', startTime: '08:00', endTime: '17:00' });

    const token = await login(app, 'budi@resto.id');
    const res = await request(app).get('/api/shifts/me').set(auth(token));

    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0].employeeId).toBe(karyawan.id);
  });

  it('menyaring jadwal berdasarkan rentang tanggal', async () => {
    await buatShift({ employeeId: karyawan.id, date: '2026-04-01', startTime: '08:00', endTime: '17:00' });
    await buatShift({ employeeId: karyawan.id, date: '2026-04-10', startTime: '08:00', endTime: '17:00' });

    const res = await request(app)
      .get('/api/shifts?startDate=2026-04-01&endDate=2026-04-05')
      .set(auth(hrToken));

    expect(res.body.pagination.total).toBe(1);
  });
});

describe('DELETE /api/shifts/:id', () => {
  it('menghapus jadwal yang belum dipakai presensi', async () => {
    const shift = await buatShift({
      employeeId: karyawan.id,
      date: '2026-04-01',
      startTime: '08:00',
      endTime: '17:00',
    });

    const res = await request(app).delete(`/api/shifts/${shift.body.id}`).set(auth(hrToken));

    expect(res.status).toBe(200);
    expect(await prisma.shiftSchedule.count()).toBe(0);
  });

  it('hanya membatalkan jadwal yang sudah punya presensi, demi jejak audit', async () => {
    const shift = await buatShift({
      employeeId: karyawan.id,
      date: '2026-04-01',
      startTime: '08:00',
      endTime: '17:00',
    });
    await makeOpenAttendance({
      employeeId: karyawan.id,
      minutesAgo: 60,
      shiftScheduleId: shift.body.id,
    });

    const res = await request(app).delete(`/api/shifts/${shift.body.id}`).set(auth(hrToken));

    expect(res.status).toBe(200);
    expect(res.body.shift.status).toBe('cancelled');
    // Barisnya tetap ada karena presensi menunjuk ke sini.
    expect(await prisma.shiftSchedule.count()).toBe(1);
  });
});
