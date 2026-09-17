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

export const checkInSchema = z
  .object({
    method: z.enum(ATTENDANCE_METHODS),
    ...coordinates,
    workLocationId: ulidField.optional(),
    qrToken: z.string().trim().min(1).max(200).optional(),
    faceImage: base64ImageField.optional(),
    notes: z.string().trim().max(500).optional(),
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
