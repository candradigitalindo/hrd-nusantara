// src/services/collectiveLeave.ts
//
// Cuti bersama (SKB 3 Menteri) memotong kuota cuti tahunan karyawan —
// tapi hanya karyawan yang memang libur pada hari itu. Staf outlet dan
// hotel bekerja di hari libur menurut roster; memotong cuti mereka untuk
// hari yang justru mereka kerjakan adalah kesalahan yang paling sering
// dikeluhkan ke HR.
//
// Karena itu potongan mengikuti pola kerja: hanya pola 'fixed' yang
// menghormati hari libur nasional yang dipotong. Tiap potongan dicatat per
// (hari libur, saldo) supaya bisa dipulihkan dan tidak pernah terjadi dua
// kali.
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import { resolveWorkPattern } from './workPattern';

export interface RingkasanPotongan {
  deducted: number;
  skippedShift: number;
  skippedNoBalance: number;
}

const tahunDari = (tanggal: Date) => tanggal.getUTCFullYear();

/** Apakah karyawan ini libur pada hari libur nasional? */
const liburDiHariLibur = async (employeeId: string) => {
  const pola = await resolveWorkPattern(employeeId);
  return pola.type === 'fixed' && pola.observesPublicHolidays;
};

const potong = async (tx: Prisma.TransactionClient | typeof prisma, holidayId: string, leaveBalanceId: string) => {
  // Unik (holidayId, leaveBalanceId): percobaan kedua ditolak database, bukan
  // diam-diam memotong dua kali.
  try {
    await tx.collectiveLeaveDeduction.create({
      data: { id: generateULID(), holidayId, leaveBalanceId, days: new Prisma.Decimal(1) },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
    throw error;
  }
  await tx.leaveBalance.update({
    where: { id: leaveBalanceId },
    data: { collectiveLeaveDays: { increment: 1 } },
  });
  return true;
};

/**
 * Menerapkan potongan satu hari libur ke semua saldo yang berhak.
 * Dipanggil saat hari libur cuti bersama dibuat.
 */
export const applyHolidayDeductions = async (holidayId: string): Promise<RingkasanPotongan> => {
  const ringkasan: RingkasanPotongan = { deducted: 0, skippedShift: 0, skippedNoBalance: 0 };

  const libur = await prisma.holiday.findUnique({ where: { id: holidayId } });
  if (!libur || !libur.isCollectiveLeave) return ringkasan;

  const tahun = tahunDari(libur.date);
  const karyawan = await prisma.employee.findMany({
    where: { status: { in: ['active', 'probation', 'contract', 'internship'] } },
    select: { id: true },
  });

  for (const k of karyawan) {
    if (!(await liburDiHariLibur(k.id))) {
      ringkasan.skippedShift += 1;
      continue;
    }
    const saldo = await prisma.leaveBalance.findMany({
      where: { employeeId: k.id, year: tahun, leaveType: { absorbsCollectiveLeave: true } },
      select: { id: true },
    });
    if (saldo.length === 0) {
      ringkasan.skippedNoBalance += 1;
      continue;
    }
    for (const s of saldo) {
      if (await potong(prisma, libur.id, s.id)) ringkasan.deducted += 1;
    }
  }

  return ringkasan;
};

/** Memulihkan saldo yang pernah dipotong hari libur ini. Dipanggil sebelum hari liburnya dihapus. */
export const revertHolidayDeductions = async (holidayId: string): Promise<number> => {
  const potongan = await prisma.collectiveLeaveDeduction.findMany({
    where: { holidayId },
    select: { id: true, leaveBalanceId: true, days: true },
  });
  if (potongan.length === 0) return 0;

  await prisma.$transaction([
    ...potongan.map((p) =>
      prisma.leaveBalance.update({
        where: { id: p.leaveBalanceId },
        data: { collectiveLeaveDays: { decrement: p.days } },
      })
    ),
    prisma.collectiveLeaveDeduction.deleteMany({ where: { holidayId } }),
  ]);

  return potongan.length;
};

/**
 * Saldo yang baru dibuat di tengah tahun harus ikut menanggung cuti bersama
 * yang sudah ditetapkan untuk tahun itu — kalau tidak, karyawan yang
 * saldonya terlambat diisi justru dapat kuota lebih.
 */
export const applyDeclaredCollectiveLeaveToBalance = async (leaveBalanceId: string): Promise<number> => {
  const saldo = await prisma.leaveBalance.findUnique({
    where: { id: leaveBalanceId },
    include: { leaveType: { select: { absorbsCollectiveLeave: true } } },
  });
  if (!saldo || !saldo.leaveType.absorbsCollectiveLeave) return 0;
  if (!(await liburDiHariLibur(saldo.employeeId))) return 0;

  const libur = await prisma.holiday.findMany({
    where: {
      isCollectiveLeave: true,
      date: {
        gte: new Date(Date.UTC(saldo.year, 0, 1)),
        lt: new Date(Date.UTC(saldo.year + 1, 0, 1)),
      },
    },
    select: { id: true },
  });

  let dipotong = 0;
  for (const h of libur) {
    if (await potong(prisma, h.id, saldo.id)) dipotong += 1;
  }
  return dipotong;
};
