// src/utils/leaveDays.ts

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Kunci tanggal kalender (YYYY-MM-DD) dari tanggal yang tersimpan UTC. */
export const calendarKey = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Kunci pekan ISO, dipakai untuk mengetahui apakah roster suatu pekan sudah
 * terbit. Tanggal cuti adalah tanggal kalender murni (tengah malam UTC),
 * jadi seluruh perhitungan memakai komponen UTC.
 */
export const isoWeekKey = (date: Date): string => {
  const d = new Date(date.getTime());
  // Geser ke Kamis pekan yang sama; nomor pekan ISO ditentukan oleh Kamis.
  const hari = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - hari + 3);

  const awalTahun = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const hariAwal = (awalTahun.getUTCDay() + 6) % 7;
  awalTahun.setUTCDate(awalTahun.getUTCDate() - hariAwal + 3);

  const pekan = 1 + Math.round((d.getTime() - awalTahun.getTime()) / (7 * MS_PER_DAY));
  return `${d.getUTCFullYear()}-W${String(pekan).padStart(2, '0')}`;
};

export const eachCalendarDay = (start: Date, end: Date): Date[] => {
  const hasil: Date[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += MS_PER_DAY) {
    hasil.push(new Date(t));
  }
  return hasil;
};

/** Alasan sebuah tanggal tidak memotong saldo cuti. */
export type NonWorkingReason = 'rest_day' | 'public_holiday' | 'not_rostered';

export interface DayAssessment {
  date: Date;
  isWorkingDay: boolean;
  reason?: NonWorkingReason;
  /** true bila hasilnya ditebak dari pola cadangan karena roster belum terbit. */
  fromFallback?: boolean;
}

export type WorkingDayResolver = (date: Date) => DayAssessment;

/**
 * Pola hari kerja tetap, misalnya kantor yang bekerja Senin sampai Sabtu.
 * `workingWeekdays` memakai 0 = Minggu sampai 6 = Sabtu.
 */
export const fixedPatternResolver = (params: {
  workingWeekdays: number[];
  holidayKeys: Set<string>;
  observesPublicHolidays: boolean;
}): WorkingDayResolver => {
  const hariKerja = new Set(params.workingWeekdays);

  return (date) => {
    if (!hariKerja.has(date.getUTCDay())) {
      return { date, isWorkingDay: false, reason: 'rest_day' };
    }
    if (params.observesPublicHolidays && params.holidayKeys.has(calendarKey(date))) {
      return { date, isWorkingDay: false, reason: 'public_holiday' };
    }
    return { date, isWorkingDay: true };
  };
};

/**
 * Pola berbasis roster untuk outlet dan hotel, yang buka tujuh hari sepekan
 * dengan hari libur berputar per karyawan.
 *
 * Yang menentukan adalah jadwal shift: kalau karyawan memang tidak dijadwalkan
 * pada suatu tanggal, ia sudah libur dan cutinya tidak memotong saldo.
 *
 * Persoalannya, cuti sering diajukan jauh sebelum roster disusun. "Tidak ada
 * shift" karena itu ambigu — bisa berarti hari libur, bisa berarti roster belum
 * terbit. Keduanya dibedakan lewat pekan: bila karyawan punya shift lain di
 * pekan yang sama, roster pekan itu dianggap sudah terbit. Kalau belum, dipakai
 * pola cadangan dan tanggal tersebut ditandai supaya HR tahu angkanya taksiran.
 */
export const shiftPatternResolver = (params: {
  scheduledDateKeys: Set<string>;
  rosteredWeekKeys: Set<string>;
  fallbackWeekdays: number[];
  holidayKeys: Set<string>;
  observesPublicHolidays: boolean;
}): WorkingDayResolver => {
  const cadangan = new Set(params.fallbackWeekdays);

  return (date) => {
    const kunci = calendarKey(date);

    if (params.scheduledDateKeys.has(kunci)) {
      return { date, isWorkingDay: true };
    }

    if (params.rosteredWeekKeys.has(isoWeekKey(date))) {
      // Roster pekan ini sudah ada dan orangnya tidak dijadwalkan: memang libur.
      return { date, isWorkingDay: false, reason: 'not_rostered' };
    }

    if (!cadangan.has(date.getUTCDay())) {
      return { date, isWorkingDay: false, reason: 'rest_day', fromFallback: true };
    }
    if (params.observesPublicHolidays && params.holidayKeys.has(kunci)) {
      return { date, isWorkingDay: false, reason: 'public_holiday', fromFallback: true };
    }
    return { date, isWorkingDay: true, fromFallback: true };
  };
};

export interface LeaveDayBreakdown {
  /** Hari yang dipotong dari saldo. */
  countedDays: number;
  restDays: number;
  publicHolidayDays: number;
  notRosteredDays: number;
  totalCalendarDays: number;
  /** Berapa hari yang ditaksir karena roster periode itu belum terbit. */
  estimatedDays: number;
  days: DayAssessment[];
}

/**
 * Menghitung berapa hari sebuah pengajuan cuti memotong saldo.
 *
 * Sebagian jenis cuti dihitung kalender penuh — cuti melahirkan tiga bulan
 * berjalan terus melewati hari libur. Itu diatur lewat `countsCalendarDays`
 * pada jenis cutinya, dan saat aktif seluruh pola hari kerja diabaikan.
 */
export const calculateLeaveDays = (params: {
  startDate: Date;
  endDate: Date;
  resolver: WorkingDayResolver;
  countsCalendarDays: boolean;
}): LeaveDayBreakdown => {
  const { startDate, endDate, resolver, countsCalendarDays } = params;

  if (endDate.getTime() < startDate.getTime()) {
    throw new Error('Tanggal selesai tidak boleh lebih awal dari tanggal mulai');
  }

  const days = eachCalendarDay(startDate, endDate).map((tanggal) => {
    const penilaian = resolver(tanggal);
    return countsCalendarDays
      ? { ...penilaian, isWorkingDay: true, reason: undefined }
      : penilaian;
  });

  return {
    countedDays: days.filter((d) => d.isWorkingDay).length,
    restDays: days.filter((d) => d.reason === 'rest_day').length,
    publicHolidayDays: days.filter((d) => d.reason === 'public_holiday').length,
    notRosteredDays: days.filter((d) => d.reason === 'not_rostered').length,
    totalCalendarDays: days.length,
    estimatedDays: days.filter((d) => d.fromFallback).length,
    days,
  };
};

/** Apakah dua rentang tanggal beririsan. */
export const rangesOverlap = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean =>
  aStart.getTime() <= bEnd.getTime() && bStart.getTime() <= aEnd.getTime();

/**
 * Pola yang dipakai kalau karyawan, departemennya, maupun perusahaan belum
 * menetapkan apa pun. Senin–Sabtu mengikuti jam kantor yang lazim di Indonesia.
 */
export const DEFAULT_WORKING_WEEKDAYS = [1, 2, 3, 4, 5, 6];
