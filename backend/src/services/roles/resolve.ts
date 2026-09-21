// src/services/roles/resolve.ts
import { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { DEFAULT_PERMISSIONS, KUNCI_IZIN } from '../../utils/permissions';

/**
 * Menentukan izin efektif seorang karyawan.
 *
 * Urutan sumbernya:
 *   1. Peran kustom yang ditugaskan ke karyawan itu (Employee.customRoleId).
 *   2. Kalau tidak ada, peran sistem dengan kode = lingkup data karyawan —
 *      supaya suntingan admin pada peran "HR Admin" tetap berlaku untuk akun
 *      lama yang belum pernah diberi peran secara eksplisit.
 *   3. Kalau peran sistem pun belum dibuat (mis. basis data baru), izin
 *      bawaan yang dikodekan.
 *
 * SUPER_ADMIN selalu memegang semua izin apa pun isi basis datanya. Tanpa
 * pengecualian ini, satu kesalahan sunting bisa mengunci pemilik sistem
 * dari halaman yang dipakai untuk memperbaikinya.
 */
export const izinEfektif = async (karyawan: {
  role: Role;
  customRole: { permissions: string[] } | null;
}): Promise<string[]> => {
  if (karyawan.role === Role.SUPER_ADMIN) return [...KUNCI_IZIN];
  if (karyawan.customRole) return karyawan.customRole.permissions;

  const sistem = await prisma.customRole.findUnique({
    where: { code: karyawan.role },
    select: { permissions: true },
  });
  return sistem ? sistem.permissions : [...DEFAULT_PERMISSIONS[karyawan.role]];
};
