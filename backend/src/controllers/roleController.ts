// src/controllers/roleController.ts
//
// Pengelolaan peran dinamis. Aturan anti-eskalasi yang dijaga di sini:
//   - Bukan SUPER_ADMIN tidak boleh membuat/menyunting peran berlingkup
//     HR_ADMIN atau SUPER_ADMIN, dan tidak boleh memberikan izin yang tidak
//     ia pegang sendiri — siapa pun yang bisa mengelola peran tidak boleh
//     memakai jalur itu untuk menaikkan haknya sendiri.
//   - Peran sistem SUPER_ADMIN terkunci sepenuhnya; peran sistem lain boleh
//     diubah izinnya tetapi tidak lingkup datanya dan tidak bisa dihapus.
//   - Peran yang masih dipegang karyawan tidak bisa dihapus.
import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateULID } from '../utils/generateULID';
import { IZIN, LABEL_LINGKUP } from '../utils/permissions';
import type { CreateRoleInput, UpdateRoleInput } from '../schemas/roleSchema';

const roleSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  baseRole: true,
  permissions: true,
  isSystem: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { employees: true } },
} satisfies Prisma.CustomRoleSelect;

const LINGKUP_TINGGI = new Set<Role>([Role.SUPER_ADMIN, Role.HR_ADMIN]);

/**
 * Alasan penolakan bila aktor mencoba memberi hak yang melampaui miliknya,
 * atau null bila boleh. SUPER_ADMIN bebas.
 */
const pelanggaranEskalasi = (
  aktor: { role: Role; permissions: string[] },
  target: { baseRole?: Role; permissions?: string[] }
): string | null => {
  if (aktor.role === Role.SUPER_ADMIN) return null;
  if (target.baseRole && LINGKUP_TINGGI.has(target.baseRole)) {
    return 'Hanya SUPER_ADMIN yang boleh membuat peran berlingkup HR Admin atau Super Admin';
  }
  const asing = (target.permissions ?? []).filter((k) => !aktor.permissions.includes(k));
  if (asing.length > 0) {
    return `Anda tidak bisa memberikan izin yang tidak Anda pegang sendiri: ${asing.join(', ')}`;
  }
  return null;
};

export const getPermissionCatalog = async (_req: Request, res: Response) => {
  res.json({
    permissions: IZIN,
    scopes: (Object.keys(LABEL_LINGKUP) as Role[]).map((role) => ({ role, label: LABEL_LINGKUP[role] })),
  });
};

export const getAllRoles = async (_req: Request, res: Response) => {
  const data = await prisma.customRole.findMany({
    select: roleSelect,
    // Peran sistem dulu, urut lingkup dari yang terluas; lalu peran kustom menurut nama.
    orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }, { name: 'asc' }],
  });
  res.json({ data });
};

export const getRoleById = async (req: Request, res: Response) => {
  const role = await prisma.customRole.findUnique({ where: { id: req.params.id }, select: roleSelect });
  if (!role) return res.status(404).json({ error: 'Peran tidak ditemukan' });
  res.json(role);
};

export const createRole = async (req: Request, res: Response) => {
  const input = req.body as CreateRoleInput;
  const aktor = req.user!;

  const tolak = pelanggaranEskalasi(aktor, input);
  if (tolak) return res.status(403).json({ error: tolak });

  try {
    const role = await prisma.customRole.create({
      data: {
        id: generateULID(),
        name: input.name,
        description: input.description,
        baseRole: input.baseRole,
        permissions: input.permissions,
      },
      select: roleSelect,
    });

    res.locals.audit = {
      action: 'peran.buat',
      entity: 'CustomRole',
      entityId: role.id,
      summary: `Membuat peran ${role.name} (lingkup ${role.baseRole}, ${role.permissions.length} izin)`,
      metadata: { baseRole: role.baseRole, permissions: role.permissions },
    };
    res.status(201).json(role);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'Nama peran sudah dipakai' });
    }
    throw error;
  }
};

export const updateRole = async (req: Request, res: Response) => {
  const { id } = req.params;
  const input = req.body as UpdateRoleInput;
  const aktor = req.user!;

  const lama = await prisma.customRole.findUnique({ where: { id }, select: roleSelect });
  if (!lama) return res.status(404).json({ error: 'Peran tidak ditemukan' });

  if (lama.code === Role.SUPER_ADMIN) {
    return res.status(403).json({ error: 'Peran Super Admin terkunci dan tidak bisa diubah' });
  }
  if (lama.isSystem && input.baseRole !== undefined && input.baseRole !== lama.baseRole) {
    return res.status(400).json({ error: 'Lingkup data peran sistem tidak bisa diubah' });
  }

  // Yang diperiksa adalah HASIL akhirnya: menyunting peran berlingkup tinggi
  // sama berbahayanya dengan membuatnya, walau field baseRole tidak dikirim.
  const tolak = pelanggaranEskalasi(aktor, {
    baseRole: input.baseRole ?? lama.baseRole,
    permissions: input.permissions,
  });
  if (tolak) return res.status(403).json({ error: tolak });

  // Menyunting peran yang sedang dipegang aktor sendiri = mengubah hak sendiri.
  if (aktor.role !== Role.SUPER_ADMIN && aktor.customRoleId === id) {
    return res.status(403).json({ error: 'Anda tidak bisa mengubah peran yang sedang Anda pegang' });
  }

  const data: Prisma.CustomRoleUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.baseRole !== undefined) data.baseRole = input.baseRole;
  if (input.permissions !== undefined) data.permissions = input.permissions;

  try {
    const role = await prisma.$transaction(async (tx) => {
      const hasil = await tx.customRole.update({ where: { id }, data, select: roleSelect });
      // Lingkup data karyawan pemegang peran ikut berubah, supaya pembatasan
      // data di controller (departemen sendiri, dsb.) tetap konsisten dengan
      // perannya.
      if (input.baseRole !== undefined && input.baseRole !== lama.baseRole) {
        await tx.employee.updateMany({ where: { customRoleId: id }, data: { role: input.baseRole } });
      }
      return hasil;
    });

    res.locals.audit = {
      action: 'peran.ubah',
      entity: 'CustomRole',
      entityId: id,
      summary: `Mengubah peran ${role.name}`,
      metadata: {
        fieldBerubah: Object.keys(input),
        izinSebelum: lama.permissions,
        izinSesudah: role.permissions,
        lingkupSebelum: lama.baseRole,
        lingkupSesudah: role.baseRole,
      },
    };
    res.json(role);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'Nama peran sudah dipakai' });
    }
    throw error;
  }
};

export const deleteRole = async (req: Request, res: Response) => {
  const { id } = req.params;

  const role = await prisma.customRole.findUnique({ where: { id }, select: roleSelect });
  if (!role) return res.status(404).json({ error: 'Peran tidak ditemukan' });
  if (role.isSystem) return res.status(403).json({ error: 'Peran sistem tidak bisa dihapus' });
  if (role._count.employees > 0) {
    return res.status(409).json({
      error: `Peran masih dipegang ${role._count.employees} karyawan. Pindahkan mereka ke peran lain dulu.`,
    });
  }

  await prisma.customRole.delete({ where: { id } });

  res.locals.audit = {
    action: 'peran.hapus',
    entity: 'CustomRole',
    entityId: id,
    summary: `Menghapus peran ${role.name}`,
    metadata: { baseRole: role.baseRole, permissions: role.permissions },
  };
  res.status(204).send();
};
