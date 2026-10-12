-- Jenis shift dengan jam berbeda per hari dalam pekan.
--
-- Shift "Reguler" sering tidak sama jamnya setiap hari (Jumat lebih pendek,
-- Sabtu setengah hari). Selama ini HR harus membuat jenis dan penugasan
-- terpisah untuk tiap hari yang berbeda. Kolom ini menyimpan pengecualian per
-- hari; hari yang tidak tercantum tetap memakai jam bawaan jenisnya.
--
-- Aman untuk data produksi: kolom baru dengan bawaan daftar kosong, jadi
-- semua jenis shift lama berperilaku persis seperti sebelumnya.

-- AlterTable
ALTER TABLE "ShiftTemplate" ADD COLUMN     "dailyHours" JSONB NOT NULL DEFAULT '[]';
