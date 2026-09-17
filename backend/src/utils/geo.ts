// src/utils/geo.ts

export interface Coordinates {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_METERS = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Jarak permukaan antara dua titik koordinat, dalam meter (formula haversine).
 *
 * Bumi diperlakukan sebagai bola, bukan elipsoid. Selisihnya di bawah 0,5% —
 * tidak berarti untuk geofence berjari-jari puluhan sampai ratusan meter.
 */
export const distanceInMeters = (a: Coordinates, b: Coordinates): number => {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
};

export const isWithinRadius = (
  point: Coordinates,
  center: Coordinates,
  radiusMeters: number
): boolean => distanceInMeters(point, center) <= radiusMeters;
