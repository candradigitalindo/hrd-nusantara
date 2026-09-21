-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "stampNote" TEXT,
ADD COLUMN     "stampSentAt" TIMESTAMP(3),
ADD COLUMN     "stampStatus" TEXT;

-- AlterTable
ALTER TABLE "WhatsAppAccount" ADD COLUMN     "attendanceGroupJid" TEXT,
ADD COLUMN     "attendanceGroupName" TEXT;

