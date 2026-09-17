// Menyiapkan skema database test sekali sebelum seluruh test berjalan.
import path from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

export default async () => {
  const result = dotenv.config({
    path: path.resolve(__dirname, '../.env.test'),
    override: true,
  });

  if (result.error) {
    throw new Error(
      'File .env.test tidak ditemukan. Salin dari .env.test.example lalu arahkan ke database test.'
    );
  }

  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'pipe',
    env: process.env,
  });
};
