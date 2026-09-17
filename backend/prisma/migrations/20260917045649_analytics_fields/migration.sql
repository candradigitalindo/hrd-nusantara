-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "exitDate" TIMESTAMP(3),
ADD COLUMN     "exitReason" TEXT,
ADD COLUMN     "exitType" TEXT,
ADD COLUMN     "joinDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "JobPosting" ADD COLUMN     "recruitmentCost" DECIMAL(15,2);

