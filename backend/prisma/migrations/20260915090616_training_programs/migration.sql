-- DropIndex
DROP INDEX "TrainingRegistration_employeeId_idx";

-- AlterTable
ALTER TABLE "TrainingRegistration" ADD COLUMN     "certificateUrl" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "note" TEXT,
ADD COLUMN     "passed" BOOLEAN,
ALTER COLUMN "evaluationScore" SET DATA TYPE DECIMAL(5,2);

-- AlterTable
ALTER TABLE "TrainingSession" ADD COLUMN     "cost" DECIMAL(15,2),
ADD COLUMN     "programId" TEXT NOT NULL,
ADD COLUMN     "registrationDeadline" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TrainingProgram" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "targetPositionId" TEXT,
    "targetDepartmentId" TEXT,
    "passingScore" DECIMAL(5,2),
    "validityMonths" INTEGER,
    "durationHours" DECIMAL(5,1),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingProgram_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainingProgram_code_key" ON "TrainingProgram"("code");

-- CreateIndex
CREATE INDEX "TrainingProgram_isMandatory_isActive_idx" ON "TrainingProgram"("isMandatory", "isActive");

-- CreateIndex
CREATE INDEX "TrainingProgram_targetPositionId_idx" ON "TrainingProgram"("targetPositionId");

-- CreateIndex
CREATE INDEX "TrainingProgram_targetDepartmentId_idx" ON "TrainingProgram"("targetDepartmentId");

-- CreateIndex
CREATE INDEX "TrainingRegistration_employeeId_status_idx" ON "TrainingRegistration"("employeeId", "status");

-- CreateIndex
CREATE INDEX "TrainingRegistration_expiresAt_idx" ON "TrainingRegistration"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingRegistration_trainingSessionId_employeeId_key" ON "TrainingRegistration"("trainingSessionId", "employeeId");

-- CreateIndex
CREATE INDEX "TrainingSession_programId_startDateTime_idx" ON "TrainingSession"("programId", "startDateTime");

-- CreateIndex
CREATE INDEX "TrainingSession_status_idx" ON "TrainingSession"("status");

-- AddForeignKey
ALTER TABLE "TrainingProgram" ADD CONSTRAINT "TrainingProgram_targetPositionId_fkey" FOREIGN KEY ("targetPositionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingProgram" ADD CONSTRAINT "TrainingProgram_targetDepartmentId_fkey" FOREIGN KEY ("targetDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_programId_fkey" FOREIGN KEY ("programId") REFERENCES "TrainingProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

