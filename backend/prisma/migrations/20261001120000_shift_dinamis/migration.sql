-- Shift dinamis: jenis shift buatan sendiri, penugasan shift berjangka
-- (1 hari / 1 minggu / 1 bulan / seterusnya / sampai tanggal), dan jam kerja
-- fleksibel per karyawan.
--
-- Penugasan dimaterialisasi menjadi baris ShiftSchedule biasa
-- (services/shiftAssignment.ts), jadi presensi, payroll, cuti, dan laporan
-- tetap membaca satu sumber jadwal yang sama dan Attendance.shiftScheduleId
-- tetap foreign key sungguhan.
--
-- Aman untuk data produksi: hanya menambah kolom ber-default, tabel baru,
-- indeks, dan foreign key. Baris jadwal lama menjadi baris manual
-- (templateId/assignmentId NULL, isOverride false) dan presensi lama menjadi
-- presensi biasa (isFlexible false), jadi perilakunya tidak berubah.
-- Satu-satunya perubahan data: manajer yang sudah ada langsung memakai jam
-- fleksibel, sesuai keputusan pemilik HR (manajer masuk dan pulang sesuai
-- kebutuhan, tanpa roster).

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "isFlexible" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "flexibleHours" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ShiftSchedule" ADD COLUMN     "assignmentId" TEXT,
ADD COLUMN     "isOverride" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "templateId" TEXT;

-- CreateTable
CREATE TABLE "ShiftTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "breakDuration" DECIMAL(4,2) NOT NULL DEFAULT 0,
    "color" TEXT NOT NULL DEFAULT 'teal',
    "departmentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "weekdays" INTEGER[],
    "skipPublicHolidays" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "notes" TEXT,
    "materializedUntil" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftTemplate_isActive_idx" ON "ShiftTemplate"("isActive");

-- CreateIndex
CREATE INDEX "ShiftTemplate_departmentId_idx" ON "ShiftTemplate"("departmentId");

-- CreateIndex
CREATE INDEX "ShiftAssignment_employeeId_idx" ON "ShiftAssignment"("employeeId");

-- CreateIndex
CREATE INDEX "ShiftAssignment_endDate_idx" ON "ShiftAssignment"("endDate");

-- CreateIndex
CREATE INDEX "ShiftAssignment_templateId_idx" ON "ShiftAssignment"("templateId");

-- CreateIndex
CREATE INDEX "ShiftSchedule_templateId_idx" ON "ShiftSchedule"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftSchedule_assignmentId_date_key" ON "ShiftSchedule"("assignmentId", "date");

-- AddForeignKey
ALTER TABLE "ShiftSchedule" ADD CONSTRAINT "ShiftSchedule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ShiftTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSchedule" ADD CONSTRAINT "ShiftSchedule_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ShiftAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTemplate" ADD CONSTRAINT "ShiftTemplate_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTemplate" ADD CONSTRAINT "ShiftTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ShiftTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Manajer yang sudah ada memakai jam fleksibel; HR bisa mematikannya per
-- orang dari detail karyawan. Jadwal shift manajer yang sudah tersusun tidak
-- dihapus di sini — itu keputusan HR, lewat sakelar di detail karyawan.
UPDATE "Employee" SET "flexibleHours" = true WHERE "role" = 'MANAGER';
