// src/utils/locationIntegrity.ts
//
// Deteksi kecurangan lokasi (fake GPS) pada presensi mobile.
//
// Tidak ada satu sinyal yang cukup: aplikasi lokasi palsu bisa menyembunyikan
// penanda mock, ponsel yang di-root bisa memalsukan apa saja. Karena itu
// sinyalnya berlapis — dari ponsel (laporan integritas) dan dari server
// (kecepatan perpindahan yang mustahil antar presensi). Sebagian sinyal
// memblokir, sisanya hanya menandai supaya HR memeriksa. Fungsi ini murni
// agar mudah diuji dan aturannya mudah diaudit.
import { distanceInMeters } from './geo';

export const INTEGRITY_FLAGS = [
  'mock_location',
  'mock_app_installed',
  'rooted_device',
  'emulator',
  'developer_options',
  'network_mismatch',
  'stale_position',
  'impossible_speed',
  'integrity_missing',
] as const;
export type IntegrityFlag = (typeof INTEGRITY_FLAGS)[number];

/** Yang memblokir presensi. Sisanya ditandai untuk ditinjau HR. */
export const BLOCKING_FLAGS: ReadonlySet<IntegrityFlag> = new Set<IntegrityFlag>([
  'mock_location',
  'mock_app_installed',
  'rooted_device',
]);

export const LABEL_FLAG: Record<IntegrityFlag, string> = {
  mock_location: 'lokasi ditandai palsu oleh sistem operasi',
  mock_app_installed: 'aplikasi lokasi palsu terpasang',
  rooted_device: 'perangkat di-root / jailbreak',
  emulator: 'berjalan di emulator',
  developer_options: 'opsi pengembang aktif',
  network_mismatch: 'lokasi GPS jauh dari lokasi jaringan seluler',
  stale_position: 'posisi GPS basi (bukan pembacaan baru)',
  impossible_speed: 'perpindahan terlalu cepat dari presensi sebelumnya',
  integrity_missing: 'aplikasi tidak mengirim laporan integritas',
};

export interface IntegrityReport {
  mockLocation?: boolean;
  mockApps?: string[];
  rooted?: boolean;
  emulator?: boolean;
  developerOptions?: boolean;
  networkDistanceMeters?: number | null;
  positionAgeSeconds?: number | null;
  platform?: 'android' | 'ios';
  appVersion?: string;
}

/** Jarak GPS vs jaringan yang masih wajar (akurasi sel bisa ratusan meter). */
export const NETWORK_MISMATCH_METERS = 1500;
/** Posisi lebih tua dari ini bukan pembacaan saat check-in. */
export const STALE_POSITION_SECONDS = 120;
/** Kecepatan darat yang tidak mungkin untuk pindah antar lokasi kerja. */
export const IMPOSSIBLE_SPEED_KMH = 250;
/** Jarak pendek diabaikan: akurasi GPS bisa "melompat" ratusan meter. */
export const MIN_DISTANCE_FOR_SPEED_METERS = 2000;

export interface PreviousFix {
  latitude: number;
  longitude: number;
  at: Date;
}

export interface IntegrityEvaluation {
  flags: IntegrityFlag[];
  blocked: boolean;
  /** Kalimat untuk pengguna bila diblokir, atau untuk HR bila hanya ditandai. */
  reason: string | null;
}

export const evaluateIntegrity = (params: {
  report: IntegrityReport | undefined;
  /** Hanya metode berbasis GPS yang menuntut laporan. */
  usesGps: boolean;
  position?: { latitude: number; longitude: number };
  previous?: PreviousFix | null;
  now: Date;
}): IntegrityEvaluation => {
  const flags: IntegrityFlag[] = [];
  const r = params.report;

  if (!r) {
    if (params.usesGps) flags.push('integrity_missing');
  } else {
    if (r.mockLocation) flags.push('mock_location');
    if (r.mockApps && r.mockApps.length > 0) flags.push('mock_app_installed');
    if (r.rooted) flags.push('rooted_device');
    if (r.emulator) flags.push('emulator');
    if (r.developerOptions) flags.push('developer_options');
    if (typeof r.networkDistanceMeters === 'number' && r.networkDistanceMeters > NETWORK_MISMATCH_METERS) {
      flags.push('network_mismatch');
    }
    if (typeof r.positionAgeSeconds === 'number' && r.positionAgeSeconds > STALE_POSITION_SECONDS) {
      flags.push('stale_position');
    }
  }

  if (params.position && params.previous) {
    const jarak = distanceInMeters(params.position, params.previous);
    const jam = (params.now.getTime() - params.previous.at.getTime()) / 3_600_000;
    if (jarak >= MIN_DISTANCE_FOR_SPEED_METERS && jam > 0 && jarak / 1000 / jam > IMPOSSIBLE_SPEED_KMH) {
      flags.push('impossible_speed');
    }
  }

  const blocked = flags.some((f) => BLOCKING_FLAGS.has(f));
  const reason =
    flags.length === 0
      ? null
      : (blocked ? 'Terdeteksi kecurangan lokasi: ' : 'Perlu ditinjau: ') +
        flags
          .filter((f) => !blocked || BLOCKING_FLAGS.has(f))
          .map((f) => LABEL_FLAG[f])
          .join(', ') +
        (r?.mockApps?.length ? ` (${r.mockApps.slice(0, 3).join(', ')})` : '');

  return { flags, blocked, reason };
};
