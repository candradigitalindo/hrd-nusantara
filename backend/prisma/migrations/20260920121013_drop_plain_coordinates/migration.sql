-- Koordinat presensi kini tersimpan terenkripsi di checkInLocation /
-- checkOutLocation. Kolom terbuka dihapus. Baris yang direkam sebelum
-- migrasi 20260920_encrypted_location_columns dipindahkan oleh
-- npm run sensitive:reencrypt, yang HARUS dijalankan sebelum migrasi ini
-- pada database yang sudah berisi presensi.
-- AlterTable
ALTER TABLE "Attendance" DROP COLUMN "checkInLatitude",
DROP COLUMN "checkInLongitude",
DROP COLUMN "checkOutLatitude",
DROP COLUMN "checkOutLongitude";

