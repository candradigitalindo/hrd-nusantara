/*
  Warnings:

  - You are about to drop the column `locationGps` on the `Attendance` table. All the data in the column will be lost.
  - You are about to alter the column `breakDuration` on the `ShiftSchedule` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(4,2)`.
  - Added the required column `checkInMethod` to the `Attendance` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Attendance" DROP COLUMN "locationGps",
ADD COLUMN     "checkInLatitude" DECIMAL(10,7),
ADD COLUMN     "checkInLongitude" DECIMAL(10,7),
ADD COLUMN     "checkInMethod" TEXT NOT NULL,
ADD COLUMN     "checkOutLatitude" DECIMAL(10,7),
ADD COLUMN     "checkOutLongitude" DECIMAL(10,7),
ADD COLUMN     "checkOutMethod" TEXT,
ADD COLUMN     "earlyLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lateMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "overtimeApproved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "overtimeApprovedAt" TIMESTAMP(3),
ADD COLUMN     "overtimeApprovedById" TEXT,
ADD COLUMN     "workLocationId" TEXT,
ADD COLUMN     "workedMinutes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ShiftSchedule" ADD COLUMN     "notes" TEXT,
ALTER COLUMN "breakDuration" SET DEFAULT 0,
ALTER COLUMN "breakDuration" SET DATA TYPE DECIMAL(4,2);

-- CreateTable
CREATE TABLE "WorkLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "radiusMeters" INTEGER NOT NULL DEFAULT 100,
    "qrSecret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkLocation_qrSecret_key" ON "WorkLocation"("qrSecret");

-- CreateIndex
CREATE INDEX "WorkLocation_isActive_idx" ON "WorkLocation"("isActive");

-- CreateIndex
CREATE INDEX "Attendance_employeeId_checkOutTime_idx" ON "Attendance"("employeeId", "checkOutTime");

-- CreateIndex
CREATE INDEX "Attendance_workLocationId_idx" ON "Attendance"("workLocationId");

-- CreateIndex
CREATE INDEX "Attendance_checkInTime_idx" ON "Attendance"("checkInTime");

-- CreateIndex
CREATE INDEX "Attendance_overtimeApprovedById_idx" ON "Attendance"("overtimeApprovedById");

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_overtimeApprovedById_fkey" FOREIGN KEY ("overtimeApprovedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
