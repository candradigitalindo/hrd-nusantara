-- DropIndex
DROP INDEX "WhatsAppConversation_externalMessageId_key";

-- AlterTable
ALTER TABLE "WhatsAppAccount" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'company',
ALTER COLUMN "phoneNumber" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "WhatsAppAccount_kind_assignedEmployeeId_idx" ON "WhatsAppAccount"("kind", "assignedEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConversation_accountId_externalMessageId_key" ON "WhatsAppConversation"("accountId", "externalMessageId");

