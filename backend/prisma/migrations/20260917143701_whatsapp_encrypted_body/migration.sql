-- AlterTable
ALTER TABLE "WhatsAppConversation" ADD COLUMN     "searchTokens" TEXT[];

-- CreateIndex
CREATE INDEX "WhatsAppConversation_searchTokens_idx" ON "WhatsAppConversation" USING GIN ("searchTokens");

