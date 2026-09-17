import request from 'supertest';
import { Prisma, Role } from '@prisma/client';
import { createApp } from '../src/app';
import {
  prisma,
  resetDatabase,
  makeEmployee,
  makeLeaveType,
  makeLeaveBalance,
} from './helpers/db';
import { login, auth, expectStatus } from './helpers/api';
import { generateULID } from '../src/utils/generateULID';

const app = createApp();

const PERIODE = { periodStart: '2026-09-01', periodEnd: '2026-09-30' };

let hrToken: string;
let budiToken: string;
let budi: { id: string };

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  budi = await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1' });
  budiToken = await login(app, 'budi@resto.id');
});


const tetapkanGaji = async (amount = 5_000_000, salaryType = 'monthly', from = '2026-01-01') => {
  const res = await request(app)
    .post(`/api/employees/${budi.id}/salary`)
    .set(auth(hrToken))
    .send({ salaryType, baseAmount: amount, effectiveFrom: from });
  // Penyiapan yang gagal harus ketahuan di sini, bukan beberapa baris kemudian.
  expectStatus(res, 201);
  return res;
};

const buatBatch = (code = '2026-09') =>
  request(app)
    .post('/api/payroll-runs')
    .set(auth(hrToken))
    .send({ code, name: `Penggajian ${code}`, ...PERIODE });

const hitung = (runId: string, body: Record<string, unknown> = {}) =>
  request(app).post(`/api/payroll-runs/${runId}/calculate`).set(auth(hrToken)).send(body);

describe('Struktur gaji karyawan', () => {
  it('menetapkan gaji dan menutup masa berlaku yang lama', async () => {
    await tetapkanGaji(5_000_000, 'monthly', '2026-01-01');
    const naik = await tetapkanGaji(6_000_000, 'monthly', '2026-07-01');

    expect(naik.status).toBe(201);

    const riwayat = await request(app)
      .get(`/api/employees/${budi.id}/salary`)
      .set(auth(hrToken));

    expect(riwayat.body.salaries).toHaveLength(2);
    // Riwayat kenaikan harus tetap terbaca, bukan ditimpa.
    const lama = riwayat.body.salaries.find((s: { baseAmount: number }) => s.baseAmount === 5_000_000);
    expect(lama.effectiveTo).not.toBeNull();
  });

  it('memakai gaji yang berlaku pada periodenya, bukan yang terbaru', async () => {
    await tetapkanGaji(5_000_000, 'monthly', '2026-01-01');
    await tetapkanGaji(9_000_000, 'monthly', '2026-12-01');

    const run = await buatBatch();
    await hitung(run.body.id);

    const slip = await request(app)
      .get(`/api/payrolls?employeeId=${budi.id}`)
      .set(auth(hrToken));

    // Periode September memakai gaji lama, bukan kenaikan Desember.
    expect(slip.body.data[0].baseAmount).toBe(5_000_000);
  });

  it('karyawan boleh melihat riwayat gajinya sendiri', async () => {
    await tetapkanGaji();
    const res = await request(app)
      .get(`/api/employees/${budi.id}/salary`)
      .set(auth(budiToken));

    expect(res.status).toBe(200);
  });

  it('karyawan tidak boleh melihat gaji orang lain', async () => {
    const siti = await makeEmployee({ email: 'siti@resto.id', nik: 'EMP-2' });

    const res = await request(app)
      .get(`/api/employees/${siti.id}/salary`)
      .set(auth(budiToken));

    expect(res.status).toBe(403);
  });

  it('karyawan tidak boleh menetapkan gajinya sendiri', async () => {
    const res = await request(app)
      .post(`/api/employees/${budi.id}/salary`)
      .set(auth(budiToken))
      .send({ salaryType: 'monthly', baseAmount: 99_000_000, effectiveFrom: '2026-01-01' });

    expect(res.status).toBe(403);
  });
});

describe('Komponen gaji', () => {
  it('menolak komponen persentase tanpa angka persen', async () => {
    const res = await request(app)
      .post('/api/salary-components')
      .set(auth(hrToken))
      .send({ code: 'RUSAK', name: 'Rusak', type: 'deduction', calculation: 'percentage' });

    // Kalau lolos, komponennya diam-diam menghasilkan nol dan baru
    // ketahuan saat slip gaji keluar salah.
    expect(res.status).toBe(400);
  });

  it('menolak komponen nominal tetap tanpa nominal', async () => {
    const res = await request(app)
      .post('/api/salary-components')
      .set(auth(hrToken))
      .send({ code: 'RUSAK2', name: 'Rusak', type: 'allowance', calculation: 'fixed' });

    expect(res.status).toBe(400);
  });

  it('menolak kode komponen yang sudah dipakai', async () => {
    const body = {
      code: 'TRANSPORT',
      name: 'Transport',
      type: 'allowance',
      calculation: 'fixed',
      defaultAmount: 500_000,
    };
    await request(app).post('/api/salary-components').set(auth(hrToken)).send(body);

    const res = await request(app).post('/api/salary-components').set(auth(hrToken)).send(body);
    expect(res.status).toBe(409);
  });

  it('karyawan biasa tidak boleh melihat daftar komponen gaji', async () => {
    const res = await request(app).get('/api/salary-components').set(auth(budiToken));
    expect(res.status).toBe(403);
  });
});

describe('Menjalankan penggajian', () => {
  it('menghitung slip dengan rincian per komponen', async () => {
    await tetapkanGaji();

    const komponen = await request(app)
      .post('/api/salary-components')
      .set(auth(hrToken))
      .send({
        code: 'TRANSPORT',
        name: 'Tunjangan Transport',
        type: 'allowance',
        calculation: 'fixed',
        defaultAmount: 600_000,
      });

    await request(app)
      .post(`/api/employees/${budi.id}/salary-components`)
      .set(auth(hrToken))
      .send({ componentId: komponen.body.id, effectiveFrom: '2026-01-01' });

    const run = await buatBatch();
    const hasil = await hitung(run.body.id);

    expect(hasil.status).toBe(200);
    expect(hasil.body.calculated).toBe(1);

    const slip = await request(app)
      .get(`/api/payrolls?employeeId=${budi.id}`)
      .set(auth(hrToken));

    const p = slip.body.data[0];
    expect(p.basicSalary).toBe(5_000_000);
    expect(p.totalAllowances).toBe(600_000);
    expect(p.grossSalary).toBe(5_600_000);
    expect(p.netSalary).toBe(5_600_000);
    // Rincian per baris, bukan gumpalan JSON.
    expect(p.items.map((i: { code: string }) => i.code)).toEqual(['BASIC', 'TRANSPORT']);
  });

  it('melewati karyawan yang belum punya struktur gaji tanpa menggagalkan batch', async () => {
    await tetapkanGaji();
    await makeEmployee({ email: 'siti@resto.id', nik: 'EMP-2' });

    const run = await buatBatch();
    const hasil = await hitung(run.body.id);

    expect(hasil.body.calculated).toBe(1);
    // HR bisa melengkapi datanya lalu menghitung ulang.
    expect(hasil.body.skipped).toHaveLength(2); // HR dan Siti
    expect(hasil.body.skipped[0].reason).toContain('belum ditetapkan');
  });

  it('bisa dihitung ulang tanpa menumpuk slip ganda', async () => {
    await tetapkanGaji();
    const run = await buatBatch();

    await hitung(run.body.id);
    await hitung(run.body.id);

    expect(await prisma.payroll.count({ where: { payrollRunId: run.body.id } })).toBe(1);
  });

  it('menolak hitung ulang setelah batch disetujui', async () => {
    await tetapkanGaji();
    const run = await buatBatch();
    await hitung(run.body.id);
    await request(app)
      .patch(`/api/payroll-runs/${run.body.id}/decision`)
      .set(auth(hrToken))
      .send({ approved: true });

    const res = await hitung(run.body.id);
    expect(res.status).toBe(409);
  });

  it('menolak kode batch yang sudah dipakai', async () => {
    await buatBatch('2026-09');
    const res = await buatBatch('2026-09');
    expect(res.status).toBe(409);
  });
});

describe('Integrasi dengan presensi dan cuti', () => {
  it('membayar lembur yang sudah disetujui saja', async () => {
    await tetapkanGaji();

    // Dua presensi berlembur; hanya satu yang disetujui.
    for (const [jam, disetujui] of [[2, true], [3, false]] as const) {
      await prisma.attendance.create({
        data: {
          id: generateULID(),
          employeeId: budi.id,
          checkInTime: new Date('2026-09-10T01:00:00.000Z'),
          checkOutTime: new Date('2026-09-10T12:00:00.000Z'),
          checkInMethod: 'gps',
          workedMinutes: 480,
          overtimeHours: new Prisma.Decimal(jam),
          overtimeApproved: disetujui,
          status: 'present',
        },
      });
    }

    const run = await buatBatch();
    await hitung(run.body.id);

    const slip = await request(app)
      .get(`/api/payrolls?employeeId=${budi.id}`)
      .set(auth(hrToken));

    const p = slip.body.data[0];
    // Hanya 2 jam yang disetujui yang dibayar.
    expect(p.overtimeHours).toBe(2);
    expect(p.overtimePay).toBeGreaterThan(0);

    const barisLembur = p.items.find((i: { code: string }) => i.code === 'OVERTIME');
    expect(barisLembur.calculationNote).toContain('1/173');
  });

  it('memprorata gaji atas cuti tak berbayar yang disetujui', async () => {
    await tetapkanGaji();

    // 20 hari dijadwalkan, 2 hari cuti tak berbayar.
    for (let i = 1; i <= 20; i += 1) {
      await prisma.shiftSchedule.create({
        data: {
          id: generateULID(),
          employeeId: budi.id,
          date: new Date(`2026-09-${String(i).padStart(2, '0')}T00:00:00.000Z`),
          startTime: '08:00',
          endTime: '16:00',
          breakDuration: new Prisma.Decimal(0),
        },
      });
    }

    const tipe = await makeLeaveType({ code: 'unpaid', name: 'Cuti Tidak Dibayar' });
    await prisma.leaveType.update({ where: { id: tipe.id }, data: { isPaid: false } });
    await makeLeaveBalance({ employeeId: budi.id, leaveTypeId: tipe.id, year: 2026 });

    await prisma.leave.create({
      data: {
        id: generateULID(),
        employeeId: budi.id,
        leaveTypeId: tipe.id,
        startDate: new Date('2026-09-10T00:00:00.000Z'),
        endDate: new Date('2026-09-11T00:00:00.000Z'),
        totalDays: new Prisma.Decimal(2),
        status: 'approved',
      },
    });

    const run = await buatBatch();
    await hitung(run.body.id);

    const slip = await request(app)
      .get(`/api/payrolls?employeeId=${budi.id}`)
      .set(auth(hrToken));

    const p = slip.body.data[0];
    expect(p.unpaidLeaveDays).toBe(2);
    // 5.000.000 × 18/20.
    expect(p.basicSalary).toBe(4_500_000);
    expect(p.items[0].calculationNote).toContain('18/20');
  });

  it('cuti berbayar tidak memotong gaji', async () => {
    await tetapkanGaji();

    const tipe = await makeLeaveType({ code: 'annual', name: 'Cuti Tahunan' });
    await makeLeaveBalance({ employeeId: budi.id, leaveTypeId: tipe.id, year: 2026 });
    await prisma.leave.create({
      data: {
        id: generateULID(),
        employeeId: budi.id,
        leaveTypeId: tipe.id,
        startDate: new Date('2026-09-10T00:00:00.000Z'),
        endDate: new Date('2026-09-11T00:00:00.000Z'),
        totalDays: new Prisma.Decimal(2),
        status: 'approved',
      },
    });

    const run = await buatBatch();
    await hitung(run.body.id);

    const slip = await request(app)
      .get(`/api/payrolls?employeeId=${budi.id}`)
      .set(auth(hrToken));

    expect(slip.body.data[0].unpaidLeaveDays).toBe(0);
    expect(slip.body.data[0].basicSalary).toBe(5_000_000);
  });
});

describe('Akses slip gaji', () => {
  const siapkanSlip = async () => {
    await tetapkanGaji();
    const run = await buatBatch();
    await hitung(run.body.id);
    return run.body.id as string;
  };

  it('menyembunyikan slip yang belum final dari karyawan', async () => {
    await siapkanSlip();

    const res = await request(app).get('/api/payrolls/me').set(auth(budiToken));

    // Angka draft masih bisa berubah; menampilkannya hanya memicu pertanyaan
    // atas angka yang belum final.
    expect(res.body.pagination.total).toBe(0);
  });

  it('menampilkan slip setelah batch disetujui', async () => {
    const runId = await siapkanSlip();
    await request(app)
      .patch(`/api/payroll-runs/${runId}/decision`)
      .set(auth(hrToken))
      .send({ approved: true });

    const res = await request(app).get('/api/payrolls/me').set(auth(budiToken));

    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0].netSalary).toBe(5_000_000);
  });

  it('karyawan tidak boleh melihat daftar slip semua orang', async () => {
    await siapkanSlip();
    const res = await request(app).get('/api/payrolls').set(auth(budiToken));
    expect(res.status).toBe(403);
  });

  it('karyawan tidak boleh membuka slip orang lain', async () => {
    await siapkanSlip();
    const siti = await makeEmployee({ email: 'siti@resto.id', nik: 'EMP-2' });
    const sitiToken = await login(app, 'siti@resto.id');

    const slip = await request(app)
      .get(`/api/payrolls?employeeId=${budi.id}`)
      .set(auth(hrToken));

    const res = await request(app)
      .get(`/api/payrolls/${slip.body.data[0].id}`)
      .set(auth(sitiToken));

    expect(res.status).toBe(403);
    expect(siti.id).toBeTruthy();
  });

  it('manajer juga tidak diberi akses ke slip gaji anggota timnya', async () => {
    await siapkanSlip();
    await makeEmployee({ email: 'mgr@resto.id', nik: 'MGR-1', role: Role.MANAGER });
    const mgrToken = await login(app, 'mgr@resto.id');

    const res = await request(app).get('/api/payrolls').set(auth(mgrToken));
    expect(res.status).toBe(403);
  });
});

describe('Pratinjau perhitungan', () => {
  it('menghitung tanpa menyimpan apa pun', async () => {
    await tetapkanGaji();
    const run = await buatBatch();

    const res = await request(app)
      .get(`/api/payroll-runs/${run.body.id}/preview/${budi.id}`)
      .set(auth(hrToken));

    expect(res.status).toBe(200);
    expect(res.body.result.netSalary).toBe(5_000_000);
    expect(await prisma.payroll.count()).toBe(0);
  });

  it('memberi alasan jelas bila struktur gaji belum ada', async () => {
    const run = await buatBatch();

    const res = await request(app)
      .get(`/api/payroll-runs/${run.body.id}/preview/${budi.id}`)
      .set(auth(hrToken));

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('no_salary');
  });
});
