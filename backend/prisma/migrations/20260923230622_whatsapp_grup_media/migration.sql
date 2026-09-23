-- AlterTable
ALTER TABLE "WhatsAppConversation" ADD COLUMN     "groupJid" TEXT,
ADD COLUMN     "groupName" TEXT,
ADD COLUMN     "mediaFileName" TEXT,
ADD COLUMN     "mediaMimeType" TEXT,
ADD COLUMN     "mediaPath" TEXT,
ADD COLUMN     "mediaSizeBytes" INTEGER,
ADD COLUMN     "mediaStatus" TEXT,
ADD COLUMN     "participantNumber" TEXT;

-- CreateIndex
CREATE INDEX "WhatsAppConversation_groupJid_timestamp_idx" ON "WhatsAppConversation"("groupJid", "timestamp");
