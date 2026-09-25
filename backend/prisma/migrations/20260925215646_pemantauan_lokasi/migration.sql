-- CreateTable
CREATE TABLE "LocationTrackingSetting" (
    "id" TEXT NOT NULL DEFAULT 'utama',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'always',
    "intervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationTrackingSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationPing" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "accuracyMeters" DOUBLE PRECISION,
    "isMocked" BOOLEAN NOT NULL DEFAULT false,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationPing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationTrackingStatus" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3),
    "permission" TEXT,
    "platform" TEXT,
    "appVersion" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationTrackingStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LocationPing_recordedAt_idx" ON "LocationPing"("recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LocationPing_employeeId_recordedAt_key" ON "LocationPing"("employeeId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LocationTrackingStatus_employeeId_key" ON "LocationTrackingStatus"("employeeId");

-- AddForeignKey
ALTER TABLE "LocationTrackingSetting" ADD CONSTRAINT "LocationTrackingSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPing" ADD CONSTRAINT "LocationPing_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationTrackingStatus" ADD CONSTRAINT "LocationTrackingStatus_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

