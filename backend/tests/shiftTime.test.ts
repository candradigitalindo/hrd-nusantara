import { DateTime } from 'luxon';
import {
  parseHHmm,
  resolveShiftWindow,
  evaluateCheckIn,
  evaluateCheckOut,
  pickNearestShift,
  businessDayRange,
} from '../src/utils/shiftTime';
import { distanceInMeters, isWithinRadius } from '../src/utils/geo';

const TZ = 'Asia/Jakarta';
const tanggal = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' }).toJSDate();
const waktu = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();

describe('parseHHmm', () => {
  it('menerima jam yang valid', () => {
    expect(parseHHmm('09:30')).toEqual({ hour: 9, minute: 30 });
    expect(parseHHmm('00:00')).toEqual({ hour: 0, minute: 0 });
    expect(parseHHmm('23:59')).toEqual({ hour: 23, minute: 59 });
  });

  it('menolak jam yang tidak masuk akal', () => {
    for (const buruk of ['24:00', '9:30', '12:60', '', 'pagi']) {
      expect(() => parseHHmm(buruk)).toThrow();
    }
  });
});

describe('resolveShiftWindow', () => {
  it('menghitung shift siang biasa dalam zona waktu operasional', () => {
    const { start, end } = resolveShiftWindow(tanggal('2026-03-10'), '08:00', '17:00', TZ);

    // 08:00 WIB = 01:00 UTC
    expect(start.toISOString()).toBe('2026-03-10T01:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-10T10:00:00.000Z');
  });

  it('memperlakukan shift malam sebagai berakhir keesokan hari', () => {
    const { start, end } = resolveShiftWindow(tanggal('2026-03-10'), '22:00', '06:00', TZ);

    expect(start.toISOString()).toBe('2026-03-10T15:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-10T23:00:00.000Z');
    expect(end.getTime()).toBeGreaterThan(start.getTime());
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(8);
  });

  it('menangani shift 24 jam penuh (jam mulai sama dengan jam selesai)', () => {
    const { start, end } = resolveShiftWindow(tanggal('2026-03-10'), '07:00', '07:00', TZ);
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(24);
  });
});

describe('evaluateCheckIn', () => {
  const mulai = waktu('2026-03-10T08:00');

  it('menganggap tepat waktu kalau datang sebelum jam mulai', () => {
    expect(evaluateCheckIn(mulai, waktu('2026-03-10T07:45'), 5)).toEqual({
      lateMinutes: 0,
      status: 'present',
    });
  });

  it('memaafkan keterlambatan dalam batas toleransi', () => {
    expect(evaluateCheckIn(mulai, waktu('2026-03-10T08:05'), 5)).toEqual({
      lateMinutes: 0,
      status: 'present',
    });
  });

  it('menghitung keterlambatan utuh begitu toleransi terlewat', () => {
    // 20 menit, bukan 20 dikurangi toleransi.
    expect(evaluateCheckIn(mulai, waktu('2026-03-10T08:20'), 5)).toEqual({
      lateMinutes: 20,
      status: 'late',
    });
  });
});

describe('evaluateCheckOut', () => {
  const dasar = {
    checkInTime: waktu('2026-03-10T08:00'),
    shiftEnd: waktu('2026-03-10T17:00'),
    breakHours: 1,
    toleranceMinutes: 5,
    minOvertimeMinutes: 30,
  };

  it('mengurangi jam istirahat dari jam kerja', () => {
    const hasil = evaluateCheckOut({ ...dasar, checkOutTime: waktu('2026-03-10T17:00') });
    expect(hasil.workedMinutes).toBe(480); // 9 jam - 1 jam istirahat
  });

  it('mencatat pulang cepat di luar toleransi', () => {
    const hasil = evaluateCheckOut({ ...dasar, checkOutTime: waktu('2026-03-10T16:00') });
    expect(hasil.earlyLeaveMinutes).toBe(60);
  });

  it('tidak menghitung pulang cepat dalam batas toleransi', () => {
    const hasil = evaluateCheckOut({ ...dasar, checkOutTime: waktu('2026-03-10T16:57') });
    expect(hasil.earlyLeaveMinutes).toBe(0);
  });

  it('mengabaikan kelebihan menit di bawah ambang lembur', () => {
    const hasil = evaluateCheckOut({ ...dasar, checkOutTime: waktu('2026-03-10T17:20') });
    expect(hasil.overtimeHours).toBe(0);
  });

  it('menghitung lembur setelah ambang terlewat', () => {
    const hasil = evaluateCheckOut({ ...dasar, checkOutTime: waktu('2026-03-10T19:30') });
    expect(hasil.overtimeHours).toBe(2.5);
  });

  it('tidak menilai pulang cepat atau lembur kalau tidak ada jadwal shift', () => {
    const hasil = evaluateCheckOut({
      ...dasar,
      shiftEnd: null,
      checkOutTime: waktu('2026-03-10T19:30'),
    });
    expect(hasil).toMatchObject({ earlyLeaveMinutes: 0, overtimeHours: 0 });
    expect(hasil.workedMinutes).toBe(630);
  });

  it('tidak pernah menghasilkan jam kerja negatif', () => {
    const hasil = evaluateCheckOut({
      ...dasar,
      breakHours: 12,
      checkOutTime: waktu('2026-03-10T17:00'),
    });
    expect(hasil.workedMinutes).toBe(0);
  });
});

describe('pickNearestShift (split shift di F&B)', () => {
  it('memilih shift yang jam mulainya paling dekat dengan check-in', () => {
    const pagi = { start: waktu('2026-03-10T07:00'), label: 'pagi' };
    const malam = { start: waktu('2026-03-10T17:00'), label: 'malam' };

    expect(pickNearestShift([pagi, malam], waktu('2026-03-10T16:50'))?.label).toBe('malam');
    expect(pickNearestShift([pagi, malam], waktu('2026-03-10T07:10'))?.label).toBe('pagi');
  });

  it('mengembalikan null kalau tidak ada shift', () => {
    expect(pickNearestShift([], new Date())).toBeNull();
  });
});

describe('businessDayRange', () => {
  const tanggalKalender = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it('memotong hari mengikuti zona operasional, bukan UTC', () => {
    const { gte, lt } = businessDayRange(
      tanggalKalender('2026-03-10'),
      tanggalKalender('2026-03-10'),
      TZ
    );

    // 10 Maret 00:00 WIB = 9 Maret 17:00 UTC.
    expect(gte.toISOString()).toBe('2026-03-09T17:00:00.000Z');
    expect(lt.toISOString()).toBe('2026-03-10T17:00:00.000Z');
  });

  it('memasukkan presensi dini hari shift malam ke tanggal yang benar', () => {
    const { gte, lt } = businessDayRange(
      tanggalKalender('2026-03-10'),
      tanggalKalender('2026-03-10'),
      TZ
    );

    // Check-out pukul 01:00 WIB tanggal 10 Maret = 9 Maret 18:00 UTC.
    // Dengan batas UTC, presensi ini akan hilang dari laporan tanggal 10.
    const diniHari = waktu('2026-03-10T01:00');

    expect(diniHari >= gte && diniHari < lt).toBe(true);
    expect(diniHari.toISOString()).toBe('2026-03-09T18:00:00.000Z');
  });

  it('menghitung rentang beberapa hari secara inklusif di kedua ujung', () => {
    const { gte, lt } = businessDayRange(
      tanggalKalender('2026-03-10'),
      tanggalKalender('2026-03-12'),
      TZ
    );

    expect((lt.getTime() - gte.getTime()) / 3_600_000).toBe(72);
  });
});

describe('geofence', () => {
  const monas = { latitude: -6.1753924, longitude: 106.8271528 };

  it('menghitung jarak yang masuk akal antara dua titik di Jakarta', () => {
    const kotaTua = { latitude: -6.1352, longitude: 106.8133 };
    const jarak = distanceInMeters(monas, kotaTua);

    // Jarak sebenarnya sekitar 4,8 km.
    expect(jarak).toBeGreaterThan(4_500);
    expect(jarak).toBeLessThan(5_200);
  });

  it('memberi jarak nol untuk titik yang sama', () => {
    expect(distanceInMeters(monas, monas)).toBeCloseTo(0, 6);
  });

  it('simetris ke dua arah', () => {
    const lain = { latitude: -6.2, longitude: 106.9 };
    expect(distanceInMeters(monas, lain)).toBeCloseTo(distanceInMeters(lain, monas), 6);
  });

  it('menentukan titik di dalam dan di luar radius', () => {
    // Sekitar 111 meter ke utara.
    const dekat = { latitude: monas.latitude + 0.001, longitude: monas.longitude };

    expect(isWithinRadius(dekat, monas, 150)).toBe(true);
    expect(isWithinRadius(dekat, monas, 50)).toBe(false);
  });
});
