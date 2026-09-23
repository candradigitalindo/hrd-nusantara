// src/utils/rosterRecap.ts
//
// Rekap hari libur dari roster. Sistem ini tidak menyimpan baris "libur":
// hari libur adalah tanggal yang tidak dijadwalkan. Karena itu "tidak ada
// shift" harus dibedakan dulu antara memang libur dan rosternya belum
// disusun — pembedanya sama dengan yang dipakai perhitungan cuti di
// leaveDays.ts, yaitu pekan: bila karyawan punya shift lain di pekan yang
// sama, roster pekan itu sudah terbit.
import { calendarKey, isoWeekKey, eachCalendarDay } from './leaveDays';

/**
 * Hari kerja berturut-turut yang masih wajar. UU Ketenagakerjaan memberi
 * sekurang-kurangnya satu hari istirahat dalam sepekan, jadi tujuh hari
 * beruntun sudah melewati batas ini.
 */
export const BATAS_HARI_BERUNTUN = 6;

/**
 * Berapa hari di luar bulan ikut dibaca. Tujuh hari cukup untuk memastikan
 * setiap pekan yang menyentuh bulan ini terbaca utuh, dan deret hari kerja
 * yang menyeberang pergantian bulan tidak terpotong.
 */
const MARGIN_HARI = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface RekapLibur {
  /** Tanggal yang dijadwalkan; split shift tetap dihitung satu hari. */
  hariKerja: number;
  hariLibur: number;
  /** Tanggal yang rosternya belum disusun — belum tentu libur. */
  belumDisusun: number;
  /** Pekan yang menyentuh bulan ini dan rosternya sudah terbit. */
  pekanTersusun: number;
  /** Ada pekan tersusun yang tidak menyisakan satu pun hari libur. */
  kurangLibur: boolean;
  /** Deret hari kerja terpanjang yang menyentuh bulan ini. */
  beruntunMaks: number;
  beruntunLewatBatas: boolean;
}

interface Pekan {
  terjadwal: number;
  libur: number;
  menyentuhBulan: boolean;
}

/**
 * @param scheduledDateKeys tanggal (YYYY-MM-DD) yang dijadwalkan untuk satu
 *   karyawan, sudah termasuk margin di luar bulan — lihat `jendelaRoster`.
 */
export const hitungRekapLibur = (params: {
  scheduledDateKeys: Set<string>;
  monthStart: Date;
  monthEnd: Date;
}): RekapLibur => {
  const { scheduledDateKeys, monthStart, monthEnd } = params;

  const jendela = eachCalendarDay(
    new Date(monthStart.getTime() - MARGIN_HARI * MS_PER_DAY),
    new Date(monthEnd.getTime() + MARGIN_HARI * MS_PER_DAY)
  );
  const kerja = jendela.map((hari) => scheduledDateKeys.has(calendarKey(hari)));
  const diBulanIni = (hari: Date) =>
    hari.getTime() >= monthStart.getTime() && hari.getTime() <= monthEnd.getTime();

  // Pekan dihitung di seluruh jendela, bukan hanya hari di dalam bulan: pekan
  // terakhir bulan ini bisa saja meletakkan hari liburnya di tanggal 1 bulan
  // berikutnya, dan itu tetap hari libur yang diterima karyawan.
  const pekan = new Map<string, Pekan>();
  jendela.forEach((hari, i) => {
    const kunci = isoWeekKey(hari);
    const p = pekan.get(kunci) ?? { terjadwal: 0, libur: 0, menyentuhBulan: false };
    if (kerja[i]) p.terjadwal += 1;
    else p.libur += 1;
    if (diBulanIni(hari)) p.menyentuhBulan = true;
    pekan.set(kunci, p);
  });

  let hariKerja = 0;
  let hariLibur = 0;
  let belumDisusun = 0;

  jendela.forEach((hari, i) => {
    if (!diBulanIni(hari)) return;
    if (kerja[i]) hariKerja += 1;
    else if ((pekan.get(isoWeekKey(hari))?.terjadwal ?? 0) > 0) hariLibur += 1;
    else belumDisusun += 1;
  });

  // Deret hari kerja diukur utuh lalu disaring: yang dilaporkan adalah deret
  // yang bersinggungan dengan bulan ini, dengan panjang sebenarnya. Enam hari
  // di akhir Agustus disambung tiga hari di awal September adalah sembilan
  // hari beruntun, bukan tiga.
  let beruntunMaks = 0;
  for (let i = 0; i < jendela.length; ) {
    if (!kerja[i]) {
      i += 1;
      continue;
    }
    let akhir = i;
    while (akhir + 1 < jendela.length && kerja[akhir + 1]) akhir += 1;

    const menyentuhBulan =
      jendela[i].getTime() <= monthEnd.getTime() && jendela[akhir].getTime() >= monthStart.getTime();
    if (menyentuhBulan) beruntunMaks = Math.max(beruntunMaks, akhir - i + 1);

    i = akhir + 1;
  }

  const pekanTersusun = [...pekan.values()].filter((p) => p.menyentuhBulan && p.terjadwal > 0);

  return {
    hariKerja,
    hariLibur,
    belumDisusun,
    pekanTersusun: pekanTersusun.length,
    kurangLibur: pekanTersusun.some((p) => p.libur === 0),
    beruntunMaks,
    beruntunLewatBatas: beruntunMaks > BATAS_HARI_BERUNTUN,
  };
};

/** Rentang tanggal sebuah bulan "YYYY-MM", sebagai tengah malam UTC. */
export const rentangBulan = (month: string): { monthStart: Date; monthEnd: Date } => {
  const [tahun, bulan] = month.split('-').map(Number);
  return {
    monthStart: new Date(Date.UTC(tahun, bulan - 1, 1)),
    // Hari ke-0 bulan berikutnya = hari terakhir bulan ini.
    monthEnd: new Date(Date.UTC(tahun, bulan, 0)),
  };
};

/** Jendela baca roster: sebulan penuh ditambah margin di kedua ujungnya. */
export const jendelaRoster = (monthStart: Date, monthEnd: Date) => ({
  gte: new Date(monthStart.getTime() - MARGIN_HARI * MS_PER_DAY),
  lte: new Date(monthEnd.getTime() + MARGIN_HARI * MS_PER_DAY),
});
