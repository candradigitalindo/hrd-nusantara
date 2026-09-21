// src/seed.ts
// Membuat akun SUPER_ADMIN pertama. Tanpa ini tidak ada siapa pun yang bisa
// login, dan tanpa login tidak ada yang bisa membuat karyawan — ayam dan telur.
//
// Jalankan: npm run seed
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { Role } from '@prisma/client';
import { prisma } from './lib/prisma';
import { env } from './config/env';
import { generateULID } from './utils/generateULID';
import { pastikanPeranSistem } from './services/roles/system';

const main = async () => {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@hrd-nusantara.local').toLowerCase();
  const nik = process.env.SEED_ADMIN_NIK ?? 'ADMIN-001';

  await pastikanPeranSistem();
  const peranAdmin = await prisma.customRole.findUnique({ where: { code: Role.SUPER_ADMIN }, select: { id: true } });

  const existing = await prisma.employee.findFirst({ where: { role: Role.SUPER_ADMIN } });
  if (existing) {
    console.log(`SUPER_ADMIN sudah ada (${existing.email}). Seed dilewati.`);
    return;
  }

  // Password acak kalau tidak diberikan, supaya tidak ada kredensial default
  // yang bisa ditebak kalau seed ini tidak sengaja jalan di server.
  const generated = !process.env.SEED_ADMIN_PASSWORD;
  const password = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(12).toString('base64url');

  const admin = await prisma.employee.create({
    data: {
      id: generateULID(),
      nik,
      name: process.env.SEED_ADMIN_NAME ?? 'Administrator',
      email,
      role: Role.SUPER_ADMIN,
      ...(peranAdmin && { customRole: { connect: { id: peranAdmin.id } } }),
      status: 'active',
      password: await bcrypt.hash(password, env.BCRYPT_ROUNDS),
    },
    select: { id: true, nik: true, email: true, role: true },
  });

  console.log('\nSUPER_ADMIN berhasil dibuat:');
  console.log(`  id    : ${admin.id}`);
  console.log(`  nik   : ${admin.nik}`);
  console.log(`  email : ${admin.email}`);
  if (generated) {
    console.log(`  password : ${password}`);
    console.log('\n  ^ Password ini hanya ditampilkan sekali. Simpan, lalu ganti');
    console.log('    lewat POST /api/auth/change-password setelah login pertama.\n');
  }
};

main()
  .catch((error) => {
    console.error('Seed gagal:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
