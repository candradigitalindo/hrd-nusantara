// src/data/indonesianHolidays.ts

export interface HolidaySeed {
  /** YYYY-MM-DD */
  date: string;
  name: string;
  isCollectiveLeave: boolean;
  /** Hari menurut sumber resmi, dipakai untuk memverifikasi tanggalnya. */
  expectedWeekday: string;
}

/**
 * Hari libur nasional dan cuti bersama Indonesia.
 *
 * Sebagian besar tanggalnya berpindah tiap tahun karena mengikuti kalender
 * Hijriah, Imlek, dan Saka, lalu ditetapkan lewat SKB 3 Menteri. Jadi data ini
 * tidak bisa dihitung, hanya bisa disalin dari keputusan resmi — dan harus
 * ditambah manual tiap kali SKB tahun baru terbit.
 *
 * Sumber 2026: SKB 3 Menteri yang ditetapkan 19 September 2025
 * (Menteri Agama, Menteri Ketenagakerjaan, Menteri PANRB), 17 hari libur
 * nasional dan 8 hari cuti bersama.
 *
 * `expectedWeekday` bukan hiasan: satu tanggal salah ketik akan menggeser
 * perhitungan saldo cuti seluruh karyawan, jadi seed memverifikasinya dan
 * berhenti kalau tidak cocok.
 */
export const HOLIDAYS_BY_YEAR: Record<number, HolidaySeed[]> = {
  2026: [
    // --- Libur nasional (17) ---
    { date: '2026-01-01', name: 'Tahun Baru Masehi', isCollectiveLeave: false, expectedWeekday: 'Kamis' },
    { date: '2026-01-16', name: 'Isra Mikraj Nabi Muhammad SAW', isCollectiveLeave: false, expectedWeekday: 'Jumat' },
    { date: '2026-02-17', name: 'Tahun Baru Imlek', isCollectiveLeave: false, expectedWeekday: 'Selasa' },
    { date: '2026-03-19', name: 'Hari Suci Nyepi', isCollectiveLeave: false, expectedWeekday: 'Kamis' },
    { date: '2026-03-21', name: 'Idulfitri 1447 H (hari ke-1)', isCollectiveLeave: false, expectedWeekday: 'Sabtu' },
    { date: '2026-03-22', name: 'Idulfitri 1447 H (hari ke-2)', isCollectiveLeave: false, expectedWeekday: 'Minggu' },
    { date: '2026-04-03', name: 'Wafat Yesus Kristus', isCollectiveLeave: false, expectedWeekday: 'Jumat' },
    { date: '2026-04-05', name: 'Kebangkitan Yesus Kristus (Paskah)', isCollectiveLeave: false, expectedWeekday: 'Minggu' },
    { date: '2026-05-01', name: 'Hari Buruh Internasional', isCollectiveLeave: false, expectedWeekday: 'Jumat' },
    { date: '2026-05-14', name: 'Kenaikan Yesus Kristus', isCollectiveLeave: false, expectedWeekday: 'Kamis' },
    { date: '2026-05-27', name: 'Iduladha 1447 H', isCollectiveLeave: false, expectedWeekday: 'Rabu' },
    { date: '2026-05-31', name: 'Hari Raya Waisak', isCollectiveLeave: false, expectedWeekday: 'Minggu' },
    { date: '2026-06-01', name: 'Hari Lahir Pancasila', isCollectiveLeave: false, expectedWeekday: 'Senin' },
    { date: '2026-06-16', name: 'Tahun Baru Islam 1448 H', isCollectiveLeave: false, expectedWeekday: 'Selasa' },
    { date: '2026-08-17', name: 'Proklamasi Kemerdekaan RI', isCollectiveLeave: false, expectedWeekday: 'Senin' },
    { date: '2026-08-25', name: 'Maulid Nabi Muhammad SAW', isCollectiveLeave: false, expectedWeekday: 'Selasa' },
    { date: '2026-12-25', name: 'Kelahiran Yesus Kristus (Natal)', isCollectiveLeave: false, expectedWeekday: 'Jumat' },

    // --- Cuti bersama (8) ---
    { date: '2026-02-16', name: 'Cuti Bersama Tahun Baru Imlek', isCollectiveLeave: true, expectedWeekday: 'Senin' },
    { date: '2026-03-18', name: 'Cuti Bersama Hari Suci Nyepi', isCollectiveLeave: true, expectedWeekday: 'Rabu' },
    { date: '2026-03-20', name: 'Cuti Bersama Idulfitri', isCollectiveLeave: true, expectedWeekday: 'Jumat' },
    { date: '2026-03-23', name: 'Cuti Bersama Idulfitri', isCollectiveLeave: true, expectedWeekday: 'Senin' },
    { date: '2026-03-24', name: 'Cuti Bersama Idulfitri', isCollectiveLeave: true, expectedWeekday: 'Selasa' },
    { date: '2026-05-15', name: 'Cuti Bersama Kenaikan Yesus Kristus', isCollectiveLeave: true, expectedWeekday: 'Jumat' },
    { date: '2026-05-28', name: 'Cuti Bersama Iduladha', isCollectiveLeave: true, expectedWeekday: 'Kamis' },
    { date: '2026-12-24', name: 'Cuti Bersama Natal', isCollectiveLeave: true, expectedWeekday: 'Kamis' },
  ],
};

export const WEEKDAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/**
 * Memastikan tiap tanggal benar-benar jatuh pada hari yang disebut sumber.
 * Mengembalikan daftar ketidakcocokan; kosong berarti semuanya konsisten.
 */
export const verifyHolidayWeekdays = (
  entries: HolidaySeed[]
): { date: string; name: string; expected: string; actual: string }[] =>
  entries
    .map((h) => {
      const actual = WEEKDAY_NAMES[new Date(`${h.date}T00:00:00.000Z`).getUTCDay()];
      return { date: h.date, name: h.name, expected: h.expectedWeekday, actual };
    })
    .filter((h) => h.expected !== h.actual);
