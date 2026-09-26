-- Bawaan interval pemantauan lokasi diubah dari 15 menjadi 20 menit.
ALTER TABLE "LocationTrackingSetting" ALTER COLUMN "intervalMinutes" SET DEFAULT 20;
