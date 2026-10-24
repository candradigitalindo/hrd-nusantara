CREATE TABLE "RecruitmentPublication" (
    "id" TEXT NOT NULL,
    "jobPostingId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "remoteId" TEXT,
    "taskId" TEXT,
    "remoteUrl" TEXT,
    "error" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecruitmentPublication_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RecruitmentPublication_requestKey_key" ON "RecruitmentPublication"("requestKey");
CREATE UNIQUE INDEX "RecruitmentPublication_jobPostingId_platform_key" ON "RecruitmentPublication"("jobPostingId", "platform");
CREATE INDEX "RecruitmentPublication_status_idx" ON "RecruitmentPublication"("status");
ALTER TABLE "RecruitmentPublication" ADD CONSTRAINT "RecruitmentPublication_jobPostingId_fkey"
  FOREIGN KEY ("jobPostingId") REFERENCES "JobPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
