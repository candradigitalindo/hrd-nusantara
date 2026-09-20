// src/controllers/reportController.ts
import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  turnoverRate,
  tenureDays,
  bucketTenure,
  costPerHire,
  attendanceProductivity,
  summarizeCosts,
  countBy,
} from '../utils/analytics';
import { businessDayRange } from '../utils/shiftTime';
import { env } from '../config/env';
import type { PeriodQuery, RawDataQuery } from '../schemas/reportSchema';

const KELUAR = ['resign', 'terminated', 'inactive'];

const num = (d: Prisma.Decimal | null) => (d === null ? 0 : d.toNumber());

const periksaPeriode = (q: PeriodQuery, res: Response): boolean => {
  if (q.endDate.getTime() < q.startDate.getTime()) {
    res.status(400).json({ error: 'endDate tidak boleh lebih awal dari startDate' });
    return false;
  }
  return true;
};

const akhirEksklusif = (d: Date) => new Date(d.getTime() + 24 * 60 * 60 * 1000);

/**
 * Ringkasan untuk dasbor HR.
 *
 * Jumlah karyawan awal periode dihitung mundur dari keadaan sekarang: siapa
 * yang masuk setelah periode dimulai dikurangi, siapa yang keluar di dalam
 * periode ditambahkan kembali. Menghitung langsung dari status saat ini akan
 * keliru, karena status hanya menyimpan keadaan terakhir — bukan riwayatnya.
 */
/**
 * Manajer hanya melihat departemennya sendiri, apa pun filter yang dikirim.
 * Manajer tanpa departemen tidak melihat siapa pun — bukan seluruh perusahaan.
 */
const batasiDepartemenManajer = (query: PeriodQuery, actor: { role: Role; departmentId: string | null }) => {
  if (actor.role === Role.MANAGER) {
    query.departmentId = actor.departmentId ?? '__tanpa_departemen__';
  }
};

export const getDashboard = async (req: Request, res: Response) => {
  const query = req.query as unknown as PeriodQuery;
  if (!periksaPeriode(query, res)) return;
  batasiDepartemenManajer(query, req.user!);

  const sampai = akhirEksklusif(query.endDate);
  const deptFilter = query.departmentId ? { departmentId: query.departmentId } : {};

  const semua = await prisma.employee.findMany({
    where: deptFilter,
    select: {
      id: true,
      status: true,
      joinDate: true,
      exitDate: true,
      exitReason: true,
      exitType: true,
      departmentId: true,
      department: { select: { id: true, name: true } },
    },
  });

  const aktifSekarang = semua.filter((e) => !KELUAR.includes(e.status));

  const masukDalamPeriode = semua.filter(
    (e) => e.joinDate && e.joinDate >= query.startDate && e.joinDate < sampai
  );
  const keluarDalamPeriode = semua.filter(
    (e) => e.exitDate && e.exitDate >= query.startDate && e.exitDate < sampai
  );

  const headcountEnd = aktifSekarang.length;
  const headcountStart = headcountEnd - masukDalamPeriode.length + keluarDalamPeriode.length;

  const now = new Date();
  const masaKerja = aktifSekarang
    .map((e) => tenureDays(e.joinDate, null, now))
    .filter((v): v is number => v !== null);

  res.json({
    period: { startDate: query.startDate, endDate: query.endDate },
    headcount: {
      start: Math.max(0, headcountStart),
      end: headcountEnd,
      byDepartment: countBy(aktifSekarang, (e) => e.department?.name ?? null),
      byStatus: countBy(aktifSekarang, (e) => e.status),
    },
    movement: {
      hires: masukDalamPeriode.length,
      exits: keluarDalamPeriode.length,
      turnoverRate: turnoverRate({
        exits: keluarDalamPeriode.length,
        headcountStart: Math.max(0, headcountStart),
        headcountEnd,
      }),
    },
    tenure: {
      // Rata-rata disajikan bersama sebarannya: satu orang yang bertahan
      // sepuluh tahun bisa menutupi lima yang keluar dalam tiga bulan.
      averageDays:
        masaKerja.length === 0
          ? null
          : Math.round(masaKerja.reduce((s, v) => s + v, 0) / masaKerja.length),
      distribution: bucketTenure(masaKerja),
      unknownJoinDate: aktifSekarang.filter((e) => e.joinDate === null).length,
    },
  });
};

/** Analisis perputaran karyawan: berapa banyak, dan yang lebih penting, mengapa. */
export const getTurnoverAnalysis = async (req: Request, res: Response) => {
  const query = req.query as unknown as PeriodQuery;
  if (!periksaPeriode(query, res)) return;

  const sampai = akhirEksklusif(query.endDate);

  const keluar = await prisma.employee.findMany({
    where: {
      exitDate: { gte: query.startDate, lt: sampai },
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    },
    select: {
      id: true,
      nik: true,
      name: true,
      joinDate: true,
      exitDate: true,
      exitReason: true,
      exitType: true,
      department: { select: { id: true, name: true } },
      position: { select: { id: true, name: true } },
    },
    orderBy: { exitDate: 'desc' },
  });

  const masaKerja = keluar
    .map((e) => tenureDays(e.joinDate, e.exitDate, new Date()))
    .filter((v): v is number => v !== null);

  res.json({
    period: { startDate: query.startDate, endDate: query.endDate },
    totalExits: keluar.length,
    byReason: countBy(keluar, (e) => e.exitReason),
    byType: countBy(keluar, (e) => e.exitType),
    byDepartment: countBy(keluar, (e) => e.department?.name ?? null),
    byPosition: countBy(keluar, (e) => e.position?.name ?? null),
    tenureAtExit: {
      averageDays:
        masaKerja.length === 0
          ? null
          : Math.round(masaKerja.reduce((s, v) => s + v, 0) / masaKerja.length),
      distribution: bucketTenure(masaKerja),
    },
    exits: keluar,
  });
};

/**
 * Analisis biaya SDM.
 *
 * Hanya batch penggajian yang sudah disetujui yang dihitung: batch draft masih
 * bisa berubah, dan memasukkannya membuat angka biaya bergoyang setiap kali
 * HR menghitung ulang.
 */
export const getCostAnalysis = async (req: Request, res: Response) => {
  const query = req.query as unknown as PeriodQuery;
  if (!periksaPeriode(query, res)) return;

  const sampai = akhirEksklusif(query.endDate);

  const [payrolls, sesiPelatihan, lowongan, diterima] = await Promise.all([
    prisma.payroll.findMany({
      where: {
        payPeriodStart: { gte: query.startDate, lt: sampai },
        status: { in: ['approved', 'paid'] },
        ...(query.departmentId ? { employee: { departmentId: query.departmentId } } : {}),
      },
      select: { netSalary: true, grossSalary: true, totalAllowances: true, overtimePay: true },
    }),
    prisma.trainingSession.findMany({
      where: { startDateTime: { gte: query.startDate, lt: sampai }, status: { not: 'cancelled' } },
      select: { cost: true },
    }),
    prisma.jobPosting.findMany({
      where: { postedDate: { gte: query.startDate, lt: sampai } },
      select: { recruitmentCost: true },
    }),
    prisma.candidate.count({
      where: {
        status: 'hired',
        stageHistory: { some: { toStage: 'hired', createdAt: { gte: query.startDate, lt: sampai } } },
      },
    }),
  ]);

  const biayaPayroll = payrolls.reduce((s, p) => s + num(p.grossSalary), 0);
  const biayaPelatihan = sesiPelatihan.reduce((s, t) => s + num(t.cost), 0);
  const biayaRekrutmen = lowongan.reduce((s, j) => s + num(j.recruitmentCost), 0);

  res.json({
    period: { startDate: query.startDate, endDate: query.endDate },
    costs: summarizeCosts({
      payroll: biayaPayroll,
      training: biayaPelatihan,
      recruitment: biayaRekrutmen,
    }),
    detail: {
      payslipCount: payrolls.length,
      overtimePay: payrolls.reduce((s, p) => s + num(p.overtimePay), 0),
      allowances: payrolls.reduce((s, p) => s + num(p.totalAllowances), 0),
      trainingSessions: sesiPelatihan.length,
      jobPostings: lowongan.length,
    },
    hires: diterima,
    costPerHire: costPerHire(biayaRekrutmen, diterima),
  });
};

/** Ringkasan produktivitas dari data presensi. */
export const getProductivityReport = async (req: Request, res: Response) => {
  const query = req.query as unknown as PeriodQuery;
  if (!periksaPeriode(query, res)) return;
  batasiDepartemenManajer(query, req.user!);

  const rentang = businessDayRange(query.startDate, query.endDate, env.APP_TIMEZONE);
  const deptFilter = query.departmentId ? { employee: { departmentId: query.departmentId } } : {};

  const [shifts, presensi] = await Promise.all([
    prisma.shiftSchedule.count({
      where: {
        status: { not: 'cancelled' },
        date: { gte: query.startDate, lt: akhirEksklusif(query.endDate) },
        ...deptFilter,
      },
    }),
    prisma.attendance.findMany({
      where: { checkInTime: { gte: rentang.gte, lt: rentang.lt }, ...deptFilter },
      select: { status: true, workedMinutes: true, overtimeHours: true, overtimeApproved: true },
    }),
  ]);

  const ringkasan = attendanceProductivity({
    scheduledShifts: shifts,
    attendanceCount: presensi.length,
    lateCount: presensi.filter((a) => a.status === 'late').length,
    totalWorkedMinutes: presensi.reduce((s, a) => s + a.workedMinutes, 0),
  });

  res.json({
    period: { startDate: query.startDate, endDate: query.endDate },
    scheduledShifts: shifts,
    attendanceCount: presensi.length,
    ...ringkasan,
    approvedOvertimeHours:
      Math.round(
        presensi
          .filter((a) => a.overtimeApproved)
          .reduce((s, a) => s + a.overtimeHours.toNumber(), 0) * 100
      ) / 100,
  });
};

/**
 * Data mentah untuk diolah lebih lanjut di luar sistem.
 *
 * Dibatasi pada kumpulan data yang sudah ditentukan, bukan kueri bebas:
 * endpoint yang menerima kueri dari klien adalah jalan masuk untuk membaca
 * tabel yang seharusnya tidak boleh dibaca.
 */
export const getRawData = async (req: Request, res: Response) => {
  const query = req.query as unknown as RawDataQuery;
  const skip = (query.page - 1) * query.limit;
  const take = query.limit;

  const sampai = query.endDate ? akhirEksklusif(query.endDate) : undefined;
  const rentangTanggal = (field: string): Record<string, unknown> =>
    query.startDate || sampai
      ? { [field]: { ...(query.startDate ? { gte: query.startDate } : {}), ...(sampai ? { lt: sampai } : {}) } }
      : {};

  const deptEmployee = query.departmentId ? { departmentId: query.departmentId } : {};
  const deptRelasi = query.departmentId ? { employee: { departmentId: query.departmentId } } : {};

  if (query.dataset === 'employees') {
    const where = { ...deptEmployee, ...rentangTanggal('joinDate') };
    const [total, data] = await Promise.all([
      prisma.employee.count({ where }),
      prisma.employee.findMany({
        where,
        // password sengaja tidak pernah ikut.
        select: {
          id: true, nik: true, name: true, email: true, status: true, role: true,
          joinDate: true, exitDate: true, exitReason: true, exitType: true,
          department: { select: { name: true } },
          position: { select: { name: true } },
        },
        orderBy: { name: 'asc' },
        skip, take,
      }),
    ]);
    return res.json({ dataset: query.dataset, data, pagination: { page: query.page, limit: query.limit, total } });
  }

  if (query.dataset === 'attendance') {
    const where = { ...deptRelasi, ...rentangTanggal('checkInTime') };
    const [total, data] = await Promise.all([
      prisma.attendance.count({ where }),
      prisma.attendance.findMany({
        where,
        select: {
          id: true, employeeId: true, checkInTime: true, checkOutTime: true,
          status: true, lateMinutes: true, workedMinutes: true, overtimeHours: true,
          overtimeApproved: true,
          employee: { select: { nik: true, name: true } },
        },
        orderBy: { checkInTime: 'desc' },
        skip, take,
      }),
    ]);
    return res.json({ dataset: query.dataset, data, pagination: { page: query.page, limit: query.limit, total } });
  }

  if (query.dataset === 'leaves') {
    const where = { ...deptRelasi, ...rentangTanggal('startDate') };
    const [total, data] = await Promise.all([
      prisma.leave.count({ where }),
      prisma.leave.findMany({
        where,
        select: {
          id: true, employeeId: true, startDate: true, endDate: true, totalDays: true,
          status: true, reason: true,
          leaveType: { select: { code: true, name: true, isPaid: true } },
          employee: { select: { nik: true, name: true } },
        },
        orderBy: { startDate: 'desc' },
        skip, take,
      }),
    ]);
    return res.json({ dataset: query.dataset, data, pagination: { page: query.page, limit: query.limit, total } });
  }

  if (query.dataset === 'payrolls') {
    const where = { ...deptRelasi, ...rentangTanggal('payPeriodStart') };
    const [total, data] = await Promise.all([
      prisma.payroll.count({ where }),
      prisma.payroll.findMany({
        where,
        select: {
          id: true, employeeId: true, payPeriodStart: true, payPeriodEnd: true,
          basicSalary: true, overtimePay: true, totalAllowances: true,
          totalDeductions: true, grossSalary: true, netSalary: true, status: true,
          employee: { select: { nik: true, name: true } },
        },
        orderBy: { payPeriodStart: 'desc' },
        skip, take,
      }),
    ]);
    return res.json({ dataset: query.dataset, data, pagination: { page: query.page, limit: query.limit, total } });
  }

  const where = { ...deptRelasi, ...rentangTanggal('registrationDate') };
  const [total, data] = await Promise.all([
    prisma.trainingRegistration.count({ where }),
    prisma.trainingRegistration.findMany({
      where,
      select: {
        id: true, employeeId: true, status: true, evaluationScore: true,
        passed: true, completedAt: true, expiresAt: true,
        trainingSession: { select: { title: true, program: { select: { code: true, name: true } } } },
        employee: { select: { nik: true, name: true } },
      },
      orderBy: { registrationDate: 'desc' },
      skip, take,
    }),
  ]);

  res.json({ dataset: query.dataset, data, pagination: { page: query.page, limit: query.limit, total } });
};
