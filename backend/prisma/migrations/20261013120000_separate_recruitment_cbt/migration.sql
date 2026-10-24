ALTER TABLE "CbtQuestion" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'shared';
-- Preserve unused and cross-purpose legacy questions explicitly as shared.
UPDATE "CbtQuestion" q SET "scope" = 'recruitment'
WHERE EXISTS (SELECT 1 FROM "CbtTestQuestion" tq JOIN "CbtTest" t ON t.id = tq."testId" WHERE tq."questionId" = q.id)
  AND NOT EXISTS (SELECT 1 FROM "CbtTestQuestion" tq JOIN "CbtTest" t ON t.id = tq."testId" WHERE tq."questionId" = q.id AND t.audience <> 'pelamar');
UPDATE "CbtQuestion" q SET "scope" = 'development'
WHERE EXISTS (SELECT 1 FROM "CbtTestQuestion" tq JOIN "CbtTest" t ON t.id = tq."testId" WHERE tq."questionId" = q.id)
  AND NOT EXISTS (SELECT 1 FROM "CbtTestQuestion" tq JOIN "CbtTest" t ON t.id = tq."testId" WHERE tq."questionId" = q.id AND t.audience <> 'karyawan');
ALTER TABLE "CbtQuestion" ADD CONSTRAINT "CbtQuestion_scope_check" CHECK ("scope" IN ('recruitment', 'development', 'shared'));
CREATE INDEX "CbtQuestion_scope_isActive_idx" ON "CbtQuestion"("scope", "isActive");
ALTER TABLE "CbtAssignment" ADD COLUMN "required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reviewedAt" TIMESTAMP(3), ADD COLUMN "reviewedById" TEXT;
UPDATE "CbtAssignment" SET "required" = true WHERE "candidateId" IS NOT NULL;
ALTER TABLE "CbtAssignment" ADD CONSTRAINT "CbtAssignment_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CbtAssignment" ADD CONSTRAINT "CbtAssignment_review_pair_check" CHECK (("reviewedAt" IS NULL) = ("reviewedById" IS NULL));
ALTER TABLE "CbtAssignment" ADD CONSTRAINT "CbtAssignment_selection_only_check" CHECK ("candidateId" IS NOT NULL OR ("required" = false AND "reviewedAt" IS NULL));
CREATE INDEX "CbtAssignment_candidateId_required_idx" ON "CbtAssignment"("candidateId", "required");
