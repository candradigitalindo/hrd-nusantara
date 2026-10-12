// src/utils/lingkupData.ts
//
// Lingkup data (kolom Role / baseRole peran kustom): ATAS SIAPA seorang
// pengguna boleh bertindak. Izin (mis. kinerja.ubah) menentukan BOLEH APA.
// Keduanya harus dipakai bersama: peran kustom berlingkup "Departemen
// sendiri" yang diberi izin kelola tidak boleh menjangkau seluruh perusahaan.
//
// Konvensinya sama dengan controller karyawan dan cuti: HR seluruh
// perusahaan, manajer departemennya sendiri, selain itu dirinya sendiri.
import { Prisma, Role } from '@prisma/client';
import type { AuthUser } from '../middleware/auth';

export type AktorLingkup = Pick<AuthUser, 'id' | 'role' | 'departmentId'>;

export const lingkupHr = (role: Role): boolean => role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;

/** Apakah karyawan sasaran berada dalam lingkup data aktor. */
export const dalamLingkup = (actor: AktorLingkup, target: { id: string; departmentId: string | null }): boolean =>
  lingkupHr(actor.role) ||
  target.id === actor.id ||
  (actor.role === Role.MANAGER && actor.departmentId !== null && target.departmentId === actor.departmentId);

/**
 * Saringan karyawan untuk daftar lintas karyawan: manajer dikunci ke
 * departemennya, lingkup "diri sendiri" ke dirinya. Mengembalikan null bila
 * departemen yang diminta di luar lingkup (jawab 403).
 */
export const saringanLingkupKaryawan = (
  actor: AktorLingkup,
  departmentId?: string | null
): Prisma.EmployeeWhereInput | null => {
  if (lingkupHr(actor.role)) return departmentId ? { departmentId } : {};
  if (actor.role === Role.MANAGER) {
    if (departmentId && departmentId !== actor.departmentId) return null;
    return { departmentId: actor.departmentId ?? '__tanpa_departemen__' };
  }
  return { id: actor.id };
};
