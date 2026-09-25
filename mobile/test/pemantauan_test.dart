import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:hrd_nusantara/core/api/klien_api.dart';
import 'package:hrd_nusantara/core/api/status_jaringan.dart';
import 'package:hrd_nusantara/core/penyimpanan/cache_lokal.dart';
import 'package:hrd_nusantara/core/penyimpanan/penyimpanan_sesi.dart';
import 'package:hrd_nusantara/fitur/auth/sesi_provider.dart';
import 'package:hrd_nusantara/fitur/pemantauan/layanan_pemantauan.dart';
import 'package:hrd_nusantara/fitur/pemantauan/layar_pemantauan.dart';
import 'package:hrd_nusantara/fitur/pemantauan/repo_pemantauan.dart';
import 'package:hrd_nusantara/fitur/presensi/model_presensi.dart';
import 'package:hrd_nusantara/fitur/presensi/repo_presensi.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'alat_uji.dart';
import 'data_uji.dart';

class CacheMemori extends CacheLokal {
  CacheMemori() : super(PenyimpananSesi());
  final isi = <String, EntriCache>{};
  @override
  Future<void> simpan(String kunci, Object? data) async => isi[kunci] = EntriCache(jsonDecode(jsonEncode(data)), DateTime.now());
  @override
  Future<EntriCache?> baca(String kunci) async => isi[kunci];
  @override
  Future<void> hapusSemua() async => isi.clear();
}

class IzinTiruan extends IzinLokasi {
  IzinTiruan(this.kode);
  String kode;
  @override
  Future<String> periksa() async => kode;
  @override
  Future<String> minta() async => kode = 'granted_always';
}

Position posisi(DateTime waktu, {double lat = -6.2088}) => Position(
      latitude: lat,
      longitude: 106.8456,
      timestamp: waktu,
      accuracy: 12,
      altitude: 0,
      altitudeAccuracy: 0,
      heading: 0,
      headingAccuracy: 0,
      speed: 0,
      speedAccuracy: 0,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // Di luar testWidgets: membaca berkas font tidak pernah selesai di dalam waktu palsunya.
  setUpAll(() async {
    await initializeDateFormatting('id_ID');
    await muatFontAsli();
  });

  late ServerAntrean server;
  late StreamController<Position> gps;
  late IzinTiruan izin;
  late Map<String, dynamic> konfigurasi;
  late ProviderContainer c;
  late List<int> intervalDiminta;
  Presensi? presensiHariIni;

  final kiriman = <List<dynamic>>[];
  final laporan = <Map<String, dynamic>>[];

  PemantauLokasi pemantau() => c.read(pemantauLokasiProvider.notifier);
  StatusPemantauan status() => c.read(pemantauLokasiProvider);
  Future<void> tunggu() => Future<void>.delayed(const Duration(milliseconds: 20));

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    kiriman.clear();
    laporan.clear();
    intervalDiminta = [];
    presensiHariIni = null;
    konfigurasi = {'enabled': true, 'mode': 'always', 'intervalMinutes': 5};
    izin = IzinTiruan('granted_while_in_use');
    gps = StreamController<Position>.broadcast();
    server = ServerAntrean()
      ..jawab = (o) => switch (o.uri.path) {
            '/api/location-tracking/config' => (200, konfigurasi),
            '/api/location-tracking/pings' => () {
                kiriman.add((o.data as Map)['pings'] as List);
                return (200, {'diterima': ((o.data as Map)['pings'] as List).length, 'enabled': konfigurasi['enabled']});
              }(),
            '/api/location-tracking/status' => () {
                laporan.add(Map<String, dynamic>.from(o.data as Map));
                return (204, null);
              }(),
            _ => (404, {'error': 'x'}),
          };
    c = ProviderContainer(overrides: [
      penggunaProvider.overrideWithValue(pengguna),
      klienTiruan(server),
      cacheLokalProvider.overrideWithValue(CacheMemori()),
      izinLokasiProvider.overrideWithValue(izin),
      sumberPosisiProvider.overrideWithValue((menit) {
        intervalDiminta.add(menit);
        return gps.stream;
      }),
      presensiHariIniProvider.overrideWith((ref) async => presensiHariIni),
    ]);
    addTearDown(c.dispose);
    c.listen(pemantauLokasiProvider, (_, _) {});
    await pemantau().segarkan();
  });

  test('aktif tapi belum dibaca karyawan: tidak mengambil lokasi, pemberitahuan diminta', () async {
    expect(status().perluPersetujuan, isTrue);
    expect(status().berjalan, isFalse);
    expect(intervalDiminta, isEmpty);
    expect(laporan.last, containsPair('consent', false));
  });

  test('setelah disetujui: berjalan tiap interval, satu titik per interval, terkirim ke server', () async {
    await pemantau().setujui();
    expect(status().berjalan, isTrue);
    expect(intervalDiminta, [5]);
    expect(laporan.last, {'consent': true, 'permission': 'granted_always', 'platform': 'android'});

    final t0 = DateTime.utc(2026, 9, 25, 3);
    gps.add(posisi(t0));
    await tunggu();
    gps.add(posisi(t0.add(const Duration(minutes: 2)))); // terlalu rapat: dibuang
    await tunggu();
    gps.add(posisi(t0.add(const Duration(minutes: 5)), lat: -6.21));
    await tunggu();

    expect(kiriman.expand((k) => k).map((t) => t['recordedAt']), ['2026-09-25T03:00:00.000Z', '2026-09-25T03:05:00.000Z']);
    expect(kiriman.last.single['latitude'], -6.21);
    expect(status().tertunda, 0);
  });

  test('offline: titik menumpuk di ponsel, terkirim sekaligus saat tersambung', () async {
    await pemantau().setujui();
    server.putus = true;
    final t0 = DateTime.utc(2026, 9, 25, 3);
    for (var i = 0; i < 3; i++) {
      gps.add(posisi(t0.add(Duration(minutes: 5 * i))));
      await tunggu();
    }
    expect(status().tertunda, 3);
    expect(kiriman, isEmpty);

    server.putus = false;
    await c.read(statusJaringanProvider.notifier).periksaSekarang();
    await pemantau().kirimTertunda();
    expect(kiriman.last, hasLength(3));
    expect(status().tertunda, 0);
  });

  test('mode "selama bekerja": hanya berjalan selama presensi hari ini terbuka', () async {
    konfigurasi = {'enabled': true, 'mode': 'while_working', 'intervalMinutes': 10};
    await pemantau().setujui();
    expect(status().berjalan, isFalse);

    presensiHariIni = Presensi(id: 'P1', status: 'present', jamMasuk: DateTime.now());
    c.invalidate(presensiHariIniProvider);
    await c.read(presensiHariIniProvider.future);
    await pemantau().segarkan();
    expect(status().berjalan, isTrue);
    expect(intervalDiminta, [10]);
  });

  test('dimatikan Super Admin: berhenti mengambil lokasi', () async {
    await pemantau().setujui();
    expect(status().berjalan, isTrue);

    konfigurasi = {'enabled': false, 'mode': 'always', 'intervalMinutes': 5};
    gps.add(posisi(DateTime.utc(2026, 9, 25, 3)));
    await tunggu();
    await tunggu();
    expect(status().berjalan, isFalse);
    expect(status().aktif, isFalse);
  });

  test('izin lokasi ditolak: tidak berjalan, dan keadaannya dilaporkan untuk Super Admin', () async {
    izin.kode = 'denied_forever';
    await c.read(penyimpananSesiProvider).simpanSetujuPantau(pengguna.id, true);
    await pemantau().segarkan();
    expect(status().izinDitolak, isTrue);
    expect(status().berjalan, isFalse);
    expect(laporan.last, containsPair('permission', 'denied_forever'));
  });

  testWidgets('baris Profil: belum disetujui → pemberitahuan lengkap, lalu berjalan', (tester) async {
    ukuranPonsel(tester);
    const konfig = KonfigurasiPemantauan(aktif: true, selamaBekerja: false, intervalMenit: 15);
    await tester.pumpWidget(aplikasiUji(
      const Scaffold(body: Card(child: BarisPemantauan())),
      overrides: [pemantauLokasiProvider.overrideWith(() => PemantauTetap(const StatusPemantauan(konfigurasi: konfig, setuju: false, izin: 'granted_while_in_use')))],
    ));
    await tester.pumpAndSettle();
    expect(find.text('Belum Anda setujui · ketuk untuk membaca'), findsOneWidget);

    await tester.tap(find.text('Pemantauan lokasi'));
    await tester.pumpAndSettle();
    expect(find.textContaining('24 jam sehari, aplikasi ini mengirim lokasi Anda ke HRD Nusantara setiap 15 menit'), findsOneWidget);
    expect(find.textContaining('hanya dapat dilihat oleh Super Admin'), findsOneWidget);
    await potret(tester, 'pemantauan-pemberitahuan');

    await tester.tap(find.text('Saya mengerti'));
    await tester.pumpAndSettle();
    expect(find.textContaining('24 jam sehari · tiap 15 menit'), findsOneWidget);
  });
}
