// src/services/payroll.ts
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { eachCalendarDay, calendarKey } from '../utils/leaveDays';
import {
  calculatePayroll,
  type ComponentInput,
  type PayrollInput,
  type PayrollResult,
  type SalaryType,
} from '../utils/payrollMath';

export class PayrollDataError extends Error {
  constructor(
    public readonly code: 'no_salary' | 'invalid_period',
    message: string
  ) {
    super(message);
    this.name = 'PayrollDataError';
  }
}

const angka = (d: Prisma.Decimal | null | undefined): number | null =>
  d === null || d === undefined ? null : d.toNumber();

/**
 * Struktur gaji yang berlaku pada tanggal tertentu.
 *
 * Dicari berdasarkan tanggal, bukan sekadar yang terbaru, supaya penggajian
 * periode lampau memakai angka yang berlaku saat itu — bukan gaji hasil
 * kenaikan yang baru ditetapkan kemudian.
 */
export const getEffectiveSalary = async (employeeId: string, onDate: Date) => {
  const salary = await prisma.employeeSalary.findFirst({
    where: {
      employeeId,
      effectiveFrom: { lte: onDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });

  if (!salary) {
    throw new PayrollDataError(
      'no_salary',
      'Struktur gaji karyawan belum ditetapkan untuk periode ini'
    );
  }

  return salary;
};

/**
 * Komponen tetap milik karyawan yang berlaku pada periode tersebut.
 * Nilai pada baris karyawan menimpa nilai bawaan komponen bila diisi.
 */
export const getEffectiveComponents = async (
  employeeId: string,
  onDate: Date
): Promise<ComponentInput[]> => {
  const rows = await prisma.employeeSalaryComponent.findMany({
    where: {
      employeeId,
      effectiveFrom: { lte: onDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
      component: { isActive: true },
    },
    include: { component: true },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map((row) => ({
    code: row.component.code,
    name: row.component.name,
    type: row.component.type as ComponentInput['type'],
    calculation: row.component.calculation as ComponentInput['calculation'],
    percentageBase: row.component.percentageBase as ComponentInput['percentageBase'],
    amount: angka(row.amount) ?? angka(row.component.defaultAmount),
    percentage: angka(row.percentage) ?? angka(row.component.defaultPercentage),
    capAmount: angka(row.component.capAmount),
    isTaxable: row.component.isTaxable,
    isStatutory: row.component.isStatutory,
  }));
};

export interface PeriodFacts {
  scheduledDays: number;
  workedDays: number;
  workedHours: number;
  approvedOvertimeHours: number;
  unpaidLeaveDays: number;
}

/**
 * Mengumpulkan angka dari modul presensi dan cuti untuk satu periode.
 *
 * Hanya lembur yang SUDAH disetujui yang ikut dihitung — itulah gunanya
 * persetujuan lembur di modul presensi.
 */
export const gatherPeriodFacts = async (
  employeeId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<PeriodFacts> => {
  const akhirEksklusif = new Date(periodEnd.getTime() + 24 * 60 * 60 * 1000);

  const [shifts, presensi, cutiTakBerbayar] = await Promise.all([
    prisma.shiftSchedule.count({
      where: {
        employeeId,
        status: { not: 'cancelled' },
        date: { gte: periodStart, lte: periodEnd },
      },
    }),
    prisma.attendance.findMany({
      where: {
        employeeId,
        checkInTime: { gte: periodStart, lt: akhirEksklusif },
      },
      select: { workedMinutes: true, overtimeHours: true, overtimeApproved: true },
    }),
    prisma.leave.findMany({
      where: {
        employeeId,
        status: 'approved',
        leaveType: { isPaid: false },
        startDate: { lte: periodEnd },
        endDate: { gte: periodStart },
      },
      select: { startDate: true, endDate: true },
    }),
  ]);

  const workedMinutes = presensi.reduce((s, a) => s + a.workedMinutes, 0);

  const approvedOvertimeHours = presensi
    .filter((a) => a.overtimeApproved)
    .reduce((s, a) => s + a.overtimeHours.toNumber(), 0);

  // Cuti bisa melewati batas periode, jadi yang dihitung hanya hari yang
  // benar-benar jatuh di dalam periode penggajian ini.
  const hariCuti = new Set<string>();
  for (const cuti of cutiTakBerbayar) {
    const mulai = cuti.startDate < periodStart ? periodStart : cuti.startDate;
    const selesai = cuti.endDate > periodEnd ? periodEnd : cuti.endDate;
    for (const hari of eachCalendarDay(mulai, selesai)) {
      hariCuti.add(calendarKey(hari));
    }
  }

  return {
    scheduledDays: shifts,
    workedDays: presensi.length,
    workedHours: Math.round((workedMinutes / 60) * 100) / 100,
    approvedOvertimeHours: Math.round(approvedOvertimeHours * 100) / 100,
    unpaidLeaveDays: hariCuti.size,
  };
};

export interface EmployeePayrollComputation {
  salaryType: SalaryType;
  baseAmount: number;
  facts: PeriodFacts;
  result: PayrollResult;
}

/** Menghitung satu slip gaji tanpa menyimpannya. */
export const computeForEmployee = async (
  employeeId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<EmployeePayrollComputation> => {
  if (periodEnd.getTime() < periodStart.getTime()) {
    throw new PayrollDataError('invalid_period', 'Periode penggajian tidak valid');
  }

  // Struktur gaji dan komponen dinilai pada akhir periode: kenaikan yang
  // berlaku di tengah bulan ikut terpakai untuk bulan itu.
  const [salary, components, facts] = await Promise.all([
    getEffectiveSalary(employeeId, periodEnd),
    getEffectiveComponents(employeeId, periodEnd),
    gatherPeriodFacts(employeeId, periodStart, periodEnd),
  ]);

  const input: PayrollInput = {
    salaryType: salary.salaryType as SalaryType,
    baseAmount: salary.baseAmount.toNumber(),
    scheduledDays: facts.scheduledDays,
    workedDays: facts.workedDays,
    workedHours: facts.workedHours,
    unpaidLeaveDays: facts.unpaidLeaveDays,
    approvedOvertimeHours: facts.approvedOvertimeHours,
    components,
    overtime: {
      hoursDivisor: env.OVERTIME_HOURS_DIVISOR,
      firstHourMultiplier: env.OVERTIME_FIRST_HOUR_MULTIPLIER,
      nextHoursMultiplier: env.OVERTIME_NEXT_HOURS_MULTIPLIER,
    },
    rounding: env.PAYROLL_ROUNDING,
  };

  return {
    salaryType: input.salaryType,
    baseAmount: input.baseAmount,
    facts,
    result: calculatePayroll(input),
  };
};
