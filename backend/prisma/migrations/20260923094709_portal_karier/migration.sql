-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "coverLetter" TEXT;

-- CreateTable
CREATE TABLE "CandidateAccount" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "password" TEXT NOT NULL,
    "cvPath" TEXT,
    "cvFileName" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CandidateAccount_email_key" ON "CandidateAccount"("email");

-- CreateIndex
CREATE INDEX "Candidate_accountId_idx" ON "Candidate"("accountId");

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CandidateAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
