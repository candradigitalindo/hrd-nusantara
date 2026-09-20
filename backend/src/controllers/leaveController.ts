// src/controllers/leaveController.ts
import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { applyDeclaredCollectiveLeaveToBalance } from '../services/collectiveLeave';
import { generateULID } from '../utils/generateULID';
import { calculateLeaveDays } from '../utils/leaveDays';
import { resolveWorkPattern, buildResolver } from '../services/workPattern';
import type {
  CreateLeaveInput,
  DecideLeaveInput,
  CancelLeaveInput,
  ListLeaveQuery,
  LeaveCalendarQuery,
  UpsertLeaveBalanceInput,
  ListLeaveBalanceQuery,
} from '../schemas/leaveSchema';

const leaveSelect = {
  id: true,
  employeeId: true,
  leaveTypeId: true,
  startDate: true,
  endDate: true,
  totalDays: true,
  reason: true,
  attachmentUrl: true,
  status: true,
  decidedById: true,
  decidedAt: true,
  decisionNote: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  employee: { select: { id: true, nik: true, name: true, departmentId: true } },
  leaveType: { select: { id: true, code: true, name: true, isPaid: true } },
} satisfies Prisma.LeaveSelect;

type LeaveRow = Prisma.LeaveGetPayload<{ select: typeof leaveSelect }>;

const toDTO = (row: LeaveRow) => ({ ...row, totalDays: row.totalDays.toNumber() });

const ACTIVE_LEAVE_STATUSES = ['pending', 'approved'];

/**
 * Sisa saldo = hak + sisa tahun lalu - terpakai.
 * `usedDays` hanya mencatat cuti yang sudah disetujui; pengajuan yang masih
 * menunggu dihitung terpisah agar satu jatah tidak bisa diajukan dua kali.
 */
const hitungSisaSaldo = (balance: {
  entitledDays: Prisma.Decimal;
  carriedOverDays: Prisma.Decimal;
  usedDays: Prisma.Decimal;
  collectiveLeaveDays: Prisma.Decimal;
}) =>
  balance.entitledDays.toNumber() +
  balance.carriedOverDays.toNumber() -
  balance.usedDays.toNumber() -
  balance.collectiveLeaveDays.toNumber();

// --- Pengajuan ---

export const createLeave = async (req: Request, res: Response) => {
  const input = req.body as CreateLeaveInput;
  const employeeId = req.user!.id;

  const [tipe, karyawan] = await Promise.all([
    prisma.leaveType.findUnique({ where: { id: input.leaveTypeId } }),
    prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { id: true, gender: true },
    }),
  ]);

  if (!tipe || !tipe.isActive) {
    return res.status(400).json({ error: 'Jenis cuti tidak ditemukan atau sudah tidak aktif' });
  }

  if (tipe.genderRestriction) {
    if (!karyawan.gender) {
      return res.status(400).json({
        error: `Jenis cuti "${tipe.name}" dibatasi jenis kelamin, tapi data Anda belum lengkap. Hubungi HR.`,
      });
    }
    if (karyawan.gender !== tipe.genderRestriction) {
      return res.status(403).json({ error: `Anda tidak berhak mengajukan ${tipe.name}` });
    }
  }

  if (tipe.requiresAttachment && !input.attachmentUrl) {
    return res.status(400).json({ error: `${tipe.name} membutuhkan lampiran pendukung` });
  }

  // Pengajuan yang tumpang tindih ditolak: satu orang tidak bisa cuti dua kali
  // di hari yang sama, dan saldonya akan terpotong ganda.
  const bentrok = await prisma.leave.findFirst({
    where: {
      employeeId,
      status: { in: ACTIVE_LEAVE_STATUSES },
      startDate: { lte: input.endDate },
      endDate: { gte: input.startDate },
    },
    select: { id: true, startDate: true, endDate: true },
  });

  if (bentrok) {
    return res.status(409).json({
      error: 'Tanggal bertabrakan dengan pengajuan cuti Anda yang lain',
      conflictingLeaveId: bentrok.id,
    });
  }

  // Hari kerja mengikuti pola karyawan: kantor punya hari tetap, sedangkan
  // outlet dan hotel mengikuti roster sehingga hari liburnya berpindah-pindah.
  const pattern = await resolveWorkPattern(employeeId);
  const resolver = await buildResolver({
    employeeId,
    pattern,
    startDate: input.startDate,
    endDate: input.endDate,
  });

  const rincian = calculateLeaveDays({
    startDate: input.startDate,
    endDate: input.endDate,
    resolver,
    countsCalendarDays: tipe.countsCalendarDays,
  });

  if (rincian.countedDays === 0) {
    return res.status(400).json({
      error: 'Rentang yang dipilih tidak mengandung hari kerja Anda',
      details: { ...rincian, days: undefined, workPattern: pattern.name },
    });
  }

  if (tipe.maxConsecutiveDays && rincian.countedDays > tipe.maxConsecutiveDays) {
    return res.status(400).json({
      error: `${tipe.name} maksimal ${tipe.maxConsecutiveDays} hari berturut-turut`,
    });
  }

  if (tipe.deductsBalance) {
    const tahun = input.startDate.getUTCFullYear();
    const saldo = await prisma.leaveBalance.findUnique({
      where: {
        employeeId_leaveTypeId_year: { employeeId, leaveTypeId: tipe.id, year: tahun },
      },
    });

    if (!saldo) {
      return res.status(400).json({
        error: `Saldo ${tipe.name} tahun ${tahun} belum ditetapkan. Hubungi HR.`,
      });
    }

    // Pengajuan yang masih menunggu ikut diperhitungkan, supaya jatah yang
    // sama tidak bisa diajukan berkali-kali sebelum atasan sempat memutuskan.
    const menunggu = await prisma.leave.aggregate({
      where: { employeeId, leaveTypeId: tipe.id, status: 'pending' },
      _sum: { totalDays: true },
    });

    const tertahan = menunggu._sum.totalDays?.toNumber() ?? 0;
    const tersedia = hitungSisaSaldo(saldo) - tertahan;

    if (rincian.countedDays > tersedia) {
      return res.status(400).json({
        error: 'Saldo cuti tidak mencukupi',
        details: {
          diminta: rincian.countedDays,
          tersedia,
          menungguPersetujuan: tertahan,
        },
      });
    }
  }

  const cuti = await prisma.leave.create({
    data: {
      id: generateULID(),
      employeeId,
      leaveTypeId: tipe.id,
      startDate: input.startDate,
      endDate: input.endDate,
      totalDays: new Prisma.Decimal(rincian.countedDays),
      reason: input.reason,
      attachmentUrl: input.attachmentUrl,
    },
    select: leaveSelect,
  });

  res.status(201).json({
    ...toDTO(cuti),
    workPattern: { code: pattern.code, name: pattern.name, type: pattern.type },
    breakdown: {
      countedDays: rincian.countedDays,
      restDays: rincian.restDays,
      publicHolidayDays: rincian.publicHolidayDays,
      notRosteredDays: rincian.notRosteredDays,
      totalCalendarDays: rincian.totalCalendarDays,
      // Ditandai supaya HR tahu angkanya taksiran: roster periode itu
      // belum terbit saat cuti diajukan.
      estimatedDays: rincian.estimatedDays,
    },
  });
};

/**
 * Menyetujui atau menolak pengajuan.
 *
 * Saldo baru dipotong saat disetujui, bukan saat diajukan — pengajuan yang
 * ditolak tidak boleh memakan jatah. Pemotongan dan perubahan status dilakukan
 * dalam satu transaksi agar tidak ada keadaan setengah jadi.
 */
export const decideLeave = async (req: Request, res: Response) => {
  const { approved, note } = req.body as DecideLeaveInput;
  const actor = req.user!;

  const cuti = await prisma.leave.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      employeeId: true,
      leaveTypeId: true,
      startDate: true,
      totalDays: true,
      status: true,
      employee: { select: { departmentId: true } },
      leaveType: { select: { deductsBalance: true, name: true } },
    },
  });

  if (!cuti) {
    return res.status(404).json({ error: 'Pengajuan cuti tidak ditemukan' });
  }

  if (cuti.status !== 'pending') {
    return res.status(409).json({ error: `Pengajuan ini sudah berstatus "${cuti.status}"` });
  }

  if (cuti.employeeId === actor.id) {
    return res.status(403).json({ error: 'Anda tidak bisa memutuskan pengajuan cuti sendiri' });
  }

  if (actor.role === Role.MANAGER && cuti.employee.departmentId !== actor.departmentId) {
    return res.status(403).json({ error: 'Anda hanya bisa memutuskan cuti di departemen sendiri' });
  }

  const hasil = await prisma.$transaction(async (tx) => {
    if (approved && cuti.leaveType.deductsBalance) {
      const tahun = cuti.startDate.getUTCFullYear();
      const saldo = await tx.leaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: cuti.employeeId,
            leaveTypeId: cuti.leaveTypeId,
            year: tahun,
          },
        },
      });

      if (!saldo) throw new Error('SALDO_TIDAK_ADA');
      if (hitungSisaSaldo(saldo) < cuti.totalDays.toNumber()) throw new Error('SALDO_KURANG');

      await tx.leaveBalance.update({
        where: { id: saldo.id },
        data: { usedDays: { increment: cuti.totalDays } },
      });
    }

    return tx.leave.update({
      where: { id: cuti.id },
      data: {
        status: approved ? 'approved' : 'rejected',
        decidedById: actor.id,
        decidedAt: new Date(),
        decisionNote: note,
      },
      select: leaveSelect,
    });
  });

  res.json({
    message: approved ? 'Cuti disetujui' : 'Cuti ditolak',
    leave: toDTO(hasil),
  });
};

/**
 * Membatalkan pengajuan. Cuti yang sudah disetujui mengembalikan saldo saat
 * dibatalkan — kalau tidak, jatah karyawan hangus tanpa pernah dipakai.
 */
export const cancelLeave = async (req: Request, res: Response) => {
  const { reason } = req.body as CancelLeaveInput;
  const actor = req.user!;

  const cuti = await prisma.leave.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      employeeId: true,
      leaveTypeId: true,
      startDate: true,
      totalDays: true,
      status: true,
      employee: { select: { departmentId: true } },
      leaveType: { select: { deductsBalance: true } },
    },
  });

  if (!cuti) {
    return res.status(404).json({ error: 'Pengajuan cuti tidak ditemukan' });
  }

  const isSelf = cuti.employeeId === actor.id;
  const isHr = actor.role === Role.HR_ADMIN || actor.role === Role.SUPER_ADMIN;
  const isManagerOfDept =
    actor.role === Role.MANAGER && cuti.employee.departmentId === actor.departmentId;

  if (!isSelf && !isHr && !isManagerOfDept) {
    return res.status(403).json({ error: 'Anda tidak punya akses membatalkan cuti ini' });
  }

  if (cuti.status === 'cancelled' || cuti.status === 'rejected') {
    return res.status(409).json({ error: `Pengajuan ini sudah berstatus "${cuti.status}"` });
  }

  const hasil = await prisma.$transaction(async (tx) => {
    if (cuti.status === 'approved' && cuti.leaveType.deductsBalance) {
      await tx.leaveBalance.updateMany({
        where: {
          employeeId: cuti.employeeId,
          leaveTypeId: cuti.leaveTypeId,
          year: cuti.startDate.getUTCFullYear(),
        },
        data: { usedDays: { decrement: cuti.totalDays } },
      });
    }

    return tx.leave.update({
      where: { id: cuti.id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        decisionNote: reason ?? undefined,
      },
      select: leaveSelect,
    });
  });

  res.json({ message: 'Pengajuan cuti dibatalkan', leave: toDTO(hasil) });
};

// --- Pembacaan ---

const buildLeaveWhere = (
  query: ListLeaveQuery,
  actor: { role: Role; departmentId: string | null }
): Prisma.LeaveWhereInput | { forbidden: string } => {
  const where: Prisma.LeaveWhereInput = {};

  if (actor.role === Role.MANAGER) {
    if (query.departmentId && query.departmentId !== actor.departmentId) {
      return { forbidden: 'Anda hanya bisa melihat departemen sendiri' };
    }
    where.employee = { departmentId: actor.departmentId ?? '__tanpa_departemen__' };
  } else if (query.departmentId) {
    where.employee = { departmentId: query.departmentId };
  }

  if (query.employeeId) where.employeeId = query.employeeId;
  if (query.leaveTypeId) where.leaveTypeId = query.leaveTypeId;
  if (query.status) where.status = query.status;

  // Irisan rentang: semua cuti yang menyentuh periode yang diminta.
  if (query.startDate) where.endDate = { gte: query.startDate };
  if (query.endDate) where.startDate = { lte: query.endDate };

  return where;
};

const halaman = async (where: Prisma.LeaveWhereInput, page: number, limit: number) => {
  const [total, rows] = await Promise.all([
    prisma.leave.count({ where }),
    prisma.leave.findMany({
      where,
      select: leaveSelect,
      orderBy: { startDate: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    data: rows.map(toDTO),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
};

export const getAllLeaves = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListLeaveQuery;

  const where = buildLeaveWhere(query, req.user!);
  if ('forbidden' in where) {
    return res.status(403).json({ error: where.forbidden });
  }

  res.json(await halaman(where, query.page, query.limit));
};

export const getMyLeaves = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListLeaveQuery;

  const where: Prisma.LeaveWhereInput = { employeeId: req.user!.id };
  if (query.status) where.status = query.status;
  if (query.startDate) where.endDate = { gte: query.startDate };
  if (query.endDate) where.startDate = { lte: query.endDate };

  res.json(await halaman(where, query.page, query.limit));
};

export const getLeaveById = async (req: Request, res: Response) => {
  const actor = req.user!;

  const cuti = await prisma.leave.findUnique({
    where: { id: req.params.id },
    select: leaveSelect,
  });

  if (!cuti) {
    return res.status(404).json({ error: 'Pengajuan cuti tidak ditemukan' });
  }

  const isSelf = cuti.employeeId === actor.id;
  const isHr = actor.role === Role.HR_ADMIN || actor.role === Role.SUPER_ADMIN;
  const isManagerOfDept =
    actor.role === Role.MANAGER &&
    actor.departmentId !== null &&
    actor.departmentId === cuti.employee.departmentId;

  if (!isSelf && !isHr && !isManagerOfDept) {
    return res.status(403).json({ error: 'Anda tidak punya akses ke pengajuan cuti ini' });
  }

  res.json(toDTO(cuti));
};

/**
 * Kalender cuti untuk perencanaan staffing: siapa libur pada tanggal berapa.
 * Hanya cuti yang sudah disetujui yang ditampilkan — yang masih menunggu belum
 * boleh dijadikan dasar menyusun jadwal.
 */
export const getLeaveCalendar = async (req: Request, res: Response) => {
  const query = req.query as unknown as LeaveCalendarQuery;
  const actor = req.user!;

  if (query.endDate.getTime() < query.startDate.getTime()) {
    return res.status(400).json({ error: 'endDate tidak boleh lebih awal dari startDate' });
  }

  const where: Prisma.LeaveWhereInput = {
    status: 'approved',
    startDate: { lte: query.endDate },
    endDate: { gte: query.startDate },
  };

  if (actor.role === Role.MANAGER) {
    if (query.departmentId && query.departmentId !== actor.departmentId) {
      return res.status(403).json({ error: 'Anda hanya bisa melihat departemen sendiri' });
    }
    where.employee = { departmentId: actor.departmentId ?? '__tanpa_departemen__' };
  } else if (query.departmentId) {
    where.employee = { departmentId: query.departmentId };
  }

  const [cuti, holidays] = await Promise.all([
    prisma.leave.findMany({
      where,
      select: leaveSelect,
      orderBy: { startDate: 'asc' },
    }),
    prisma.holiday.findMany({
      where: { date: { gte: query.startDate, lte: query.endDate } },
      orderBy: { date: 'asc' },
    }),
  ]);

  res.json({
    period: { startDate: query.startDate, endDate: query.endDate },
    leaves: cuti.map(toDTO),
    holidays,
  });
};

// --- Saldo ---

const balanceDTO = (b: Prisma.LeaveBalanceGetPayload<{
  include: { leaveType: { select: { id: true; code: true; name: true } } };
}>) => ({
  id: b.id,
  employeeId: b.employeeId,
  leaveType: b.leaveType,
  year: b.year,
  entitledDays: b.entitledDays.toNumber(),
  carriedOverDays: b.carriedOverDays.toNumber(),
  usedDays: b.usedDays.toNumber(),
  collectiveLeaveDays: b.collectiveLeaveDays.toNumber(),
  remainingDays: hitungSisaSaldo(b),
  note: b.note,
});

export const upsertLeaveBalance = async (req: Request, res: Response) => {
  const input = req.body as UpsertLeaveBalanceInput;

  const [karyawan, tipe] = await Promise.all([
    prisma.employee.findUnique({ where: { id: input.employeeId }, select: { id: true } }),
    prisma.leaveType.findUnique({ where: { id: input.leaveTypeId }, select: { id: true } }),
  ]);

  if (!karyawan) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });
  if (!tipe) return res.status(404).json({ error: 'Jenis cuti tidak ditemukan' });

  const disimpan = await prisma.leaveBalance.upsert({
    where: {
      employeeId_leaveTypeId_year: {
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        year: input.year,
      },
    },
    // usedDays sengaja tidak ikut diubah: itu hasil akumulasi cuti yang sudah
    // disetujui, bukan angka yang boleh ditetapkan manual.
    update: {
      entitledDays: new Prisma.Decimal(input.entitledDays),
      carriedOverDays: new Prisma.Decimal(input.carriedOverDays),
      note: input.note,
    },
    create: {
      id: generateULID(),
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      year: input.year,
      entitledDays: new Prisma.Decimal(input.entitledDays),
      carriedOverDays: new Prisma.Decimal(input.carriedOverDays),
      note: input.note,
    },
  });

  // Saldo ikut menanggung cuti bersama yang sudah ditetapkan tahun itu.
  // Dipanggil setiap kali, bukan hanya saat saldo baru dibuat: potongannya
  // idempoten (satu hari libur memotong satu saldo paling banyak sekali,
  // ditegakkan constraint unik), jadi saldo yang karena pergantian pola kerja
  // sempat terlewat akan tersusul di sini tanpa pernah terpotong dua kali.
  await applyDeclaredCollectiveLeaveToBalance(disimpan.id);

  const saldo = await prisma.leaveBalance.findUniqueOrThrow({
    where: { id: disimpan.id },
    include: { leaveType: { select: { id: true, code: true, name: true } } },
  });

  res.json(balanceDTO(saldo));
};

export const getMyLeaveBalances = async (req: Request, res: Response) => {
  const { year } = req.query as unknown as ListLeaveBalanceQuery;

  const saldo = await prisma.leaveBalance.findMany({
    where: { employeeId: req.user!.id, ...(year ? { year } : {}) },
    include: { leaveType: { select: { id: true, code: true, name: true } } },
    orderBy: [{ year: 'desc' }, { leaveTypeId: 'asc' }],
  });

  res.json({ data: saldo.map(balanceDTO) });
};

export const getEmployeeLeaveBalances = async (req: Request, res: Response) => {
  const { year } = req.query as unknown as ListLeaveBalanceQuery;
  const actor = req.user!;
  const employeeId = req.params.id;

  const karyawan = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, departmentId: true },
  });

  if (!karyawan) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });

  if (
    actor.role === Role.MANAGER &&
    karyawan.departmentId !== actor.departmentId
  ) {
    return res.status(403).json({ error: 'Anda hanya bisa melihat departemen sendiri' });
  }

  const saldo = await prisma.leaveBalance.findMany({
    where: { employeeId, ...(year ? { year } : {}) },
    include: { leaveType: { select: { id: true, code: true, name: true } } },
    orderBy: [{ year: 'desc' }, { leaveTypeId: 'asc' }],
  });

  res.json({ data: saldo.map(balanceDTO) });
};
