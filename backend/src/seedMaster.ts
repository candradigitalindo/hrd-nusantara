// src/seedMaster.ts
//
// Mengisi data induk yang dibutuhkan modul cuti agar bisa dipakai:
// pola hari kerja, jenis cuti, dan kalender hari libur.
//
// Aman dijalankan berulang — semuanya upsert berdasarkan kode atau tanggal,
// dan nilai yang sudah diubah HR tidak ditimpa.
//
// Jalankan: npm run seed:master -- --year 2026
import { prisma } from './lib/prisma';
import { generateULID } from './utils/generateULID';
import { HOLIDAYS_BY_YEAR, verifyHolidayWeekdays } from './data/indonesianHolidays';

const WORK_PATTERNS = [
  {
    code: 'kantor',
    name: 'Kantor (Senin–Sabtu)',
    description: 'Hari kerja tetap Senin sampai Sabtu, libur nasional dihormati.',
    type: 'fixed',
    // 0 = Minggu, 6 = Sabtu. Hanya Minggu yang libur.
    workingWeekdays: [1, 2, 3, 4, 5, 6],
    observesPublicHolidays: true,
    isDefault: true,
  },
  {
    code: 'operasional_shift',
    name: 'Outlet & Hotel (Shift)',
    description:
      'Hari kerja mengikuti roster, bukan hari dalam pekan. Libur tiap karyawan ' +
      'berbeda dan berpindah tiap pekan. Hari libur nasional tidak otomatis ' +
      'libur karena outlet dan hotel justru beroperasi saat itu.',
    type: 'shift',
    // Dipakai hanya sebagai cadangan saat roster periode yang diminta belum terbit.
    workingWeekdays: [1, 2, 3, 4, 5, 6],
    observesPublicHolidays: false,
    isDefault: false,
  },
];

/**
 * Jenis cuti standar mengikuti UU 13/2003. Kuotanya bisa disesuaikan HR;
 * yang penting strukturnya sudah ada supaya modul cuti bisa langsung dipakai.
 */
const LEAVE_TYPES = [
  {
    code: 'annual',
    name: 'Cuti Tahunan',
    description: '12 hari kerja setelah 12 bulan masa kerja (UU 13/2003 Pasal 79).',
    defaultQuotaDays: 12,
    isPaid: true,
    deductsBalance: true,
    requiresAttachment: false,
    maxConsecutiveDays: null,
    genderRestriction: null,
    countsCalendarDays: false,
  },
  {
    code: 'sick',
    name: 'Cuti Sakit',
    description: 'Dengan surat keterangan dokter. Tidak memotong kuota cuti tahunan.',
    defaultQuotaDays: null,
    isPaid: true,
    deductsBalance: false,
    requiresAttachment: true,
    maxConsecutiveDays: null,
    genderRestriction: null,
    countsCalendarDays: false,
  },
  {
    code: 'maternity',
    name: 'Cuti Melahirkan',
    description: '3 bulan kalender (UU 13/2003 Pasal 82). Berjalan terus melewati hari libur.',
    defaultQuotaDays: null,
    isPaid: true,
    deductsBalance: false,
    requiresAttachment: true,
    maxConsecutiveDays: null,
    genderRestriction: 'female',
    // Dihitung hari kalender, bukan hari kerja.
    countsCalendarDays: true,
  },
  {
    code: 'menstrual',
    name: 'Cuti Haid',
    description: 'Hari pertama dan kedua masa haid (UU 13/2003 Pasal 81).',
    defaultQuotaDays: null,
    isPaid: true,
    deductsBalance: false,
    requiresAttachment: false,
    maxConsecutiveDays: 2,
    genderRestriction: 'female',
    countsCalendarDays: false,
  },
  {
    code: 'marriage',
    name: 'Cuti Menikah',
    description: '3 hari (UU 13/2003 Pasal 93 ayat 4).',
    defaultQuotaDays: 3,
    isPaid: true,
    deductsBalance: false,
    requiresAttachment: false,
    maxConsecutiveDays: 3,
    genderRestriction: null,
    countsCalendarDays: false,
  },
  {
    code: 'bereavement',
    name: 'Cuti Duka',
    description: 'Keluarga inti meninggal, 2 hari (UU 13/2003 Pasal 93 ayat 4).',
    defaultQuotaDays: 2,
    isPaid: true,
    deductsBalance: false,
    requiresAttachment: false,
    maxConsecutiveDays: 2,
    genderRestriction: null,
    countsCalendarDays: false,
  },
  {
    code: 'unpaid',
    name: 'Cuti Tidak Dibayar',
    description: 'Cuti di luar tanggungan perusahaan, atas persetujuan manajemen.',
    defaultQuotaDays: null,
    isPaid: false,
    deductsBalance: false,
    requiresAttachment: false,
    maxConsecutiveDays: null,
    genderRestriction: null,
    countsCalendarDays: false,
  },
];

/**
 * Komponen gaji wajib menurut regulasi.
 *
 * Yang dicantumkan hanya porsi POTONGAN KARYAWAN — bagian yang benar-benar
 * mengurangi gaji yang diterima. Iuran yang ditanggung perusahaan (JKK, JKM,
 * dan porsi pemberi kerja pada JHT, JP, serta BPJS Kesehatan) adalah beban
 * perusahaan, bukan potongan gaji, jadi tidak muncul di slip.
 *
 * PPh 21 sengaja TIDAK diisi: sejak 2024 pemotongan bulanan memakai Tarif
 * Efektif Rata-rata yang tabelnya panjang dan bergantung status PTKP tiap
 * karyawan. Menebaknya berisiko salah potong pajak, jadi komponennya dibuat
 * kosong untuk diisi bersama konsultan pajak Anda.
 */
const SALARY_COMPONENTS = [
  {
    code: 'BPJS_KES',
    name: 'BPJS Kesehatan (porsi karyawan)',
    description:
      'Iuran 1% dari upah, ditanggung karyawan. Perusahaan menanggung 4% terpisah. ' +
      'Dasar perhitungan dibatasi plafon upah.',
    type: 'deduction',
    calculation: 'percentage',
    percentageBase: 'basic',
    defaultAmount: null,
    defaultPercentage: 1,
    capAmount: 12_000_000,
    isTaxable: false,
    isStatutory: true,
  },
  {
    code: 'BPJS_JHT',
    name: 'BPJS JHT (porsi karyawan)',
    description: 'Jaminan Hari Tua 2% dari upah, ditanggung karyawan. Perusahaan 3,7%.',
    type: 'deduction',
    calculation: 'percentage',
    percentageBase: 'basic',
    defaultAmount: null,
    defaultPercentage: 2,
    capAmount: null,
    isTaxable: false,
    isStatutory: true,
  },
  {
    code: 'BPJS_JP',
    name: 'BPJS Jaminan Pensiun (porsi karyawan)',
    description:
      'Jaminan Pensiun 1% dari upah, ditanggung karyawan. Perusahaan 2%. ' +
      'Plafon upahnya disesuaikan pemerintah tiap tahun — periksa nilainya.',
    type: 'deduction',
    calculation: 'percentage',
    percentageBase: 'basic',
    defaultAmount: null,
    defaultPercentage: 1,
    capAmount: 10_547_400,
    isTaxable: false,
    isStatutory: true,
  },
  {
    code: 'PPH21',
    name: 'PPh 21',
    description:
      'BELUM DIKONFIGURASI. Isi tarifnya bersama konsultan pajak: sejak 2024 ' +
      'pemotongan bulanan memakai TER yang bergantung status PTKP karyawan.',
    type: 'deduction',
    calculation: 'fixed',
    percentageBase: null,
    defaultAmount: 0,
    defaultPercentage: null,
    capAmount: null,
    isTaxable: false,
    isStatutory: true,
  },
  {
    code: 'TJ_TRANSPORT',
    name: 'Tunjangan Transport',
    description: 'Tunjangan tetap, nominalnya disesuaikan kebijakan perusahaan.',
    type: 'allowance',
    calculation: 'fixed',
    percentageBase: null,
    defaultAmount: 0,
    defaultPercentage: null,
    capAmount: null,
    isTaxable: true,
    isStatutory: false,
  },
  {
    code: 'TJ_MAKAN',
    name: 'Tunjangan Makan',
    description: 'Tunjangan tetap, nominalnya disesuaikan kebijakan perusahaan.',
    type: 'allowance',
    calculation: 'fixed',
    percentageBase: null,
    defaultAmount: 0,
    defaultPercentage: null,
    capAmount: null,
    isTaxable: true,
    isStatutory: false,
  },
  {
    code: 'TJ_JABATAN',
    name: 'Tunjangan Jabatan',
    description: 'Tunjangan tetap untuk pemegang jabatan tertentu.',
    type: 'allowance',
    calculation: 'fixed',
    percentageBase: null,
    defaultAmount: 0,
    defaultPercentage: null,
    capAmount: null,
    isTaxable: true,
    isStatutory: false,
  },
];

const seedSalaryComponents = async () => {
  let dibuat = 0;
  let dilewati = 0;

  for (const k of SALARY_COMPONENTS) {
    const ada = await prisma.salaryComponent.findUnique({ where: { code: k.code } });
    if (ada) {
      dilewati += 1;
      continue;
    }
    await prisma.salaryComponent.create({ data: { id: generateULID(), ...k } });
    dibuat += 1;
  }

  console.log(`Komponen gaji: ${dibuat} dibuat, ${dilewati} sudah ada`);
};

const bacaTahun = (): number => {
  const idx = process.argv.indexOf('--year');
  const nilai = idx >= 0 ? Number(process.argv[idx + 1]) : new Date().getUTCFullYear();

  if (!Number.isInteger(nilai) || nilai < 2000 || nilai > 2100) {
    throw new Error(`Tahun tidak valid: ${process.argv[idx + 1]}`);
  }
  return nilai;
};

const seedWorkPatterns = async () => {
  let dibuat = 0;
  let dilewati = 0;

  for (const pola of WORK_PATTERNS) {
    const ada = await prisma.workPattern.findUnique({ where: { code: pola.code } });
    if (ada) {
      dilewati += 1;
      continue;
    }
    await prisma.workPattern.create({ data: { id: generateULID(), ...pola } });
    dibuat += 1;
  }

  console.log(`Pola kerja   : ${dibuat} dibuat, ${dilewati} sudah ada`);
};

const seedLeaveTypes = async () => {
  let dibuat = 0;
  let dilewati = 0;

  for (const tipe of LEAVE_TYPES) {
    const ada = await prisma.leaveType.findUnique({ where: { code: tipe.code } });
    if (ada) {
      dilewati += 1;
      continue;
    }
    await prisma.leaveType.create({ data: { id: generateULID(), ...tipe } });
    dibuat += 1;
  }

  console.log(`Jenis cuti   : ${dibuat} dibuat, ${dilewati} sudah ada`);
};

const seedHolidays = async (tahun: number) => {
  const daftar = HOLIDAYS_BY_YEAR[tahun];

  if (!daftar) {
    const tersedia = Object.keys(HOLIDAYS_BY_YEAR).join(', ');
    throw new Error(
      `Belum ada data hari libur untuk tahun ${tahun}. Tersedia: ${tersedia}.\n` +
        'Tanggalnya tidak bisa dihitung — salin dari SKB 3 Menteri tahun tersebut ' +
        'ke src/data/indonesianHolidays.ts.'
    );
  }

  // Satu tanggal salah menggeser perhitungan saldo cuti seluruh karyawan,
  // jadi diperiksa dulu sebelum apa pun ditulis ke database.
  const tidakCocok = verifyHolidayWeekdays(daftar);
  if (tidakCocok.length > 0) {
    for (const s of tidakCocok) {
      console.error(`  ${s.date} ${s.name}: sumber menyebut ${s.expected}, sebenarnya ${s.actual}`);
    }
    throw new Error('Ada tanggal hari libur yang harinya tidak cocok. Seed dibatalkan.');
  }

  let dibuat = 0;
  let dilewati = 0;

  for (const h of daftar) {
    const date = new Date(`${h.date}T00:00:00.000Z`);
    const ada = await prisma.holiday.findUnique({ where: { date } });
    if (ada) {
      dilewati += 1;
      continue;
    }
    await prisma.holiday.create({
      data: {
        id: generateULID(),
        date,
        name: h.name,
        isCollectiveLeave: h.isCollectiveLeave,
      },
    });
    dibuat += 1;
  }

  const nasional = daftar.filter((h) => !h.isCollectiveLeave).length;
  const bersama = daftar.length - nasional;
  console.log(
    `Hari libur ${tahun}: ${dibuat} dibuat, ${dilewati} sudah ada ` +
      `(${nasional} libur nasional, ${bersama} cuti bersama)`
  );
};

const main = async () => {
  const tahun = bacaTahun();

  console.log(`\nMengisi data induk (tahun ${tahun})\n`);

  await seedWorkPatterns();
  await seedLeaveTypes();
  await seedSalaryComponents();
  await seedHolidays(tahun);

  console.log('\nLangkah berikutnya:');
  console.log('  1. Pasang pola "operasional_shift" ke departemen outlet dan hotel:');
  console.log('     PATCH /api/departments/:id/work-pattern');
  console.log('  2. Tetapkan saldo cuti tahunan tiap karyawan:');
  console.log('     POST /api/leave-balances');
  console.log('  3. Tetapkan struktur gaji tiap karyawan:');
  console.log('     POST /api/employees/:id/salary');
  console.log('  4. PPh 21 masih kosong — isi tarifnya bersama konsultan pajak');
  console.log('     sebelum penggajian dijalankan.\n');
};

main()
  .catch((error) => {
    console.error('\nSeed gagal:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
