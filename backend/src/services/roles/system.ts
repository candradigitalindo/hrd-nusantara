// src/services/roles/system.ts
//
// Empat peran sistem yang selalu ada: satu untuk tiap lingkup data. Mereka
// dibuat otomatis saat server pertama kali jalan dan tidak bisa dihapus,
// supaya selalu ada peran yang bisa diberikan ke karyawan baru walau admin
// belum sempat membuat peran kustom.
import { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { generateULID } from '../../utils/generateULID';
import { DEFAULT_PERMISSIONS, KUNCI_IZIN, adaIzinLama, migrasiIzin } from '../../utils/permissions';

export const PERAN_SISTEM: readonly { code: Role; name: string; description: string }[] = [
  { code: Role.SUPER_ADMIN, name: 'Super Admin', description: 'Pemilik sistem. Semua hak akses, tidak bisa dibatasi.' },
  { code: Role.HR_ADMIN, name: 'HR Admin', description: 'Mengelola seluruh data kepegawaian perusahaan.' },
  { code: Role.MANAGER, name: 'Manajer', description: 'Mengelola tim di departemennya sendiri.' },
  { code: Role.EMPLOYEE, name: 'Karyawan', description: 'Akses ke data diri sendiri saja.' },
];

/**
 * Membuat peran sistem yang belum ada. Peran yang sudah ada TIDAK ditimpa:
 * admin boleh mengubah izin peran HR Admin/Manajer/Karyawan, dan perubahan
 * itu harus bertahan walau server dimulai ulang.
 */
export const pastikanPeranSistem = async (): Promise<void> => {
  await migrasiIzinPeranLama();
  for (const peran of PERAN_SISTEM) {
    const ada = await prisma.customRole.findUnique({ where: { code: peran.code }, select: { id: true } });
    if (ada) continue;
    await prisma.customRole.create({
      data: {
        id: generateULID(),
        code: peran.code,
        name: peran.name,
        description: peran.description,
        baseRole: peran.code,
        permissions: [...DEFAULT_PERMISSIONS[peran.code]],
        isSystem: true,
      },
    });
  }
};


/**
 * Menerjemahkan kunci izin generasi sebelumnya ("karyawan.kelola",
 * "halaman.cuti", …) yang masih tersimpan di peran menjadi kunci matriks
 * sekarang. Dijalankan tiap boot, tetapi hanya menyentuh peran yang memang
 * masih memuat kunci lama, jadi aman diulang. Super Admin selalu diberi
 * seluruh katalog karena perannya terkunci dan izinnya tidak dibaca
 * (SUPER_ADMIN memegang semua izin apa pun isi basis datanya).
 */
export const migrasiIzinPeranLama = async (): Promise<number> => {
  const semua = await prisma.customRole.findMany({ select: { id: true, code: true, permissions: true } });
  let diubah = 0;
  for (const peran of semua) {
    if (!adaIzinLama(peran.permissions)) continue;
    const baru = peran.code === Role.SUPER_ADMIN ? [...KUNCI_IZIN] : migrasiIzin(peran.permissions);
    await prisma.customRole.update({ where: { id: peran.id }, data: { permissions: baru } });
    diubah += 1;
  }
  if (diubah > 0) console.log(`[peran] ${diubah} peran dimigrasi ke kunci izin matriks`);
  return diubah;
};
