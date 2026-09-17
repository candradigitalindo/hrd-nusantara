// src/controllers/payrollController.ts
import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import { computeForEmployee, PayrollDataError } from '../services/payroll';
import type {
  CreateSalaryComponentInput,
  UpdateSalaryComponentInput,
  ListSalaryComponentQuery,
  SetEmployeeSalaryInput,
  AssignComponentInput,
  CreatePayrollRunInput,
  CalculatePayrollRunInput,
  DecidePayrollRunInput,
  ListPayrollRunQuery,
  ListPayrollQuery,
} from '../schemas/payrollSchema';

const num = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());

// --- Komponen gaji ---

export const createSalaryComponent = async (req: Request, res: Response) => {
  const input = req.body as CreateSalaryComponentInput;

  try {
    const komponen = await prisma.salaryComponent.create({
      data: {
        id: generateULID(),
        ...input,
        defaultAmount: input.defaultAmount != null ? new Prisma.Decimal(input.defaultAmount) : null,
        defaultPercentage:
          input.defaultPercentage != null ? new Prisma.Decimal(input.defaultPercentage) : null,
        capAmount: input.capAmount != null ? new Prisma.Decimal(input.capAmount) : null,
      },
    });
    res.status(201).json(komponen);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: `Kode komponen "${input.code}" sudah dipakai` });
    }
    throw error;
  }
};

export const getAllSalaryComponents = async (req: Request, res: Response) => {
  const { page, limit, type, includeInactive } =
    req.query as unknown as ListSalaryComponentQuery;

  const where: Prisma.SalaryComponentWhereInput = {
    ...(includeInactive ? {} : { isActive: true }),
    ...(type ? { type } : {}),
  };

  const [total, data] = await Promise.all([
    prisma.salaryComponent.count({ where }),
    prisma.salaryComponent.findMany({
      where,
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
};

export const updateSalaryComponent = async (req: Request, res: Response) => {
  const input = req.body as UpdateSalaryComponentInput;

  try {
    const komponen = await prisma.salaryComponent.update({
      where: { id: req.params.id },
      data: {
        ...input,
        ...(input.defaultAmount !== undefined
          ? { defaultAmount: input.defaultAmount != null ? new Prisma.Decimal(input.defaultAmount) : null }
          : {}),
        ...(input.defaultPercentage !== undefined
          ? {
              defaultPercentage:
                input.defaultPercentage != null ? new Prisma.Decimal(input.defaultPercentage) : null,
            }
          : {}),
        ...(input.capAmount !== undefined
          ? { capAmount: input.capAmount != null ? new Prisma.Decimal(input.capAmount) : null }
          : {}),
      },
    });
    res.json(komponen);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({ error: 'Komponen gaji tidak ditemukan' });
    }
    throw error;
  }
};

// --- Struktur gaji karyawan ---

/**
 * Menetapkan gaji baru. Baris lama ditutup masa berlakunya, tidak ditimpa —
 * riwayat kenaikan gaji harus tetap terbaca, dan slip periode lampau memakai
 * angka yang berlaku saat itu.
 */
export const setEmployeeSalary = async (req: Request, res: Response) => {
  const input = req.body as SetEmployeeSalaryInput;
  const employeeId = req.params.id;

  const karyawan = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true },
  });
  if (!karyawan) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });

  const sehariSebelum = new Date(input.effectiveFrom.getTime() - 24 * 60 * 60 * 1000);

  const salary = await prisma.$transaction(async (tx) => {
    await tx.employeeSalary.updateMany({
      where: { employeeId, effectiveTo: null, effectiveFrom: { lt: input.effectiveFrom } },
      data: { effectiveTo: sehariSebelum },
    });

    return tx.employeeSalary.create({
      data: {
        id: generateULID(),
        employeeId,
        salaryType: input.salaryType,
        baseAmount: new Prisma.Decimal(input.baseAmount),
        effectiveFrom: input.effectiveFrom,
        note: input.note,
      },
    });
  });

  res.status(201).json({ ...salary, baseAmount: salary.baseAmount.toNumber() });
};

export const getEmployeeSalaryHistory = async (req: Request, res: Response) => {
  const actor = req.user!;
  const employeeId = req.params.id;

  // Gaji adalah data sensitif: hanya HR dan yang bersangkutan.
  const isSelf = actor.id === employeeId;
  const isHr = actor.role === Role.HR_ADMIN || actor.role === Role.SUPER_ADMIN;

  if (!isSelf && !isHr) {
    return res.status(403).json({ error: 'Anda tidak punya akses ke data gaji ini' });
  }

  const [salaries, components] = await Promise.all([
    prisma.employeeSalary.findMany({
      where: { employeeId },
      orderBy: { effectiveFrom: 'desc' },
    }),
    prisma.employeeSalaryComponent.findMany({
      where: { employeeId },
      include: { component: { select: { id: true, code: true, name: true, type: true } } },
      orderBy: { effectiveFrom: 'desc' },
    }),
  ]);

  res.json({
    salaries: salaries.map((s) => ({ ...s, baseAmount: s.baseAmount.toNumber() })),
    components: components.map((c) => ({
      ...c,
      amount: num(c.amount),
      percentage: num(c.percentage),
    })),
  });
};

export const assignEmployeeComponent = async (req: Request, res: Response) => {
  const input = req.body as AssignComponentInput;
  const employeeId = req.params.id;

  const [karyawan, komponen] = await Promise.all([
    prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } }),
    prisma.salaryComponent.findUnique({ where: { id: input.componentId }, select: { id: true } }),
  ]);

  if (!karyawan) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });
  if (!komponen) return res.status(404).json({ error: 'Komponen gaji tidak ditemukan' });

  const baris = await prisma.employeeSalaryComponent.create({
    data: {
      id: generateULID(),
      employeeId,
      componentId: input.componentId,
      amount: input.amount != null ? new Prisma.Decimal(input.amount) : null,
      percentage: input.percentage != null ? new Prisma.Decimal(input.percentage) : null,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      note: input.note,
    },
  });

  res.status(201).json({
    ...baris,
    amount: num(baris.amount),
    percentage: num(baris.percentage),
  });
};

export const removeEmployeeComponent = async (req: Request, res: Response) => {
  try {
    await prisma.employeeSalaryComponent.delete({ where: { id: req.params.id } });
    res.json({ message: 'Komponen karyawan dihapus' });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({ error: 'Komponen karyawan tidak ditemukan' });
    }
    throw error;
  }
};

// --- Batch penggajian ---

export const createPayrollRun = async (req: Request, res: Response) => {
  const input = req.body as CreatePayrollRunInput;

  try {
    const run = await prisma.payrollRun.create({ data: { id: generateULID(), ...input } });
    res.status(201).json(run);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: `Kode batch "${input.code}" sudah dipakai` });
    }
    throw error;
  }
};

/**
 * Menghitung seluruh slip dalam satu batch.
 *
 * Bisa dijalankan berulang selama batch masih draft atau calculated: hasil
 * sebelumnya dihapus lalu dihitung ulang, sehingga koreksi data presensi atau
 * cuti bisa langsung tercermin. Setelah disetujui, batch dikunci.
 */
export const calculatePayrollRun = async (req: Request, res: Response) => {
  const input = req.body as CalculatePayrollRunInput;

  const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
  if (!run) return res.status(404).json({ error: 'Batch penggajian tidak ditemukan' });

  if (run.status !== 'draft' && run.status !== 'calculated') {
    return res.status(409).json({
      error: `Batch berstatus "${run.status}" tidak bisa dihitung ulang`,
    });
  }

  const where: Prisma.EmployeeWhereInput = {
    status: { notIn: ['resign', 'terminated', 'inactive'] },
    ...(input.employeeIds?.length ? { id: { in: input.employeeIds } } : {}),
    ...(input.departmentId ? { departmentId: input.departmentId } : {}),
  };

  const employees = await prisma.employee.findMany({
    where,
    select: { id: true, nik: true, name: true },
    orderBy: { name: 'asc' },
  });

  const dilewati: { employeeId: string; nik: string; name: string; reason: string }[] = [];
  let berhasil = 0;

  // Perhitungan lama dibuang lebih dulu supaya menjalankan ulang tidak
  // menumpuk slip ganda.
  await prisma.payroll.deleteMany({ where: { payrollRunId: run.id } });

  for (const karyawan of employees) {
    try {
      const hitung = await computeForEmployee(karyawan.id, run.periodStart, run.periodEnd);

      await prisma.payroll.create({
        data: {
          id: generateULID(),
          employeeId: karyawan.id,
          payrollRunId: run.id,
          payPeriodStart: run.periodStart,
          payPeriodEnd: run.periodEnd,
          salaryType: hitung.salaryType,
          baseAmount: new Prisma.Decimal(hitung.baseAmount),
          basicSalary: new Prisma.Decimal(hitung.result.basicSalary),
          scheduledDays: hitung.facts.scheduledDays,
          workedDays: hitung.facts.workedDays,
          unpaidLeaveDays: new Prisma.Decimal(hitung.facts.unpaidLeaveDays),
          overtimeHours: new Prisma.Decimal(hitung.facts.approvedOvertimeHours),
          overtimePay: new Prisma.Decimal(hitung.result.overtimePay),
          totalAllowances: new Prisma.Decimal(hitung.result.totalAllowances),
          totalDeductions: new Prisma.Decimal(hitung.result.totalDeductions),
          grossSalary: new Prisma.Decimal(hitung.result.grossSalary),
          taxableIncome: new Prisma.Decimal(hitung.result.taxableIncome),
          netSalary: new Prisma.Decimal(hitung.result.netSalary),
          status: 'calculated',
          items: {
            create: hitung.result.lines.map((line, index) => ({
              id: generateULID(),
              code: line.code,
              name: line.name,
              type: line.type,
              amount: new Prisma.Decimal(line.amount),
              calculationNote: line.calculationNote,
              isTaxable: line.isTaxable,
              sortOrder: index,
            })),
          },
        },
      });

      berhasil += 1;
    } catch (error) {
      if (error instanceof PayrollDataError) {
        // Karyawan tanpa struktur gaji dilewati, bukan menggagalkan seluruh
        // batch — HR bisa melengkapi datanya lalu menghitung ulang.
        dilewati.push({
          employeeId: karyawan.id,
          nik: karyawan.nik,
          name: karyawan.name,
          reason: error.message,
        });
        continue;
      }
      throw error;
    }
  }

  const diperbarui = await prisma.payrollRun.update({
    where: { id: run.id },
    data: { status: 'calculated', calculatedAt: new Date() },
  });

  res.json({
    payrollRun: diperbarui,
    calculated: berhasil,
    skipped: dilewati,
  });
};

export const decidePayrollRun = async (req: Request, res: Response) => {
  const { approved, note } = req.body as DecidePayrollRunInput;
  const actor = req.user!;

  const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
  if (!run) return res.status(404).json({ error: 'Batch penggajian tidak ditemukan' });

  if (run.status !== 'calculated') {
    return res.status(409).json({
      error: `Hanya batch berstatus "calculated" yang bisa diputuskan, ini "${run.status}"`,
    });
  }

  const hasil = await prisma.$transaction(async (tx) => {
    await tx.payroll.updateMany({
      where: { payrollRunId: run.id },
      data: { status: approved ? 'approved' : 'draft' },
    });

    return tx.payrollRun.update({
      where: { id: run.id },
      data: {
        status: approved ? 'approved' : 'draft',
        approvedById: approved ? actor.id : null,
        approvedAt: approved ? new Date() : null,
        note: note ?? run.note,
      },
    });
  });

  res.json({
    message: approved ? 'Batch penggajian disetujui' : 'Batch dikembalikan ke draft',
    payrollRun: hasil,
  });
};

export const getAllPayrollRuns = async (req: Request, res: Response) => {
  const { page, limit, status } = req.query as unknown as ListPayrollRunQuery;
  const where: Prisma.PayrollRunWhereInput = status ? { status } : {};

  const [total, data] = await Promise.all([
    prisma.payrollRun.count({ where }),
    prisma.payrollRun.findMany({
      where,
      include: { _count: { select: { payrolls: true } } },
      orderBy: { periodStart: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
};

// --- Slip gaji ---

const payrollSelect = {
  id: true,
  employeeId: true,
  payrollRunId: true,
  payPeriodStart: true,
  payPeriodEnd: true,
  salaryType: true,
  baseAmount: true,
  basicSalary: true,
  scheduledDays: true,
  workedDays: true,
  unpaidLeaveDays: true,
  overtimeHours: true,
  overtimePay: true,
  totalAllowances: true,
  totalDeductions: true,
  grossSalary: true,
  taxableIncome: true,
  netSalary: true,
  status: true,
  note: true,
  createdAt: true,
  employee: { select: { id: true, nik: true, name: true, departmentId: true } },
  items: {
    select: {
      code: true,
      name: true,
      type: true,
      amount: true,
      calculationNote: true,
      isTaxable: true,
    },
    orderBy: { sortOrder: 'asc' as const },
  },
} satisfies Prisma.PayrollSelect;

type PayrollRow = Prisma.PayrollGetPayload<{ select: typeof payrollSelect }>;

const toDTO = (row: PayrollRow) => ({
  ...row,
  baseAmount: row.baseAmount.toNumber(),
  basicSalary: row.basicSalary.toNumber(),
  unpaidLeaveDays: row.unpaidLeaveDays.toNumber(),
  overtimeHours: row.overtimeHours.toNumber(),
  overtimePay: row.overtimePay.toNumber(),
  totalAllowances: row.totalAllowances.toNumber(),
  totalDeductions: row.totalDeductions.toNumber(),
  grossSalary: row.grossSalary.toNumber(),
  taxableIncome: row.taxableIncome.toNumber(),
  netSalary: row.netSalary.toNumber(),
  items: row.items.map((i) => ({ ...i, amount: i.amount.toNumber() })),
});

export const getAllPayrolls = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListPayrollQuery;

  const where: Prisma.PayrollWhereInput = {
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(query.payrollRunId ? { payrollRunId: query.payrollRunId } : {}),
    ...(query.departmentId ? { employee: { departmentId: query.departmentId } } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.payroll.count({ where }),
    prisma.payroll.findMany({
      where,
      select: payrollSelect,
      orderBy: { payPeriodStart: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  res.json({
    data: rows.map(toDTO),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit) || 1,
    },
  });
};

/**
 * Slip gaji milik sendiri.
 *
 * Yang belum disetujui tidak ditampilkan: angka draft masih bisa berubah, dan
 * memperlihatkannya hanya menimbulkan pertanyaan atas angka yang belum final.
 */
export const getMyPayrolls = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListPayrollQuery;

  const where: Prisma.PayrollWhereInput = {
    employeeId: req.user!.id,
    status: { in: ['approved', 'paid'] },
  };

  const [total, rows] = await Promise.all([
    prisma.payroll.count({ where }),
    prisma.payroll.findMany({
      where,
      select: payrollSelect,
      orderBy: { payPeriodStart: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  res.json({
    data: rows.map(toDTO),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit) || 1,
    },
  });
};

export const getPayrollById = async (req: Request, res: Response) => {
  const actor = req.user!;

  const payroll = await prisma.payroll.findUnique({
    where: { id: req.params.id },
    select: payrollSelect,
  });

  if (!payroll) return res.status(404).json({ error: 'Slip gaji tidak ditemukan' });

  const isSelf = payroll.employeeId === actor.id;
  const isHr = actor.role === Role.HR_ADMIN || actor.role === Role.SUPER_ADMIN;

  // Manajer sengaja tidak diberi akses: gaji anggota tim bukan bagian dari
  // kewenangan operasional mereka.
  if (!isSelf && !isHr) {
    return res.status(403).json({ error: 'Anda tidak punya akses ke slip gaji ini' });
  }

  if (isSelf && !isHr && payroll.status !== 'approved' && payroll.status !== 'paid') {
    return res.status(403).json({ error: 'Slip gaji ini belum final' });
  }

  res.json(toDTO(payroll));
};

/** Pratinjau perhitungan tanpa menyimpan, untuk memeriksa sebelum batch dijalankan. */
export const previewPayroll = async (req: Request, res: Response) => {
  const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
  if (!run) return res.status(404).json({ error: 'Batch penggajian tidak ditemukan' });

  try {
    const hitung = await computeForEmployee(
      req.params.employeeId,
      run.periodStart,
      run.periodEnd
    );
    res.json(hitung);
  } catch (error) {
    if (error instanceof PayrollDataError) {
      return res.status(422).json({ error: error.message, reason: error.code });
    }
    throw error;
  }
};
