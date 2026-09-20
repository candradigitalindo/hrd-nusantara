-- AlterTable
ALTER TABLE "ComplaintOrDisciplinaryAction" ADD COLUMN     "incidentDate" TIMESTAMP(3),
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "severity" TEXT,
ADD COLUMN     "title" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "PsychometricTestResult" ADD COLUMN     "interpretation" TEXT,
ADD COLUMN     "maxScore" DOUBLE PRECISION,
ADD COLUMN     "testDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ComplaintOrDisciplinaryAction_type_status_idx" ON "ComplaintOrDisciplinaryAction"("type", "status");

-- CreateIndex
CREATE INDEX "ComplaintOrDisciplinaryAction_reportedById_idx" ON "ComplaintOrDisciplinaryAction"("reportedById");

