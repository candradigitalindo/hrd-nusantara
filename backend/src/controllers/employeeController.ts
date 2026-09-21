// src/controllers/employeeController.ts
import type { DirectoryQuery } from '../schemas/employeeSchema';
import { Request, Response } from 'express';
import { normalizePhoneNumber } from '../utils/whatsappRules';
import bcrypt from 'bcryptjs';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { generateULID } from '../utils/generateULID';
import type {
  CreateEmployeeInput,
  UpdateEmployeeInput,
  ListEmployeeQuery,
  DeactivateEmployeeInput,
} from '../schemas/employeeSchema';

/** Field yang boleh keluar dari API. `password` sengaja tidak pernah ikut. */
const employeeSelect = {
  id: true,
  nik: true,
  name: true,
  email: true,
  phoneNumber: true,
  address: true,
  dateOfBirth: true,
  status: true,
  role: true,
  customRoleId: true,
  customRole: { select: { id: true, name: true, isSystem: true } },
  lastLoginAt: true,
  joinDate: true,
  exitDate: true,
  exitReason: true,
  exitType: true,
  departmentId: true,
  positionId: true,
  createdAt: true,
  updatedAt: true,
  department: { select: { id: true, name: true } },
  position: { select: { id: true, name: true } },
} satisfies Prisma.EmployeeSelect;

const INACTIVE_STATUSES = ['resign', 'terminated', 'inactive'];

/**
 * HR_ADMIN boleh mengangkat MANAGER dan EMPLOYEE, tapi tidak boleh membuat
 * HR_ADMIN atau SUPER_ADMIN baru — termasuk untuk dirinya sendiri.
 * Tanpa aturan ini, satu akun HR yang bocor cukup untuk mengambil alih sistem.
 */
const assertCanAssignRole = (actorRole: Role, targetRole: Role): string | null => {
  if (actorRole === Role.SUPER_ADMIN) return null;
  if (targetRole === Role.SUPER_ADMIN || targetRole === Role.HR_ADMIN) {
    return 'Hanya SUPER_ADMIN yang boleh memberikan role HR_ADMIN atau SUPER_ADMIN';
  }
  return null;
};

/**
 * Menentukan peran yang akan diberikan: peran kustom yang diminta, atau peran
 * sistem sesuai lingkup data. Lingkup data karyawan (kolom role) selalu
 * mengikuti lingkup perannya, supaya pembatasan data di controller lain
 * konsisten dengan izin yang ia pegang.
 */
const tentukanPeran = async (
  aktor: { role: Role; permissions: string[] },
  input: { role?: Role; customRoleId?: string }
): Promise<{ ok: true; role: Role; customRoleId: string | null } | { ok: false; status: number; error: string }> => {
  if (input.customRoleId) {
    const peran = await prisma.customRole.findUnique({
      where: { id: input.customRoleId },
      select: { id: true, baseRole: true, permissions: true },
    });
    if (!peran) return { ok: false, status: 400, error: 'Peran tidak ditemukan' };

    const roleError = assertCanAssignRole(aktor.role, peran.baseRole);
    if (roleError) return { ok: false, status: 403, error: roleError };

    // Memberi orang lain peran yang izinnya melampaui milik sendiri adalah
    // jalur eskalasi tidak langsung; SUPER_ADMIN bebas.
    if (aktor.role !== Role.SUPER_ADMIN) {
      const asing = peran.permissions.filter((k) => !aktor.permissions.includes(k));
      if (asing.length > 0) {
        return { ok: false, status: 403, error: `Anda tidak bisa memberikan peran dengan izin yang tidak Anda pegang: ${asing.join(', ')}` };
      }
    }
    return { ok: true, role: peran.baseRole, customRoleId: peran.id };
  }

  const role = input.role ?? Role.EMPLOYEE;
  const roleError = assertCanAssignRole(aktor.role, role);
  if (roleError) return { ok: false, status: 403, error: roleError };

  const sistem = await prisma.customRole.findUnique({ where: { code: role }, select: { id: true } });
  return { ok: true, role, customRoleId: sistem?.id ?? null };
};

export const getAllEmployees = async (req: Request, res: Response) => {
  const { page, limit, search, status, departmentId, includeInactive } =
    req.query as unknown as ListEmployeeQuery;
  const actor = req.user!;

  const where: Prisma.EmployeeWhereInput = {};

  // MANAGER hanya melihat karyawan di departemennya sendiri.
  if (actor.role === Role.MANAGER) {
    where.departmentId = actor.departmentId ?? '__tanpa_departemen__';
  }
  if (departmentId) {
    if (actor.role === Role.MANAGER && departmentId !== actor.departmentId) {
      return res.status(403).json({ error: 'Anda hanya bisa melihat departemen sendiri' });
    }
    where.departmentId = departmentId;
  }

  if (status) {
    where.status = status;
  } else if (!includeInactive) {
    where.status = { notIn: INACTIVE_STATUSES };
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { nik: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [total, data] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.employee.findMany({
      where,
      select: employeeSelect,
      orderBy: { name: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
};

export const getEmployeeById = async (req: Request, res: Response) => {
  const { id } = req.params;
  const actor = req.user!;

  const employee = await prisma.employee.findUnique({ where: { id }, select: employeeSelect });

  if (!employee) {
    return res.status(404).json({ error: 'Karyawan tidak ditemukan' });
  }

  const isSelf = actor.id === employee.id;
  const isHr = actor.role === Role.HR_ADMIN || actor.role === Role.SUPER_ADMIN;
  const isManagerOfDept =
    actor.role === Role.MANAGER &&
    actor.departmentId !== null &&
    actor.departmentId === employee.departmentId;

  if (!isSelf && !isHr && !isManagerOfDept) {
    return res.status(403).json({ error: 'Anda tidak punya akses ke data karyawan ini' });
  }

  res.json(employee);
};

/**
 * Nomor HP adalah username login, jadi disimpan dalam bentuk baku (628…)
 * apa pun cara HR mengetiknya; nomor yang tidak sah ditolak lebih awal.
 */
const bakukanNomorHp = (nomor: string | null | undefined): { ok: true; nomor: string | null } | { ok: false } => {
  if (nomor === undefined || nomor === null || nomor.trim() === '') return { ok: true, nomor: null };
  const baku = normalizePhoneNumber(nomor);
  return baku ? { ok: true, nomor: baku } : { ok: false };
};

const pesanKonflik = (target: string[] | undefined) => {
  const t = target ?? [];
  if (t.includes('phoneNumber')) return 'Nomor HP sudah dipakai karyawan lain';
  if (t.includes('email')) return 'Email sudah terpakai';
  if (t.includes('nik')) return 'NIK sudah terpakai';
  return `${t.join(', ') || 'NIK atau email'} sudah terpakai`;
};

export const createEmployee = async (req: Request, res: Response) => {
  const input = req.body as CreateEmployeeInput;
  const actor = req.user!;

  const peran = await tentukanPeran(actor, input);
  if (!peran.ok) return res.status(peran.status).json({ error: peran.error });

  const hp = bakukanNomorHp(input.phoneNumber);
  if (!hp.ok) return res.status(400).json({ error: 'Nomor HP tidak valid. Gunakan format 08xx atau +62xx.' });

  try {
    const employee = await prisma.employee.create({
      data: {
        // ULID dibuat di aplikasi, sesuai arsitektur_aplikasi.md.
        id: generateULID(),
        nik: input.nik,
        name: input.name,
        email: input.email,
        phoneNumber: hp.nomor,
        address: input.address,
        dateOfBirth: input.dateOfBirth,
        status: input.status,
        role: peran.role,
        ...(peran.customRoleId && { customRole: { connect: { id: peran.customRoleId } } }),
        password: input.password
          ? await bcrypt.hash(input.password, env.BCRYPT_ROUNDS)
          : null,
        ...(input.departmentId && { department: { connect: { id: input.departmentId } } }),
        ...(input.positionId && { position: { connect: { id: input.positionId } } }),
      },
      select: employeeSelect,
    });

    res.status(201).json(employee);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return res.status(409).json({ error: pesanKonflik(error.meta?.target as string[] | undefined) });
      }
      if (error.code === 'P2025') {
        return res.status(400).json({ error: 'Departemen atau posisi tidak ditemukan' });
      }
    }
    throw error;
  }
};

export const updateEmployee = async (req: Request, res: Response) => {
  const { id } = req.params;
  const input = req.body as UpdateEmployeeInput;
  const actor = req.user!;

  const ubahPeran = input.role !== undefined || input.customRoleId !== undefined;
  let peranBaru: { role: Role; customRoleId: string | null } | null = null;
  if (ubahPeran) {
    const peran = await tentukanPeran(actor, input);
    if (!peran.ok) return res.status(peran.status).json({ error: peran.error });
    if (actor.id === id && (peran.role !== actor.role || peran.customRoleId !== actor.customRoleId)) {
      return res.status(403).json({ error: 'Anda tidak bisa mengubah role diri sendiri' });
    }
    peranBaru = { role: peran.role, customRoleId: peran.customRoleId };
  }

  const data: Prisma.EmployeeUpdateInput = {};

  // Dibangun field demi field. Tidak ada spread dari req.body, jadi klien
  // tidak bisa menyelipkan kolom yang tidak dimaksudkan.
  if (input.nik !== undefined) data.nik = input.nik;
  if (input.name !== undefined) data.name = input.name;
  if (input.email !== undefined) data.email = input.email;
  if (input.phoneNumber !== undefined) {
    const hp = bakukanNomorHp(input.phoneNumber);
    if (!hp.ok) return res.status(400).json({ error: 'Nomor HP tidak valid. Gunakan format 08xx atau +62xx.' });
    data.phoneNumber = hp.nomor;
  }
  if (input.address !== undefined) data.address = input.address;
  if (input.dateOfBirth !== undefined) data.dateOfBirth = input.dateOfBirth;
  if (input.status !== undefined) data.status = input.status;
  if (peranBaru) {
    data.role = peranBaru.role;
    data.customRole = peranBaru.customRoleId ? { connect: { id: peranBaru.customRoleId } } : { disconnect: true };
  }

  // null berarti lepaskan relasi; string berarti pindahkan.
  if (input.departmentId !== undefined) {
    data.department = input.departmentId
      ? { connect: { id: input.departmentId } }
      : { disconnect: true };
  }
  if (input.positionId !== undefined) {
    data.position = input.positionId
      ? { connect: { id: input.positionId } }
      : { disconnect: true };
  }

  // Nilai sebelum perubahan, khusus untuk yang menyangkut hak akses dan
  // status kerja. Jejak "role diubah" tanpa nilai lamanya tidak menjawab
  // pertanyaan yang justru ditanyakan saat audit: naik dari apa ke apa.
  const perluNilaiLama = ubahPeran || input.status !== undefined;
  const sebelum = perluNilaiLama
    ? await prisma.employee.findUnique({ where: { id }, select: { role: true, status: true } })
    : null;

  try {
    const employee = await prisma.employee.update({ where: { id }, data, select: employeeSelect });

    res.locals.audit = {
      action: ubahPeran ? 'employee.ubah.role' : 'employee.ubah',
      entity: 'Employee',
      entityId: id,
      summary:
        ubahPeran && sebelum
          ? `Mengubah peran ${employee.email} menjadi ${employee.customRole?.name ?? employee.role} (lingkup ${sebelum.role} → ${employee.role})`
          : `Memperbarui data ${employee.email}`,
      // Hanya NAMA field yang berubah, bukan nilainya: alamat, tanggal lahir,
      // dan nomor telepon adalah data pribadi yang tidak perlu disalin ke
      // tabel audit yang tidak terenkripsi dan tidak bisa dihapus.
      metadata: {
        fieldBerubah: Object.keys(input),
        ...(sebelum
          ? {
              roleSebelum: sebelum.role,
              roleSesudah: employee.role,
              statusSebelum: sebelum.status,
              statusSesudah: employee.status,
            }
          : {}),
      },
    };

    res.json(employee);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return res.status(404).json({ error: 'Karyawan, departemen, atau posisi tidak ditemukan' });
      }
      if (error.code === 'P2002') {
        const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'NIK atau email';
        return res.status(409).json({ error: `${target} sudah terpakai` });
      }
    }
    throw error;
  }
};

/**
 * Non-aktifkan karyawan, bukan hapus baris.
 *
 * Hard delete memang mustahil di sini (semua foreign key ON DELETE RESTRICT,
 * jadi karyawan dengan satu presensi saja sudah tidak bisa dihapus), dan itu
 * justru benar: data presensi, payroll dan kontrak wajib diarsipkan.
 */
export const deactivateEmployee = async (req: Request, res: Response) => {
  const { id } = req.params;
  const actor = req.user!;

  if (actor.id === id) {
    return res.status(400).json({ error: 'Anda tidak bisa menonaktifkan akun sendiri' });
  }

  const { status, reason } = req.body as DeactivateEmployeeInput;

  try {
    const employee = await prisma.employee.update({
      where: { id },
      data: {
        status,
        // Tanggal dan alasan berhenti dicatat di sini, satu-satunya tempat
        // karyawan dinonaktifkan. Tanpa keduanya, analisis perputaran
        // karyawan tidak punya bahan.
        exitDate: new Date(),
        exitReason: reason,
        exitType: status === 'terminated' ? 'involuntary' : 'voluntary',
      },
      select: employeeSelect,
    });
    res.json({ message: 'Karyawan dinonaktifkan', employee });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({ error: 'Karyawan tidak ditemukan' });
    }
    throw error;
  }
};

/**
 * Direktori karyawan aktif untuk semua peran: hanya nama, NIK, dan unit kerja.
 * Karyawan biasa perlu memilih rekan saat membuat ruang obrolan atau memberi
 * umpan balik, tapi tidak boleh melihat email, telepon, alamat, atau gaji —
 * itu tetap di GET /employees yang dibatasi manajemen.
 */
export const getDirectory = async (req: Request, res: Response) => {
  const { q } = req.query as unknown as DirectoryQuery;

  const data = await prisma.employee.findMany({
    where: {
      status: { notIn: INACTIVE_STATUSES },
      ...(q
        ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { nik: { contains: q, mode: 'insensitive' } }] }
        : {}),
    },
    select: {
      id: true,
      nik: true,
      name: true,
      department: { select: { id: true, name: true } },
      position: { select: { id: true, name: true } },
    },
    orderBy: { name: 'asc' },
    take: 300,
  });

  res.json({ data });
};
