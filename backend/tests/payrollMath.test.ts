import {
  calculatePayroll,
  calculateBasicSalary,
  calculateOvertimePay,
  evaluateComponent,
  type PayrollInput,
  type ComponentInput,
} from '../src/utils/payrollMath';

const LEMBUR = { hoursDivisor: 173, firstHourMultiplier: 1.5, nextHoursMultiplier: 2 };

const dasar = (ubah: Partial<PayrollInput> = {}): PayrollInput => ({
  salaryType: 'monthly',
  baseAmount: 5_000_000,
  scheduledDays: 25,
  workedDays: 25,
  unpaidLeaveDays: 0,
  approvedOvertimeHours: 0,
  components: [],
  overtime: LEMBUR,
  rounding: 1,
  ...ubah,
});

const komponen = (ubah: Partial<ComponentInput> = {}): ComponentInput => ({
  code: 'X',
  name: 'Komponen',
  type: 'allowance',
  calculation: 'fixed',
  amount: 0,
  isTaxable: true,
  isStatutory: false,
  ...ubah,
});

describe('calculateBasicSalary', () => {
  it('membayar gaji bulanan penuh saat tidak ada cuti tak berbayar', () => {
    expect(calculateBasicSalary(dasar()).amount).toBe(5_000_000);
  });

  it('memprorata gaji bulanan atas cuti tak berbayar', () => {
    // 5 hari tak berbayar dari 25 hari jadwal = dibayar 20/25.
    const h = calculateBasicSalary(dasar({ unpaidLeaveDays: 5 }));
    expect(h.amount).toBe(4_000_000);
    expect(h.note).toContain('20/25');
  });

  it('mengalikan upah harian dengan hari yang benar-benar dijalani', () => {
    const h = calculateBasicSalary(
      dasar({ salaryType: 'daily', baseAmount: 200_000, workedDays: 22 })
    );
    expect(h.amount).toBe(4_400_000);
  });

  it('mengalikan upah per jam dengan jam kerja', () => {
    const h = calculateBasicSalary(
      dasar({ salaryType: 'hourly', baseAmount: 30_000, workedHours: 160 })
    );
    expect(h.amount).toBe(4_800_000);
  });

  it('membayar penuh bila tidak ada jadwal sebagai dasar prorata', () => {
    expect(calculateBasicSalary(dasar({ scheduledDays: 0, unpaidLeaveDays: 3 })).amount).toBe(
      5_000_000
    );
  });

  it('tidak menghasilkan gaji negatif walau cuti melebihi jadwal', () => {
    expect(calculateBasicSalary(dasar({ unpaidLeaveDays: 40 })).amount).toBe(0);
  });
});

describe('calculateOvertimePay (Kepmenaker 102/2004)', () => {
  it('membayar jam pertama 1,5 kali upah sejam', () => {
    // 5.000.000 / 173 = 28.901,7 per jam; × 1,5 = 43.352,6
    const h = calculateOvertimePay(5_000_000, 1, LEMBUR);
    expect(h.amount).toBeCloseTo((5_000_000 / 173) * 1.5, 4);
  });

  it('membayar jam berikutnya 2 kali upah sejam', () => {
    const upahSejam = 5_000_000 / 173;
    const h = calculateOvertimePay(5_000_000, 3, LEMBUR);

    // 1 jam × 1,5 + 2 jam × 2
    expect(h.amount).toBeCloseTo(upahSejam * 1.5 + upahSejam * 2 * 2, 4);
  });

  it('menangani lembur pecahan jam', () => {
    const upahSejam = 5_000_000 / 173;
    const h = calculateOvertimePay(5_000_000, 0.5, LEMBUR);
    expect(h.amount).toBeCloseTo(upahSejam * 0.5 * 1.5, 4);
  });

  it('tidak membayar apa pun tanpa jam lembur', () => {
    expect(calculateOvertimePay(5_000_000, 0, LEMBUR).amount).toBe(0);
  });

  it('menyebutkan pembagi 1/173 pada catatan perhitungan', () => {
    expect(calculateOvertimePay(5_000_000, 2, LEMBUR).note).toContain('1/173');
  });
});

describe('evaluateComponent', () => {
  const basis = { basic: 5_000_000, gross: 6_000_000 };

  it('memakai nominal tetap apa adanya', () => {
    const h = evaluateComponent(komponen({ calculation: 'fixed', amount: 750_000 }), basis);
    expect(h.amount).toBe(750_000);
  });

  it('menghitung persentase dari gaji pokok', () => {
    const h = evaluateComponent(
      komponen({ calculation: 'percentage', percentage: 2, percentageBase: 'basic' }),
      basis
    );
    expect(h.amount).toBe(100_000);
  });

  it('menghitung persentase dari penghasilan kotor', () => {
    const h = evaluateComponent(
      komponen({ calculation: 'percentage', percentage: 1, percentageBase: 'gross' }),
      basis
    );
    expect(h.amount).toBe(60_000);
  });

  it('membatasi DASAR perhitungan, bukan hasilnya, saat ada plafon', () => {
    // Plafon BPJS Kesehatan: persentase berhenti bertambah di atas batas upah.
    const h = evaluateComponent(
      komponen({
        calculation: 'percentage',
        percentage: 1,
        percentageBase: 'basic',
        capAmount: 12_000_000,
      }),
      { basic: 20_000_000, gross: 20_000_000 }
    );

    expect(h.amount).toBe(120_000);
    expect(h.note).toContain('plafon');
  });

  it('tidak menerapkan plafon bila dasarnya masih di bawah batas', () => {
    const h = evaluateComponent(
      komponen({
        calculation: 'percentage',
        percentage: 1,
        percentageBase: 'basic',
        capAmount: 12_000_000,
      }),
      basis
    );

    expect(h.amount).toBe(50_000);
    expect(h.note).not.toContain('plafon');
  });
});

describe('calculatePayroll', () => {
  it('menjumlahkan gaji pokok, tunjangan, dan potongan', () => {
    const h = calculatePayroll(
      dasar({
        components: [
          komponen({ code: 'TRANSPORT', name: 'Tunjangan Transport', amount: 500_000 }),
          komponen({ code: 'MAKAN', name: 'Tunjangan Makan', amount: 300_000 }),
          komponen({
            code: 'BPJS_TK',
            name: 'BPJS Ketenagakerjaan',
            type: 'deduction',
            calculation: 'percentage',
            percentage: 2,
            percentageBase: 'basic',
          }),
        ],
      })
    );

    expect(h.basicSalary).toBe(5_000_000);
    expect(h.totalAllowances).toBe(800_000);
    expect(h.grossSalary).toBe(5_800_000);
    expect(h.totalDeductions).toBe(100_000);
    expect(h.netSalary).toBe(5_700_000);
  });

  it('menghasilkan satu baris rincian untuk tiap komponen', () => {
    const h = calculatePayroll(
      dasar({
        approvedOvertimeHours: 2,
        components: [
          komponen({ code: 'TRANSPORT', name: 'Transport', amount: 500_000 }),
          komponen({ code: 'BPJS', name: 'BPJS', type: 'deduction', amount: 100_000 }),
        ],
      })
    );

    // Gaji pokok, lembur, transport, BPJS.
    expect(h.lines).toHaveLength(4);
    expect(h.lines.map((l) => l.code)).toEqual(['BASIC', 'OVERTIME', 'TRANSPORT', 'BPJS']);
  });

  it('menyertakan catatan asal angka pada tiap baris', () => {
    const h = calculatePayroll(dasar({ unpaidLeaveDays: 5 }));

    // Dipakai saat karyawan mempertanyakan slipnya.
    expect(h.lines[0].calculationNote).toContain('20/25');
  });

  it('tidak memunculkan baris lembur bila tidak ada lembur disetujui', () => {
    const h = calculatePayroll(dasar());
    expect(h.lines.some((l) => l.code === 'OVERTIME')).toBe(false);
  });

  it('mengecualikan komponen bukan objek pajak dari penghasilan kena pajak', () => {
    const h = calculatePayroll(
      dasar({
        components: [
          komponen({ code: 'KENA', name: 'Kena Pajak', amount: 1_000_000, isTaxable: true }),
          komponen({ code: 'BEBAS', name: 'Bebas Pajak', amount: 500_000, isTaxable: false }),
        ],
      })
    );

    expect(h.grossSalary).toBe(6_500_000);
    // Yang bebas pajak tidak ikut dasar pengenaan pajak.
    expect(h.taxableIncome).toBe(6_000_000);
  });

  it('lembur tidak ikut berkurang karena prorata cuti', () => {
    // Upah lembur dihitung dari gaji sebulan penuh, bukan yang sudah dipotong.
    const penuh = calculatePayroll(dasar({ approvedOvertimeHours: 3 }));
    const prorata = calculatePayroll(dasar({ approvedOvertimeHours: 3, unpaidLeaveDays: 5 }));

    expect(prorata.basicSalary).toBeLessThan(penuh.basicSalary);
    expect(prorata.overtimePay).toBe(penuh.overtimePay);
  });

  it('membulatkan tiap komponen ke kelipatan yang ditentukan', () => {
    const h = calculatePayroll(
      dasar({
        approvedOvertimeHours: 1,
        rounding: 100,
      })
    );

    expect(h.overtimePay % 100).toBe(0);
  });

  it('menghitung upah harian dengan lembur yang disetarakan ke bulanan', () => {
    const h = calculatePayroll(
      dasar({
        salaryType: 'daily',
        baseAmount: 200_000,
        scheduledDays: 25,
        workedDays: 25,
        approvedOvertimeHours: 2,
      })
    );

    expect(h.basicSalary).toBe(5_000_000);
    // Setara bulanan 200.000 × 25 = 5.000.000, lalu dibagi 173.
    expect(h.overtimePay).toBeGreaterThan(0);
  });

  it('potongan persentase memakai penghasilan kotor yang sudah lengkap', () => {
    const h = calculatePayroll(
      dasar({
        components: [
          komponen({ code: 'TRANSPORT', name: 'Transport', amount: 1_000_000 }),
          komponen({
            code: 'POT',
            name: 'Potongan',
            type: 'deduction',
            calculation: 'percentage',
            percentage: 10,
            percentageBase: 'gross',
          }),
        ],
      })
    );

    // 10% dari 6.000.000, bukan dari 5.000.000.
    expect(h.totalDeductions).toBe(600_000);
  });

  it('menghasilkan gaji bersih nol bila potongan menghabiskan penghasilan', () => {
    const h = calculatePayroll(
      dasar({
        components: [
          komponen({ code: 'POT', name: 'Potongan', type: 'deduction', amount: 5_000_000 }),
        ],
      })
    );

    expect(h.netSalary).toBe(0);
  });
});
