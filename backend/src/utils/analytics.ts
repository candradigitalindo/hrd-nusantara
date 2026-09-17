// src/utils/analytics.ts

const bulat2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Tingkat perputaran karyawan untuk satu periode, dalam persen.
 *
 * Pembaginya rata-rata jumlah karyawan awal dan akhir periode, bukan salah
 * satunya saja. Memakai jumlah akhir membuat perusahaan yang menyusut tampak
 * punya perputaran jauh lebih tinggi daripada kenyataannya, dan memakai jumlah
 * awal menyembunyikan perputaran di perusahaan yang sedang tumbuh cepat.
 */
export const turnoverRate = (params: {
  exits: number;
  headcountStart: number;
  headcountEnd: number;
}): number => {
  const rataRata = (params.headcountStart + params.headcountEnd) / 2;
  if (rataRata === 0) return 0;
  return bulat2((params.exits / rataRata) * 100);
};

/** Masa kerja dalam hari. null bila tanggal masuknya tidak diketahui. */
export const tenureDays = (joinDate: Date | null, exitDate: Date | null, now: Date): number | null => {
  if (!joinDate) return null;
  const akhir = exitDate ?? now;
  const selisih = akhir.getTime() - joinDate.getTime();
  return Math.max(0, Math.round(selisih / (24 * 60 * 60 * 1000)));
};

export interface TenureBucket {
  label: string;
  count: number;
}

/**
 * Mengelompokkan masa kerja ke rentang yang bermakna bagi HR.
 *
 * Rata-rata masa kerja saja menyesatkan: satu orang bertahan sepuluh tahun
 * bisa menutupi lima orang yang keluar dalam tiga bulan. Sebarannya yang
 * memperlihatkan di titik mana karyawan paling banyak berhenti.
 */
export const bucketTenure = (tenures: number[]): TenureBucket[] => {
  const batas: { label: string; max: number }[] = [
    { label: '< 3 bulan', max: 90 },
    { label: '3–6 bulan', max: 180 },
    { label: '6–12 bulan', max: 365 },
    { label: '1–2 tahun', max: 730 },
    { label: '2–5 tahun', max: 1825 },
    { label: '> 5 tahun', max: Infinity },
  ];

  return batas.map((b, i) => {
    const min = i === 0 ? 0 : batas[i - 1].max;
    return {
      label: b.label,
      count: tenures.filter((t) => t >= min && t < b.max).length,
    };
  });
};

/**
 * Biaya per rekrutan.
 *
 * Mengembalikan null bila belum ada yang direkrut — bukan nol. Nol berarti
 * "merekrut tanpa biaya", sedangkan yang sebenarnya terjadi adalah angkanya
 * belum bisa dihitung.
 */
export const costPerHire = (totalCost: number, hires: number): number | null =>
  hires === 0 ? null : bulat2(totalCost / hires);

export interface AttendanceProductivity {
  averageWorkedHours: number;
  latePercentage: number;
  absencePercentage: number;
}

/**
 * Ringkasan produktivitas dari data presensi.
 *
 * Persentase dihitung terhadap shift terjadwal, bukan terhadap presensi yang
 * tercatat: kalau dibagi jumlah presensi, karyawan yang sering mangkir justru
 * akan terlihat punya tingkat keterlambatan rendah — karena hari mangkirnya
 * tidak pernah masuk pembagi.
 */
export const attendanceProductivity = (params: {
  scheduledShifts: number;
  attendanceCount: number;
  lateCount: number;
  totalWorkedMinutes: number;
}): AttendanceProductivity => {
  const { scheduledShifts, attendanceCount, lateCount, totalWorkedMinutes } = params;

  return {
    averageWorkedHours:
      attendanceCount === 0 ? 0 : bulat2(totalWorkedMinutes / attendanceCount / 60),
    latePercentage: scheduledShifts === 0 ? 0 : bulat2((lateCount / scheduledShifts) * 100),
    absencePercentage:
      scheduledShifts === 0
        ? 0
        : bulat2((Math.max(0, scheduledShifts - attendanceCount) / scheduledShifts) * 100),
  };
};

export interface CostBreakdown {
  payroll: number;
  training: number;
  recruitment: number;
  total: number;
  /** Bagian tiap pos terhadap total, dalam persen. */
  shares: { payroll: number; training: number; recruitment: number };
}

/** Rincian biaya SDM beserta porsi tiap posnya. */
export const summarizeCosts = (params: {
  payroll: number;
  training: number;
  recruitment: number;
}): CostBreakdown => {
  const total = params.payroll + params.training + params.recruitment;
  const porsi = (v: number) => (total === 0 ? 0 : bulat2((v / total) * 100));

  return {
    payroll: bulat2(params.payroll),
    training: bulat2(params.training),
    recruitment: bulat2(params.recruitment),
    total: bulat2(total),
    shares: {
      payroll: porsi(params.payroll),
      training: porsi(params.training),
      recruitment: porsi(params.recruitment),
    },
  };
};

/** Mengelompokkan dan menghitung, diurutkan dari yang terbanyak. */
export const countBy = <T>(
  items: T[],
  key: (item: T) => string | null
): { value: string; count: number }[] => {
  const peta = new Map<string, number>();

  for (const item of items) {
    const k = key(item) ?? 'tidak dicatat';
    peta.set(k, (peta.get(k) ?? 0) + 1);
  }

  return [...peta.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
};
