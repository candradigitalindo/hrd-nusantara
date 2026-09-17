-- AlterTable
ALTER TABLE "WhatsAppConversation" ADD COLUMN     "accountId" TEXT NOT NULL,
ADD COLUMN     "contactNumber" TEXT NOT NULL,
ADD COLUMN     "externalMessageId" TEXT NOT NULL,
ADD COLUMN     "messageType" TEXT NOT NULL DEFAULT 'text';

-- CreateTable
CREATE TABLE "WhatsAppAccount" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "assignedEmployeeId" TEXT,
    "departmentId" TEXT,
    "sessionStatus" TEXT NOT NULL DEFAULT 'pending_scan',
    "lastConnectedAt" TIMESTAMP(3),
    "lastDisconnectedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppSessionEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppSessionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAccount_phoneNumber_key" ON "WhatsAppAccount"("phoneNumber");

-- CreateIndex
CREATE INDEX "WhatsAppAccount_isActive_idx" ON "WhatsAppAccount"("isActive");

-- CreateIndex
CREATE INDEX "WhatsAppAccount_sessionStatus_idx" ON "WhatsAppAccount"("sessionStatus");

-- CreateIndex
CREATE INDEX "WhatsAppAccount_assignedEmployeeId_idx" ON "WhatsAppAccount"("assignedEmployeeId");

-- CreateIndex
CREATE INDEX "WhatsAppSessionEvent_accountId_occurredAt_idx" ON "WhatsAppSessionEvent"("accountId", "occurredAt");

-- CreateIndex
CREATE INDEX "WhatsAppSessionEvent_notifiedAt_idx" ON "WhatsAppSessionEvent"("notifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConversation_externalMessageId_key" ON "WhatsAppConversation"("externalMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppConversation_accountId_timestamp_idx" ON "WhatsAppConversation"("accountId", "timestamp");

-- CreateIndex
CREATE INDEX "WhatsAppConversation_contactNumber_idx" ON "WhatsAppConversation"("contactNumber");

-- AddForeignKey
ALTER TABLE "WhatsAppAccount" ADD CONSTRAINT "WhatsAppAccount_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppAccount" ADD CONSTRAINT "WhatsAppAccount_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppSessionEvent" ADD CONSTRAINT "WhatsAppSessionEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

