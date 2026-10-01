import request from 'supertest';
import { DateTime } from 'luxon';
import { Prisma, Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee, makeDepartment, TEST_TIMEZONE } from './helpers/db';
import { login, auth, expectStatus } from './helpers/api';
import { bikinApp } from './helpers/app';
import { generateULID } from '../src/utils/generateULID';

const app = bikinApp();

/** Tanggal kalender hari ini menurut zona operasional, digeser sejumlah hari. */
const hari = (geser = 0) => DateTime.now().setZone(TEST_TIMEZONE).plus({ days: geser }).toISODate()!;
const tgl = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

let hrToken: string;
let dapurId: string;
let barId: string;
let budi: { id: string };

beforeEach(async () => {
  await resetDatabase();
  dapurId = (await makeDepartment('Dapur')).id;
  barId = (await makeDepartment('Bar')).id;
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  budi = await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1', name: 'Budi', departmentId: dapurId });
});

const buatJenis = (body: Record<string, unknown>, token = hrToken) =>
  request(app).post('/api/shifts/templates').set(auth(token)).send(body);

const ubahJenis = (id: string, body: Record<string, unknown>, token = hrToken) =>
  request(app).put(`/api/shifts/templates/${id}`).set(auth(token)).send(body);

const PAGI = { name: 'Pagi', code: 'P', startTime: '07:00', endTime: '15:00', breakDuration: 1, color: 'teal' };

const barisJadwal = (employeeId: string, iso: string, extra: Partial<Prisma.ShiftScheduleUncheckedCreateInput> = {}) =>
  prisma.shiftSchedule.create({
    data: {
      id: generateULID(),
      employeeId,
      date: tgl(iso),
      startTime: '07:00',
      endTime: '15:00',
      breakDuration: new Prisma.Decimal(1),
      status: 'confirmed',
      ...extra,
    },
  });

describe('POST /api/shifts/templates', () => {
  it('membuat jenis shift dengan bentuk DTO yang dijanjikan', async () => {
    const res = await buatJenis(PAGI);

    expectStatus(res, 201);
    expect(res.body).toEqual({
      id: expect.any(String),
      name: 'Pagi',
      code: 'P',
      startTime: '07:00',
      endTime: '15:00',
      breakDuration: 1,
      color: 'teal',
      departmentId: null,
      department: null,
      isActive: true,
      activeAssignments: 0,
    });
  });

  it('memakai warna teal dan istirahat 0 bila tidak dikirim', async () => {
    const res = await buatJenis({ name: 'Malam', startTime: '22:00', endTime: '06:00' });

    expectStatus(res, 201);
    expect(res.body.color).toBe('teal');
    expect(res.body.breakDuration).toBe(0);
    expect(res.body.code).toBeNull();
  });

  it('menolak nama yang sudah dipakai jenis aktif di departemen yang sama', async () => {
    await buatJenis(PAGI);
    const res = await buatJenis({ ...PAGI, name: 'pagi' });
    expect(res.status).toBe(409);

    // Nama yang sama untuk departemen tertentu tetap boleh.
    const khusus = await buatJenis({ ...PAGI, departmentId: dapurId });
    expectStatus(khusus, 201);
    expect(khusus.body.department).toEqual({ id: dapurId, name: 'Dapur' });
  });

  it('nama jenis yang sudah dinonaktifkan boleh dipakai lagi', async () => {
    const lama = await buatJenis(PAGI);
    expectStatus(await request(app).delete(`/api/shifts/templates/${lama.body.id}`).set(auth(hrToken)), 200);

    expectStatus(await buatJenis(PAGI), 201);
  });

  it.each([
    ['kode lebih dari 4 karakter', { code: 'PAGI1' }],
    ['warna di luar palet', { color: 'pink' }],
    ['istirahat sepanjang shift', { breakDuration: 8 }],
    ['jam tidak valid', { startTime: '7:00' }],
    ['nama terlalu pendek', { name: 'P' }],
    ['field tak dikenal', { warnaHex: '#fff' }],
  ])('menolak %s', async (_label, ubahan) => {
    const res = await buatJenis({ ...PAGI, ...ubahan });
    expect(res.status).toBe(400);
  });

  it('menolak departemen yang tidak ada', async () => {
    const res = await buatJenis({ ...PAGI, departmentId: generateULID() });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/shifts/templates', () => {
  it('menyembunyikan jenis nonaktif kecuali diminta', async () => {
    const pagi = await buatJenis(PAGI);
    await buatJenis({ ...PAGI, name: 'Siang', startTime: '11:00', endTime: '19:00' });
    await prisma.shiftTemplate.update({ where: { id: pagi.body.id }, data: { isActive: false } });

    const aktif = await request(app).get('/api/shifts/templates').set(auth(hrToken));
    expectStatus(aktif, 200);
    expect(aktif.body.data.map((t: { name: string }) => t.name)).toEqual(['Siang']);

    const semua = await request(app).get('/api/shifts/templates?includeInactive=true').set(auth(hrToken));
    expect(semua.body.data).toHaveLength(2);
  });

  it('menghitung penugasan aktif saja', async () => {
    const pagi = await buatJenis(PAGI);
    const dasar = { employeeId: budi.id, templateId: pagi.body.id, weekdays: [1, 2, 3, 4, 5] };
    await prisma.shiftAssignment.createMany({
      data: [
        { id: generateULID(), ...dasar, startDate: tgl(hari(-30)), endDate: null },
        { id: generateULID(), ...dasar, startDate: tgl(hari(-30)), endDate: tgl(hari(-1)) },
        { id: generateULID(), ...dasar, startDate: tgl(hari(-30)), endDate: tgl(hari(0)) },
      ],
    });

    const res = await request(app).get('/api/shifts/templates').set(auth(hrToken));
    // Yang berakhir kemarin sudah tidak aktif; yang berakhir hari ini masih.
    expect(res.body.data[0].activeAssignments).toBe(2);
  });
});

describe('PUT /api/shifts/templates/:id — jam baru ikut ke jadwal ke depan', () => {
  it('hanya mengubah baris ke depan yang belum dikoreksi, dibatalkan, atau dipakai presensi', async () => {
    const pagi = (await buatJenis(PAGI)).body;
    const t = { templateId: pagi.id };

    const lampau = await barisJadwal(budi.id, hari(-2), t);
    const depan = await barisJadwal(budi.id, hari(2), t);
    const koreksi = await barisJadwal(budi.id, hari(3), { ...t, isOverride: true });
    const berpresensi = await barisJadwal(budi.id, hari(4), t);
    await prisma.attendance.create({
      data: {
        id: generateULID(),
        employeeId: budi.id,
        checkInTime: new Date(),
        checkInMethod: 'gps',
        shiftScheduleId: berpresensi.id,
        status: 'present',
      },
    });
    const batal = await barisJadwal(budi.id, hari(5), { ...t, status: 'cancelled' });
    const manual = await barisJadwal(budi.id, hari(6));

    const res = await ubahJenis(pagi.id, { startTime: '08:00', endTime: '16:00' });

    expectStatus(res, 200);
    expect(res.body.rowsUpdated).toBe(1);
    expect(res.body.template.startTime).toBe('08:00');

    const jam = async (id: string) => {
      const r = await prisma.shiftSchedule.findUniqueOrThrow({ where: { id } });
      return `${r.startTime}-${r.endTime}`;
    };
    expect(await jam(depan.id)).toBe('08:00-16:00');
    for (const tetap of [lampau, koreksi, berpresensi, batal, manual]) {
      expect(await jam(tetap.id)).toBe('07:00-15:00');
    }
  });

  it('perubahan istirahat saja juga diterapkan, ganti nama tidak menyentuh jadwal', async () => {
    const pagi = (await buatJenis(PAGI)).body;
    const depan = await barisJadwal(budi.id, hari(2), { templateId: pagi.id });

    const istirahat = await ubahJenis(pagi.id, { breakDuration: 0.5 });
    expect(istirahat.body.rowsUpdated).toBe(1);
    const baris = await prisma.shiftSchedule.findUniqueOrThrow({ where: { id: depan.id } });
    expect(baris.breakDuration.toNumber()).toBe(0.5);

    const nama = await ubahJenis(pagi.id, { name: 'Pagi Raya', color: 'amber' });
    expectStatus(nama, 200);
    expect(nama.body.rowsUpdated).toBe(0);
    expect(nama.body.template).toMatchObject({ name: 'Pagi Raya', color: 'amber' });
  });

  it('membiarkan baris yang dengan jam baru akan bertabrakan dengan shift lain', async () => {
    const pagi = (await buatJenis(PAGI)).body;
    const depan = await barisJadwal(budi.id, hari(2), { templateId: pagi.id });
    // Split shift sore orang yang sama.
    await barisJadwal(budi.id, hari(2), { startTime: '16:00', endTime: '20:00', breakDuration: new Prisma.Decimal(0) });

    const res = await ubahJenis(pagi.id, { startTime: '12:00', endTime: '18:00' });

    expectStatus(res, 200);
    expect(res.body.rowsUpdated).toBe(0);
    expect(res.body.rowsSkipped).toBe(1);
    const baris = await prisma.shiftSchedule.findUniqueOrThrow({ where: { id: depan.id } });
    expect(baris.startTime).toBe('07:00');
  });

  it('menolak istirahat yang menghabiskan panjang shift baru', async () => {
    const pagi = (await buatJenis(PAGI)).body;
    const res = await ubahJenis(pagi.id, { startTime: '07:00', endTime: '08:00' });
    expect(res.status).toBe(400);
  });

  it('menjawab 404 untuk jenis yang tidak ada', async () => {
    const res = await ubahJenis(generateULID(), { name: 'Apa saja' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/shifts/templates/:id', () => {
  it('menonaktifkan, bukan menghapus', async () => {
    const pagi = (await buatJenis(PAGI)).body;
    const baris = await barisJadwal(budi.id, hari(-1), { templateId: pagi.id });

    const res = await request(app).delete(`/api/shifts/templates/${pagi.id}`).set(auth(hrToken));

    expectStatus(res, 200);
    expect(res.body.template.isActive).toBe(false);
    // Jadwal lama tetap menunjuk jenisnya untuk riwayat.
    expect((await prisma.shiftSchedule.findUniqueOrThrow({ where: { id: baris.id } })).templateId).toBe(pagi.id);
  });

  it('menolak dengan 409 selama masih dipakai penugasan aktif', async () => {
    const pagi = (await buatJenis(PAGI)).body;
    const tetapkan = await request(app)
      .post('/api/shifts/assignments')
      .set(auth(hrToken))
      .send({
        employeeIds: [budi.id],
        templateId: pagi.id,
        startDate: hari(1),
        durasi: 'seterusnya',
        weekdays: [1, 2, 3, 4, 5],
      });
    expectStatus(tetapkan, 201);

    const res = await request(app).delete(`/api/shifts/templates/${pagi.id}`).set(auth(hrToken));

    expect(res.status).toBe(409);
    expect(res.body.activeAssignments).toBe(1);
    expect((await prisma.shiftTemplate.findUniqueOrThrow({ where: { id: pagi.id } })).isActive).toBe(true);
  });

  it('jenis shift khusus departemen ikut nonaktif saat departemennya dihapus', async () => {
    const kosong = await makeDepartment('Gudang');
    const jenis = (await buatJenis({ ...PAGI, departmentId: kosong.id })).body;

    const res = await request(app).delete(`/api/departments/${kosong.id}`).set(auth(hrToken));
    expect(res.status).toBe(204);

    // Tanpa ini ia berubah menjadi jenis shift untuk semua departemen.
    const sesudah = await prisma.shiftTemplate.findUniqueOrThrow({ where: { id: jenis.id } });
    expect(sesudah.isActive).toBe(false);
  });
});

describe('Manajer dan jenis shift', () => {
  let mgrToken: string;
  let globalId: string;
  let dapurJenisId: string;
  let barJenisId: string;

  beforeEach(async () => {
    await makeEmployee({ email: 'mgr@resto.id', nik: 'MGR-1', role: Role.MANAGER, departmentId: dapurId });
    mgrToken = await login(app, 'mgr@resto.id');
    globalId = (await buatJenis(PAGI)).body.id;
    dapurJenisId = (await buatJenis({ ...PAGI, name: 'Dapur Pagi', departmentId: dapurId })).body.id;
    barJenisId = (await buatJenis({ ...PAGI, name: 'Bar Malam', departmentId: barId })).body.id;
  });

  it('hanya melihat jenis untuk semua departemen dan departemennya sendiri', async () => {
    const res = await request(app).get('/api/shifts/templates').set(auth(mgrToken));

    expectStatus(res, 200);
    expect(res.body.data.map((t: { id: string }) => t.id).sort()).toEqual([globalId, dapurJenisId].sort());
  });

  it('jenis buatan manajer selalu milik departemennya', async () => {
    const res = await buatJenis({ ...PAGI, name: 'Siang', departmentId: barId }, mgrToken);

    expectStatus(res, 201);
    expect(res.body.departmentId).toBe(dapurId);
  });

  it('tidak bisa mengubah jenis untuk semua departemen atau milik departemen lain', async () => {
    expect((await ubahJenis(globalId, { name: 'Pagi Baru' }, mgrToken)).status).toBe(403);
    expect((await ubahJenis(barJenisId, { name: 'Bar Baru' }, mgrToken)).status).toBe(403);
    expect((await request(app).delete(`/api/shifts/templates/${globalId}`).set(auth(mgrToken))).status).toBe(403);

    expectStatus(await ubahJenis(dapurJenisId, { name: 'Dapur Pagi Baru' }, mgrToken), 200);
  });

  it('tidak bisa memindahkan jenis departemennya ke departemen lain', async () => {
    const res = await ubahJenis(dapurJenisId, { departmentId: barId }, mgrToken);
    expect(res.status).toBe(403);
  });

  it('manajer tanpa departemen ditolak', async () => {
    await makeEmployee({ email: 'lepas@resto.id', nik: 'MGR-2', role: Role.MANAGER });
    const token = await login(app, 'lepas@resto.id');

    const res = await buatJenis({ ...PAGI, name: 'Lepas' }, token);
    expect(res.status).toBe(403);
  });

  it('karyawan biasa tidak boleh membuat jenis shift', async () => {
    const token = await login(app, 'budi@resto.id');
    expect((await buatJenis({ ...PAGI, name: 'Budi' }, token)).status).toBe(403);
  });
});

describe('POST /api/shifts dengan templateId', () => {
  it('mengambil jam dan istirahat dari jenis shift', async () => {
    const pagi = (await buatJenis(PAGI)).body;

    const res = await request(app)
      .post('/api/shifts')
      .set(auth(hrToken))
      .send({ employeeId: budi.id, date: hari(3), templateId: pagi.id });

    expectStatus(res, 201);
    expect(res.body).toMatchObject({
      startTime: '07:00',
      endTime: '15:00',
      breakDuration: 1,
      templateId: pagi.id,
      template: { id: pagi.id, name: 'Pagi', code: 'P', color: 'teal' },
      assignmentId: null,
      isOverride: false,
    });
  });

  it('jam yang dikirim eksplisit mengalahkan jam jenis shift', async () => {
    const pagi = (await buatJenis(PAGI)).body;

    const res = await request(app)
      .post('/api/shifts')
      .set(auth(hrToken))
      .send({ employeeId: budi.id, date: hari(3), templateId: pagi.id, startTime: '08:00', breakDuration: 0 });

    expectStatus(res, 201);
    expect(res.body.startTime).toBe('08:00');
    expect(res.body.endTime).toBe('15:00');
    expect(res.body.breakDuration).toBe(0);
  });

  it('tanpa templateId jam tetap wajib, seperti klien lama', async () => {
    const res = await request(app).post('/api/shifts').set(auth(hrToken)).send({ employeeId: budi.id, date: hari(3) });
    expect(res.status).toBe(400);
  });

  it('menolak jenis shift yang sudah nonaktif', async () => {
    const pagi = (await buatJenis(PAGI)).body;
    await prisma.shiftTemplate.update({ where: { id: pagi.id }, data: { isActive: false } });

    const res = await request(app)
      .post('/api/shifts')
      .set(auth(hrToken))
      .send({ employeeId: budi.id, date: hari(3), templateId: pagi.id });
    expect(res.status).toBe(422);
  });
});
