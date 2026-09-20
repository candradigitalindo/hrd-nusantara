-- AlterTable
ALTER TABLE "LeaveBalance" ADD COLUMN     "collectiveLeaveDays" DECIMAL(5,1) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "LeaveType" ADD COLUMN     "absorbsCollectiveLeave" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CollectiveLeaveDeduction" (
    "id" TEXT NOT NULL,
    "holidayId" TEXT NOT NULL,
    "leaveBalanceId" TEXT NOT NULL,
    "days" DECIMAL(5,1) NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectiveLeaveDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CollectiveLeaveDeduction_leaveBalanceId_idx" ON "CollectiveLeaveDeduction"("leaveBalanceId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectiveLeaveDeduction_holidayId_leaveBalanceId_key" ON "CollectiveLeaveDeduction"("holidayId", "leaveBalanceId");

-- AddForeignKey
ALTER TABLE "CollectiveLeaveDeduction" ADD CONSTRAINT "CollectiveLeaveDeduction_holidayId_fkey" FOREIGN KEY ("holidayId") REFERENCES "Holiday"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectiveLeaveDeduction" ADD CONSTRAINT "CollectiveLeaveDeduction_leaveBalanceId_fkey" FOREIGN KEY ("leaveBalanceId") REFERENCES "LeaveBalance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

