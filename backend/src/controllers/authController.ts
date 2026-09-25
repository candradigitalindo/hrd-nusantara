// src/controllers/authController.ts
import { Request, Response } from 'express';
import { normalizePhoneNumber } from '../utils/whatsappRules';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { ACTIVE_STATUSES } from '../middleware/auth';
import type { LoginInput, ChangePasswordInput, RefreshTokenInput } from '../schemas/authSchema';
import { buatSesi, cabutSesi, cabutSesiDariToken, putarSesi, tandaTanganAkses } from '../services/sesiMobile';
import { izinEfektif } from '../services/roles/resolve';
import { denganAliasKlienLama } from '../utils/permissions';

/**
 * Hash palsu yang valid secara format. Dipakai saat email tidak ditemukan
 * supaya bcrypt.compare tetap berjalan dengan biaya yang sama — tanpa ini,
 * email terdaftar akan merespons jauh lebih lambat daripada yang tidak,
 * dan selisih waktu itu bisa dipakai menebak siapa saja karyawan perusahaan.
 */
const DUMMY_HASH = bcrypt.hashSync('password-pembanding-yang-tidak-dipakai', env.BCRYPT_ROUNDS);

const publicUserFields = {
  id: true,
  nik: true,
  name: true,
  email: true,
  role: true,
  status: true,
  departmentId: true,
  positionId: true,
  customRoleId: true,
  customRole: { select: { id: true, name: true, permissions: true } },
  mustChangePassword: true,
} as const;

/**
 * Mencari akun dari pengenal login: nomor HP/WhatsApp (dibakukan) atau email.
 * Mengembalikan null untuk pengenal yang tidak sah — diperlakukan sama dengan
 * "tidak terdaftar" supaya balasan gagalnya seragam.
 */
const cariAkunLogin = (pengenal: string) => {
  const include = { customRole: { select: { id: true, name: true, permissions: true } } };
  if (pengenal.includes('@')) {
    return prisma.employee.findUnique({ where: { email: pengenal.toLowerCase() }, include });
  }
  const nomor = normalizePhoneNumber(pengenal);
  if (!nomor) return Promise.resolve(null);
  return prisma.employee.findUnique({ where: { phoneNumber: nomor }, include });
};

export const login = async (req: Request, res: Response) => {
  const { username, email, password, device } = req.body as LoginInput;
  const pengenal = (username ?? email ?? '').trim();

  const employee = await cariAkunLogin(pengenal);

  const isValid = await bcrypt.compare(password, employee?.password ?? DUMMY_HASH);

  // Pesan error sengaja sama untuk email tidak ada, password salah, dan akun
  // belum punya password — supaya tidak membocorkan email mana yang terdaftar.
  if (!employee || !employee.password || !isValid) {
    // Percobaan login yang gagal dicatat: beruntun dari satu IP, inilah
    // satu-satunya tanda awal ada yang menebak kata sandi. Kata sandinya
    // sendiri tidak pernah ikut, hanya email yang dicoba.
    res.locals.audit = {
      action: 'auth.login.gagal',
      entity: 'Employee',
      entityId: employee?.id,
      summary: `Login gagal untuk ${pengenal}`,
      metadata: { pengenal, alasan: !employee ? 'tidak_terdaftar' : 'password_salah' },
    };
    return res.status(401).json({ error: 'Nomor HP/email atau password salah' });
  }

  if (!ACTIVE_STATUSES.has(employee.status)) {
    return res.status(403).json({ error: 'Akun Anda sudah tidak aktif. Hubungi HR.' });
  }

  // Aplikasi mobile menyebut perangkatnya dan menerima sesi yang bisa
  // diperpanjang; web tetap memakai token akses saja.
  const sesiMobile = device ? await buatSesi(employee.id, device) : null;
  const token = tandaTanganAkses(employee, sesiMobile?.sesi.id);

  // Pencatatan waktu login sengaja tidak boleh menggagalkan login.
  //
  // Pada titik ini kredensialnya sudah terbukti benar dan token sudah dibuat.
  // Kalau pembaruan ini dibiarkan melempar — misalnya baris karyawannya
  // terhapus tepat di sela pemeriksaan password — pengguna yang sah menerima
  // 500 alih-alih tokennya, hanya karena sebuah catatan sampingan gagal.
  try {
    await prisma.employee.update({
      where: { id: employee.id },
      data: { lastLoginAt: new Date() },
    });
  } catch (error) {
    if (env.NODE_ENV !== 'test') {
      console.warn('Gagal mencatat lastLoginAt:', error);
    }
  }

  res.locals.audit = {
    action: 'auth.login.berhasil',
    entity: 'Employee',
    entityId: employee.id,
    summary: `${employee.email} login`,
  };

  res.json({
    token,
    expiresIn: env.JWT_EXPIRES_IN,
    ...(sesiMobile
      ? { refreshToken: sesiMobile.refreshToken, refreshExpiresAt: sesiMobile.sesi.expiresAt }
      : {}),
    user: {
      id: employee.id,
      nik: employee.nik,
      mustChangePassword: employee.mustChangePassword,
      name: employee.name,
      email: employee.email,
      role: employee.role,
      status: employee.status,
      departmentId: employee.departmentId,
      positionId: employee.positionId,
      customRole: employee.customRole ? { id: employee.customRole.id, name: employee.customRole.name } : null,
      permissions: denganAliasKlienLama(await izinEfektif(employee)),
    },
  });
};

export const me = async (req: Request, res: Response) => {
  const employee = await prisma.employee.findUnique({
    where: { id: req.user!.id },
    select: {
      ...publicUserFields,
      phoneNumber: true,
      address: true,
      dateOfBirth: true,
      lastLoginAt: true,
      department: { select: { id: true, name: true } },
      position: { select: { id: true, name: true } },
    },
  });

  if (!employee) {
    return res.status(404).json({ error: 'Karyawan tidak ditemukan' });
  }

  // Izin dikirim ke klien hanya untuk menyembunyikan menu yang tidak relevan;
  // penegakannya tetap di server pada setiap rute.
  const { customRole, ...data } = employee;
  res.json({
    ...data,
    customRole: customRole ? { id: customRole.id, name: customRole.name } : null,
    permissions: denganAliasKlienLama(await izinEfektif({ role: employee.role, customRole })),
  });
};

export const changePassword = async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body as ChangePasswordInput;

  const employee = await prisma.employee.findUnique({
    where: { id: req.user!.id },
    select: { id: true, password: true },
  });

  if (!employee?.password) {
    return res.status(400).json({ error: 'Akun belum memiliki password' });
  }

  const isValid = await bcrypt.compare(currentPassword, employee.password);
  if (!isValid) {
    return res.status(401).json({ error: 'Password saat ini salah' });
  }

  await prisma.employee.update({
    where: { id: employee.id },
    // Sandi dari HR sudah diganti sendiri: kunci "wajib ganti" dilepas.
    data: { password: await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS), mustChangePassword: false },
  });
  // Perangkat lain yang masih login dengan sandi lama ikut keluar; perangkat
  // yang dipakai mengganti sandi tetap masuk.
  await cabutSesi({ employeeId: employee.id, idKecuali: req.sessionId }, 'password_changed');

  res.json({ message: 'Password berhasil diubah' });
};

/** Menukar refresh token sesi mobile dengan token akses baru (dan refresh token baru). */
export const refresh = async (req: Request, res: Response) => {
  const { refreshToken } = req.body as RefreshTokenInput;
  const hasil = await putarSesi(refreshToken);

  if (!hasil.ok) {
    if (hasil.dicabutKarenaDipakaiUlang) {
      res.locals.audit = {
        action: 'auth.sesi.token_dipakai_ulang',
        entity: 'Employee',
        entityId: hasil.employeeId,
        summary: 'Refresh token lama dipakai lagi; sesi perangkat dicabut',
      };
    }
    return res.status(hasil.status).json({ error: hasil.error });
  }

  res.json({
    token: hasil.token,
    expiresIn: env.JWT_EXPIRES_IN,
    refreshToken: hasil.refreshToken,
    refreshExpiresAt: hasil.refreshExpiresAt,
  });
};

/** Mengakhiri sesi mobile. Selalu 204: token yang sudah mati tidak perlu dilaporkan. */
export const logout = async (req: Request, res: Response) => {
  const { refreshToken } = req.body as RefreshTokenInput;
  await cabutSesiDariToken(refreshToken);
  res.status(204).end();
};
