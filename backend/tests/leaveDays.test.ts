import {
  calculateLeaveDays,
  fixedPatternResolver,
  shiftPatternResolver,
  eachCalendarDay,
  rangesOverlap,
  calendarKey,
  isoWeekKey,
  DEFAULT_WORKING_WEEKDAYS,
} from '../src/utils/leaveDays';

const tgl = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// 2026-03-02 Senin ... 2026-03-07 Sabtu, 2026-03-08 Minggu.
const SENIN = '2026-03-02';
const RABU = '2026-03-04';
const SABTU = '2026-03-07';
const MINGGU = '2026-03-08';

const KANTOR = [1, 2, 3, 4, 5, 6]; // Senin–Sabtu

const kantor = (holidays: string[] = [], observes = true) =>
  fixedPatternResolver({
    workingWeekdays: KANTOR,
    holidayKeys: new Set(holidays),
    observesPublicHolidays: observes,
  });

const hitung = (start: string, end: string, resolver: ReturnType<typeof kantor>, kalender = false) =>
  calculateLeaveDays({
    startDate: tgl(start),
    endDate: tgl(end),
    resolver,
    countsCalendarDays: kalender,
  });

describe('Pola kantor Senin–Sabtu', () => {
  it('menghitung Sabtu sebagai hari kerja', () => {
    // Inti koreksinya: kantor bekerja sampai Sabtu, jadi Senin–Sabtu = 6 hari.
    expect(hitung(SENIN, SABTU, kantor()).countedDays).toBe(6);
  });

  it('hanya melewatkan hari Minggu', () => {
    const h = hitung(SENIN, MINGGU, kantor());
    expect(h.countedDays).toBe(6);
    expect(h.restDays).toBe(1);
    expect(h.totalCalendarDays).toBe(7);
  });

  it('melewati hari libur nasional', () => {
    const h = hitung(SENIN, SABTU, kantor([RABU]));
    expect(h.countedDays).toBe(5);
    expect(h.publicHolidayDays).toBe(1);
  });

  it('tidak menghitung ganda libur yang jatuh di hari istirahat', () => {
    const h = hitung(SENIN, MINGGU, kantor([MINGGU]));
    expect(h.restDays).toBe(1);
    expect(h.publicHolidayDays).toBe(0);
    expect(h.countedDays).toBe(6);
  });

  it('memberi nol hari untuk cuti yang jatuh di hari Minggu saja', () => {
    expect(hitung(MINGGU, MINGGU, kantor()).countedDays).toBe(0);
  });

  it('mengabaikan libur nasional bila pola tidak menghormatinya', () => {
    // Hotel dan restoran justru buka saat libur nasional.
    expect(hitung(SENIN, SABTU, kantor([RABU], false)).countedDays).toBe(6);
  });

  it('menghitung kalender penuh untuk cuti melahirkan', () => {
    expect(hitung(SENIN, MINGGU, kantor(), true).countedDays).toBe(7);
  });

  it('menolak tanggal terbalik', () => {
    expect(() => hitung(SABTU, SENIN, kantor())).toThrow();
  });
});

describe('Pola lima hari (Senin–Jumat)', () => {
  const limaHari = fixedPatternResolver({
    workingWeekdays: [1, 2, 3, 4, 5],
    holidayKeys: new Set(),
    observesPublicHolidays: true,
  });

  it('melewatkan Sabtu dan Minggu', () => {
    const h = hitung(SENIN, MINGGU, limaHari);
    expect(h.countedDays).toBe(5);
    expect(h.restDays).toBe(2);
  });
});

describe('Pola shift untuk outlet dan hotel', () => {
  /**
   * Hari libur staf outlet berputar mengikuti roster, jadi yang menentukan
   * adalah jadwal shift — bukan hari dalam pekan.
   */
  const shiftResolver = (params: {
    jadwal: string[];
    rosterTerbit: string[];
    cadangan?: number[];
  }) =>
    shiftPatternResolver({
      scheduledDateKeys: new Set(params.jadwal),
      rosteredWeekKeys: new Set(params.rosterTerbit.map((d) => isoWeekKey(tgl(d)))),
      fallbackWeekdays: params.cadangan ?? KANTOR,
      holidayKeys: new Set(),
      observesPublicHolidays: false,
    });

  it('menghitung hanya hari yang benar-benar dijadwalkan', () => {
    // Dijadwalkan Senin, Selasa, Kamis; Rabu adalah hari liburnya.
    const r = shiftResolver({
      jadwal: [SENIN, '2026-03-03', '2026-03-05'],
      rosterTerbit: [SENIN],
    });

    const h = hitung(SENIN, '2026-03-05', r);
    expect(h.countedDays).toBe(3);
    expect(h.notRosteredDays).toBe(1);
  });

  it('menghitung hari Minggu bila orangnya memang dijadwalkan', () => {
    // Hotel beroperasi tujuh hari; Minggu bisa jadi hari kerja.
    const r = shiftResolver({ jadwal: [MINGGU], rosterTerbit: [MINGGU] });

    expect(hitung(MINGGU, MINGGU, r).countedDays).toBe(1);
  });

  it('tidak memotong saldo untuk hari libur rosternya', () => {
    const r = shiftResolver({ jadwal: [SENIN], rosterTerbit: [SENIN] });

    // Selasa tidak dijadwalkan padahal roster pekan itu sudah terbit.
    expect(hitung('2026-03-03', '2026-03-03', r).countedDays).toBe(0);
  });

  it('memakai pola cadangan saat roster pekan itu belum terbit', () => {
    // Cuti sering diajukan jauh sebelum jadwal disusun.
    const r = shiftResolver({ jadwal: [], rosterTerbit: [] });

    const h = hitung(SENIN, SABTU, r);
    expect(h.countedDays).toBe(6);
    // Ditandai taksiran supaya HR tahu angkanya belum pasti.
    expect(h.estimatedDays).toBe(6);
  });

  it('tidak menandai taksiran bila rosternya sudah ada', () => {
    const r = shiftResolver({ jadwal: [SENIN, '2026-03-03'], rosterTerbit: [SENIN] });

    expect(hitung(SENIN, '2026-03-03', r).estimatedDays).toBe(0);
  });

  it('membedakan pekan yang sudah ter-roster dari yang belum', () => {
    // Roster pekan pertama terbit, pekan kedua belum.
    const r = shiftResolver({
      jadwal: [SENIN, '2026-03-03'],
      rosterTerbit: [SENIN],
    });

    const pekanPertama = hitung(SENIN, '2026-03-07', r);
    expect(pekanPertama.estimatedDays).toBe(0);

    const pekanKedua = hitung('2026-03-09', '2026-03-14', r);
    expect(pekanKedua.estimatedDays).toBeGreaterThan(0);
  });
});

describe('isoWeekKey', () => {
  it('menempatkan Senin dan Minggu pekan yang sama pada kunci yang sama', () => {
    // 2026-03-02 Senin sampai 2026-03-08 Minggu adalah satu pekan ISO.
    expect(isoWeekKey(tgl(SENIN))).toBe(isoWeekKey(tgl(MINGGU)));
  });

  it('memisahkan pekan yang berbeda', () => {
    expect(isoWeekKey(tgl(SENIN))).not.toBe(isoWeekKey(tgl('2026-03-09')));
  });

  it('menangani pergantian tahun', () => {
    // 2026-12-31 Kamis dan 2027-01-01 Jumat masih satu pekan ISO.
    expect(isoWeekKey(tgl('2026-12-31'))).toBe(isoWeekKey(tgl('2027-01-01')));
  });
});

describe('Pembantu lain', () => {
  it('DEFAULT_WORKING_WEEKDAYS adalah Senin sampai Sabtu', () => {
    expect(DEFAULT_WORKING_WEEKDAYS).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('eachCalendarDay inklusif di kedua ujung', () => {
    expect(eachCalendarDay(tgl(SENIN), tgl(RABU))).toHaveLength(3);
  });

  it('calendarKey menghasilkan YYYY-MM-DD', () => {
    expect(calendarKey(tgl(SABTU))).toBe(SABTU);
  });

  it('rangesOverlap mendeteksi irisan dan ujung bersentuhan', () => {
    expect(rangesOverlap(tgl(SENIN), tgl(RABU), tgl(RABU), tgl(SABTU))).toBe(true);
    expect(rangesOverlap(tgl(SENIN), tgl('2026-03-03'), tgl(RABU), tgl(SABTU))).toBe(false);
  });
});
