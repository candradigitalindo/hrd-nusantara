// src/schemas/attendanceSchema.ts
import { z } from 'zod';
import {
  ulidField,
  dateOnlyField,
  latitudeField,
  longitudeField,
  paginationFields,
} from './common';
import { base64ImageField } from './faceSchema';

export const ATTENDANCE_METHODS = ['gps', 'qr', 'face'] as const;
export const ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'no_checkout'] as const;

const coordinates = {
  latitude: latitudeField.optional(),
  longitude: longitudeField.optional(),
};

/**
 * Tiap metode presensi punya syarat data yang berbeda, jadi validasinya
 * per-metode. Kalau tidak, controller harus menebak field mana yang wajib
 * dan pesan errornya jadi kabur bagi aplikasi mobile.
 */
const requireByMethod = (
  data: {
    method: string;
    latitude?: number;
    longitude?: number;
    qrToken?: string;
    workLocationId?: string;
    faceImage?: string;
  },
  ctx: z.RefinementCtx
) => {
  const wajibKoordinat = () => {
    if (data.latitude === undefined || data.longitude === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['latitude'],
        message: `Metode "${data.method}" membutuhkan latitude dan longitude`,
      });
    }
  };

  if (data.method === 'gps') {
    wajibKoordinat();
    if (!data.workLocationId) {
      ctx.addIssue({
        code: 'custom',
        path: ['workLocationId'],
        message: 'Metode "gps" membutuhkan workLocationId',
      });
    }
  }

  if (data.method === 'qr' && !data.qrToken) {
    ctx.addIssue({
      code: 'custom',
      path: ['qrToken'],
      message: 'Metode "qr" membutuhkan qrToken hasil pemindaian',
    });
  }

  if (data.method === 'face') {
    wajibKoordinat();
    if (!data.faceImage) {
      ctx.addIssue({
        code: 'custom',
        path: ['faceImage'],
        message: 'Metode "face" membutuhkan faceImage (foto base64)',
      });
    }
    if (!data.workLocationId) {
      ctx.addIssue({
        code: 'custom',
        path: ['workLocationId'],
        message: 'Metode "face" membutuhkan workLocationId',
      });
    }
  }
};

/**
 * Laporan integritas perangkat dari aplikasi mobile. Semua opsional: klien
 * lama tidak mengirimnya, dan ketiadaannya sendiri ditandai oleh server.
 */
export const integritySchema = z
  .object({
    mockLocation: z.boolean().optional(),
    mockApps: z.array(z.string().trim().max(200)).max(50).optional(),
    rooted: z.boolean().optional(),
    emulator: z.boolean().optional(),
    developerOptions: z.boolean().optional(),
    networkDistanceMeters: z.number().min(0).max(40_000_000).nullable().optional(),
    positionAgeSeconds: z.number().min(0).max(31_536_000).nullable().optional(),
    platform: z.enum(['android', 'ios']).optional(),
    appVersion: z.string().trim().max(40).optional(),
  })
  .strict();

const waktuIso = z.iso.datetime({ offset: true });

/**
 * Presensi yang diambil saat ponsel offline dan dikirim belakangan dari
 * antrean. Waktu yang dicatat ditentukan dari bukti ini (lihat
 * utils/offlineAttendance.ts), bukan jam server saat kiriman tiba.
 */
export const offlineSchema = z
  .object({
    /** Jam ponsel saat presensi diambil. */
    capturedAt: waktuIso,
    /** Jam server saat terakhir online + jam monotonik perangkat sejak itu. */
    serverTimeEstimate: waktuIso.nullable().optional(),
    /** Waktu pembacaan GPS (bukan jam ponsel). */
    gpsTime: waktuIso.nullable().optional(),
  })
  .strict();

export const checkInSchema = z
  .object({
    method: z.enum(ATTENDANCE_METHODS),
    ...coordinates,
    workLocationId: ulidField.optional(),
    qrToken: z.string().trim().min(1).max(200).optional(),
    faceImage: base64ImageField.optional(),
    notes: z.string().trim().max(500).optional(),
    integrity: integritySchema.optional(),
    /// Foto untuk stempel absensi ke grup WhatsApp, bila metodenya bukan wajah.
    photo: base64ImageField.optional(),
    offline: offlineSchema.optional(),
  })
  .strict()
  .superRefine(requireByMethod);

export const checkOutSchema = z
  .object({
    method: z.enum(ATTENDANCE_METHODS),
    ...coordinates,
    workLocationId: ulidField.optional(),
    qrToken: z.string().trim().min(1).max(200).optional(),
    faceImage: base64ImageField.optional(),
    notes: z.string().trim().max(500).optional(),
    integrity: integritySchema.optional(),
    photo: base64ImageField.optional(),
    offline: offlineSchema.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    // Saat check-out lokasi diambil dari record presensi yang sedang terbuka,
    // jadi workLocationId tidak perlu dikirim ulang.
    requireByMethod({ ...data, workLocationId: data.workLocationId ?? 'ada' }, ctx);
  });

export const overtimeDecisionSchema = z
  .object({
    approved: z.boolean(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

export const listAttendanceQuerySchema = z.object({
  ...paginationFields,
  employeeId: ulidField.optional(),
  departmentId: ulidField.optional(),
  status: z.enum(ATTENDANCE_STATUSES).optional(),
  startDate: dateOnlyField.optional(),
  endDate: dateOnlyField.optional(),
  onlyPendingOvertime: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /// Hanya presensi yang punya penanda kecurangan lokasi.
  flaggedOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /// Hanya presensi yang masuk atau pulangnya diambil offline dan dikirim belakangan.
  offlineOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export const attendanceReportQuerySchema = z.object({
  startDate: dateOnlyField,
  endDate: dateOnlyField,
  employeeId: ulidField.optional(),
  departmentId: ulidField.optional(),
});

export type CheckInInput = z.infer<typeof checkInSchema>;
export type CheckOutInput = z.infer<typeof checkOutSchema>;
export type OvertimeDecisionInput = z.infer<typeof overtimeDecisionSchema>;
export type ListAttendanceQuery = z.infer<typeof listAttendanceQuerySchema>;
export type AttendanceReportQuery = z.infer<typeof attendanceReportQuerySchema>;
