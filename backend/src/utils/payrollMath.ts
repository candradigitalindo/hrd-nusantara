// src/utils/payrollMath.ts

export type SalaryType = 'monthly' | 'daily' | 'hourly';
export type ComponentType = 'allowance' | 'deduction';
export type CalculationMethod = 'fixed' | 'percentage';
export type PercentageBase = 'basic' | 'gross';

export interface ComponentInput {
  code: string;
  name: string;
  type: ComponentType;
  calculation: CalculationMethod;
  percentageBase?: PercentageBase | null;
  amount?: number | null;
  percentage?: number | null;
  /** Batas atas dasar perhitungan, seperti plafon upah BPJS Kesehatan. */
  capAmount?: number | null;
  isTaxable: boolean;
  isStatutory: boolean;
}

export interface PayrollLine {
  code: string;
  name: string;
  type: 'earning' | 'deduction';
  amount: number;
  calculationNote: string;
  isTaxable: boolean;
}

export interface OvertimePolicy {
  hoursDivisor: number;
  firstHourMultiplier: number;
  nextHoursMultiplier: number;
}

export interface PayrollInput {
  salaryType: SalaryType;
  baseAmount: number;
  /** Hari yang seharusnya dijalani menurut jadwal. */
  scheduledDays: number;
  /** Hari yang benar-benar dijalani. */
  workedDays: number;
  /** Hari cuti tak berbayar; mengurangi hari yang dibayar. */
  unpaidLeaveDays: number;
  /** Jam lembur yang SUDAH disetujui atasan. */
  approvedOvertimeHours: number;
  /** Jam kerja untuk tipe upah per jam. */
  workedHours?: number;
  components: ComponentInput[];
  overtime: OvertimePolicy;
  /** Kelipatan pembulatan rupiah, 1 berarti dibulatkan ke rupiah terdekat. */
  rounding: number;
}

export interface PayrollResult {
  basicSalary: number;
  overtimePay: number;
  totalAllowances: number;
  totalDeductions: number;
  grossSalary: number;
  taxableIncome: number;
  netSalary: number;
  lines: PayrollLine[];
}

const bulatkan = (nilai: number, kelipatan: number): number => {
  if (kelipatan <= 1) return Math.round(nilai);
  return Math.round(nilai / kelipatan) * kelipatan;
};

const rupiah = (nilai: number): string =>
  new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(nilai));

/**
 * Menghitung gaji pokok yang dibayar untuk periode ini.
 *
 * Gaji bulanan diprorata terhadap hari yang benar-benar dijalani: karyawan
 * yang mengambil cuti tak berbayar atau mangkir tidak dibayar penuh. Upah
 * harian dan per jam memang sudah proporsional menurut sifatnya.
 */
export const calculateBasicSalary = (input: PayrollInput): { amount: number; note: string } => {
  const { salaryType, baseAmount, scheduledDays, workedDays, unpaidLeaveDays } = input;

  if (salaryType === 'daily') {
    return {
      amount: baseAmount * workedDays,
      note: `${rupiah(baseAmount)} × ${workedDays} hari kerja`,
    };
  }

  if (salaryType === 'hourly') {
    const jam = input.workedHours ?? 0;
    return {
      amount: baseAmount * jam,
      note: `${rupiah(baseAmount)} × ${jam} jam kerja`,
    };
  }

  // Bulanan. Tanpa jadwal, tidak ada dasar prorata — dibayar penuh.
  if (scheduledDays <= 0) {
    return { amount: baseAmount, note: 'Gaji bulanan penuh' };
  }

  const hariDibayar = Math.max(0, scheduledDays - unpaidLeaveDays);

  if (hariDibayar >= scheduledDays) {
    return { amount: baseAmount, note: 'Gaji bulanan penuh' };
  }

  return {
    amount: (baseAmount * hariDibayar) / scheduledDays,
    note:
      `${rupiah(baseAmount)} × ${hariDibayar}/${scheduledDays} hari ` +
      `(dipotong ${unpaidLeaveDays} hari cuti tak berbayar)`,
  };
};

/**
 * Upah lembur menurut Kepmenaker 102/2004: jam pertama dibayar lebih rendah
 * daripada jam-jam sesudahnya, jadi keduanya dihitung terpisah.
 *
 * Dasar perhitungannya gaji pokok sebulan penuh, bukan yang sudah diprorata —
 * lembur tidak ikut berkurang karena karyawan mengambil cuti di hari lain.
 */
export const calculateOvertimePay = (
  monthlyEquivalent: number,
  hours: number,
  policy: OvertimePolicy
): { amount: number; note: string } => {
  if (hours <= 0 || monthlyEquivalent <= 0) {
    return { amount: 0, note: 'Tidak ada jam lembur disetujui' };
  }

  const upahSejam = monthlyEquivalent / policy.hoursDivisor;

  const jamPertama = Math.min(hours, 1);
  const jamBerikutnya = Math.max(0, hours - 1);

  const amount =
    upahSejam * jamPertama * policy.firstHourMultiplier +
    upahSejam * jamBerikutnya * policy.nextHoursMultiplier;

  const bagian = [`${jamPertama} jam × ${policy.firstHourMultiplier}`];
  if (jamBerikutnya > 0) {
    bagian.push(`${jamBerikutnya} jam × ${policy.nextHoursMultiplier}`);
  }

  return {
    amount,
    note: `Upah/jam ${rupiah(upahSejam)} (1/${policy.hoursDivisor}); ${bagian.join(' + ')}`,
  };
};

/** Nilai satu komponen terhadap dasar yang sesuai. */
export const evaluateComponent = (
  component: ComponentInput,
  basis: { basic: number; gross: number }
): { amount: number; note: string } => {
  if (component.calculation === 'fixed') {
    const amount = component.amount ?? 0;
    return { amount, note: `Nominal tetap ${rupiah(amount)}` };
  }

  const persen = component.percentage ?? 0;
  const dasarMentah = component.percentageBase === 'gross' ? basis.gross : basis.basic;
  const namaDasar = component.percentageBase === 'gross' ? 'penghasilan kotor' : 'gaji pokok';

  // Plafon membatasi DASAR perhitungan, bukan hasil akhirnya.
  const dasar =
    component.capAmount != null ? Math.min(dasarMentah, component.capAmount) : dasarMentah;

  const catatan =
    component.capAmount != null && dasarMentah > component.capAmount
      ? `${persen}% dari ${namaDasar}, dibatasi plafon ${rupiah(component.capAmount)}`
      : `${persen}% dari ${namaDasar} ${rupiah(dasar)}`;

  return { amount: (dasar * persen) / 100, note: catatan };
};

/**
 * Menyusun satu slip gaji.
 *
 * Urutannya penting: gaji pokok dan lembur dihitung lebih dulu, lalu tunjangan
 * (yang membentuk penghasilan kotor), baru potongan. Potongan berbasis persen
 * karena itu dapat memakai penghasilan kotor yang sudah lengkap.
 */
export const calculatePayroll = (input: PayrollInput): PayrollResult => {
  const lines: PayrollLine[] = [];

  const pokok = calculateBasicSalary(input);
  const basicSalary = bulatkan(pokok.amount, input.rounding);

  lines.push({
    code: 'BASIC',
    name: 'Gaji Pokok',
    type: 'earning',
    amount: basicSalary,
    calculationNote: pokok.note,
    isTaxable: true,
  });

  // Dasar lembur disetarakan ke sebulan agar rumus 1/173 tetap berlaku
  // untuk upah harian maupun per jam.
  const setaraBulanan =
    input.salaryType === 'monthly'
      ? input.baseAmount
      : input.salaryType === 'daily'
        ? input.baseAmount * (input.scheduledDays || 25)
        : input.baseAmount * input.overtime.hoursDivisor;

  const lembur = calculateOvertimePay(
    setaraBulanan,
    input.approvedOvertimeHours,
    input.overtime
  );
  const overtimePay = bulatkan(lembur.amount, input.rounding);

  if (overtimePay > 0) {
    lines.push({
      code: 'OVERTIME',
      name: 'Upah Lembur',
      type: 'earning',
      amount: overtimePay,
      calculationNote: lembur.note,
      isTaxable: true,
    });
  }

  const tunjangan = input.components.filter((c) => c.type === 'allowance');
  const potongan = input.components.filter((c) => c.type === 'deduction');

  let totalAllowances = 0;
  for (const komponen of tunjangan) {
    const hasil = evaluateComponent(komponen, {
      basic: basicSalary,
      gross: basicSalary + overtimePay + totalAllowances,
    });
    const amount = bulatkan(hasil.amount, input.rounding);
    totalAllowances += amount;

    lines.push({
      code: komponen.code,
      name: komponen.name,
      type: 'earning',
      amount,
      calculationNote: hasil.note,
      isTaxable: komponen.isTaxable,
    });
  }

  const grossSalary = basicSalary + overtimePay + totalAllowances;

  let totalDeductions = 0;
  for (const komponen of potongan) {
    const hasil = evaluateComponent(komponen, { basic: basicSalary, gross: grossSalary });
    const amount = bulatkan(hasil.amount, input.rounding);
    totalDeductions += amount;

    lines.push({
      code: komponen.code,
      name: komponen.name,
      type: 'deduction',
      amount,
      calculationNote: hasil.note,
      isTaxable: komponen.isTaxable,
    });
  }

  // Penghasilan kena pajak hanya menjumlahkan komponen yang memang objek pajak.
  const taxableIncome = lines
    .filter((l) => l.type === 'earning' && l.isTaxable)
    .reduce((sum, l) => sum + l.amount, 0);

  return {
    basicSalary,
    overtimePay,
    totalAllowances,
    totalDeductions,
    grossSalary,
    taxableIncome,
    netSalary: grossSalary - totalDeductions,
    lines,
  };
};
