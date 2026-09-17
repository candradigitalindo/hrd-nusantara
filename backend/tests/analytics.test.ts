import {
  turnoverRate,
  tenureDays,
  bucketTenure,
  costPerHire,
  attendanceProductivity,
  summarizeCosts,
  countBy,
} from '../src/utils/analytics';

const tgl = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('turnoverRate', () => {
  it('memakai rata-rata jumlah karyawan sebagai pembagi', () => {
    // 10 keluar, dari 100 menjadi 100 -> 10%.
    expect(turnoverRate({ exits: 10, headcountStart: 100, headcountEnd: 100 })).toBe(10);
  });

  it('tidak melebih-lebihkan pada perusahaan yang menyusut', () => {
    // 20 keluar, 100 -> 80. Rata-rata 90, bukan 80.
    const h = turnoverRate({ exits: 20, headcountStart: 100, headcountEnd: 80 });
    expect(h).toBe(22.22);
    // Kalau memakai jumlah akhir, hasilnya 25% — lebih tinggi dari kenyataan.
    expect(h).toBeLessThan(25);
  });

  it('tidak menyembunyikan perputaran pada perusahaan yang tumbuh', () => {
    // 20 keluar, 80 -> 120. Rata-rata 100.
    const h = turnoverRate({ exits: 20, headcountStart: 80, headcountEnd: 120 });
    expect(h).toBe(20);
    // Kalau memakai jumlah awal, hasilnya 25%; kalau akhir, 16,7%.
    expect(h).toBeGreaterThan(16.7);
  });

  it('mengembalikan nol bila tidak ada karyawan sama sekali', () => {
    expect(turnoverRate({ exits: 0, headcountStart: 0, headcountEnd: 0 })).toBe(0);
  });
});

describe('tenureDays', () => {
  const kini = tgl('2026-09-17');

  it('menghitung masa kerja karyawan yang masih aktif', () => {
    expect(tenureDays(tgl('2026-09-07'), null, kini)).toBe(10);
  });

  it('berhenti menghitung pada tanggal keluar', () => {
    expect(tenureDays(tgl('2026-01-01'), tgl('2026-07-01'), kini)).toBe(181);
  });

  it('mengembalikan null bila tanggal masuk tidak diketahui', () => {
    expect(tenureDays(null, null, kini)).toBeNull();
  });

  it('tidak menghasilkan angka negatif', () => {
    expect(tenureDays(tgl('2026-09-20'), tgl('2026-09-10'), kini)).toBe(0);
  });
});

describe('bucketTenure', () => {
  it('mengelompokkan ke rentang yang bermakna', () => {
    const h = bucketTenure([30, 100, 200, 400, 1000, 2000]);
    const cari = (label: string) => h.find((b) => b.label === label)!.count;

    expect(cari('< 3 bulan')).toBe(1);
    expect(cari('3–6 bulan')).toBe(1);
    expect(cari('6–12 bulan')).toBe(1);
    expect(cari('1–2 tahun')).toBe(1);
    expect(cari('2–5 tahun')).toBe(1);
    expect(cari('> 5 tahun')).toBe(1);
  });

  it('memperlihatkan pola yang tertutup oleh rata-rata', () => {
    // Lima orang keluar dalam tiga bulan, satu bertahan sepuluh tahun.
    // Rata-ratanya ~10 bulan, seolah wajar.
    const h = bucketTenure([20, 30, 40, 50, 60, 3650]);

    expect(h.find((b) => b.label === '< 3 bulan')!.count).toBe(5);
    expect(h.find((b) => b.label === '> 5 tahun')!.count).toBe(1);
  });

  it('menangani daftar kosong', () => {
    expect(bucketTenure([]).every((b) => b.count === 0)).toBe(true);
  });
});

describe('costPerHire', () => {
  it('membagi total biaya dengan jumlah rekrutan', () => {
    expect(costPerHire(30_000_000, 6)).toBe(5_000_000);
  });

  it('mengembalikan null bila belum ada yang direkrut', () => {
    // Nol berarti "merekrut tanpa biaya"; yang benar adalah belum bisa dihitung.
    expect(costPerHire(5_000_000, 0)).toBeNull();
  });
});

describe('attendanceProductivity', () => {
  it('menghitung persentase terhadap shift terjadwal, bukan presensi tercatat', () => {
    // 20 shift dijadwalkan, hadir 15, terlambat 3.
    const h = attendanceProductivity({
      scheduledShifts: 20,
      attendanceCount: 15,
      lateCount: 3,
      totalWorkedMinutes: 15 * 480,
    });

    // 3/20 = 15%. Kalau dibagi jumlah presensi (15), hasilnya 20% —
    // dan karyawan yang sering mangkir justru terlihat jarang terlambat.
    expect(h.latePercentage).toBe(15);
    expect(h.absencePercentage).toBe(25);
    expect(h.averageWorkedHours).toBe(8);
  });

  it('tidak membagi dengan nol', () => {
    const h = attendanceProductivity({
      scheduledShifts: 0,
      attendanceCount: 0,
      lateCount: 0,
      totalWorkedMinutes: 0,
    });

    expect(h).toEqual({ averageWorkedHours: 0, latePercentage: 0, absencePercentage: 0 });
  });

  it('tidak menghasilkan ketidakhadiran negatif bila presensi melebihi jadwal', () => {
    const h = attendanceProductivity({
      scheduledShifts: 10,
      attendanceCount: 12,
      lateCount: 0,
      totalWorkedMinutes: 12 * 480,
    });

    expect(h.absencePercentage).toBe(0);
  });
});

describe('summarizeCosts', () => {
  it('menjumlahkan dan menghitung porsi tiap pos', () => {
    const h = summarizeCosts({ payroll: 80_000_000, training: 15_000_000, recruitment: 5_000_000 });

    expect(h.total).toBe(100_000_000);
    expect(h.shares).toEqual({ payroll: 80, training: 15, recruitment: 5 });
  });

  it('tidak membagi dengan nol saat semua biaya kosong', () => {
    const h = summarizeCosts({ payroll: 0, training: 0, recruitment: 0 });
    expect(h.total).toBe(0);
    expect(h.shares.payroll).toBe(0);
  });
});

describe('countBy', () => {
  it('mengurutkan dari yang terbanyak', () => {
    const h = countBy(
      [{ a: 'x' }, { a: 'y' }, { a: 'x' }, { a: 'z' }, { a: 'x' }],
      (i) => i.a
    );

    expect(h[0]).toEqual({ value: 'x', count: 3 });
  });

  it('mengelompokkan nilai kosong secara terpisah', () => {
    const h = countBy([{ a: null }, { a: 'x' }, { a: null }], (i) => i.a);
    expect(h.find((x) => x.value === 'tidak dicatat')!.count).toBe(2);
  });
});
