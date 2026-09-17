-- AlterTable
ALTER TABLE "PerformanceFormTemplate" DROP COLUMN "questions",
ADD COLUMN     "positionId" TEXT;

-- AlterTable
ALTER TABLE "PerformanceReview" DROP COLUMN "answers",
ADD COLUMN     "cycleId" TEXT NOT NULL,
ADD COLUMN     "reviewerType" TEXT NOT NULL DEFAULT 'manager',
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "totalScore" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "PerformanceScore" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "score" DECIMAL(5,2) NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceCriterion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "weight" DECIMAL(5,2) NOT NULL,
    "maxScore" INTEGER NOT NULL DEFAULT 5,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceCycle" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "closedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceDiscussion" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceDiscussion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContinuousFeedback" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'note',
    "message" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContinuousFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PerformanceScore_criterionId_idx" ON "PerformanceScore"("criterionId");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceScore_reviewId_criterionId_key" ON "PerformanceScore"("reviewId", "criterionId");

-- CreateIndex
CREATE INDEX "PerformanceCriterion_templateId_idx" ON "PerformanceCriterion"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceCriterion_templateId_code_key" ON "PerformanceCriterion"("templateId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceCycle_code_key" ON "PerformanceCycle"("code");

-- CreateIndex
CREATE INDEX "PerformanceCycle_status_idx" ON "PerformanceCycle"("status");

-- CreateIndex
CREATE INDEX "PerformanceCycle_periodStart_idx" ON "PerformanceCycle"("periodStart");

-- CreateIndex
CREATE INDEX "PerformanceDiscussion_reviewId_createdAt_idx" ON "PerformanceDiscussion"("reviewId", "createdAt");

-- CreateIndex
CREATE INDEX "ContinuousFeedback_recipientId_createdAt_idx" ON "ContinuousFeedback"("recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "ContinuousFeedback_authorId_idx" ON "ContinuousFeedback"("authorId");

-- CreateIndex
CREATE INDEX "PerformanceFormTemplate_positionId_idx" ON "PerformanceFormTemplate"("positionId");

-- CreateIndex
CREATE INDEX "PerformanceFormTemplate_isActive_idx" ON "PerformanceFormTemplate"("isActive");

-- CreateIndex
CREATE INDEX "PerformanceReview_cycleId_status_idx" ON "PerformanceReview"("cycleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceReview_cycleId_revieweeId_reviewerId_reviewerTyp_key" ON "PerformanceReview"("cycleId", "revieweeId", "reviewerId", "reviewerType");

-- AddForeignKey
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PerformanceCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceScore" ADD CONSTRAINT "PerformanceScore_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "PerformanceReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceScore" ADD CONSTRAINT "PerformanceScore_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "PerformanceCriterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceCriterion" ADD CONSTRAINT "PerformanceCriterion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PerformanceFormTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceDiscussion" ADD CONSTRAINT "PerformanceDiscussion_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "PerformanceReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceDiscussion" ADD CONSTRAINT "PerformanceDiscussion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContinuousFeedback" ADD CONSTRAINT "ContinuousFeedback_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContinuousFeedback" ADD CONSTRAINT "ContinuousFeedback_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceFormTemplate" ADD CONSTRAINT "PerformanceFormTemplate_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

