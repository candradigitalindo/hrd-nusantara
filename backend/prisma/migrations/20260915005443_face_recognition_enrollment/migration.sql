-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "faceMatchScore" DOUBLE PRECISION,
ADD COLUMN     "faceVerified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FaceEnrollment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "embedding" BYTEA NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "modelName" TEXT NOT NULL,
    "imageUrl" TEXT,
    "detectionScore" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "enrolledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaceEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FaceEnrollment_employeeId_isActive_idx" ON "FaceEnrollment"("employeeId", "isActive");

-- CreateIndex
CREATE INDEX "FaceEnrollment_enrolledById_idx" ON "FaceEnrollment"("enrolledById");

-- AddForeignKey
ALTER TABLE "FaceEnrollment" ADD CONSTRAINT "FaceEnrollment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceEnrollment" ADD CONSTRAINT "FaceEnrollment_enrolledById_fkey" FOREIGN KEY ("enrolledById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
