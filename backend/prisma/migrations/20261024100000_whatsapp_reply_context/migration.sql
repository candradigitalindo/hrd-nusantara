ALTER TABLE "WhatsAppConversation"
ADD COLUMN "quotedMessageId" TEXT,
ADD COLUMN "quotedMessageBody" TEXT,
ADD COLUMN "quotedMessageType" TEXT,
ADD COLUMN "quotedSenderNumber" TEXT,
ADD COLUMN "quotedSenderLid" TEXT;
