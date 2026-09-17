// src/utils/shiftTime.ts
import { DateTime } from 'luxon';

export interface ShiftWindow {
  start: Date;
  end: Date;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const parseHHmm = (value: string): { hour: number; minute: number } => {
  const match = HHMM.exec(value);
  if (!match) {
    throw new Error(`Format jam tidak valid: "${value}" (harus HH:mm)`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
};

/**
 * Mengubah tanggal shift + "HH:mm" lokal menjadi rentang waktu absolut.
 *
 * Shift yang jam selesainya lebih awal dari jam mulai (22:00–06:00) berarti
 * berakhir keesokan harinya. Ini bukan kasus pinggiran di hotel dan F&B —
 * shift malam adalah operasi sehari-hari.
 */
export const resolveShiftWindow = (
  date: Date,
  startTime: string,
  endTime: string,
  timezone: string
): ShiftWindow => {
  const start = parseHHmm(startTime);
  const end = parseHHmm(endTime);

  // `date` tersimpan sebagai tengah malam UTC; yang dipakai hanya komponen
  // tanggalnya, lalu ditempelkan ke zona waktu operasional.
  const isoDate = DateTime.fromJSDate(date, { zone: 'utc' }).toISODate();
  if (!isoDate) throw new Error('Tanggal shift tidak valid');

  const base = DateTime.fromISO(isoDate, { zone: timezone });
  const startAt = base.set({ ...start, second: 0, millisecond: 0 });
  let endAt = base.set({ ...end, second: 0, millisecond: 0 });

  if (endAt <= startAt) {
    endAt = endAt.plus({ days: 1 });
  }

  return { start: startAt.toJSDate(), end: endAt.toJSDate() };
};

/**
 * Mengubah rentang tanggal kalender menjadi rentang waktu absolut, mengikuti
 * hari kerja di zona waktu operasional.
 *
 * Tanpa ini, rentang dipotong pada tengah malam UTC — yang di WIB jatuh pukul
 * 07:00. Presensi shift malam pukul 01:00 WIB akan masuk ke tanggal UTC
 * sebelumnya dan lenyap dari laporan hari itu.
 */
export const businessDayRange = (
  startDate: Date,
  endDate: Date,
  timezone: string
): { gte: Date; lt: Date } => {
  const startIso = DateTime.fromJSDate(startDate, { zone: 'utc' }).toISODate();
  const endIso = DateTime.fromJSDate(endDate, { zone: 'utc' }).toISODate();

  if (!startIso || !endIso) throw new Error('Rentang tanggal tidak valid');

  return {
    gte: DateTime.fromISO(startIso, { zone: timezone }).startOf('day').toJSDate(),
    // Eksklusif di ujung: tanggal akhir ikut terhitung penuh.
    lt: DateTime.fromISO(endIso, { zone: timezone }).plus({ days: 1 }).startOf('day').toJSDate(),
  };
};

const minutesBetween = (from: Date, to: Date): number =>
  Math.floor((to.getTime() - from.getTime()) / 60_000);

export interface CheckInEvaluation {
  lateMinutes: number;
  status: 'present' | 'late';
}

/**
 * Toleransi bersifat memaafkan penuh: datang dalam rentang toleransi dihitung
 * tepat waktu, tapi begitu terlewat, keterlambatan dihitung utuh dari jam
 * mulai — bukan dikurangi toleransinya.
 */
export const evaluateCheckIn = (
  shiftStart: Date,
  checkInTime: Date,
  toleranceMinutes: number
): CheckInEvaluation => {
  const late = minutesBetween(shiftStart, checkInTime);

  if (late <= toleranceMinutes) {
    return { lateMinutes: 0, status: 'present' };
  }
  return { lateMinutes: late, status: 'late' };
};

export interface CheckOutEvaluation {
  workedMinutes: number;
  earlyLeaveMinutes: number;
  overtimeHours: number;
}

export const evaluateCheckOut = (params: {
  checkInTime: Date;
  checkOutTime: Date;
  shiftEnd: Date | null;
  breakHours: number;
  toleranceMinutes: number;
  minOvertimeMinutes: number;
}): CheckOutEvaluation => {
  const { checkInTime, checkOutTime, shiftEnd, breakHours } = params;

  const gross = minutesBetween(checkInTime, checkOutTime);
  const workedMinutes = Math.max(0, gross - Math.round(breakHours * 60));

  // Tanpa jadwal shift, tidak ada acuan untuk menilai pulang cepat atau lembur.
  if (!shiftEnd) {
    return { workedMinutes, earlyLeaveMinutes: 0, overtimeHours: 0 };
  }

  const diff = minutesBetween(shiftEnd, checkOutTime);

  const earlyLeaveMinutes = diff < -params.toleranceMinutes ? Math.abs(diff) : 0;
  const overtimeHours =
    diff >= params.minOvertimeMinutes ? Math.round((diff / 60) * 100) / 100 : 0;

  return { workedMinutes, earlyLeaveMinutes, overtimeHours };
};

/**
 * Dari beberapa shift di tanggal yang sama (F&B lazim memakai split shift),
 * pilih yang jam mulainya paling dekat dengan waktu check-in.
 */
export const pickNearestShift = <T extends { start: Date }>(
  shifts: T[],
  checkInTime: Date
): T | null => {
  if (shifts.length === 0) return null;

  return shifts.reduce((nearest, shift) => {
    const current = Math.abs(shift.start.getTime() - checkInTime.getTime());
    const best = Math.abs(nearest.start.getTime() - checkInTime.getTime());
    return current < best ? shift : nearest;
  });
};
