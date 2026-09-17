-- AlterTable
ALTER TABLE "CertificationRecord" DROP COLUMN "status",
ADD COLUMN     "certificationTypeId" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "revokedReason" TEXT,
ADD COLUMN     "trainingRegistrationId" TEXT;

-- AlterTable
ALTER TABLE "CompetencyStandard" DROP COLUMN "competencyName",
ADD COLUMN     "competencyId" TEXT NOT NULL,
DROP COLUMN "requiredLevel",
ADD COLUMN     "requiredLevel" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "Competency" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "maxLevel" INTEGER NOT NULL DEFAULT 4,
    "levelLabels" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeCompetency" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "currentLevel" INTEGER NOT NULL,
    "assessedById" TEXT NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidenceUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeCompetency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificationType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "issuingOrganization" TEXT,
    "validityMonths" INTEGER,
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "targetPositionId" TEXT,
    "trainingProgramId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificationType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Competency_code_key" ON "Competency"("code");

-- CreateIndex
CREATE INDEX "Competency_isActive_idx" ON "Competency"("isActive");

-- CreateIndex
CREATE INDEX "EmployeeCompetency_employeeId_idx" ON "EmployeeCompetency"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeCompetency_competencyId_idx" ON "EmployeeCompetency"("competencyId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeCompetency_employeeId_competencyId_key" ON "EmployeeCompetency"("employeeId", "competencyId");

-- CreateIndex
CREATE UNIQUE INDEX "CertificationType_code_key" ON "CertificationType"("code");

-- CreateIndex
CREATE INDEX "CertificationType_isMandatory_isActive_idx" ON "CertificationType"("isMandatory", "isActive");

-- CreateIndex
CREATE INDEX "CertificationType_targetPositionId_idx" ON "CertificationType"("targetPositionId");

-- CreateIndex
CREATE INDEX "CertificationType_trainingProgramId_idx" ON "CertificationType"("trainingProgramId");

-- CreateIndex
CREATE INDEX "CertificationRecord_certificationTypeId_idx" ON "CertificationRecord"("certificationTypeId");

-- CreateIndex
CREATE INDEX "CompetencyStandard_competencyId_idx" ON "CompetencyStandard"("competencyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetencyStandard_positionId_competencyId_key" ON "CompetencyStandard"("positionId", "competencyId");

-- AddForeignKey
ALTER TABLE "CompetencyStandard" ADD CONSTRAINT "CompetencyStandard_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeCompetency" ADD CONSTRAINT "EmployeeCompetency_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeCompetency" ADD CONSTRAINT "EmployeeCompetency_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeCompetency" ADD CONSTRAINT "EmployeeCompetency_assessedById_fkey" FOREIGN KEY ("assessedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificationType" ADD CONSTRAINT "CertificationType_targetPositionId_fkey" FOREIGN KEY ("targetPositionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificationType" ADD CONSTRAINT "CertificationType_trainingProgramId_fkey" FOREIGN KEY ("trainingProgramId") REFERENCES "TrainingProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificationRecord" ADD CONSTRAINT "CertificationRecord_certificationTypeId_fkey" FOREIGN KEY ("certificationTypeId") REFERENCES "CertificationType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificationRecord" ADD CONSTRAINT "CertificationRecord_trainingRegistrationId_fkey" FOREIGN KEY ("trainingRegistrationId") REFERENCES "TrainingRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

