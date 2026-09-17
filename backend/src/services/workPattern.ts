// src/services/workPattern.ts
import { prisma } from '../lib/prisma';
import {
  calendarKey,
  isoWeekKey,
  fixedPatternResolver,
  shiftPatternResolver,
  DEFAULT_WORKING_WEEKDAYS,
  type WorkingDayResolver,
} from '../utils/leaveDays';

export interface ResolvedWorkPattern {
  id: string | null;
  code: string;
  name: string;
  type: 'fixed' | 'shift';
  workingWeekdays: number[];
  observesPublicHolidays: boolean;
}

/**
 * Pola terakhir kalau tidak ada yang dikonfigurasi sama sekali.
 * Senin–Sabtu, hari libur nasional dihormati — jam kantor yang lazim.
 */
const POLA_BAWAAN: ResolvedWorkPattern = {
  id: null,
  code: 'default_office',
  name: 'Kantor (Senin–Sabtu)',
  type: 'fixed',
  workingWeekdays: DEFAULT_WORKING_WEEKDAYS,
  observesPublicHolidays: true,
};

const normalkan = (p: {
  id: string;
  code: string;
  name: string;
  type: string;
  workingWeekdays: number[];
  observesPublicHolidays: boolean;
}): ResolvedWorkPattern => ({
  id: p.id,
  code: p.code,
  name: p.name,
  type: p.type === 'shift' ? 'shift' : 'fixed',
  workingWeekdays: p.workingWeekdays,
  observesPublicHolidays: p.observesPublicHolidays,
});

/**
 * Menentukan pola kerja seorang karyawan.
 *
 * Urutannya: pola milik karyawan sendiri, lalu pola departemennya, lalu pola
 * yang ditandai bawaan perusahaan. Berjenjang seperti ini supaya HR cukup
 * menetapkan satu pola per departemen, dan hanya memberi pengecualian pada
 * orang yang memang berbeda.
 */
export const resolveWorkPattern = async (employeeId: string): Promise<ResolvedWorkPattern> => {
  const karyawan = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      workPattern: true,
      department: { select: { workPattern: true } },
    },
  });

  if (karyawan?.workPattern?.isActive) return normalkan(karyawan.workPattern);
  if (karyawan?.department?.workPattern?.isActive) {
    return normalkan(karyawan.department.workPattern);
  }

  const bawaan = await prisma.workPattern.findFirst({
    where: { isDefault: true, isActive: true },
  });

  return bawaan ? normalkan(bawaan) : POLA_BAWAAN;
};

/**
 * Menyusun penentu hari kerja untuk satu karyawan pada satu rentang tanggal.
 *
 * Untuk pola 'shift', roster karyawan dibaca lebih dulu: hari kerjanya adalah
 * hari ia benar-benar dijadwalkan, bukan hari dalam pekan.
 */
export const buildResolver = async (params: {
  employeeId: string;
  pattern: ResolvedWorkPattern;
  startDate: Date;
  endDate: Date;
}): Promise<WorkingDayResolver> => {
  const { employeeId, pattern, startDate, endDate } = params;

  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: startDate, lte: endDate } },
    select: { date: true },
  });
  const holidayKeys = new Set(holidays.map((h) => calendarKey(h.date)));

  if (pattern.type === 'fixed') {
    return fixedPatternResolver({
      workingWeekdays: pattern.workingWeekdays,
      holidayKeys,
      observesPublicHolidays: pattern.observesPublicHolidays,
    });
  }

  // Rentang dilebarkan sepekan ke kiri dan kanan supaya pekan di ujung
  // rentang tetap bisa dinilai sudah ter-roster atau belum.
  const sepekan = 7 * 24 * 60 * 60 * 1000;
  const shifts = await prisma.shiftSchedule.findMany({
    where: {
      employeeId,
      status: { not: 'cancelled' },
      date: {
        gte: new Date(startDate.getTime() - sepekan),
        lte: new Date(endDate.getTime() + sepekan),
      },
    },
    select: { date: true },
  });

  return shiftPatternResolver({
    scheduledDateKeys: new Set(shifts.map((s) => calendarKey(s.date))),
    rosteredWeekKeys: new Set(shifts.map((s) => isoWeekKey(s.date))),
    fallbackWeekdays: pattern.workingWeekdays,
    holidayKeys,
    observesPublicHolidays: pattern.observesPublicHolidays,
  });
};
