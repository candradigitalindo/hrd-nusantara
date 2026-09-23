-- Penanda "wajib ganti kata sandi": diisi true saat HR mengatur (ulang) sandi
-- seorang karyawan, dikosongkan lagi saat karyawan mengganti sandinya sendiri.
ALTER TABLE "Employee" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
