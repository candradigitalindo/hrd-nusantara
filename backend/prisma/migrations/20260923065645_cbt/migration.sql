-- CreateTable
CREATE TABLE "CbtQuestion" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL DEFAULT 'sedang',
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "imagePath" TEXT,
    "options" JSONB,
    "answerKey" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rubric" TEXT,
    "points" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "explanation" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CbtQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CbtTest" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "audience" TEXT NOT NULL DEFAULT 'keduanya',
    "durationMinutes" INTEGER NOT NULL,
    "passingScore" DOUBLE PRECISION,
    "shuffleQuestions" BOOLEAN NOT NULL DEFAULT true,
    "shuffleOptions" BOOLEAN NOT NULL DEFAULT true,
    "showResultToTaker" BOOLEAN NOT NULL DEFAULT false,
    "recordProctorEvents" BOOLEAN NOT NULL DEFAULT true,
    "proctorPhotos" BOOLEAN NOT NULL DEFAULT false,
    "proctorPhotoIntervalSec" INTEGER NOT NULL DEFAULT 180,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CbtTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CbtTestQuestion" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "points" DOUBLE PRECISION,

    CONSTRAINT "CbtTestQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CbtAssignment" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "employeeId" TEXT,
    "candidateId" TEXT,
    "accessTokenHash" TEXT,
    "availableFrom" TIMESTAMP(3),
    "availableUntil" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "note" TEXT,
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CbtAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CbtAttempt" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "autoSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "questionOrder" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scoreObjective" DOUBLE PRECISION,
    "scoreEssay" DOUBLE PRECISION,
    "scoreTotal" DOUBLE PRECISION,
    "maxScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "percent" DOUBLE PRECISION,
    "passed" BOOLEAN,
    "gradedById" TEXT,
    "gradedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CbtAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CbtAnswer" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "chosen" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "text" TEXT,
    "isCorrect" BOOLEAN,
    "points" DOUBLE PRECISION,
    "graderNote" TEXT,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CbtAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CbtProctorEvent" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CbtProctorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CbtProctorPhoto" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CbtProctorPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CbtQuestion_category_isActive_idx" ON "CbtQuestion"("category", "isActive");

-- CreateIndex
CREATE INDEX "CbtQuestion_type_isActive_idx" ON "CbtQuestion"("type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CbtTest_code_key" ON "CbtTest"("code");

-- CreateIndex
CREATE INDEX "CbtTest_status_audience_idx" ON "CbtTest"("status", "audience");

-- CreateIndex
CREATE INDEX "CbtTestQuestion_testId_sortOrder_idx" ON "CbtTestQuestion"("testId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CbtTestQuestion_testId_questionId_key" ON "CbtTestQuestion"("testId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "CbtAssignment_accessTokenHash_key" ON "CbtAssignment"("accessTokenHash");

-- CreateIndex
CREATE INDEX "CbtAssignment_testId_status_idx" ON "CbtAssignment"("testId", "status");

-- CreateIndex
CREATE INDEX "CbtAssignment_employeeId_status_idx" ON "CbtAssignment"("employeeId", "status");

-- CreateIndex
CREATE INDEX "CbtAssignment_candidateId_idx" ON "CbtAssignment"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "CbtAttempt_assignmentId_key" ON "CbtAttempt"("assignmentId");

-- CreateIndex
CREATE INDEX "CbtAttempt_submittedAt_idx" ON "CbtAttempt"("submittedAt");

-- CreateIndex
CREATE INDEX "CbtAnswer_questionId_idx" ON "CbtAnswer"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "CbtAnswer_attemptId_questionId_key" ON "CbtAnswer"("attemptId", "questionId");

-- CreateIndex
CREATE INDEX "CbtProctorEvent_attemptId_at_idx" ON "CbtProctorEvent"("attemptId", "at");

-- CreateIndex
CREATE INDEX "CbtProctorPhoto_attemptId_takenAt_idx" ON "CbtProctorPhoto"("attemptId", "takenAt");

-- AddForeignKey
ALTER TABLE "CbtQuestion" ADD CONSTRAINT "CbtQuestion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CbtTest" ADD CONSTRAINT "CbtTest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CbtTestQuestion" ADD CONSTRAINT "CbtTestQuestion_testId_fkey" FOREIGN KEY ("testId") REFERENCES "CbtTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CbtTestQuestion" ADD CONSTRAINT "CbtTestQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CbtQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CbtAssignment" ADD CONSTRAINT "CbtAssignment_testId_fkey" FOREIGN KEY ("testId") REFERENCES "CbtTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CbtAssignment" ADD CONSTRAINT "CbtAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CbtAssignment" ADD CONSTRAINT "CbtAssignment_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CbtAssignment" ADD CONSTRAINT "CbtAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CbtAttempt" ADD CONSTRAINT "CbtAttempt_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "CbtAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CbtAttempt" ADD CONSTRAINT "CbtAttempt_gradedById_fkey" FOREIGN KEY ("gradedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CbtAnswer" ADD CONSTRAINT "CbtAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "CbtAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CbtAnswer" ADD CONSTRAINT "CbtAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CbtQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CbtProctorEvent" ADD CONSTRAINT "CbtProctorEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "CbtAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CbtProctorPhoto" ADD CONSTRAINT "CbtProctorPhoto_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "CbtAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Persis satu peserta per penugasan: karyawan ATAU pelamar, tidak keduanya
-- dan tidak kosong. Dijaga basis data, bukan hanya aplikasi — penugasan yang
-- bercabang dua akan merusak seluruh perhitungan hasil dan tidak akan pernah
-- terlihat sampai laporannya salah.
ALTER TABLE "CbtAssignment"
  ADD CONSTRAINT "CbtAssignment_peserta_tunggal"
  CHECK (("employeeId" IS NOT NULL)::int + ("candidateId" IS NOT NULL)::int = 1);
