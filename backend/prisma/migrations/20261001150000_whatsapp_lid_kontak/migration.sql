-- Pemantauan WhatsApp: nomor asli di balik LID, nama kontak, dan pengirim grup.
--
-- WhatsApp makin sering menyebut lawan bicara lewat LID ("2147…@lid"), ID
-- samaran yang bukan nomor telepon. Selama ini digitnya tersimpan seolah nomor
-- HP, sehingga satu kontak terpecah menjadi dua utas dan "+2147…" tampil
-- sebagai nomor. Migrasi ini menambah:
--   - WhatsAppLidMap: pemetaan LID -> nomor asli yang permanen (store Baileys
--     ikut terhapus setiap kali sesi di-logout atau dipindai ulang);
--   - WhatsAppContact: nama kontak per nomor yang dipantau;
--   - WhatsAppConversation.contactLid / participantLid / senderName.
--
-- Aman untuk data produksi: hanya tabel baru, kolom nullable, dan indeks.
-- Baris lama TIDAK diubah di sini; pemulihannya dikerjakan aplikasi
-- (src/services/whatsapp/pemulihanLid.ts, juga lewat
-- `npm run whatsapp:pulihkan-lid`) secara bertahap dan bisa diulang.

-- AlterTable
ALTER TABLE "WhatsAppConversation" ADD COLUMN     "contactLid" TEXT,
ADD COLUMN     "participantLid" TEXT,
ADD COLUMN     "senderName" TEXT;

-- CreateTable
CREATE TABLE "WhatsAppLidMap" (
    "lid" TEXT NOT NULL,
    "pn" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppLidMap_pkey" PRIMARY KEY ("lid")
);

-- CreateTable
CREATE TABLE "WhatsAppContact" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "number" TEXT,
    "lid" TEXT,
    "savedName" TEXT,
    "pushName" TEXT,
    "verifiedName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppLidMap_pn_idx" ON "WhatsAppLidMap"("pn");

-- CreateIndex
CREATE INDEX "WhatsAppContact_accountId_idx" ON "WhatsAppContact"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppContact_accountId_number_key" ON "WhatsAppContact"("accountId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppContact_accountId_lid_key" ON "WhatsAppContact"("accountId", "lid");

-- CreateIndex
CREATE INDEX "WhatsAppConversation_accountId_contactNumber_timestamp_idx" ON "WhatsAppConversation"("accountId", "contactNumber", "timestamp");

-- CreateIndex
CREATE INDEX "WhatsAppConversation_accountId_contactLid_idx" ON "WhatsAppConversation"("accountId", "contactLid");

-- AddForeignKey
ALTER TABLE "WhatsAppContact" ADD CONSTRAINT "WhatsAppContact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

