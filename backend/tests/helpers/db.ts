import bcrypt from 'bcryptjs';
import { DateTime } from 'luxon';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../../src/lib/prisma';
import { env } from '../../src/config/env';
import { generateULID } from '../../src/utils/generateULID';

/** Mengosongkan semua tabel aplikasi, tapi menyisakan riwayat migrasi. */
export const resetDatabase = async () => {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  if (tables.length === 0) return;

  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
};

export const DEFAULT_PASSWORD = 'RahasiaUji123';
export const TEST_TIMEZONE = 'Asia/Jakarta';

/** Monas — titik acuan geofence di seluruh test. */
export const MONAS = { latitude: -6.1753924, longitude: 106.8271528 };

let counter = 0;

export const makeEmployee = async (
  overrides: {
    nik?: string;
    name?: string;
    email?: string;
    role?: Role;
    status?: string;
    password?: string | null;
    departmentId?: string | null;
    positionId?: string | null;
    gender?: string | null;
    phoneNumber?: string | null;
    customRoleId?: string | null;
  } = {}
) => {
  counter += 1;
  const password = overrides.password === undefined ? DEFAULT_PASSWORD : overrides.password;

  return prisma.employee.create({
    data: {
      id: generateULID(),
      nik: overrides.nik ?? `NIK-${counter}`,
      name: overrides.name ?? `Karyawan ${counter}`,
      email: overrides.email ?? `karyawan${counter}@resto.id`,
      role: overrides.role ?? Role.EMPLOYEE,
      status: overrides.status ?? 'active',
      password: password === null ? null : await bcrypt.hash(password, env.BCRYPT_ROUNDS),
      departmentId: overrides.departmentId ?? null,
      positionId: overrides.positionId ?? null,
      gender: overrides.gender ?? null,
      phoneNumber: overrides.phoneNumber ?? null,
      customRoleId: overrides.customRoleId ?? null,
    },
  });
};

export const makeDepartment = async (name: string) =>
  prisma.department.create({ data: { id: generateULID(), name } });

export const makeLeaveType = async (
  overrides: {
    code?: string;
    name?: string;
    defaultQuotaDays?: number | null;
    deductsBalance?: boolean;
    requiresAttachment?: boolean;
    maxConsecutiveDays?: number | null;
    genderRestriction?: string | null;
    countsCalendarDays?: boolean;
  } = {}
) => {
  counter += 1;
  return prisma.leaveType.create({
    data: {
      id: generateULID(),
      code: overrides.code ?? `tipe_${counter}`,
      name: overrides.name ?? `Cuti Uji ${counter}`,
      defaultQuotaDays: overrides.defaultQuotaDays ?? 12,
      deductsBalance: overrides.deductsBalance ?? true,
      requiresAttachment: overrides.requiresAttachment ?? false,
      maxConsecutiveDays: overrides.maxConsecutiveDays ?? null,
      genderRestriction: overrides.genderRestriction ?? null,
      countsCalendarDays: overrides.countsCalendarDays ?? false,
    },
  });
};

export const makeLeaveBalance = async (params: {
  employeeId: string;
  leaveTypeId: string;
  year: number;
  entitledDays?: number;
  carriedOverDays?: number;
}) =>
  prisma.leaveBalance.create({
    data: {
      id: generateULID(),
      employeeId: params.employeeId,
      leaveTypeId: params.leaveTypeId,
      year: params.year,
      entitledDays: new Prisma.Decimal(params.entitledDays ?? 12),
      carriedOverDays: new Prisma.Decimal(params.carriedOverDays ?? 0),
    },
  });

export const makeHoliday = async (isoDate: string, name = 'Libur Uji', isCollectiveLeave = false) =>
  prisma.holiday.create({
    data: {
      id: generateULID(),
      date: new Date(`${isoDate}T00:00:00.000Z`),
      name,
      isCollectiveLeave,
    },
  });

export const makePosition = async (name: string, departmentId?: string) =>
  prisma.position.create({
    data: { id: generateULID(), name, departmentId: departmentId ?? null },
  });

export const makeWorkLocation = async (
  overrides: { name?: string; latitude?: number; longitude?: number; radiusMeters?: number } = {}
) => {
  counter += 1;
  return prisma.workLocation.create({
    data: {
      id: generateULID(),
      name: overrides.name ?? `Lokasi ${counter}`,
      // Monas, dipakai sebagai titik acuan tetap di seluruh test.
      latitude: new Prisma.Decimal(overrides.latitude ?? -6.1753924),
      longitude: new Prisma.Decimal(overrides.longitude ?? 106.8271528),
      radiusMeters: overrides.radiusMeters ?? 100,
      qrSecret: `qr-uji-${counter}-${generateULID()}`,
    },
  });
};

/**
 * Membuat shift relatif terhadap waktu sekarang, dinyatakan dalam menit.
 * Check-in selalu memakai jam saat ini, jadi skenario "terlambat" atau
 * "lembur" hanya bisa dibentuk dengan menggeser jadwalnya, bukan jamnya.
 */
export const makeShiftRelative = async (
  employeeId: string,
  startOffsetMinutes: number,
  endOffsetMinutes: number,
  breakHours = 0
) => {
  const mulai = DateTime.now().setZone(TEST_TIMEZONE).plus({ minutes: startOffsetMinutes });
  const selesai = DateTime.now().setZone(TEST_TIMEZONE).plus({ minutes: endOffsetMinutes });

  return prisma.shiftSchedule.create({
    data: {
      id: generateULID(),
      employeeId,
      date: new Date(`${mulai.toISODate()}T00:00:00.000Z`),
      startTime: mulai.toFormat('HH:mm'),
      endTime: selesai.toFormat('HH:mm'),
      breakDuration: new Prisma.Decimal(breakHours),
      status: 'confirmed',
    },
  });
};

/** Presensi yang sudah terbuka sejak beberapa waktu lalu, untuk menguji check-out. */
export const makeOpenAttendance = async (params: {
  employeeId: string;
  minutesAgo: number;
  shiftScheduleId?: string;
  workLocationId?: string;
}) =>
  prisma.attendance.create({
    data: {
      id: generateULID(),
      employeeId: params.employeeId,
      checkInTime: DateTime.now().minus({ minutes: params.minutesAgo }).toJSDate(),
      checkInMethod: 'gps',
      shiftScheduleId: params.shiftScheduleId ?? null,
      workLocationId: params.workLocationId ?? null,
      status: 'present',
    },
  });

export { prisma };
