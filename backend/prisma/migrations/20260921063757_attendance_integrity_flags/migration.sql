-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "checkOutIntegrityReport" JSONB,
ADD COLUMN     "integrityFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "integrityReport" JSONB;

