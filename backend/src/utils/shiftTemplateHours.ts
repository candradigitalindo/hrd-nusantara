// src/utils/shiftTemplateHours.ts
//
// Jam kerja sebuah jenis shift pada tanggal tertentu. Jenis shift punya jam
// bawaan, dan boleh punya jam berbeda untuk hari tertentu dalam pekan
// (kolom JSON dailyHours) — mis. "Reguler" 08:00–16:00 kecuali Jumat
// 08:00–11:30 dan Sabtu 08:00–13:00. Semua pembuat baris jadwal (penugasan
// berjangka, jadwal satu hari, pembaruan jadwal ke depan) membaca lewat sini,
// supaya aturan "hari mana memakai jam apa" hanya ditulis sekali.

export interface JamShift {
  startTime: string;
  endTime: string;
  /** Jam istirahat. */
  breakDuration: number;
}

export interface JamHari extends JamShift {
  /** 0 = Minggu … 6 = Sabtu, sama dengan Date.getUTCDay() untuk tanggal kalender. */
  weekday: number;
}

const POLA_JAM = /^([01]\d|2[0-3]):[0-5]\d$/;

const angka = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'toNumber' in v && typeof (v as { toNumber: unknown }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
};

/**
 * Membaca kolom dailyHours. Entri yang bentuknya tidak sah dibuang, dan satu
 * hari hanya punya satu jam (entri pertama yang menang): data yang rusak tidak
 * boleh membuat materialisasi jadwal gagal.
 */
export const bacaJamPerHari = (json: unknown): JamHari[] => {
  if (!Array.isArray(json)) return [];
  const terlihat = new Set<number>();
  const hasil: JamHari[] = [];
  for (const e of json) {
    if (!e || typeof e !== 'object') continue;
    const { weekday, startTime, endTime, breakDuration } = e as Record<string, unknown>;
    if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    if (typeof startTime !== 'string' || !POLA_JAM.test(startTime)) continue;
    if (typeof endTime !== 'string' || !POLA_JAM.test(endTime)) continue;
    const istirahat = breakDuration === undefined || breakDuration === null ? 0 : angka(breakDuration);
    if (!Number.isFinite(istirahat) || istirahat < 0) continue;
    if (terlihat.has(weekday)) continue;
    terlihat.add(weekday);
    hasil.push({ weekday, startTime, endTime, breakDuration: istirahat });
  }
  return hasil.sort((a, b) => a.weekday - b.weekday);
};

export interface JenisBerjam {
  startTime: string;
  endTime: string;
  breakDuration: number | { toNumber: () => number };
  dailyHours?: unknown;
}

/** Jam bawaan jenis shift (hari tanpa jam khusus). */
export const jamBawaan = (jenis: JenisBerjam): JamShift => ({
  startTime: jenis.startTime,
  endTime: jenis.endTime,
  breakDuration: angka(jenis.breakDuration),
});

/** Jam yang berlaku pada hari pekan tertentu (0 = Minggu … 6 = Sabtu). */
export const jamUntukHari = (jenis: JenisBerjam, weekday: number): JamShift => {
  const khusus = bacaJamPerHari(jenis.dailyHours).find((j) => j.weekday === weekday);
  return khusus
    ? { startTime: khusus.startTime, endTime: khusus.endTime, breakDuration: khusus.breakDuration }
    : jamBawaan(jenis);
};

/** Jam yang berlaku pada sebuah tanggal kalender (tengah malam UTC). */
export const jamUntukTanggal = (jenis: JenisBerjam, tanggal: Date): JamShift =>
  jamUntukHari(jenis, tanggal.getUTCDay());

export const samaJam = (a: JamShift, b: JamShift) =>
  a.startTime === b.startTime && a.endTime === b.endTime && a.breakDuration === b.breakDuration;

/**
 * Menyiapkan dailyHours untuk disimpan: urut per hari, dan hari yang jamnya
 * persis sama dengan jam bawaan dibuang. Entri seperti itu tidak bermakna saat
 * disimpan, tetapi akan "membekukan" hari itu bila jam bawaan diubah kemudian.
 */
export const normalkanJamPerHari = (jamPerHari: readonly JamHari[], bawaan: JamShift): JamHari[] =>
  [...jamPerHari]
    .filter((j) => !samaJam(j, bawaan))
    .sort((a, b) => a.weekday - b.weekday)
    .map((j) => ({ weekday: j.weekday, startTime: j.startTime, endTime: j.endTime, breakDuration: j.breakDuration }));
