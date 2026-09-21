-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "customRoleId" TEXT;

-- CreateTable
CREATE TABLE "CustomRole" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "baseRole" "Role" NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomRole_code_key" ON "CustomRole"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CustomRole_name_key" ON "CustomRole"("name");

-- CreateIndex
CREATE INDEX "Employee_customRoleId_idx" ON "Employee"("customRoleId");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "CustomRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Peran sistem: satu untuk tiap lingkup data. Izin bawaannya meniru penjaga
-- rute sebelum peran dinamis ada (src/utils/permissions.ts).
INSERT INTO "CustomRole" ("id", "code", "name", "description", "baseRole", "permissions", "isSystem", "updatedAt") VALUES
('01M31XBRB023AF4RBNHZ2PEHNK', 'SUPER_ADMIN', 'Super Admin', 'Pemilik sistem. Semua hak akses, tidak bisa dibatasi.', 'SUPER_ADMIN', ARRAY['karyawan.lihat', 'karyawan.kelola', 'organisasi.kelola', 'dokumen.kelola', 'wajah.kelola', 'presensi.lihat_tim', 'presensi.lembur', 'shift.kelola', 'lokasi.kelola', 'cuti.setujui', 'cuti.kelola', 'payroll.kelola', 'rekrutmen.kelola', 'kinerja.kelola', 'pelatihan.kelola', 'kompetensi.kelola', 'disiplin.kelola', 'audit.lihat', 'pengumuman.kelola', 'survei.kelola', 'whatsapp.pantau', 'laporan.dashboard', 'laporan.hr', 'aplikasi.rilis', 'peran.kelola']::TEXT[], true, CURRENT_TIMESTAMP),
('01M31XBRB023AF4RBNHZ2PEHNM', 'HR_ADMIN', 'HR Admin', 'Mengelola seluruh data kepegawaian perusahaan.', 'HR_ADMIN', ARRAY['karyawan.lihat', 'karyawan.kelola', 'organisasi.kelola', 'dokumen.kelola', 'wajah.kelola', 'presensi.lihat_tim', 'presensi.lembur', 'shift.kelola', 'lokasi.kelola', 'cuti.setujui', 'cuti.kelola', 'payroll.kelola', 'rekrutmen.kelola', 'kinerja.kelola', 'pelatihan.kelola', 'kompetensi.kelola', 'disiplin.kelola', 'pengumuman.kelola', 'survei.kelola', 'whatsapp.pantau', 'laporan.dashboard', 'laporan.hr', 'aplikasi.rilis']::TEXT[], true, CURRENT_TIMESTAMP),
('01M31XBRB023AF4RBNHZ2PEHNN', 'MANAGER', 'Manajer', 'Mengelola tim di departemennya sendiri.', 'MANAGER', ARRAY['karyawan.lihat', 'presensi.lihat_tim', 'presensi.lembur', 'shift.kelola', 'cuti.setujui', 'disiplin.kelola', 'laporan.dashboard']::TEXT[], true, CURRENT_TIMESTAMP),
('01M31XBRB023AF4RBNHZ2PEHNP', 'EMPLOYEE', 'Karyawan', 'Akses ke data diri sendiri saja.', 'EMPLOYEE', ARRAY[]::TEXT[], true, CURRENT_TIMESTAMP);

-- Setiap karyawan yang sudah ada diberi peran sistem sesuai lingkup datanya.
UPDATE "Employee" e SET "customRoleId" = r."id" FROM "CustomRole" r WHERE r."code" = e."role"::text AND e."customRoleId" IS NULL;
