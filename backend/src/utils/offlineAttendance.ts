// src/utils/offlineAttendance.ts
//
// Waktu presensi yang diambil saat ponsel offline dan baru dikirim
// belakangan dari antrean mobile.
//
// Tanpa ini server mencatat jam saat kiriman TIBA: karyawan yang absen
// 07.55 di lokasi tanpa sinyal lalu tersambung 10.00 tercatat terlambat dua
// jam. Sebaliknya jam ponsel mudah dimundurkan lewat pengaturan, jadi waktu
// dari ponsel tidak diterima begitu saja:
//
// - serverTimeEstimate: jam server saat ponsel terakhir online, ditambah
//   jam monotonik perangkat sejak itu (tidak ikut berubah bila jam ponsel
//   diubah). Bila ada, INILAH waktu yang dicatat.
// - gpsTime: waktu pembacaan GPS, pembanding kedua.
// - capturedAt: jam ponsel; dipakai hanya bila tidak ada pembanding (mis.
//   ponsel dinyalakan ulang saat offline), dan ditandai untuk HR.
//
// Fungsi ini murni supaya aturannya mudah diuji dan diaudit.
import type { IntegrityFlag } from './locationIntegrity';

/** Selisih jam yang masih wajar antara jam ponsel dan pembandingnya. */
export const TOLERANSI_JAM_MENIT = 5;

export interface BuktiWaktuOffline {
  capturedAt: Date;
  serverTimeEstimate?: Date | null;
  gpsTime?: Date | null;
}

export type HasilWaktuOffline =
  | { ok: true; waktu: Date; flags: IntegrityFlag[] }
  | { ok: false; alasan: string };

const selisihMenit = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) / 60_000;

export const evaluateOfflineTime = (
  bukti: BuktiWaktuOffline,
  params: { now: Date; maxHours: number }
): HasilWaktuOffline => {
  const { capturedAt, serverTimeEstimate, gpsTime } = bukti;
  const waktu = serverTimeEstimate ?? capturedAt;
  const flags: IntegrityFlag[] = [];

  const pembanding = serverTimeEstimate ?? gpsTime;
  if (!pembanding) {
    flags.push('clock_unverified');
  } else if (
    selisihMenit(capturedAt, pembanding) > TOLERANSI_JAM_MENIT ||
    (serverTimeEstimate && gpsTime && selisihMenit(serverTimeEstimate, gpsTime) > TOLERANSI_JAM_MENIT)
  ) {
    flags.push('clock_mismatch');
  }

  if (waktu.getTime() > params.now.getTime() + TOLERANSI_JAM_MENIT * 60_000) {
    return { ok: false, alasan: 'Waktu presensi berada di masa depan. Periksa jam ponsel Anda.' };
  }
  if (params.now.getTime() - waktu.getTime() > params.maxHours * 3_600_000) {
    return {
      ok: false,
      alasan: `Presensi offline baru terkirim lebih dari ${params.maxHours} jam setelah diambil. Hubungi HR untuk koreksi presensi.`,
    };
  }

  return { ok: true, waktu, flags };
};
