-- Kredensial sesi WhatsApp pindah dari berkas di volume ke database, supaya
-- banyak nomor tertaut tidak bergantung pada satu direktori di satu server.
-- Berkas lama tidak diimpor: sesi yang tersimpan di sana sudah tidak sah.

-- CreateTable
CREATE TABLE "WhatsAppAuthKey" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAuthKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAuthKey_accountId_category_keyId_key" ON "WhatsAppAuthKey"("accountId", "category", "keyId");

-- AddForeignKey
ALTER TABLE "WhatsAppAuthKey" ADD CONSTRAINT "WhatsAppAuthKey_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nomor yang belum pernah tersambung tapi tercatat "disconnected" — akibat QR
-- kedaluwarsa yang dulu diperlakukan seperti putus jaringan. Dengan status
-- itu bootstrap membukanya lagi di setiap deploy dan memunculkan QR yang
-- tidak dilihat siapa pun.
UPDATE "WhatsAppAccount"
SET "sessionStatus" = 'pending_scan'
WHERE "sessionStatus" = 'disconnected' AND "lastConnectedAt" IS NULL;
