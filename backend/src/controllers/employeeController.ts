// src/controllers/employeeController.ts
import type { DirectoryQuery, ResetPasswordInput, FlexibleHoursInput } from '../schemas/employeeSchema';
import { Request, Response } from 'express';
import { normalizePhoneNumber } from '../utils/whatsappRules';
import bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { cabutSesi } from '../services/sesiMobile';
import { punyaIzin, ACTIVE_STATUSES, type AuthUser } from '../middleware/auth';
import { lihatAtauKelola } from '../utils/permissions';
import { generateULID } from '../utils/generateULID';
import { akhiriPenugasanKaryawan, hariIni, type Db } from '../services/shiftAssignment';
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
  flexibleHours: true,
  joinDate: true,
  exitDate: true,
  exitReason: true,
  exitType: true,
  departmentId: true,
  positionId: true,
  // Pola hari kerja milik karyawan sendiri (null = ikut departemen/bawaan),
  // supaya HR melihat dan mengubahnya dari halaman detail.
  workPatternId: true,
  createdAt: true,
  updatedAt: true,
  department: { select: { id: true, name: true } },
  position: { select: { id: true, name: true } },
  workPattern: { select: { id: true, name: true, type: true } },
} satisfies Prisma.EmployeeSelect;

export const INACTIVE_STATUSES = ['resign', 'terminated', 'inactive'];

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

/** Lingkup data dari yang paling sempit ke paling luas. */
const PERINGKAT_LINGKUP: Record<Role, number> = { EMPLOYEE: 0, MANAGER: 1, HR_ADMIN: 2, SUPER_ADMIN: 3 };

/**
 * Akun berlingkup lebih luas tidak boleh disentuh dari bawah: hanya SUPER_ADMIN
 * yang boleh menyunting, menonaktifkan, atau mengatur ulang sandi akun pemilik
 * sistem. Tanpa pagar ini izin `karyawan.ubah` saja sudah cukup untuk mengambil
 * alih akun Super Admin (dengan mengganti sandinya) atau mengunci pemiliknya
 * keluar (dengan menurunkan perannya, lalu menonaktifkan akunnya).
 */
const lingkupLebihTinggi = (aktor: { role: Role }, target: { role: Role }): boolean =>
  PERINGKAT_LINGKUP[target.role] > PERINGKAT_LINGKUP[aktor.role];

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

/**
 * Karyawan mana yang wajahnya siap dicocokkan saat check-in, supaya HR bisa
 * melihat siapa yang masih harus didaftarkan. Syaratnya sama dengan check-in:
 * pendaftaran aktif dan disetujui untuk model yang sedang dipakai —
 * pendaftaran dari model lama tidak dihitung karena check-in tetap akan
 * menolaknya. Kiriman mandiri yang menunggu persetujuan dihitung terpisah,
 * supaya HR tahu siapa yang tinggal disetujui, bukan didaftarkan dari awal.
 *
 * Hanya untuk pemegang izin wajah (null bila tidak): status biometrik bukan
 * bagian dari data karyawan yang boleh dilihat semua orang.
 */
const statusWajah = async (
  actor: Pick<AuthUser, 'permissions'>,
  ids: string[]
): Promise<{ terdaftar: Set<string>; menunggu: Set<string> } | null> => {
  if (!lihatAtauKelola('wajah').some((k) => punyaIzin(actor, k))) return null;
  if (ids.length === 0) return { terdaftar: new Set(), menunggu: new Set() };

  const [terdaftar, menunggu] = await Promise.all([
    prisma.faceEnrollment.findMany({
      where: {
        employeeId: { in: ids },
        isActive: true,
        status: 'approved',
        modelName: env.FACE_MODEL_NAME,
      },
      select: { employeeId: true },
      distinct: ['employeeId'],
    }),
    prisma.faceEnrollment.findMany({
      where: { employeeId: { in: ids }, status: 'pending' },
      select: { employeeId: true },
      distinct: ['employeeId'],
    }),
  ]);
  return {
    terdaftar: new Set(terdaftar.map((r) => r.employeeId)),
    menunggu: new Set(menunggu.map((r) => r.employeeId)),
  };
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

  const wajah = await statusWajah(actor, data.map((k) => k.id));

  res.json({
    data: wajah
      ? data.map((k) => ({
          ...k,
          faceEnrolled: wajah.terdaftar.has(k.id),
          facePending: wajah.menunggu.has(k.id),
        }))
      : data,
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
        joinDate: input.joinDate,
        status: input.status,
        role: peran.role,
        // Manajer masuk dan pulang sesuai kebutuhan, jadi bawaannya fleksibel;
        // HR tetap bisa mengirim nilai lain.
        flexibleHours: input.flexibleHours ?? peran.role === Role.MANAGER,
        ...(peran.customRoleId && { customRole: { connect: { id: peran.customRoleId } } }),
        password: input.password
          ? await bcrypt.hash(input.password, env.BCRYPT_ROUNDS)
          : null,
        // Sandi awal dari HR bersifat sementara: karyawan menggantinya sendiri.
        mustChangePassword: Boolean(input.password),
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

  const target = await prisma.employee.findUnique({
    where: { id },
    select: { role: true, status: true, flexibleHours: true },
  });
  if (!target) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });
  if (lingkupLebihTinggi(actor, target)) {
    return res.status(403).json({ error: 'Tidak bisa mengubah data akun berlingkup lebih tinggi' });
  }

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
  if (input.joinDate !== undefined) data.joinDate = input.joinDate;
  if (input.status !== undefined) data.status = input.status;
  if (input.password !== undefined) {
    data.password = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
    data.mustChangePassword = true;
  }
  if (peranBaru) {
    data.role = peranBaru.role;
    data.customRole = peranBaru.customRoleId ? { connect: { id: peranBaru.customRoleId } } : { disconnect: true };
  }

  // Jam fleksibel mengikuti peran bila tidak diatur eksplisit: naik menjadi
  // Manajer menyalakannya, turun dari Manajer mematikannya.
  const fleksibelBaru =
    input.flexibleHours ??
    (peranBaru && peranBaru.role !== target.role ? peranBaru.role === Role.MANAGER : target.flexibleHours);
  if (fleksibelBaru !== target.flexibleHours) {
    const tolak = tolakUbahJamSendiri(actor, id);
    if (tolak) return res.status(403).json({ error: tolak });
    data.flexibleHours = fleksibelBaru;
  }
  const nyalakanFleksibel = fleksibelBaru && !target.flexibleHours;
  // Status keluar juga bisa diatur lewat penyuntingan biasa, bukan hanya
  // lewat /deactivate; penugasan shiftnya harus ikut berhenti di kedua jalur.
  const keluarSekarang =
    input.status !== undefined && !ACTIVE_STATUSES.has(input.status) && ACTIVE_STATUSES.has(target.status);

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
  const sebelum = ubahPeran || input.status !== undefined ? target : null;

  try {
    // Menyalakan jam fleksibel lewat penyuntingan biasa (termasuk karena
    // diangkat menjadi Manajer) membersihkan rosternya sama seperti sakelar
    // khusus: jadwal yang tersisa akan tercatat "absen" karena check-in
    // fleksibel tidak lagi menautkan shift.
    const employee = await prisma.$transaction(async (tx) => {
      const hasil = await tx.employee.update({ where: { id }, data, select: employeeSelect });
      if (nyalakanFleksibel) {
        await akhiriPenugasanKaryawan(tx, id, hariIni(), { hapusOverride: true });
      } else if (keluarSekarang) {
        await akhiriPenugasanKaryawan(tx, id, hariIni(), { hapusOverride: false });
      }
      return hasil;
    });

    res.locals.audit = {
      action: ubahPeran ? 'employee.ubah.role' : 'employee.ubah',
      entity: 'Employee',
      entityId: id,
      summary:
        ubahPeran && sebelum
          ? `Mengubah peran ${employee.email} menjadi ${employee.customRole?.name ?? employee.role} (lingkup ${sebelum.role} → ${employee.role})`
          : `Memperbarui data ${employee.email}${input.password !== undefined ? ' (termasuk mengatur ulang kata sandi)' : ''}`,
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

  const target = await prisma.employee.findUnique({ where: { id }, select: { role: true } });
  if (!target) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });
  if (lingkupLebihTinggi(actor, target)) {
    return res.status(403).json({ error: 'Tidak bisa menonaktifkan akun berlingkup lebih tinggi' });
  }

  const { status, reason } = req.body as DeactivateEmployeeInput;

  try {
    const employee = await prisma.$transaction(async (tx) => {
      const hasil = await tx.employee.update({
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
      // Penugasan shift berhenti di hari keluar dan jadwal sesudahnya
      // dihapus; kalau dibiarkan, orang yang sudah keluar terhitung "absen"
      // di laporan dan tetap muncul di roster.
      await akhiriPenugasanKaryawan(tx, id, hariIni(), { hapusOverride: false });
      return hasil;
    });
    await cabutSesi({ employeeId: id }, 'deactivated');
    res.json({ message: 'Karyawan dinonaktifkan', employee });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({ error: 'Karyawan tidak ditemukan' });
    }
    throw error;
  }
};

/**
 * Mengubah jam kerja sendiri sama saja membebaskan diri dari hitungan
 * terlambat dan pulang cepat. Hanya Super Admin (pemilik sistem) yang boleh.
 */
const tolakUbahJamSendiri = (actor: { id: string; role: Role }, targetId: string): string | null =>
  actor.id === targetId && actor.role !== Role.SUPER_ADMIN ? 'Anda tidak bisa mengubah jam kerja sendiri' : null;

/** Dibatalkan dengan sengaja untuk pratinjau; hasilnya dibawa keluar transaksi. */
class BatalkanPratinjau extends Error {
  constructor(public readonly hasil: { assignmentsEnded: number; rowsDeleted: number }) {
    super('pratinjau');
  }
}

/**
 * Sakelar jam fleksibel. Menyalakannya mengakhiri penugasan shift karyawan
 * itu hari ini dan menghapus semua jadwal sesudah hari ini yang belum
 * dipakai presensi (termasuk yang dikoreksi manual): karyawan fleksibel
 * tidak memakai roster, dan jadwal yang tersisa akan terbaca "absen".
 *
 * Dengan preview, dampaknya dihitung di transaksi yang lalu dibatalkan,
 * jadi angkanya persis sama dengan yang akan terjadi.
 */
export const setFlexibleHours = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { flexibleHours, preview } = req.body as FlexibleHoursInput;
  const actor = req.user!;

  const target = await prisma.employee.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, departmentId: true, flexibleHours: true },
  });
  if (!target) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });
  if (lingkupLebihTinggi(actor, target)) {
    return res.status(403).json({ error: 'Tidak bisa mengubah data akun berlingkup lebih tinggi' });
  }
  if (actor.role === Role.MANAGER && (!actor.departmentId || target.departmentId !== actor.departmentId)) {
    return res.status(403).json({ error: 'Manajer hanya bisa mengubah karyawan di departemennya' });
  }
  if (flexibleHours !== target.flexibleHours) {
    const tolak = tolakUbahJamSendiri(actor, id);
    if (tolak) return res.status(403).json({ error: tolak });
  }

  const nyalakan = flexibleHours && !target.flexibleHours;
  const jalankan = async (tx: Db) => {
    if (flexibleHours !== target.flexibleHours) {
      await tx.employee.update({ where: { id }, data: { flexibleHours } });
    }
    return nyalakan
      ? akhiriPenugasanKaryawan(tx, id, hariIni(), { hapusOverride: true })
      : { assignmentsEnded: 0, rowsDeleted: 0 };
  };

  let dampak: { assignmentsEnded: number; rowsDeleted: number };
  try {
    dampak = await prisma.$transaction(async (tx) => {
      const hasil = await jalankan(tx);
      if (preview) throw new BatalkanPratinjau(hasil);
      return hasil;
    });
  } catch (error) {
    if (!(error instanceof BatalkanPratinjau)) throw error;
    dampak = error.hasil;
  }

  res.locals.audit = preview
    ? {
        action: 'employee.flexible_hours.preview',
        entity: 'Employee',
        entityId: id,
        summary: `Pratinjau ${flexibleHours ? 'menyalakan' : 'mematikan'} jam fleksibel ${target.email}`,
      }
    : {
        action: 'employee.flexible_hours',
        entity: 'Employee',
        entityId: id,
        summary: `${flexibleHours ? 'Menyalakan' : 'Mematikan'} jam fleksibel ${target.email}${
          nyalakan ? `; ${dampak.assignmentsEnded} penugasan shift diakhiri, ${dampak.rowsDeleted} jadwal ke depan dihapus` : ''
        }`,
        metadata: { sebelum: target.flexibleHours, sesudah: flexibleHours, ...dampak },
      };

  res.json({
    employee: { id, flexibleHours: preview ? target.flexibleHours : flexibleHours },
    ...dampak,
    ...(preview ? { preview: true } : {}),
  });
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

// ============ Atur ulang kata sandi ============

/** Tanpa huruf/angka yang mudah tertukar (0/O, 1/l/I) karena sandi ini dibacakan atau diketik ulang. */
const ALFABET_SANDI = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const buatSandiSementara = () =>
  Array.from({ length: 10 }, () => ALFABET_SANDI[randomInt(ALFABET_SANDI.length)]).join('');

/**
 * HR mengatur ulang kata sandi karyawan yang lupa. Sandi sementara dibuat
 * server dan dikembalikan SEKALI di respons ini — tidak disimpan di mana pun
 * selain sebagai hash — lalu karyawan wajib menggantinya saat login berikutnya.
 */
export const resetPassword = async (req: Request, res: Response) => {
  const { id } = req.params;
  const input = req.body as ResetPasswordInput;
  const actor = req.user!;

  if (actor.id === id) {
    return res.status(400).json({ error: 'Untuk akun sendiri gunakan menu ganti kata sandi' });
  }

  const target = await prisma.employee.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, role: true, departmentId: true },
  });
  if (!target) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });

  // Pagar eskalasi: HR tidak boleh mengambil alih akun pemilik sistem dengan
  // mengatur ulang sandinya; manajer hanya untuk departemennya sendiri.
  if (lingkupLebihTinggi(actor, target)) {
    return res.status(403).json({ error: 'Tidak bisa mengatur ulang kata sandi akun berlingkup lebih tinggi' });
  }
  if (actor.role === Role.MANAGER && target.departmentId !== actor.departmentId) {
    return res.status(403).json({ error: 'Manajer hanya bisa mengatur ulang kata sandi karyawan di departemennya' });
  }

  const sementara = input.password ? null : buatSandiSementara();
  const sandi = input.password ?? sementara!;
  await prisma.employee.update({
    where: { id },
    data: { password: await bcrypt.hash(sandi, env.BCRYPT_ROUNDS), mustChangePassword: true },
  });
  // Ponsel yang masih login dengan sandi lama harus login ulang.
  await cabutSesi({ employeeId: id }, 'password_reset');

  res.locals.audit = {
    action: 'employee.reset_sandi',
    entity: 'Employee',
    entityId: id,
    summary: `Mengatur ulang kata sandi ${target.email}`,
    metadata: { sandiSementara: sementara !== null },
  };

  res.json({
    message: `Kata sandi ${target.name} diatur ulang; wajib diganti saat login berikutnya`,
    mustChangePassword: true,
    ...(sementara ? { temporaryPassword: sementara } : {}),
  });
};
