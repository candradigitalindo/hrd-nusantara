-- Pendaftaran wajah mandiri dari aplikasi mobile, dengan persetujuan HR.
-- Karyawan mengirim selfie sendiri; kiriman itu baru dipakai mencocokkan
-- check-in setelah HR memastikan orangnya benar (mencegah titip absen dengan
-- mendaftarkan wajah rekan atas nama sendiri).
--
-- Hanya menambah kolom ber-default dan indeks: baris lama otomatis menjadi
-- status 'approved', source 'hr', sehingga check-in yang sudah berjalan tidak
-- berubah perilakunya.

-- AlterTable
ALTER TABLE "FaceEnrollment" ADD COLUMN     "livenessScore" DOUBLE PRECISION,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'hr',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'approved';

-- CreateIndex
CREATE INDEX "FaceEnrollment_status_idx" ON "FaceEnrollment"("status");

-- CreateIndex
CREATE INDEX "FaceEnrollment_reviewedById_idx" ON "FaceEnrollment"("reviewedById");

-- AddForeignKey
ALTER TABLE "FaceEnrollment" ADD CONSTRAINT "FaceEnrollment_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

