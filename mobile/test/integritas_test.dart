import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/fitur/presensi/integritas_lokasi.dart';
import 'package:hrd_nusantara/fitur/presensi/layanan_lokasi.dart';
import 'package:hrd_nusantara/fitur/presensi/model_presensi.dart';

void main() {
  final kini = DateTime(2026, 9, 21, 8, 0);
  final posisiMonas = PosisiSaatIni(-6.1753924, 106.8271528, 12, waktu: kini.subtract(const Duration(seconds: 5)));

  test('ponsel jujur: tidak diblokir, tanpa peringatan', () {
    final l = susunLaporan(posisi: posisiMonas, native: const SinyalNative(), sekarang: kini);
    expect(l.diblokir, isFalse);
    expect(l.peringatan, isEmpty);
    expect(l.keJson()['mockLocation'], isFalse);
    expect(l.keJson()['positionAgeSeconds'], closeTo(5, 0.1));
  });

  test('penanda mock dari OS memblokir', () {
    final l = susunLaporan(posisi: PosisiSaatIni(-6.1, 106.8, 5, mocked: true), native: const SinyalNative(), sekarang: kini);
    expect(l.diblokir, isTrue);
    expect(l.alasanBlokir.single, contains('palsu oleh sistem operasi'));
  });

  test('aplikasi lokasi palsu terpasang memblokir dan disebut namanya', () {
    final l = susunLaporan(posisi: posisiMonas, native: const SinyalNative(mockApps: ['com.lexa.fakegps']), sekarang: kini);
    expect(l.diblokir, isTrue);
    expect(l.alasanBlokir.single, contains('com.lexa.fakegps'));
    expect(l.keJson()['mockApps'], ['com.lexa.fakegps']);
  });

  test('root memblokir; emulator & opsi pengembang hanya peringatan', () {
    expect(susunLaporan(posisi: posisiMonas, native: const SinyalNative(rooted: true), sekarang: kini).diblokir, isTrue);
    final l = susunLaporan(posisi: posisiMonas, native: const SinyalNative(emulator: true, developerOptions: true), sekarang: kini);
    expect(l.diblokir, isFalse);
    expect(l.peringatan, hasLength(2));
  });

  test('GPS jauh dari lokasi jaringan jadi peringatan, jaringan basi diabaikan', () {
    // Lokasi jaringan di Bundaran HI (≈2,2 km dari Monas).
    final jaringan = {'latitude': -6.1950, 'longitude': 106.8230, 'accuracy': 500.0, 'ageSeconds': 30.0, 'mocked': false};
    final l = susunLaporan(posisi: posisiMonas, native: SinyalNative(networkLocation: jaringan), sekarang: kini);
    expect(l.networkDistanceMeters, closeTo(2230, 120));
    expect(l.peringatan.single, contains('jaringan'));
    final basi = susunLaporan(posisi: posisiMonas, native: SinyalNative(networkLocation: {...jaringan, 'ageSeconds': 3600.0}), sekarang: kini);
    expect(basi.networkDistanceMeters, isNull);
  });

  test('lokasi jaringan yang juga mock ikut memblokir', () {
    final l = susunLaporan(posisi: posisiMonas, native: const SinyalNative(networkLocation: {'latitude': -6.17, 'longitude': 106.82, 'ageSeconds': 5.0, 'mocked': true}), sekarang: kini);
    expect(l.diblokir, isTrue);
  });

  test('posisi GPS tua jadi peringatan', () {
    final l = susunLaporan(posisi: PosisiSaatIni(-6.1, 106.8, 5, waktu: kini.subtract(const Duration(minutes: 10))), native: const SinyalNative(), sekarang: kini);
    expect(l.peringatan.single, contains('bukan pembacaan baru'));
  });

  test('sinyal native dari map platform channel dibaca dengan aman', () {
    final n = SinyalNative.dariMap({'developerOptions': true, 'mockApps': ['a', 'b'], 'networkLocation': {'latitude': 1.0}, 'locationSimulated': true});
    expect(n.developerOptions, isTrue);
    expect(n.mockApps, ['a', 'b']);
    expect(n.locationSimulated, isTrue);
    expect(SinyalNative.dariMap({}).mockApps, isEmpty);
  });

  test('laporan ikut dikirim di badan permintaan absen', () {
    final l = susunLaporan(posisi: posisiMonas, native: const SinyalNative(), sekarang: kini);
    final p = PermintaanAbsen(metode: MetodeAbsen.gps, latitude: -6.1, longitude: 106.8, lokasiId: 'x', integritas: l.keJson());
    expect(p.keJson()['integrity'], isA<Map<String, dynamic>>());
    expect((p.keJson()['integrity'] as Map)['rooted'], isFalse);
  });
}
