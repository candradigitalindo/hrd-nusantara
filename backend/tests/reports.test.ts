import request from 'supertest';
import { Prisma, Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee, makeDepartment } from './helpers/db';
import { bikinApp } from './helpers/app';
import { login, auth } from './helpers/api';
import { generateULID } from '../src/utils/generateULID';

const app = bikinApp();

const AWAL = '2026-01-01';
const AKHIR = '2026-12-31';
const tgl = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

let hrToken: string;
let budiToken: string;
let dapurId: string;

const laporan = (jalur: string, token = hrToken) =>
  request(app).get(`/api/reports/${jalur}?startDate=${AWAL}&endDate=${AKHIR}`).set(auth(token));

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1' });
  budiToken = await login(app, 'budi@resto.id');
  dapurId = (await makeDepartment('Kitchen')).id;
});


/** Karyawan dengan tanggal masuk, dan boleh sudah keluar. */
const buatKaryawan = async (params: {
  nik: string;
  joinDate: string;
  exitDate?: string;
  exitReason?: string;
  exitType?: string;
  status?: string;
  departmentId?: string;
}) => {
  const k = await makeEmployee({
    nik: params.nik,
    email: `${params.nik.toLowerCase()}@resto.id`,
    status: params.status ?? 'active',
    departmentId: params.departmentId ?? null,
  });

  return prisma.employee.update({
    where: { id: k.id },
    data: {
      joinDate: tgl(params.joinDate),
      exitDate: params.exitDate ? tgl(params.exitDate) : null,
      exitReason: params.exitReason ?? null,
      exitType: params.exitType ?? null,
    },
  });
};

describe('Dasbor HR', () => {
  it('menghitung jumlah karyawan awal dan akhir periode', async () => {
    // Dua masuk di dalam periode, satu keluar di dalam periode.
    await buatKaryawan({ nik: 'A', joinDate: '2026-03-01' });
    await buatKaryawan({ nik: 'B', joinDate: '2026-05-01' });
    await buatKaryawan({
      nik: 'C',
      joinDate: '2025-01-01',
      exitDate: '2026-06-01',
      status: 'resign',
    });

    const res = await laporan('dashboard');

    expect(res.status).toBe(200);
    expect(res.body.movement.hires).toBe(2);
    expect(res.body.movement.exits).toBe(1);
  });

  it('menghitung mundur jumlah awal, bukan dari status saat ini', async () => {
    // HR dan Budi tanpa joinDate + satu masuk + satu keluar.
    await buatKaryawan({ nik: 'A', joinDate: '2026-03-01' });
    await buatKaryawan({
      nik: 'C',
      joinDate: '2025-01-01',
      exitDate: '2026-06-01',
      status: 'resign',
    });

    const res = await laporan('dashboard');

    // Akhir: HR, Budi, A = 3. Awal = 3 - 1 masuk + 1 keluar = 3.
    expect(res.body.headcount.end).toBe(3);
    expect(res.body.headcount.start).toBe(3);
  });

  it('menghitung tingkat perputaran dari rata-rata jumlah karyawan', async () => {
    for (const nik of ['A', 'B', 'C', 'D']) {
      await buatKaryawan({ nik, joinDate: '2025-01-01' });
    }
    await buatKaryawan({
      nik: 'E',
      joinDate: '2025-01-01',
      exitDate: '2026-06-01',
      status: 'resign',
    });

    const res = await laporan('dashboard');

    // Akhir 6 (HR, Budi, A-D), awal 7. Rata-rata 6,5. 1/6,5 = 15,38%.
    expect(res.body.movement.turnoverRate).toBeCloseTo(15.38, 1);
  });

  it('menyajikan sebaran masa kerja, bukan hanya rata-ratanya', async () => {
    await buatKaryawan({ nik: 'A', joinDate: '2026-09-01' });
    await buatKaryawan({ nik: 'B', joinDate: '2016-01-01' });

    const res = await laporan('dashboard');

    // Satu orang bertahan sepuluh tahun bisa menutupi yang baru masuk.
    expect(res.body.tenure.distribution).toBeDefined();
    const panjang = res.body.tenure.distribution.find(
      (b: { label: string }) => b.label === '> 5 tahun'
    );
    expect(panjang.count).toBe(1);
  });

  it('melaporkan berapa karyawan yang tanggal masuknya belum diisi', async () => {
    // HR dan Budi dibuat tanpa joinDate.
    const res = await laporan('dashboard');
    expect(res.body.tenure.unknownJoinDate).toBe(2);
  });

  it('menolak rentang tanggal terbalik', async () => {
    const res = await request(app)
      .get('/api/reports/dashboard?startDate=2026-12-31&endDate=2026-01-01')
      .set(auth(hrToken));

    expect(res.status).toBe(400);
  });

  it('manajer hanya melihat departemennya sendiri, apa pun filternya', async () => {
    const barId = (await makeDepartment('Bar')).id;
    await buatKaryawan({ nik: 'K-1', joinDate: '2025-01-01', departmentId: dapurId });
    await buatKaryawan({ nik: 'K-2', joinDate: '2025-01-01', departmentId: dapurId });
    await buatKaryawan({ nik: 'B-1', joinDate: '2025-01-01', departmentId: barId });
    await makeEmployee({ email: 'chef@resto.id', nik: 'MGR-1', role: Role.MANAGER, departmentId: dapurId });
    const chefToken = await login(app, 'chef@resto.id');

    const res = await request(app)
      .get(`/api/reports/dashboard?startDate=${AWAL}&endDate=${AKHIR}&departmentId=${barId}`)
      .set(auth(chefToken));
    expect(res.status).toBe(200);
    // Dua koki + chef sendiri; Bar tidak ikut walau diminta lewat filter.
    expect(res.body.headcount.end).toBe(3);

    const prod = await request(app)
      .get(`/api/reports/productivity?startDate=${AWAL}&endDate=${AKHIR}&departmentId=${barId}`)
      .set(auth(chefToken));
    expect(prod.status).toBe(200);
  });

  it('manajer tanpa departemen tidak melihat siapa pun', async () => {
    await buatKaryawan({ nik: 'K-1', joinDate: '2025-01-01', departmentId: dapurId });
    await makeEmployee({ email: 'lepas@resto.id', nik: 'MGR-2', role: Role.MANAGER });
    const res = await laporan('dashboard', await login(app, 'lepas@resto.id'));
    expect(res.status).toBe(200);
    expect(res.body.headcount.end).toBe(0);
  });

  it('karyawan biasa tidak boleh membuka dasbor', async () => {
    const res = await laporan('dashboard', budiToken);
    expect(res.status).toBe(403);
  });
});

describe('Analisis perputaran karyawan', () => {
  const siapkanKeluar = async () => {
    await buatKaryawan({
      nik: 'A',
      joinDate: '2025-01-01',
      exitDate: '2026-03-01',
      exitReason: 'Gaji kurang kompetitif',
      exitType: 'voluntary',
      status: 'resign',
      departmentId: dapurId,
    });
    await buatKaryawan({
      nik: 'B',
      joinDate: '2025-06-01',
      exitDate: '2026-04-01',
      exitReason: 'Gaji kurang kompetitif',
      exitType: 'voluntary',
      status: 'resign',
      departmentId: dapurId,
    });
    await buatKaryawan({
      nik: 'C',
      joinDate: '2024-01-01',
      exitDate: '2026-05-01',
      exitReason: 'Pelanggaran disiplin',
      exitType: 'involuntary',
      status: 'terminated',
    });
  };

  it('mengelompokkan berdasarkan alasan berhenti', async () => {
    await siapkanKeluar();
    const res = await laporan('turnover');

    expect(res.body.totalExits).toBe(3);
    // Yang penting bukan berapa banyak yang keluar, tapi mengapa.
    expect(res.body.byReason[0]).toEqual({ value: 'Gaji kurang kompetitif', count: 2 });
  });

  it('memisahkan mengundurkan diri dari diberhentikan', async () => {
    await siapkanKeluar();
    const res = await laporan('turnover');

    const sukarela = res.body.byType.find((t: { value: string }) => t.value === 'voluntary');
    expect(sukarela.count).toBe(2);
  });

  it('mengelompokkan berdasarkan departemen', async () => {
    await siapkanKeluar();
    const res = await laporan('turnover');

    expect(res.body.byDepartment[0]).toEqual({ value: 'Kitchen', count: 2 });
  });

  it('menghitung masa kerja saat berhenti', async () => {
    await siapkanKeluar();
    const res = await laporan('turnover');

    expect(res.body.tenureAtExit.averageDays).toBeGreaterThan(0);
    expect(res.body.tenureAtExit.distribution).toBeDefined();
  });

  it('hanya menghitung yang keluar di dalam periode', async () => {
    await buatKaryawan({
      nik: 'LAMA',
      joinDate: '2020-01-01',
      exitDate: '2024-06-01',
      status: 'resign',
    });

    const res = await laporan('turnover');
    expect(res.body.totalExits).toBe(0);
  });
});

describe('Analisis biaya SDM', () => {
  const siapkanBiaya = async () => {
    const budi = await prisma.employee.findFirstOrThrow({ where: { nik: 'EMP-1' } });

    const run = await prisma.payrollRun.create({
      data: {
        id: generateULID(),
        code: '2026-03',
        name: 'Maret',
        periodStart: tgl('2026-03-01'),
        periodEnd: tgl('2026-03-31'),
        status: 'approved',
      },
    });

    await prisma.payroll.create({
      data: {
        id: generateULID(),
        employeeId: budi.id,
        payrollRunId: run.id,
        payPeriodStart: tgl('2026-03-01'),
        payPeriodEnd: tgl('2026-03-31'),
        salaryType: 'monthly',
        baseAmount: new Prisma.Decimal(5_000_000),
        basicSalary: new Prisma.Decimal(5_000_000),
        grossSalary: new Prisma.Decimal(6_000_000),
        totalAllowances: new Prisma.Decimal(1_000_000),
        overtimePay: new Prisma.Decimal(0),
        totalDeductions: new Prisma.Decimal(0),
        netSalary: new Prisma.Decimal(6_000_000),
        status: 'approved',
      },
    });

    const program = await prisma.trainingProgram.create({
      data: { id: generateULID(), code: 'HYG', name: 'Hygiene' },
    });
    await prisma.trainingSession.create({
      data: {
        id: generateULID(),
        programId: program.id,
        title: 'Batch 1',
        trainer: 'Chef',
        startDateTime: tgl('2026-04-01'),
        endDateTime: tgl('2026-04-02'),
        cost: new Prisma.Decimal(3_000_000),
      },
    });

    const posisi = await prisma.position.create({
      data: { id: generateULID(), name: 'Waiter' },
    });
    const hr = await prisma.employee.findFirstOrThrow({ where: { nik: 'HR-1' } });
    await prisma.jobPosting.create({
      data: {
        id: generateULID(),
        title: 'Waiter',
        description: 'x',
        requirements: 'x',
        positionId: posisi.id,
        createdById: hr.id,
        postedDate: tgl('2026-02-01'),
        recruitmentCost: new Prisma.Decimal(1_000_000),
      },
    });
  };

  it('merinci biaya per pos beserta porsinya', async () => {
    await siapkanBiaya();
    const res = await laporan('costs');

    expect(res.body.costs.payroll).toBe(6_000_000);
    expect(res.body.costs.training).toBe(3_000_000);
    expect(res.body.costs.recruitment).toBe(1_000_000);
    expect(res.body.costs.total).toBe(10_000_000);
    expect(res.body.costs.shares.payroll).toBe(60);
  });

  it('mengabaikan batch penggajian yang belum disetujui', async () => {
    await siapkanBiaya();
    await prisma.payroll.updateMany({ data: { status: 'draft' } });

    const res = await laporan('costs');

    // Angka draft masih bisa berubah; memasukkannya membuat biaya bergoyang
    // setiap kali HR menghitung ulang.
    expect(res.body.costs.payroll).toBe(0);
  });

  it('mengembalikan null untuk biaya per rekrutan bila belum ada yang direkrut', async () => {
    await siapkanBiaya();
    const res = await laporan('costs');

    // Nol berarti "merekrut tanpa biaya"; yang benar adalah belum bisa dihitung.
    expect(res.body.hires).toBe(0);
    expect(res.body.costPerHire).toBeNull();
  });
});

describe('Laporan produktivitas', () => {
  it('menghitung persentase terhadap shift terjadwal', async () => {
    const budi = await prisma.employee.findFirstOrThrow({ where: { nik: 'EMP-1' } });

    for (let i = 1; i <= 4; i += 1) {
      await prisma.shiftSchedule.create({
        data: {
          id: generateULID(),
          employeeId: budi.id,
          date: tgl(`2026-03-0${i}`),
          startTime: '08:00',
          endTime: '16:00',
          breakDuration: new Prisma.Decimal(0),
        },
      });
    }

    // Hadir 3 kali, satu di antaranya terlambat.
    for (const [hari, status] of [['01', 'present'], ['02', 'late'], ['03', 'present']] as const) {
      await prisma.attendance.create({
        data: {
          id: generateULID(),
          employeeId: budi.id,
          checkInTime: new Date(`2026-03-${hari}T01:00:00.000Z`),
          checkOutTime: new Date(`2026-03-${hari}T09:00:00.000Z`),
          checkInMethod: 'gps',
          workedMinutes: 480,
          status,
        },
      });
    }

    const res = await laporan('productivity');

    expect(res.body.scheduledShifts).toBe(4);
    expect(res.body.attendanceCount).toBe(3);
    // 1 dari 4 shift = 25%, bukan 1 dari 3 presensi = 33%.
    expect(res.body.latePercentage).toBe(25);
    expect(res.body.absencePercentage).toBe(25);
    expect(res.body.averageWorkedHours).toBe(8);
  });

  it('bisa diakses manajer sebagai alat kerja operasional', async () => {
    await makeEmployee({ email: 'mgr@resto.id', nik: 'MGR-1', role: Role.MANAGER });
    const mgrToken = await login(app, 'mgr@resto.id');

    const res = await laporan('productivity', mgrToken);
    expect(res.status).toBe(200);
  });
});

describe('Data mentah', () => {
  it('tidak pernah menyertakan password', async () => {
    const res = await request(app)
      .get('/api/reports/raw-data?dataset=employees')
      .set(auth(hrToken));

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it('menolak kumpulan data di luar daftar', async () => {
    // Endpoint yang menerima kueri bebas dari klien adalah jalan masuk
    // untuk membaca tabel yang seharusnya tidak boleh dibaca.
    const res = await request(app)
      .get('/api/reports/raw-data?dataset=Employee')
      .set(auth(hrToken));

    expect(res.status).toBe(400);
  });

  it('menyaring per departemen', async () => {
    await buatKaryawan({ nik: 'A', joinDate: '2026-01-05', departmentId: dapurId });
    await buatKaryawan({ nik: 'B', joinDate: '2026-01-05' });

    const res = await request(app)
      .get(`/api/reports/raw-data?dataset=employees&departmentId=${dapurId}`)
      .set(auth(hrToken));

    expect(res.body.pagination.total).toBe(1);
  });

  it('karyawan biasa tidak boleh mengambil data mentah', async () => {
    const res = await request(app)
      .get('/api/reports/raw-data?dataset=payrolls')
      .set(auth(budiToken));

    expect(res.status).toBe(403);
  });
});

describe('Integrasi: menonaktifkan karyawan mengisi data perputaran', () => {
  it('mencatat tanggal, alasan, dan jenis berhenti', async () => {
    const siti = await makeEmployee({ email: 'siti@resto.id', nik: 'EMP-2' });

    await request(app)
      .patch(`/api/employees/${siti.id}/deactivate`)
      .set(auth(hrToken))
      .send({ status: 'resign', reason: 'Pindah ke luar kota' });

    const tersimpan = await prisma.employee.findUniqueOrThrow({ where: { id: siti.id } });
    expect(tersimpan.exitDate).not.toBeNull();
    expect(tersimpan.exitReason).toBe('Pindah ke luar kota');
    expect(tersimpan.exitType).toBe('voluntary');

    const res = await laporan('turnover');
    expect(res.body.byReason[0]).toEqual({ value: 'Pindah ke luar kota', count: 1 });
  });

  it('menandai pemberhentian sebagai involuntary', async () => {
    const siti = await makeEmployee({ email: 'siti@resto.id', nik: 'EMP-2' });

    await request(app)
      .patch(`/api/employees/${siti.id}/deactivate`)
      .set(auth(hrToken))
      .send({ status: 'terminated', reason: 'Pelanggaran berat' });

    const tersimpan = await prisma.employee.findUniqueOrThrow({ where: { id: siti.id } });
    expect(tersimpan.exitType).toBe('involuntary');
  });
});
