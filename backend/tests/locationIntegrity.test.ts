import { evaluateIntegrity, BLOCKING_FLAGS } from '../src/utils/locationIntegrity';

const now = new Date('2026-09-21T01:00:00.000Z');
const monas = { latitude: -6.1753924, longitude: 106.8271528 };
const surabaya = { latitude: -7.2575, longitude: 112.7521 };

describe('Deteksi lokasi palsu (aturan murni)', () => {
  it('ponsel jujur dengan laporan lengkap: tanpa penanda, tidak diblokir', () => {
    const h = evaluateIntegrity({ report: { mockLocation: false, mockApps: [], rooted: false, networkDistanceMeters: 120, positionAgeSeconds: 3 }, usesGps: true, position: monas, now });
    expect(h.flags).toEqual([]);
    expect(h.blocked).toBe(false);
    expect(h.reason).toBeNull();
  });

  it('penanda mock OS, aplikasi palsu, dan root memblokir; alasannya menyebut aplikasinya', () => {
    for (const report of [{ mockLocation: true }, { mockApps: ['com.lexa.fakegps'] }, { rooted: true }]) {
      const h = evaluateIntegrity({ report, usesGps: true, now });
      expect(h.blocked).toBe(true);
      expect(h.flags.some((f) => BLOCKING_FLAGS.has(f))).toBe(true);
    }
    expect(evaluateIntegrity({ report: { mockApps: ['com.lexa.fakegps'] }, usesGps: true, now }).reason).toContain('com.lexa.fakegps');
  });

  it('emulator, opsi pengembang, jaringan tak cocok, posisi basi hanya menandai', () => {
    const h = evaluateIntegrity({ report: { emulator: true, developerOptions: true, networkDistanceMeters: 5000, positionAgeSeconds: 600 }, usesGps: true, now });
    expect(h.flags).toEqual(['emulator', 'developer_options', 'network_mismatch', 'stale_position']);
    expect(h.blocked).toBe(false);
    expect(h.reason).toMatch(/^Perlu ditinjau/);
  });

  it('tanpa laporan: metode GPS ditandai integrity_missing, QR tidak', () => {
    expect(evaluateIntegrity({ report: undefined, usesGps: true, now }).flags).toEqual(['integrity_missing']);
    expect(evaluateIntegrity({ report: undefined, usesGps: false, now }).flags).toEqual([]);
  });

  it('Jakarta ke Surabaya dalam 30 menit ditandai perpindahan mustahil, tanpa memblokir', () => {
    const h = evaluateIntegrity({ report: {}, usesGps: true, position: surabaya, previous: { ...monas, at: new Date(now.getTime() - 30 * 60_000) }, now });
    expect(h.flags).toEqual(['impossible_speed']);
    expect(h.blocked).toBe(false);
  });

  it('perpindahan yang masuk akal atau jarak pendek tidak ditandai', () => {
    // Jakarta–Surabaya dalam 8 jam (≈ 90 km/jam): wajar.
    expect(evaluateIntegrity({ report: {}, usesGps: true, position: surabaya, previous: { ...monas, at: new Date(now.getTime() - 8 * 3_600_000) }, now }).flags).toEqual([]);
    // 300 m dalam 1 detik: lompatan akurasi GPS, bukan kecurangan.
    expect(evaluateIntegrity({ report: {}, usesGps: true, position: { latitude: monas.latitude + 0.0027, longitude: monas.longitude }, previous: { ...monas, at: new Date(now.getTime() - 1000) }, now }).flags).toEqual([]);
  });
});
