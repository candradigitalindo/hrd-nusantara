import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/core/api/galat_api.dart';
import 'package:hrd_nusantara/core/api/klien_api.dart';
import 'package:hrd_nusantara/core/api/status_jaringan.dart';
import 'package:hrd_nusantara/core/penyimpanan/cache_lokal.dart';
import 'package:hrd_nusantara/core/penyimpanan/penyimpanan_sesi.dart';
import 'package:hrd_nusantara/core/widget/bingkai_jaringan.dart';
import 'package:hrd_nusantara/fitur/auth/sesi_provider.dart';
import 'package:hrd_nusantara/fitur/jadwal/model_shift.dart';
import 'package:hrd_nusantara/fitur/jadwal/repo_jadwal.dart';
import 'package:hrd_nusantara/fitur/presensi/layar_presensi.dart';
import 'package:hrd_nusantara/fitur/presensi/model_presensi.dart';
import 'package:hrd_nusantara/fitur/presensi/repo_presensi.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'alat_uji.dart';
import 'data_uji.dart';

/// Server tiruan: menjawab JSON per jalur, atau berpura-pura jaringan mati.
class ServerPalsu implements HttpClientAdapter {
  bool putus = false;
  int kode = 200;
  final jawaban = <String, Object?>{};
  final permintaan = <String>[];

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    permintaan.add(o.uri.path);
    if (putus) throw DioException.connectionError(requestOptions: o, reason: 'jaringan mati');
    return ResponseBody.fromString(jsonEncode(jawaban[o.uri.path] ?? {'status': 'ok'}), kode, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });
  }

  @override
  void close({bool force = false}) {}
}

/// Cache di memori untuk tes widget: berkas sungguhan tidak selesai ditulis
/// di dalam waktu palsu testWidgets.
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

Override klienPalsu(ServerPalsu server, CacheLokal cache) => klienApiProvider.overrideWith((ref) => KlienApi(
      penyimpanan: PenyimpananSesi(),
      dio: Dio()..httpClientAdapter = server,
      baseUrl: 'https://hrd.contoh/api',
      cache: cache,
      jaringan: ref.read(statusJaringanProvider.notifier),
    ));

Map<String, dynamic> jsonPresensi(String id, DateTime masuk, {DateTime? pulang}) => {
      'id': id,
      'status': 'present',
      'checkInTime': iso(masuk),
      if (pulang != null) 'checkOutTime': iso(pulang),
      'checkInMethod': 'gps',
      'lateMinutes': 0,
      if (pulang != null) 'workedMinutes': pulang.difference(masuk).inMinutes,
      'workLocation': {'name': 'Outlet Sudirman'},
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    await initializeDateFormatting('id_ID');
    await muatFontAsli();
  });
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  group('klien API saat offline', () {
    late ServerPalsu server;
    late ProviderContainer c;
    KlienApi api() => c.read(klienApiProvider);
    StatusJaringan status() => c.read(statusJaringanProvider);

    setUp(() {
      server = ServerPalsu()
        ..jawaban['/api/jadwal'] = {
          'data': [
            {'id': 'S1'},
          ],
        };
      c = ProviderContainer(overrides: [klienPalsu(server, CacheMemori())]);
      addTearDown(c.dispose);
    });

    test('online menyimpan salinan; offline memakai salinan dan mencatat jam datanya', () async {
      expect(await api().getDaftar('/jadwal', cache: 'jadwal'), [
        {'id': 'S1'},
      ]);
      expect(status().terhubung, isTrue);

      server.putus = true;
      expect(await api().getDaftar('/jadwal', cache: 'jadwal'), [
        {'id': 'S1'},
      ]);
      expect(status().terhubung, isFalse);
      expect(status().dataPer, isNotNull);
    });

    test('offline tanpa salinan: galat jaringan tetap sampai ke layar', () async {
      server.putus = true;
      await expectLater(api().getDaftar('/jadwal', cache: 'jadwal'), throwsA(isA<GalatApi>().having((g) => g.jaringan, 'jaringan', isTrue)));
      // Tanpa kunci cache pun sama.
      await expectLater(api().getDaftar('/jadwal'), throwsA(isA<GalatApi>()));
      expect(status().terhubung, isFalse);
      expect(status().dataPer, isNull);
    });

    test('jawaban 4xx tidak diganti salinan, dan membuktikan server terjangkau lagi', () async {
      await api().getDaftar('/jadwal', cache: 'jadwal');
      server.putus = true;
      await api().getDaftar('/jadwal', cache: 'jadwal');
      expect(status().terhubung, isFalse);

      server
        ..putus = false
        ..kode = 403;
      await expectLater(api().getDaftar('/jadwal', cache: 'jadwal'), throwsA(isA<GalatApi>().having((g) => g.kodeHttp, 'kodeHttp', 403)));
      expect(status().terhubung, isTrue);
      expect(status().dataPer, isNull);
    });

    test('502 dari proxy saat backend mati: salinan dipakai', () async {
      await api().getDaftar('/jadwal', cache: 'jadwal');
      server.kode = 502;
      expect(await api().getDaftar('/jadwal', cache: 'jadwal'), hasLength(1));
      expect(status().terhubung, isFalse);
    });

    test('sambungan pulih lewat /health: provider data yang tampil mengambil ulang', () async {
      final data = FutureProvider.autoDispose((ref) {
        ref.watch(sambunganProvider);
        return ref.watch(klienApiProvider).getDaftar('/jadwal', cache: 'jadwal');
      });
      final dengar = c.listen(data.future, (_, _) {});
      await dengar.read();

      server.putus = true;
      c.invalidate(data);
      await c.read(data.future);
      expect(status().terhubung, isFalse);

      server.putus = false;
      server.permintaan.clear();
      await c.read(statusJaringanProvider.notifier).periksaSekarang();
      expect(server.permintaan, ['/health']);
      expect(status().terhubung, isTrue);
      expect(status().sambungan, 1);

      await c.read(data.future);
      expect(server.permintaan, ['/health', '/api/jadwal']);
    });
  });

  group('"hari ini" disaring dari salinan, bukan dari tanggal permintaan', () {
    test('presensi kemarin yang belum check-out tidak tampil sebagai presensi hari ini', () async {
      final c = ProviderContainer(overrides: [
        riwayatPresensiProvider.overrideWith((ref) async => [Presensi.dariJson(jsonPresensi('P-1', jam(8, 0, -1)))]),
      ]);
      addTearDown(c.dispose);
      expect(await c.listen(presensiHariIniProvider.future, (_, _) {}).read(), isNull);
    });

    test('presensi dan shift hari ini ditemukan di antara riwayat dan jadwal', () async {
      final c = ProviderContainer(overrides: [
        riwayatPresensiProvider.overrideWith((ref) async => [
              Presensi.dariJson(jsonPresensi('P0', jam(7, 52))),
              Presensi.dariJson(jsonPresensi('P-1', jam(7, 55, -1), pulang: jam(17, 2, -1))),
            ]),
        jadwalProvider.overrideWith((ref) async => [
              for (final g in [-1, 0, 1]) Shift.dariJson({'id': 'S$g', 'date': '${tanggalSaja(jam(0, 0, g))}T00:00:00.000Z', 'startTime': '08:00', 'endTime': '17:00'}),
            ]),
      ]);
      addTearDown(c.dispose);
      expect((await c.listen(presensiHariIniProvider.future, (_, _) {}).read())!.id, 'P0');
      expect((await c.listen(shiftHariIniProvider.future, (_, _) {}).read())!.id, 'S0');
    });
  });

  testWidgets('layar presensi offline: data tersimpan tampil di bawah pita Offline', (tester) async {
    ukuranPonsel(tester);
    final server = ServerPalsu()..putus = true;
    final cache = CacheMemori()
      ..isi['presensi-riwayat'] = EntriCache({
        'data': [
          jsonPresensi('P0', jam(7, 52)),
          jsonPresensi('P-1', jam(7, 55, -1), pulang: jam(17, 2, -1)),
          jsonPresensi('P-2', jam(7, 49, -2), pulang: jam(17, 5, -2)),
        ],
      }, jam(7, 53));

    await tester.pumpWidget(aplikasiUji(
      const LayarPresensi(),
      builder: (context, child) => BingkaiJaringan(child: child!),
      overrides: [
        klienPalsu(server, cache),
        penggunaProvider.overrideWithValue(pengguna),
      ],
    ));
    await tester.pumpAndSettle();

    expect(find.textContaining('Offline · Menampilkan data tersimpan pukul 07:53'), findsOneWidget);
    expect(find.text('Check-out'), findsOneWidget, reason: 'presensi hari ini dari salinan masih terbuka');
    expect(find.text('Outlet Sudirman'), findsWidgets);
    await potret(tester, 'presensi-offline');

    // Dispose pohon widget supaya pemeriksaan ulang berkala ikut berhenti.
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('pita offline muncul dan hilang tanpa mengosongkan tumpukan halaman', (tester) async {
    await tester.pumpWidget(aplikasiUji(
      Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: FilledButton(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const Scaffold(body: Text('Halaman kedua')))),
              child: const Text('Buka'),
            ),
          ),
        ),
      ),
      builder: (context, child) => BingkaiJaringan(child: child!),
    ));
    await tester.tap(find.text('Buka'));
    await tester.pumpAndSettle();
    final c = ProviderScope.containerOf(tester.element(find.text('Halaman kedua')));

    c.read(statusJaringanProvider.notifier).terputus();
    await tester.pump();
    expect(find.textContaining('Tidak terhubung ke server'), findsOneWidget);
    expect(find.text('Halaman kedua'), findsOneWidget);

    c.read(statusJaringanProvider.notifier).berhasil();
    await tester.pump();
    expect(find.textContaining('Tidak terhubung ke server'), findsNothing);
    expect(find.text('Halaman kedua'), findsOneWidget);
  });
}
