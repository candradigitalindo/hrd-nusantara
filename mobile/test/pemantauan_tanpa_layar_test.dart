import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:hrd_nusantara/core/api/klien_api.dart';
import 'package:hrd_nusantara/core/penyimpanan/cache_lokal.dart';
import 'package:hrd_nusantara/fitur/auth/sesi_provider.dart';
import 'package:hrd_nusantara/fitur/pemantauan/kanal_pemantauan.dart';
import 'package:hrd_nusantara/fitur/pemantauan/layanan_pemantauan.dart';
import 'package:hrd_nusantara/fitur/pemantauan/layar_pemantauan.dart';
import 'package:hrd_nusantara/fitur/pemantauan/repo_pemantauan.dart';
import 'package:hrd_nusantara/fitur/presensi/repo_presensi.dart';
import 'package:hrd_nusantara/router.dart';

import 'alat_uji.dart';
import 'data_uji.dart';
import 'pemantauan_awet_test.dart' show KanalTiruan, PemantauPenyiapanUji;
import 'pemantauan_test.dart' show CacheMemori, IzinTiruan;

/// Mesin Flutter yang dinyalakan tanpa layar setelah ponsel restart belum
/// pernah menerima status siklus hidup dari Android (null). Berkas tersendiri,
/// dan urutan tesnya penting: begitu status siklus diatur, tidak bisa kembali
/// ke null.
void main() {
  final binding = TestWidgetsFlutterBinding.ensureInitialized();

  test('tanpa layar: izin "saat dipakai" tidak memulai pengambilan; "sepanjang waktu" memulainya', () async {
    expect(binding.lifecycleState, isNull, reason: 'prasyarat tes: belum ada status siklus');
    FlutterSecureStorage.setMockInitialValues({});
    final izin = IzinTiruan('granted_while_in_use');
    final kanal = KanalTiruan();
    final intervalDiminta = <int>[];
    final server = ServerAntrean()
      ..jawab = (o) => switch (o.uri.path) {
            '/api/location-tracking/config' => (200, {'enabled': true, 'mode': 'always', 'intervalMinutes': 5}),
            '/api/location-tracking/status' => (204, null),
            _ => (404, {'error': 'x'}),
          };
    final c = ProviderContainer(overrides: [
      penggunaProvider.overrideWithValue(pengguna),
      klienTiruan(server),
      cacheLokalProvider.overrideWithValue(CacheMemori()),
      izinLokasiProvider.overrideWithValue(izin),
      kanalPemantauanProvider.overrideWithValue(kanal),
      sumberPosisiProvider.overrideWithValue((menit) {
        intervalDiminta.add(menit);
        return StreamController<Position>.broadcast().stream;
      }),
      presensiHariIniProvider.overrideWith((ref) async => null),
    ]);
    addTearDown(c.dispose);
    c.listen(pemantauLokasiProvider, (_, _) {});
    await c.read(penyimpananSesiProvider).simpanSetujuPantau(pengguna.id, true);

    await c.read(pemantauLokasiProvider.notifier).segarkan();
    expect(intervalDiminta, isEmpty, reason: 'Android menolak layanan lokasi dari latar dengan izin ini');
    expect(c.read(pemantauLokasiProvider).berjalan, isFalse);
    expect(kanal.berhentiDipanggil, 0, reason: 'bukan dihentikan dengan sengaja: pengingat tetap jalan');

    izin.kode = 'granted_always';
    await c.read(pemantauLokasiProvider.notifier).segarkan();
    expect(intervalDiminta, [5]);
    expect(kanal.mulaian, [5]);
    expect(binding.lifecycleState, isNull);
  });

  // Terakhir: tes ini mengubah status siklus menjadi resumed.
  testWidgets('tanpa layar: dialog tidak tampil dan tidak dicatat sudah ditawarkan; tampil begitu aplikasi dibuka', (tester) async {
    expect(binding.lifecycleState, isNull, reason: 'prasyarat tes: belum ada status siklus');
    FlutterSecureStorage.setMockInitialValues({});
    ukuranPonsel(tester);
    const konfig = KonfigurasiPemantauan(aktif: true, selamaBekerja: false, intervalMenit: 15);
    const kurang = StatusPenyiapan(notifikasi: false, penghematBaterai: false);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        penggunaProvider.overrideWithValue(pengguna),
        kanalPemantauanProvider.overrideWithValue(KanalTiruan(kurang)),
        pemantauLokasiProvider.overrideWith(
          () => PemantauPenyiapanUji(const StatusPemantauan(konfigurasi: konfig, setuju: true, izin: 'granted_while_in_use', penyiapan: kurang), () => kurang),
        ),
      ],
      child: MaterialApp(
        navigatorKey: kunciNavigatorAkar,
        builder: (context, child) => PendengarPemantauan(child: child ?? const SizedBox.shrink()),
        home: const Scaffold(body: Text('Beranda uji')),
      ),
    ));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.text('Agar pemantauan tidak terputus'), findsNothing);
    final wadah = ProviderScope.containerOf(tester.element(find.byType(Scaffold)));
    expect(wadah.read(pemantauLokasiProvider).penyiapanDitunda, isFalse, reason: 'belum ada yang melihat');
    expect(binding.lifecycleState, isNull);

    binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(find.text('Agar pemantauan tidak terputus'), findsOneWidget);
    expect(wadah.read(pemantauLokasiProvider).penyiapanDitunda, isTrue);
  });
}
