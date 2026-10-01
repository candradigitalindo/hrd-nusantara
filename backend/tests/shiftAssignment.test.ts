import request from 'supertest';
import { DateTime } from 'luxon';
import { Role } from '@prisma/client';
import {
  prisma,
  resetDatabase,
  makeEmployee,
  makeDepartment,
  makeHoliday,
  makeLeaveType,
  makeLeaveBalance,
  TEST_TIMEZONE,
} from './helpers/db';
import { login, auth, expectStatus } from './helpers/api';
import { bikinApp } from './helpers/app';
import { generateULID } from '../src/utils/generateULID';
import { HORIZON_HARI, materialisasi, perpanjangSemua, pastikanJadwalTerbit } from '../src/services/shiftAssignment';

const app = bikinApp();

/** Tanggal kalender hari ini menurut zona operasional, digeser sejumlah hari. */
const hari = (geser = 0) => DateTime.now().setZone(TEST_TIMEZONE).plus({ days: geser }).toISODate()!;
const tgl = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const geser = (iso: string, n: number) => DateTime.fromISO(iso, { zone: 'utc' }).plus({ days: n }).toISODate()!;
/** Senin pertama pada atau sesudah tanggal ini. */
const seninDari = (iso: string) => {
  let d = DateTime.fromISO(iso, { zone: 'utc' });
  while (d.weekday !== 1) d = d.plus({ days: 1 });
  return d.toISODate()!;
};
const SEMUA_HARI = [0, 1, 2, 3, 4, 5, 6];
const SEN_JUM = [1, 2, 3, 4, 5];

let hrToken: string;
let dapurId: string;
let barId: string;
let budi: { id: string };
let sari: { id: string };
let pagiId: string;
let malamId: string;

beforeEach(async () => {
  await resetDatabase();
  dapurId = (await makeDepartment('Dapur')).id;
  barId = (await makeDepartment('Bar')).id;
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  budi = await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1', name: 'Budi', departmentId: dapurId });
  sari = await makeEmployee({ email: 'sari@resto.id', nik: 'EMP-2', name: 'Sari', departmentId: barId });

  const jenis = async (body: Record<string, unknown>) => {
    const res = await request(app).post('/api/shifts/templates').set(auth(hrToken)).send(body);
    expectStatus(res, 201);
    return res.body.id as string;
  };
  pagiId = await jenis({ name: 'Pagi', code: 'P', startTime: '07:00', endTime: '15:00', breakDuration: 1 });
  malamId = await jenis({ name: 'Malam', code: 'M', startTime: '22:00', endTime: '06:00', color: 'violet' });
});

const tetapkan = (body: Record<string, unknown>, token = hrToken) =>
  request(app).post('/api/shifts/assignments').set(auth(token)).send(body);

const tanggalJadwal = async (employeeId: string) =>
  (await prisma.shiftSchedule.findMany({ where: { employeeId }, orderBy: { date: 'asc' } })).map((r) =>
    r.date.toISOString().slice(0, 10)
  );

const presensiUntuk = (employeeId: string, shiftScheduleId: string) =>
  prisma.attendance.create({
    data: {
      id: generateULID(),
      employeeId,
      checkInTime: new Date(),
      checkInMethod: 'gps',
      shiftScheduleId,
      status: 'present',
    },
  });

const barisPada = (employeeId: string, iso: string) =>
  prisma.shiftSchedule.findFirstOrThrow({ where: { employeeId, date: tgl(iso) } });

describe('POST /api/shifts/assignments — durasi', () => {
  it('1 hari membuat satu baris biasa tanpa penugasan', async () => {
    const res = await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(2), durasi: 'hari' });

    expectStatus(res, 201);
    expect(res.body.results[0]).toMatchObject({
      employeeId: budi.id,
      employeeName: 'Budi',
      assignmentId: null,
      created: 1,
      skipped: [],
      replacedAssignments: 0,
    });
    expect(res.body.totals).toEqual({ created: 1, skipped: 0, employees: 1, failed: 0 });
    expect(await prisma.shiftAssignment.count()).toBe(0);

    const baris = await barisPada(budi.id, hari(2));
    expect(baris).toMatchObject({ templateId: pagiId, assignmentId: null, startTime: '07:00', endTime: '15:00' });
  });

  it('1 hari boleh memakai jam kustom tanpa jenis shift', async () => {
    const res = await tetapkan({
      employeeIds: [budi.id],
      startTime: '10:00',
      endTime: '18:00',
      breakDuration: 0.5,
      startDate: hari(2),
      durasi: 'hari',
    });

    expectStatus(res, 201);
    const baris = await barisPada(budi.id, hari(2));
    expect(baris).toMatchObject({ templateId: null, startTime: '10:00', endTime: '18:00' });
    expect(baris.breakDuration.toNumber()).toBe(0.5);
  });

  it('1 minggu hanya mengisi hari yang dipilih', async () => {
    const senin = seninDari(hari(1));

    const res = await tetapkan({
      employeeIds: [budi.id],
      templateId: pagiId,
      startDate: senin,
      durasi: 'minggu',
      weekdays: [5, 1, 3],
    });

    expectStatus(res, 201);
    expect(res.body.results[0].created).toBe(3);
    expect(await tanggalJadwal(budi.id)).toEqual([senin, geser(senin, 2), geser(senin, 4)]);

    const penugasan = await prisma.shiftAssignment.findUniqueOrThrow({ where: { id: res.body.results[0].assignmentId } });
    expect(penugasan.endDate?.toISOString().slice(0, 10)).toBe(geser(senin, 6));
    expect(penugasan.weekdays).toEqual([1, 3, 5]);
  });

  it.each([
    ['2027-01-31', '2027-02-28', 29],
    ['2028-01-31', '2028-02-29', 30],
    ['2027-03-15', '2027-04-14', 31],
  ])('1 bulan dari %s berakhir %s', async (mulai, akhir, jumlah) => {
    const res = await tetapkan({
      employeeIds: [budi.id],
      templateId: pagiId,
      startDate: mulai,
      durasi: 'bulan',
      weekdays: SEMUA_HARI,
    });

    expectStatus(res, 201);
    expect(res.body.results[0].created).toBe(jumlah);
    const tanggal = await tanggalJadwal(budi.id);
    expect(tanggal[0]).toBe(mulai);
    expect(tanggal[tanggal.length - 1]).toBe(akhir);
  });

  it('seterusnya membuat baris sampai cakrawala lalu mencatat materializedUntil', async () => {
    const res = await tetapkan({
      employeeIds: [budi.id],
      templateId: pagiId,
      startDate: hari(0),
      durasi: 'seterusnya',
      weekdays: SEMUA_HARI,
    });

    expectStatus(res, 201);
    expect(res.body.results[0].created).toBe(HORIZON_HARI + 1);

    const penugasan = await prisma.shiftAssignment.findUniqueOrThrow({ where: { id: res.body.results[0].assignmentId } });
    expect(penugasan.endDate).toBeNull();
    expect(penugasan.materializedUntil?.toISOString().slice(0, 10)).toBe(hari(HORIZON_HARI));

    const tanggal = await tanggalJadwal(budi.id);
    expect(tanggal[tanggal.length - 1]).toBe(hari(HORIZON_HARI));
  });

  it('penugasan yang mulai jauh di depan langsung berbaris sejak tanggal mulainya', async () => {
    const mulai = hari(90);
    const res = await tetapkan({
      employeeIds: [budi.id],
      templateId: pagiId,
      startDate: mulai,
      durasi: 'seterusnya',
      weekdays: SEMUA_HARI,
    });

    expect(res.body.results[0].created).toBe(HORIZON_HARI + 1);
    expect((await tanggalJadwal(budi.id))[0]).toBe(mulai);
  });

  it('sampai tanggal membuat baris inklusif sampai tanggal akhir', async () => {
    const senin = seninDari(hari(1));

    const res = await tetapkan({
      employeeIds: [budi.id],
      templateId: pagiId,
      startDate: senin,
      durasi: 'sampai',
      endDate: geser(senin, 11),
      weekdays: SEN_JUM,
    });

    expectStatus(res, 201);
    // Dua pekan kerja, pekan kedua berakhir Jumat = hari ke-11.
    expect(res.body.results[0].created).toBe(10);
  });

  it.each([
    ['jam kustom untuk lebih dari sehari', { durasi: 'minggu', templateId: undefined, startTime: '08:00', endTime: '16:00', weekdays: SEN_JUM }],
    ['tanpa hari', { durasi: 'minggu', weekdays: [] }],
    ['sampai tanpa tanggal akhir', { durasi: 'sampai', weekdays: SEN_JUM }],
    ['sampai lebih dari 366 hari', { durasi: 'sampai', endDate: '2028-03-01', weekdays: SEN_JUM }],
    ['tanggal akhir sebelum mulai', { durasi: 'sampai', endDate: '2027-01-01', weekdays: SEN_JUM }],
    ['tanggal mustahil', { durasi: 'minggu', startDate: '2027-02-31', weekdays: SEN_JUM }],
    ['karyawan ganda', { durasi: 'minggu', weekdays: SEN_JUM, dobel: true }],
    ['field tak dikenal', { durasi: 'minggu', weekdays: SEN_JUM, berulang: true }],
  ])('menolak %s', async (_label, ubahan) => {
    const { dobel, ...sisa } = ubahan as Record<string, unknown>;
    const res = await tetapkan({
      employeeIds: dobel ? [budi.id, budi.id] : [budi.id],
      templateId: pagiId,
      startDate: '2027-02-01',
      ...sisa,
    });
    expect(res.status).toBe(400);
    expect(await prisma.shiftSchedule.count()).toBe(0);
  });

  it('menolak jenis shift yang sudah nonaktif dengan 422', async () => {
    await prisma.shiftTemplate.update({ where: { id: pagiId }, data: { isActive: false } });

    const res = await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(1), durasi: 'minggu', weekdays: SEN_JUM });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/shifts/assignments — tanggal yang dilewati', () => {
  it('melewati libur nasional bila diminta', async () => {
    const senin = seninDari(hari(1));
    const rabu = geser(senin, 2);
    await makeHoliday(rabu, 'Libur Uji');

    const lewati = await tetapkan({
      employeeIds: [budi.id],
      templateId: pagiId,
      startDate: senin,
      durasi: 'minggu',
      weekdays: SEN_JUM,
      skipPublicHolidays: true,
    });
    expect(lewati.body.results[0].created).toBe(4);
    expect(lewati.body.results[0].skipped).toEqual([{ date: rabu, reason: 'libur_nasional' }]);

    const tetap = await tetapkan({ employeeIds: [sari.id], templateId: pagiId, startDate: senin, durasi: 'minggu', weekdays: SEN_JUM });
    expect(tetap.body.results[0].created).toBe(5);
  });

  it('melewati tanggal yang bertabrakan, termasuk shift malam sehari sebelumnya', async () => {
    const senin = seninDari(hari(2));
    const jadwal = (iso: string, startTime: string, endTime: string) =>
      prisma.shiftSchedule.create({
        data: { id: generateULID(), employeeId: budi.id, date: tgl(iso), startTime, endTime, status: 'confirmed' },
      });
    // Minggu malam 23:00 sampai Senin 08:00 menabrak Senin pagi.
    await jadwal(geser(senin, -1), '23:00', '08:00');
    // Selasa 10:00–18:00 menabrak Selasa pagi.
    await jadwal(geser(senin, 1), '10:00', '18:00');
    // Kamis sore tidak menabrak: split shift boleh.
    await jadwal(geser(senin, 3), '16:00', '20:00');
    // Rabu yang dibatalkan tidak dihitung.
    await prisma.shiftSchedule.create({
      data: { id: generateULID(), employeeId: budi.id, date: tgl(geser(senin, 2)), startTime: '07:00', endTime: '15:00', status: 'cancelled' },
    });

    const res = await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: senin, durasi: 'minggu', weekdays: SEN_JUM });

    expectStatus(res, 201);
    expect(res.body.results[0].created).toBe(3);
    expect(res.body.results[0].skipped).toEqual([
      { date: senin, reason: 'bentrok' },
      { date: geser(senin, 1), reason: 'bentrok' },
    ]);
  });

  it('tanpa "ganti", tanggal yang sudah diisi penugasan lain dilewati sebagai bentrok', async () => {
    await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(0), durasi: 'seterusnya', weekdays: SEMUA_HARI });
    const siang = await request(app)
      .post('/api/shifts/templates')
      .set(auth(hrToken))
      .send({ name: 'Siang', startTime: '11:00', endTime: '19:00' });

    const res = await tetapkan({ employeeIds: [budi.id], templateId: siang.body.id, startDate: hari(1), durasi: 'minggu', weekdays: SEMUA_HARI });

    expect(res.body.results[0].created).toBe(0);
    expect(res.body.results[0].skipped).toHaveLength(7);
    expect(res.body.totals.skipped).toBe(7);
  });
});

describe('POST /api/shifts/assignments — ganti penugasan lain', () => {
  it('mengakhiri penugasan lama sehari sebelumnya dan menghapus baris ke depannya', async () => {
    const lama = await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(0), durasi: 'seterusnya', weekdays: SEMUA_HARI });
    const lamaId = lama.body.results[0].assignmentId as string;

    // Koreksi manual dan presensi melindungi barisnya dari penghapusan.
    const koreksi = await barisPada(budi.id, hari(10));
    await prisma.shiftSchedule.update({ where: { id: koreksi.id }, data: { isOverride: true } });
    const dipakai = await barisPada(budi.id, hari(8));
    await presensiUntuk(budi.id, dipakai.id);

    const res = await tetapkan({
      employeeIds: [budi.id],
      templateId: malamId,
      startDate: hari(7),
      durasi: 'seterusnya',
      weekdays: SEMUA_HARI,
      replaceExisting: true,
    });

    expectStatus(res, 201);
    expect(res.body.results[0].replacedAssignments).toBe(1);
    // Hari ke-7 sampai ke-62 milik penugasan lama, dikurangi dua yang dilindungi.
    expect(res.body.results[0].replacedRows).toBe(HORIZON_HARI - 7 + 1 - 2);
    expect(res.body.results[0].created).toBe(HORIZON_HARI + 1);

    const penugasanLama = await prisma.shiftAssignment.findUniqueOrThrow({ where: { id: lamaId } });
    expect(penugasanLama.endDate?.toISOString().slice(0, 10)).toBe(hari(6));

    const sisaLama = await prisma.shiftSchedule.findMany({
      where: { assignmentId: lamaId, date: { gte: tgl(hari(7)) } },
      orderBy: { date: 'asc' },
    });
    expect(sisaLama.map((r) => r.date.toISOString().slice(0, 10))).toEqual([hari(8), hari(10)]);
  });

  it('menghapus penugasan lain yang belum mulai', async () => {
    const nanti = await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(20), durasi: 'seterusnya', weekdays: SEN_JUM });
    const nantiId = nanti.body.results[0].assignmentId as string;

    const res = await tetapkan({
      employeeIds: [budi.id],
      templateId: malamId,
      startDate: hari(5),
      durasi: 'seterusnya',
      weekdays: SEN_JUM,
      replaceExisting: true,
    });

    expect(res.body.results[0].replacedAssignments).toBe(1);
    expect(await prisma.shiftAssignment.findUnique({ where: { id: nantiId } })).toBeNull();
    expect(await prisma.shiftSchedule.count({ where: { templateId: pagiId } })).toBe(0);
  });

  it('1 hari dengan "ganti" mengganti shift orang itu di tanggal tersebut', async () => {
    await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(0), durasi: 'seterusnya', weekdays: SEMUA_HARI });

    const res = await tetapkan({
      employeeIds: [budi.id],
      templateId: malamId,
      startDate: hari(3),
      durasi: 'hari',
      replaceExisting: true,
    });

    expectStatus(res, 201);
    expect(res.body.results[0]).toMatchObject({ created: 1, replacedRows: 1 });
    const baris = await prisma.shiftSchedule.findMany({ where: { employeeId: budi.id, date: tgl(hari(3)) } });
    expect(baris).toHaveLength(1);
    expect(baris[0].templateId).toBe(malamId);

    // Baris penugasan yang diganti tidak muncul kembali saat diperpanjang.
    await perpanjangSemua();
    expect(await prisma.shiftSchedule.count({ where: { employeeId: budi.id, date: tgl(hari(3)) } })).toBe(1);
  });
});

describe('POST /api/shifts/assignments — pratinjau', () => {
  it('menghitung hasil yang sama persis tanpa menulis apa pun', async () => {
    const lama = await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(0), durasi: 'seterusnya', weekdays: SEMUA_HARI });
    const lamaId = lama.body.results[0].assignmentId as string;
    const barisSebelum = await prisma.shiftSchedule.count();

    const body = {
      employeeIds: [budi.id, sari.id],
      templateId: malamId,
      startDate: hari(7),
      durasi: 'bulan',
      weekdays: SEN_JUM,
      replaceExisting: true,
    };
    const pratinjau = await tetapkan({ ...body, preview: true });

    expectStatus(pratinjau, 200);
    expect(pratinjau.body.results.every((r: { assignmentId: string | null }) => r.assignmentId === null)).toBe(true);
    expect(pratinjau.body.results[0].replacedAssignments).toBe(1);
    expect(await prisma.shiftAssignment.count()).toBe(1);
    expect((await prisma.shiftAssignment.findUniqueOrThrow({ where: { id: lamaId } })).endDate).toBeNull();
    expect(await prisma.shiftSchedule.count()).toBe(barisSebelum);

    const sungguhan = await tetapkan(body);
    expectStatus(sungguhan, 201);
    expect(sungguhan.body.totals).toEqual(pratinjau.body.totals);
    expect(sungguhan.body.results.map((r: { created: number }) => r.created)).toEqual(
      pratinjau.body.results.map((r: { created: number }) => r.created)
    );
  });
});

describe('Materialisasi idempoten dan perpanjangan', () => {
  const buatSeterusnya = async () => {
    const res = await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(0), durasi: 'seterusnya', weekdays: SEMUA_HARI });
    expectStatus(res, 201);
    return res.body.results[0].assignmentId as string;
  };

  it('materialisasi dan perpanjangSemua dua kali tidak menggandakan baris', async () => {
    const id = await buatSeterusnya();
    const jumlah = await prisma.shiftSchedule.count();

    expect((await materialisasi(id, tgl(hari(HORIZON_HARI)))).dibuat).toBe(0);
    expect((await perpanjangSemua()).dibuat).toBe(0);
    expect((await perpanjangSemua()).dibuat).toBe(0);
    expect(await prisma.shiftSchedule.count()).toBe(jumlah);
  });

  it('memperpanjang penugasan yang barisnya tertinggal sampai cakrawala', async () => {
    const id = await buatSeterusnya();
    // Seolah-olah penugasan ini dibuat 30 hari lalu dan belum diperpanjang.
    await prisma.shiftSchedule.deleteMany({ where: { assignmentId: id, date: { gt: tgl(hari(30)) } } });
    await prisma.shiftAssignment.update({ where: { id }, data: { materializedUntil: tgl(hari(30)) } });

    const pertama = await perpanjangSemua();
    expect(pertama).toEqual({ penugasan: 1, dibuat: HORIZON_HARI - 30 });
    expect(await prisma.shiftSchedule.count({ where: { assignmentId: id } })).toBe(HORIZON_HARI + 1);

    expect((await perpanjangSemua()).dibuat).toBe(0);
  });

  it('baris yang sengaja dihapus HR tidak muncul kembali', async () => {
    const id = await buatSeterusnya();
    const baris = await barisPada(budi.id, hari(5));
    expectStatus(await request(app).delete(`/api/shifts/${baris.id}`).set(auth(hrToken)), 200);

    await perpanjangSemua();
    await materialisasi(id, tgl(hari(HORIZON_HARI + 10)));

    expect(await prisma.shiftSchedule.count({ where: { employeeId: budi.id, date: tgl(hari(5)) } })).toBe(0);
  });

  it('melewati semua tanggal bila karyawannya kini memakai jam fleksibel', async () => {
    const id = await buatSeterusnya();
    await prisma.employee.update({ where: { id: budi.id }, data: { flexibleHours: true } });

    const hasil = await materialisasi(id, tgl(hari(HORIZON_HARI + 3)));

    expect(hasil.dibuat).toBe(0);
    expect(hasil.dilewati.map((d) => d.alasan)).toEqual(['fleksibel', 'fleksibel', 'fleksibel']);
  });

  it('pastikanJadwalTerbit dibatasi 400 hari ke depan', async () => {
    const id = await buatSeterusnya();

    await pastikanJadwalTerbit([budi.id], tgl('2100-01-01'));

    const penugasan = await prisma.shiftAssignment.findUniqueOrThrow({ where: { id } });
    expect(penugasan.materializedUntil?.toISOString().slice(0, 10)).toBe(hari(400));
  });
});

describe('Pembaca jadwal memastikan baris penugasan sudah terbit', () => {
  it('roster yang dibuka jauh ke depan sudah berisi baris penugasan', async () => {
    await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(0), durasi: 'seterusnya', weekdays: SEMUA_HARI });

    const res = await request(app)
      .get(`/api/shifts?employeeId=${budi.id}&startDate=${hari(80)}&endDate=${hari(86)}`)
      .set(auth(hrToken));

    expectStatus(res, 200);
    expect(res.body.data).toHaveLength(7);
    expect(res.body.data[0]).toMatchObject({
      template: { id: pagiId, name: 'Pagi', code: 'P', color: 'teal' },
      isOverride: false,
    });
    expect(res.body.data[0].assignmentId).toHaveLength(26);
  });

  it('cuti 100 hari lagi dihitung dari jadwal penugasan, bukan pola cadangan', async () => {
    const pola = await request(app)
      .post('/api/work-patterns')
      .set(auth(hrToken))
      .send({ code: 'outlet_shift', name: 'Outlet (Shift)', type: 'shift', workingWeekdays: [1, 2, 3, 4, 5, 6], observesPublicHolidays: false });
    expectStatus(pola, 201);
    expectStatus(
      await request(app).patch(`/api/employees/${budi.id}/work-pattern`).set(auth(hrToken)).send({ workPatternId: pola.body.id }),
      200
    );
    await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(0), durasi: 'seterusnya', weekdays: SEN_JUM });

    const mulai = seninDari(hari(100));
    const tipe = await makeLeaveType({ code: 'annual', name: 'Cuti Tahunan' });
    await makeLeaveBalance({ employeeId: budi.id, leaveTypeId: tipe.id, year: Number(mulai.slice(0, 4)), entitledDays: 12 });

    const res = await request(app)
      .post('/api/leaves')
      .set(auth(await login(app, 'budi@resto.id')))
      .send({ leaveTypeId: tipe.id, startDate: mulai, endDate: geser(mulai, 6) });

    expectStatus(res, 201);
    // Pola cadangan akan menghitung 6 hari (Senin–Sabtu) sebagai taksiran.
    expect(res.body.totalDays).toBe(5);
    expect(res.body.breakdown.estimatedDays).toBe(0);
  });
});

describe('POST /api/shifts/assignments/:id/end', () => {
  it('menghapus baris sesudah tanggal akhir kecuali yang dikoreksi atau berpresensi', async () => {
    const res = await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(0), durasi: 'seterusnya', weekdays: SEMUA_HARI });
    const id = res.body.results[0].assignmentId as string;

    const koreksi = await barisPada(budi.id, hari(12));
    expectStatus(await request(app).put(`/api/shifts/${koreksi.id}`).set(auth(hrToken)).send({ startTime: '08:00' }), 200);
    await presensiUntuk(budi.id, (await barisPada(budi.id, hari(11))).id);

    const akhiri = await request(app).post(`/api/shifts/assignments/${id}/end`).set(auth(hrToken)).send({ endDate: hari(9) });

    expectStatus(akhiri, 200);
    expect(akhiri.body.assignment.endDate).toBe(hari(9));
    expect(akhiri.body.rowsDeleted).toBe(HORIZON_HARI - 9 - 2);
    const tanggal = await tanggalJadwal(budi.id);
    expect(tanggal.slice(-3)).toEqual([hari(9), hari(11), hari(12)]);

    // Sudah berakhir: perpanjangan tidak membuat apa pun lagi.
    expect((await perpanjangSemua()).dibuat).toBe(0);
  });

  it('boleh diakhiri sehari sebelum mulai, tapi tidak lebih awal', async () => {
    const res = await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(5), durasi: 'minggu', weekdays: SEMUA_HARI });
    const id = res.body.results[0].assignmentId as string;

    const terlalu = await request(app).post(`/api/shifts/assignments/${id}/end`).set(auth(hrToken)).send({ endDate: hari(3) });
    expect(terlalu.status).toBe(422);

    const batal = await request(app).post(`/api/shifts/assignments/${id}/end`).set(auth(hrToken)).send({ endDate: hari(4) });
    expectStatus(batal, 200);
    expect(batal.body.rowsDeleted).toBe(7);
  });

  it('tidak bisa memundurkan tanggal akhir yang sudah lewat', async () => {
    const res = await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(1), durasi: 'minggu', weekdays: SEMUA_HARI });
    const id = res.body.results[0].assignmentId as string;

    const akhiri = await request(app).post(`/api/shifts/assignments/${id}/end`).set(auth(hrToken)).send({ endDate: hari(30) });
    expect(akhiri.status).toBe(422);
  });
});

describe('DELETE /api/shifts/assignments/:id', () => {
  it('penugasan yang belum mulai dihapus bersama barisnya', async () => {
    const res = await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(5), durasi: 'minggu', weekdays: SEMUA_HARI });
    const id = res.body.results[0].assignmentId as string;

    const hapus = await request(app).delete(`/api/shifts/assignments/${id}`).set(auth(hrToken));

    expectStatus(hapus, 200);
    expect(hapus.body).toEqual({ rowsDeleted: 7, deleted: true });
    expect(await prisma.shiftAssignment.count()).toBe(0);
    expect(await prisma.shiftSchedule.count()).toBe(0);
  });

  it('penugasan yang sudah berjalan diakhiri kemarin; shift hari ini yang berpresensi tetap', async () => {
    const res = await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(-3), durasi: 'seterusnya', weekdays: SEMUA_HARI });
    const id = res.body.results[0].assignmentId as string;
    await presensiUntuk(budi.id, (await barisPada(budi.id, hari(0))).id);

    const hapus = await request(app).delete(`/api/shifts/assignments/${id}`).set(auth(hrToken));

    expectStatus(hapus, 200);
    expect(hapus.body).toEqual({ rowsDeleted: HORIZON_HARI, deleted: false });
    const penugasan = await prisma.shiftAssignment.findUniqueOrThrow({ where: { id } });
    expect(penugasan.endDate?.toISOString().slice(0, 10)).toBe(hari(-1));
    expect(await tanggalJadwal(budi.id)).toEqual([hari(-3), hari(-2), hari(-1), hari(0)]);
  });
});

describe('GET /api/shifts/assignments', () => {
  it('menampilkan penugasan aktif dengan bentuk DTO yang dijanjikan', async () => {
    const aktif = await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(0), durasi: 'seterusnya', weekdays: [5, 1], notes: 'Rotasi' });
    await prisma.shiftAssignment.create({
      data: { id: generateULID(), employeeId: sari.id, templateId: malamId, startDate: tgl(hari(-20)), endDate: tgl(hari(-1)), weekdays: SEN_JUM },
    });

    const res = await request(app).get('/api/shifts/assignments').set(auth(hrToken));

    expectStatus(res, 200);
    expect(res.body.pagination).toMatchObject({ page: 1, total: 1 });
    expect(res.body.data[0]).toEqual({
      id: aktif.body.results[0].assignmentId,
      employeeId: budi.id,
      employee: { id: budi.id, name: 'Budi', nik: 'EMP-1', departmentId: dapurId },
      template: { id: pagiId, name: 'Pagi', code: 'P', color: 'teal', startTime: '07:00', endTime: '15:00' },
      startDate: hari(0),
      endDate: null,
      weekdays: [1, 5],
      skipPublicHolidays: false,
      status: 'confirmed',
      notes: 'Rotasi',
      createdAt: expect.any(String),
    });

    const semua = await request(app).get('/api/shifts/assignments?active=false').set(auth(hrToken));
    expect(semua.body.data).toHaveLength(2);

    const milikSari = await request(app).get(`/api/shifts/assignments?active=false&employeeId=${sari.id}`).set(auth(hrToken));
    expect(milikSari.body.data.map((a: { employeeId: string }) => a.employeeId)).toEqual([sari.id]);
  });
});

describe('Manajer dan penugasan shift', () => {
  let mgrToken: string;

  beforeEach(async () => {
    await makeEmployee({ email: 'mgr@resto.id', nik: 'MGR-1', role: Role.MANAGER, departmentId: dapurId });
    mgrToken = await login(app, 'mgr@resto.id');
  });

  it('menolak seluruh permintaan bila ada karyawan departemen lain', async () => {
    const res = await tetapkan(
      { employeeIds: [budi.id, sari.id], templateId: pagiId, startDate: hari(1), durasi: 'minggu', weekdays: SEN_JUM },
      mgrToken
    );

    expect(res.status).toBe(403);
    expect(await prisma.shiftSchedule.count()).toBe(0);
  });

  it('boleh menugaskan departemennya sendiri', async () => {
    const res = await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(1), durasi: 'minggu', weekdays: SEN_JUM }, mgrToken);
    expectStatus(res, 201);
  });

  it('tidak bisa memakai jenis shift departemen lain', async () => {
    const bar = await request(app)
      .post('/api/shifts/templates')
      .set(auth(hrToken))
      .send({ name: 'Bar Malam', startTime: '18:00', endTime: '02:00', departmentId: barId });

    const res = await tetapkan({ employeeIds: [budi.id], templateId: bar.body.id, startDate: hari(1), durasi: 'minggu', weekdays: SEN_JUM }, mgrToken);
    expect(res.status).toBe(403);
  });

  it('tidak bisa mengakhiri atau menghapus penugasan departemen lain', async () => {
    const res = await tetapkan({ employeeIds: [sari.id], templateId: pagiId, startDate: hari(0), durasi: 'seterusnya', weekdays: SEN_JUM });
    const id = res.body.results[0].assignmentId as string;

    expect((await request(app).post(`/api/shifts/assignments/${id}/end`).set(auth(mgrToken)).send({ endDate: hari(3) })).status).toBe(403);
    expect((await request(app).delete(`/api/shifts/assignments/${id}`).set(auth(mgrToken))).status).toBe(403);
    expect((await request(app).get(`/api/shifts/assignments?departmentId=${barId}`).set(auth(mgrToken))).status).toBe(403);
  });

  it('manajer tanpa departemen tidak bisa menjadwalkan siapa pun', async () => {
    const tanpaDept = await makeEmployee({ name: 'Tanpa Dept' });
    await makeEmployee({ email: 'lepas@resto.id', nik: 'MGR-2', role: Role.MANAGER });
    const token = await login(app, 'lepas@resto.id');

    const res = await tetapkan({ employeeIds: [tanpaDept.id], templateId: pagiId, startDate: hari(1), durasi: 'minggu', weekdays: SEN_JUM }, token);
    expect(res.status).toBe(403);

    const satu = await request(app)
      .post('/api/shifts')
      .set(auth(token))
      .send({ employeeId: tanpaDept.id, date: hari(1), startTime: '08:00', endTime: '16:00' });
    expect(satu.status).toBe(403);
  });
});

describe('Karyawan yang tidak bisa dijadwalkan', () => {
  it('karyawan berjam fleksibel gagal sendiri tanpa menggagalkan yang lain', async () => {
    await prisma.employee.update({ where: { id: sari.id }, data: { flexibleHours: true } });

    const res = await tetapkan({ employeeIds: [budi.id, sari.id], templateId: pagiId, startDate: hari(1), durasi: 'minggu', weekdays: SEN_JUM });

    expectStatus(res, 201);
    expect(res.body.results[1]).toMatchObject({
      employeeId: sari.id,
      assignmentId: null,
      created: 0,
      error: 'Memakai jam fleksibel — tidak memakai roster',
    });
    expect(res.body.totals).toMatchObject({ employees: 1, failed: 1 });
    expect(await prisma.shiftAssignment.count({ where: { employeeId: sari.id } })).toBe(0);
  });

  it('POST /api/shifts dan /bulk menolak karyawan berjam fleksibel dengan 422', async () => {
    await prisma.employee.update({ where: { id: sari.id }, data: { flexibleHours: true } });
    const shift = { employeeId: sari.id, date: hari(1), startTime: '08:00', endTime: '16:00' };

    const satu = await request(app).post('/api/shifts').set(auth(hrToken)).send(shift);
    expect(satu.status).toBe(422);
    expect(satu.body.error).toBe('Sari memakai jam fleksibel; matikan dulu di detail karyawan');

    const bulk = await request(app)
      .post('/api/shifts/bulk')
      .set(auth(hrToken))
      .send({ shifts: [{ ...shift, employeeId: budi.id }, shift] });
    expect(bulk.status).toBe(422);
    expect(await prisma.shiftSchedule.count()).toBe(0);
  });

  it('karyawan yang sudah keluar tidak bisa dijadwalkan', async () => {
    await prisma.employee.update({ where: { id: sari.id }, data: { status: 'resign' } });

    const satu = await request(app)
      .post('/api/shifts')
      .set(auth(hrToken))
      .send({ employeeId: sari.id, date: hari(1), startTime: '08:00', endTime: '16:00' });
    expect(satu.status).toBe(422);

    const res = await tetapkan({ employeeIds: [sari.id], templateId: pagiId, startDate: hari(1), durasi: 'minggu', weekdays: SEN_JUM });
    expect(res.body.results[0].error).toBe('Karyawan sudah tidak aktif');
  });
});

describe('Kait karyawan keluar dan hari libur', () => {
  it('karyawan dinonaktifkan: penugasan berakhir hari ini dan jadwal sesudahnya dihapus', async () => {
    const res = await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(-3), durasi: 'seterusnya', weekdays: SEMUA_HARI });
    const id = res.body.results[0].assignmentId as string;
    const koreksi = await barisPada(budi.id, hari(5));
    await prisma.shiftSchedule.update({ where: { id: koreksi.id }, data: { isOverride: true } });

    const nonaktif = await request(app)
      .patch(`/api/employees/${budi.id}/deactivate`)
      .set(auth(hrToken))
      .send({ status: 'resign', reason: 'Pindah kota' });
    expectStatus(nonaktif, 200);

    const penugasan = await prisma.shiftAssignment.findUniqueOrThrow({ where: { id } });
    expect(penugasan.endDate?.toISOString().slice(0, 10)).toBe(hari(0));
    const tanggal = await tanggalJadwal(budi.id);
    expect(tanggal).toEqual([hari(-3), hari(-2), hari(-1), hari(0), hari(5)]);

    // Perpanjangan tidak menghidupkannya kembali.
    expect((await perpanjangSemua()).dibuat).toBe(0);
  });

  it('status keluar lewat penyuntingan biasa juga mengakhiri penugasan', async () => {
    const res = await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(0), durasi: 'seterusnya', weekdays: SEMUA_HARI });
    const id = res.body.results[0].assignmentId as string;

    expectStatus(await request(app).put(`/api/employees/${budi.id}`).set(auth(hrToken)).send({ status: 'terminated' }), 200);

    expect((await prisma.shiftAssignment.findUniqueOrThrow({ where: { id } })).endDate?.toISOString().slice(0, 10)).toBe(hari(0));
    expect(await tanggalJadwal(budi.id)).toEqual([hari(0)]);
  });

  it('libur baru menghapus tanggal itu dari penugasan yang melewati libur; dihapus lagi memulihkannya', async () => {
    const senin = seninDari(hari(3));
    const rabu = geser(senin, 2);
    await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(0), durasi: 'seterusnya', weekdays: SEN_JUM, skipPublicHolidays: true });
    await tetapkan({ employeeIds: [sari.id], templateId: pagiId, startDate: hari(0), durasi: 'seterusnya', weekdays: SEN_JUM });

    const libur = await request(app).post('/api/holidays').set(auth(hrToken)).send({ date: rabu, name: 'Libur Uji' });

    expectStatus(libur, 201);
    expect(libur.body.shiftsRemoved).toBe(1);
    expect(await prisma.shiftSchedule.count({ where: { employeeId: budi.id, date: tgl(rabu) } })).toBe(0);
    expect(await prisma.shiftSchedule.count({ where: { employeeId: sari.id, date: tgl(rabu) } })).toBe(1);

    const hapus = await request(app).delete(`/api/holidays/${libur.body.id}`).set(auth(hrToken));

    expectStatus(hapus, 200);
    expect(hapus.body.shiftsRestored).toBe(1);
    expect(await prisma.shiftSchedule.count({ where: { employeeId: budi.id, date: tgl(rabu) } })).toBe(1);
  });
});

describe('Baris hasil penugasan yang dikoreksi manual', () => {
  it('perubahan jam atau tanggal menandainya override; status atau catatan tidak', async () => {
    await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(1), durasi: 'minggu', weekdays: SEMUA_HARI });
    const a = await barisPada(budi.id, hari(2));
    const b = await barisPada(budi.id, hari(3));

    const jam = await request(app).put(`/api/shifts/${a.id}`).set(auth(hrToken)).send({ startTime: '08:00' });
    expectStatus(jam, 200);
    expect(jam.body.isOverride).toBe(true);

    const catatan = await request(app).put(`/api/shifts/${b.id}`).set(auth(hrToken)).send({ notes: 'Bawa seragam' });
    expect(catatan.body.isOverride).toBe(false);

    // Jam jenis shift berubah: yang dikoreksi tetap, yang lain ikut.
    const ubah = await request(app).put(`/api/shifts/templates/${pagiId}`).set(auth(hrToken)).send({ startTime: '06:00', endTime: '14:00' });
    expectStatus(ubah, 200);
    expect((await prisma.shiftSchedule.findUniqueOrThrow({ where: { id: a.id } })).startTime).toBe('08:00');
    expect((await prisma.shiftSchedule.findUniqueOrThrow({ where: { id: b.id } })).startTime).toBe('06:00');
  });

  it('memindahkan baris ke tanggal yang sudah berisi baris penugasan yang sama dijawab 409, bukan 500', async () => {
    await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(1), durasi: 'minggu', weekdays: SEMUA_HARI });
    const a = await barisPada(budi.id, hari(2));

    // Tidak bertabrakan waktu dengan Pagi di hari ke-3, tapi satu penugasan
    // hanya boleh punya satu baris per tanggal.
    const res = await request(app)
      .put(`/api/shifts/${a.id}`)
      .set(auth(hrToken))
      .send({ date: hari(3), startTime: '16:00', endTime: '20:00', breakDuration: 0 });

    expect(res.status).toBe(409);
    expect((await prisma.shiftSchedule.findUniqueOrThrow({ where: { id: a.id } })).date.toISOString().slice(0, 10)).toBe(hari(2));
  });
});

describe('GET /api/shifts/me dan rekap', () => {
  it('tidak mengirim shift yang dibatalkan dan menyertakan flexibleHours', async () => {
    const jadwal = (iso: string, status: string) =>
      prisma.shiftSchedule.create({
        data: { id: generateULID(), employeeId: budi.id, date: tgl(iso), startTime: '08:00', endTime: '16:00', status },
      });
    await jadwal(hari(1), 'confirmed');
    await jadwal(hari(2), 'cancelled');
    await jadwal(hari(3), 'tentative');

    const res = await request(app)
      .get(`/api/shifts/me?startDate=${hari(0)}&endDate=${hari(14)}`)
      .set(auth(await login(app, 'budi@resto.id')));

    expectStatus(res, 200);
    expect(res.body.data.map((s: { status: string }) => s.status)).toEqual(['confirmed', 'tentative']);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.flexibleHours).toBe(false);
  });

  it('/me ikut menerbitkan baris penugasan sampai tanggal akhir permintaan', async () => {
    await tetapkan({ employeeIds: [budi.id], templateId: pagiId, startDate: hari(0), durasi: 'seterusnya', weekdays: SEMUA_HARI });

    const res = await request(app)
      .get(`/api/shifts/me?startDate=${hari(70)}&endDate=${hari(76)}`)
      .set(auth(await login(app, 'budi@resto.id')));

    expect(res.body.data).toHaveLength(7);
  });

  it('rekap menandai karyawan fleksibel tanpa peringatan dan tanpa "belum disusun"', async () => {
    await prisma.employee.update({ where: { id: sari.id }, data: { flexibleHours: true } });
    const bulan = hari(0).slice(0, 7);

    const res = await request(app).get(`/api/shifts/rekap?month=${bulan}`).set(auth(hrToken));

    expectStatus(res, 200);
    const s = res.body.data.find((k: { id: string }) => k.id === sari.id);
    const b = res.body.data.find((k: { id: string }) => k.id === budi.id);
    expect(s).toMatchObject({ flexibleHours: true, belumDisusun: 0, kurangLibur: false, beruntunLewatBatas: false });
    expect(b.flexibleHours).toBe(false);
    expect(b.belumDisusun).toBeGreaterThan(0);
  });
});

describe('Validasi tanggal kalender', () => {
  it.each(['2026-02-31', '2026-02-29', '2026-13-01', '2026-04-31'])('menolak tanggal mustahil %s', async (date) => {
    const res = await request(app)
      .post('/api/shifts')
      .set(auth(hrToken))
      .send({ employeeId: budi.id, date, startTime: '08:00', endTime: '16:00' });
    expect(res.status).toBe(400);
  });

  it('menerima 29 Februari tahun kabisat', async () => {
    const res = await request(app)
      .post('/api/shifts')
      .set(auth(hrToken))
      .send({ employeeId: budi.id, date: '2028-02-29', startTime: '08:00', endTime: '16:00' });
    expectStatus(res, 201);
  });
});
