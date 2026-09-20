import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee, makeDepartment, makeLeaveType, makeLeaveBalance } from './helpers/db';
import { login, auth, expectStatus } from './helpers/api';
import { bikinApp } from './helpers/app';
import { generateULID } from '../src/utils/generateULID';

const app = bikinApp();

let hrToken: string;
let kantor: { id: string };
let hotel: { id: string };
let budi: { id: string };   // kantor, Senin–Sabtu
let sari: { id: string };   // hotel, shift
let tahunan: { id: string };
let sakit: { id: string };

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');

  kantor = await makeDepartment('Kantor Pusat');
  hotel = await makeDepartment('Front Office Hotel');
  const shift = await prisma.workPattern.create({
    data: { id: generateULID(), code: 'shift_hotel', name: 'Shift Hotel', type: 'shift', workingWeekdays: [], observesPublicHolidays: false },
  });
  await prisma.department.update({ where: { id: hotel.id }, data: { workPatternId: shift.id } });

  budi = await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1', departmentId: kantor.id });
  sari = await makeEmployee({ email: 'sari@resto.id', nik: 'EMP-2', departmentId: hotel.id });

  tahunan = await prisma.leaveType.create({
    data: { id: generateULID(), code: 'annual', name: 'Cuti Tahunan', defaultQuotaDays: 12, absorbsCollectiveLeave: true },
  });
  sakit = await makeLeaveType({ code: 'sick', name: 'Cuti Sakit' });
});

const buatLibur = (tanggal: string, cutiBersama: boolean, nama = 'Libur Uji') =>
  request(app).post('/api/holidays').set(auth(hrToken)).send({ date: tanggal, name: nama, isCollectiveLeave: cutiBersama });

const saldo = async (employeeId: string, leaveTypeId: string) =>
  prisma.leaveBalance.findUniqueOrThrow({ where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year: 2026 } } });

describe('Cuti bersama memotong saldo cuti tahunan', () => {
  it('memotong satu hari dari karyawan kantor saat cuti bersama ditetapkan', async () => {
    await makeLeaveBalance({ employeeId: budi.id, leaveTypeId: tahunan.id, year: 2026, entitledDays: 12 });

    const res = await buatLibur('2026-03-30', true, 'Cuti Bersama Nyepi');
    expectStatus(res, 201);
    expect(res.body.collectiveLeave.deducted).toBe(1);

    const s = await saldo(budi.id, tahunan.id);
    expect(s.collectiveLeaveDays.toNumber()).toBe(1);
    // usedDays tidak disentuh: itu akumulasi cuti yang benar-benar diajukan.
    expect(s.usedDays.toNumber()).toBe(0);

    const dto = await request(app).get(`/api/employees/${budi.id}/leave-balances?year=2026`).set(auth(hrToken));
    expect(dto.body.data[0].collectiveLeaveDays).toBe(1);
    expect(dto.body.data[0].remainingDays).toBe(11);
  });

  it('libur nasional biasa tidak memotong apa pun', async () => {
    await makeLeaveBalance({ employeeId: budi.id, leaveTypeId: tahunan.id, year: 2026 });

    const res = await buatLibur('2026-08-17', false, 'HUT RI');
    expectStatus(res, 201);
    expect(res.body.collectiveLeave.deducted).toBe(0);
    expect((await saldo(budi.id, tahunan.id)).collectiveLeaveDays.toNumber()).toBe(0);
  });

  it('TIDAK memotong karyawan shift — mereka bekerja di hari itu', async () => {
    // Staf hotel bekerja menurut roster, termasuk saat cuti bersama.
    // Memotong cuti mereka untuk hari yang justru mereka kerjakan adalah
    // kesalahan yang paling sering dikeluhkan ke HR.
    await makeLeaveBalance({ employeeId: budi.id, leaveTypeId: tahunan.id, year: 2026 });
    await makeLeaveBalance({ employeeId: sari.id, leaveTypeId: tahunan.id, year: 2026 });

    const res = await buatLibur('2026-03-30', true);
    expect(res.body.collectiveLeave).toMatchObject({ deducted: 1, skippedShift: 1 });
    expect((await saldo(sari.id, tahunan.id)).collectiveLeaveDays.toNumber()).toBe(0);
  });

  it('hanya memotong jenis cuti yang menyerap cuti bersama', async () => {
    await makeLeaveBalance({ employeeId: budi.id, leaveTypeId: tahunan.id, year: 2026 });
    await makeLeaveBalance({ employeeId: budi.id, leaveTypeId: sakit.id, year: 2026 });

    await buatLibur('2026-03-30', true);

    expect((await saldo(budi.id, sakit.id)).collectiveLeaveDays.toNumber()).toBe(0);
  });

  it('saldo yang dibuat belakangan ikut menanggung cuti bersama yang sudah ada', async () => {
    // Karyawan yang saldonya terlambat diisi tidak boleh justru dapat kuota lebih.
    await buatLibur('2026-03-30', true);
    await buatLibur('2026-12-24', true);

    const res = await request(app).post('/api/leave-balances').set(auth(hrToken))
      .send({ employeeId: budi.id, leaveTypeId: tahunan.id, year: 2026, entitledDays: 12 });

    expectStatus(res, 200);
    expect(res.body.collectiveLeaveDays).toBe(2);
    expect(res.body.remainingDays).toBe(10);
  });

  it('memperbarui saldo yang sudah ada tidak memotong dua kali', async () => {
    await makeLeaveBalance({ employeeId: budi.id, leaveTypeId: tahunan.id, year: 2026 });
    await buatLibur('2026-03-30', true);

    const res = await request(app).post('/api/leave-balances').set(auth(hrToken))
      .send({ employeeId: budi.id, leaveTypeId: tahunan.id, year: 2026, entitledDays: 14 });

    expect(res.body.entitledDays).toBe(14);
    expect(res.body.collectiveLeaveDays).toBe(1);
  });

  it('menghapus hari libur memulihkan saldo', async () => {
    await makeLeaveBalance({ employeeId: budi.id, leaveTypeId: tahunan.id, year: 2026 });
    const libur = await buatLibur('2026-03-30', true);

    const hapus = await request(app).delete(`/api/holidays/${libur.body.id}`).set(auth(hrToken));
    expectStatus(hapus, 200);
    expect(hapus.body.restoredBalances).toBe(1);

    expect((await saldo(budi.id, tahunan.id)).collectiveLeaveDays.toNumber()).toBe(0);
    expect(await prisma.collectiveLeaveDeduction.count()).toBe(0);
  });

  it('kalender setahun sekaligus memotong tiap hari cuti bersama', async () => {
    await makeLeaveBalance({ employeeId: budi.id, leaveTypeId: tahunan.id, year: 2026 });

    const res = await request(app).post('/api/holidays/bulk').set(auth(hrToken)).send({
      holidays: [
        { date: '2026-01-01', name: 'Tahun Baru', isCollectiveLeave: false },
        { date: '2026-03-30', name: 'Cuti Bersama Nyepi', isCollectiveLeave: true },
        { date: '2026-12-24', name: 'Cuti Bersama Natal', isCollectiveLeave: true },
      ],
    });

    expectStatus(res, 201);
    expect(res.body.collectiveLeave.deducted).toBe(2);
    expect((await saldo(budi.id, tahunan.id)).collectiveLeaveDays.toNumber()).toBe(2);
  });

  it('pengajuan cuti memperhitungkan sisa setelah potongan cuti bersama', async () => {
    await makeLeaveBalance({ employeeId: budi.id, leaveTypeId: tahunan.id, year: 2026, entitledDays: 2 });
    await buatLibur('2026-03-30', true);
    const budiToken = await login(app, 'budi@resto.id');

    // Sisa tinggal 1 hari; mengajukan 2 hari kerja harus ditolak, dan angka
    // "tersedia" yang dilaporkan harus sudah memperhitungkan potongannya.
    const res = await request(app).post('/api/leaves').set(auth(budiToken))
      .send({ leaveTypeId: tahunan.id, startDate: '2026-06-01', endDate: '2026-06-02' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Saldo cuti tidak mencukupi');
    expect(res.body.details.tersedia).toBe(1);
  });
});
