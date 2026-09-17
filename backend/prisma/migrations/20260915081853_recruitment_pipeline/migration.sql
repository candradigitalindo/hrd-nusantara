-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "expectedSalary" DECIMAL(15,2),
ADD COLUMN     "hiredEmployeeId" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "Interview" ADD COLUMN     "durationMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "result" TEXT,
ADD COLUMN     "round" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "score" DOUBLE PRECISION,
ADD COLUMN     "stage" TEXT NOT NULL DEFAULT 'hr';

-- AlterTable
ALTER TABLE "JobPosting" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "employmentType" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "openings" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "salaryRangeMax" DECIMAL(15,2),
ADD COLUMN     "salaryRangeMin" DECIMAL(15,2),
ALTER COLUMN "status" SET DEFAULT 'draft';

-- CreateTable
CREATE TABLE "CandidateStageHistory" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateStageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CandidateStageHistory_candidateId_createdAt_idx" ON "CandidateStageHistory"("candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "CandidateStageHistory_toStage_createdAt_idx" ON "CandidateStageHistory"("toStage", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_hiredEmployeeId_key" ON "Candidate"("hiredEmployeeId");

-- CreateIndex
CREATE INDEX "Candidate_status_applicationDate_idx" ON "Candidate"("status", "applicationDate");

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_hiredEmployeeId_fkey" FOREIGN KEY ("hiredEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateStageHistory" ADD CONSTRAINT "CandidateStageHistory_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateStageHistory" ADD CONSTRAINT "CandidateStageHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

