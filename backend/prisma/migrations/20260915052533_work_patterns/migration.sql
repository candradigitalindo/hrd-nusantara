-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "workPatternId" TEXT;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "workPatternId" TEXT;

-- CreateTable
CREATE TABLE "WorkPattern" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "workingWeekdays" INTEGER[],
    "observesPublicHolidays" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkPattern_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkPattern_code_key" ON "WorkPattern"("code");

-- CreateIndex
CREATE INDEX "WorkPattern_isActive_idx" ON "WorkPattern"("isActive");

-- CreateIndex
CREATE INDEX "WorkPattern_isDefault_idx" ON "WorkPattern"("isDefault");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_workPatternId_fkey" FOREIGN KEY ("workPatternId") REFERENCES "WorkPattern"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_workPatternId_fkey" FOREIGN KEY ("workPatternId") REFERENCES "WorkPattern"("id") ON DELETE SET NULL ON UPDATE CASCADE;
