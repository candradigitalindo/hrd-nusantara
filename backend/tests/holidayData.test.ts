import {
  HOLIDAYS_BY_YEAR,
  verifyHolidayWeekdays,
  WEEKDAY_NAMES,
} from '../src/data/indonesianHolidays';

describe('Kalender hari libur Indonesia', () => {
  const tahun = 2026;
  const daftar = HOLIDAYS_BY_YEAR[tahun];

  it('setiap tanggal jatuh pada hari yang disebut sumber resmi', () => {
    // Penjaga terkuat terhadap salah ketik tanggal: satu digit meleset hampir
    // pasti memindahkan harinya. Tanggal yang salah menggeser perhitungan
    // saldo cuti seluruh karyawan.
    expect(verifyHolidayWeekdays(daftar)).toEqual([]);
  });

  it('jumlahnya sesuai SKB 3 Menteri 2026: 17 libur nasional dan 8 cuti bersama', () => {
    expect(daftar.filter((h) => !h.isCollectiveLeave)).toHaveLength(17);
    expect(daftar.filter((h) => h.isCollectiveLeave)).toHaveLength(8);
  });

  it('tidak ada tanggal yang terdaftar dua kali', () => {
    const tanggal = daftar.map((h) => h.date);
    expect(new Set(tanggal).size).toBe(tanggal.length);
  });

  it('semua tanggal berada di tahun yang benar dan berformat YYYY-MM-DD', () => {
    for (const h of daftar) {
      expect(h.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(h.date.startsWith(String(tahun))).toBe(true);
    }
  });

  it('memuat hari libur bertanggal tetap yang ditetapkan undang-undang', () => {
    // Tanggal-tanggal ini tidak pernah berpindah, jadi boleh dipatok di test.
    const tetap = [
      ['2026-01-01', 'Tahun Baru'],
      ['2026-05-01', 'Hari Buruh'],
      ['2026-06-01', 'Pancasila'],
      ['2026-08-17', 'Kemerdekaan'],
      ['2026-12-25', 'Natal'],
    ];

    for (const [tanggal] of tetap) {
      expect(daftar.some((h) => h.date === tanggal && !h.isCollectiveLeave)).toBe(true);
    }
  });

  it('cuti bersama ditandai terpisah dari libur nasional', () => {
    // Bedanya penting: cuti bersama memotong kuota cuti tahunan karyawan,
    // libur nasional tidak.
    const idulfitriBersama = daftar.find((h) => h.date === '2026-03-20');
    const idulfitriNasional = daftar.find((h) => h.date === '2026-03-21');

    expect(idulfitriBersama?.isCollectiveLeave).toBe(true);
    expect(idulfitriNasional?.isCollectiveLeave).toBe(false);
  });

  it('verifyHolidayWeekdays benar-benar menangkap tanggal yang salah', () => {
    // Tanpa pengecekan ini, test pertama bisa saja hijau karena fungsinya
    // selalu mengembalikan array kosong.
    const rusak = [
      { date: '2026-08-17', name: 'Kemerdekaan', isCollectiveLeave: false, expectedWeekday: 'Jumat' },
    ];

    const hasil = verifyHolidayWeekdays(rusak);
    expect(hasil).toHaveLength(1);
    expect(hasil[0].actual).toBe('Senin');
  });

  it('WEEKDAY_NAMES dimulai dari Minggu, sesuai getUTCDay()', () => {
    expect(WEEKDAY_NAMES[0]).toBe('Minggu');
    expect(WEEKDAY_NAMES[6]).toBe('Sabtu');
  });
});
