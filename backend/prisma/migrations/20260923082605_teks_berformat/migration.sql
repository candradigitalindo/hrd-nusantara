-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "contentHtml" TEXT;

-- AlterTable
ALTER TABLE "CbtQuestion" ADD COLUMN     "textHtml" TEXT;

-- AlterTable
ALTER TABLE "CbtTest" ADD COLUMN     "descriptionHtml" TEXT;

-- AlterTable
ALTER TABLE "JobPosting" ADD COLUMN     "descriptionHtml" TEXT,
ADD COLUMN     "requirementsHtml" TEXT;

-- AlterTable
ALTER TABLE "TrainingProgram" ADD COLUMN     "descriptionHtml" TEXT;
