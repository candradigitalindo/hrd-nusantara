import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/core/api/galat_api.dart';
import 'package:hrd_nusantara/core/api/klien_api.dart';
import 'package:hrd_nusantara/core/penyimpanan/cache_lokal.dart';
import 'package:hrd_nusantara/core/penyimpanan/penyimpanan_sesi.dart';
import 'package:hrd_nusantara/fitur/auth/sesi_provider.dart';

/// Server tiruan berbasis fungsi: jawaban ditentukan per permintaan.
class ServerSesi implements HttpClientAdapter {
  ServerSesi(this.jawab);
  final Future<(int, Object?)> Function(RequestOptions o) jawab;
  final panggilan = <String>[];

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    panggilan.add('${o.method} ${o.uri.path} ${o.headers['Authorization'] ?? '-'}');
    final (kode, isi) = await jawab(o);
    return ResponseBody.fromString(isi == null ? '' : jsonEncode(isi), kode, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });
  }

  @override
  void close({bool force = false}) {}
}

/// Keystore yang rusak (mis. setelah ponsel dipulihkan dari cadangan).
class PenyimpananRusak extends PenyimpananSesi {
  @override
  Future<String?> bacaToken() async => throw PlatformException(code: 'keystore', message: 'BadPaddingException');
}

Future<(int, Object?)> tokenBaru(RequestOptions o) async => (200, {'token': 'akses-baru', 'refreshToken': 'refresh-2'});

void main() {
  late int sesiHabis;
  final simpanan = PenyimpananSesi();

  KlienApi klien(Future<(int, Object?)> Function(RequestOptions o) jawab) => KlienApi(
        penyimpanan: simpanan,
        dio: Dio()..httpClientAdapter = ServerSesi(jawab),
        baseUrl: 'https://hrd.contoh/api',
        saatSesiHabis: () async => sesiHabis++,
      );

  List<String> panggilan(KlienApi api) => (api.dio.httpClientAdapter as ServerSesi).panggilan;

  setUp(() {
    sesiHabis = 0;
    FlutterSecureStorage.setMockInitialValues({'hrd_token': 'akses-lama', 'hrd_refresh': 'refresh-1'});
  });

  test('token akses kedaluwarsa: ditukar diam-diam, permintaannya diulang, pengguna tetap masuk', () async {
    final api = klien((o) async => switch (o.uri.path) {
          '/api/auth/refresh' => tokenBaru(o),
          _ => o.headers['Authorization'] == 'Bearer akses-baru' ? (200, {'id': 'P1'}) : (401, {'error': 'Token kedaluwarsa'}),
        });

    expect(await api.getObjek('/presensi'), {'id': 'P1'});
    expect(panggilan(api), [
      'GET /api/presensi Bearer akses-lama',
      'POST /api/auth/refresh Bearer akses-lama',
      'GET /api/presensi Bearer akses-baru',
    ]);
    expect(await simpanan.bacaToken(), 'akses-baru');
    expect(await simpanan.bacaRefreshToken(), 'refresh-2');
    expect(sesiHabis, 0);
  });

  test('beberapa 401 bersamaan berbagi satu pertukaran (refresh token berputar)', () async {
    final api = klien((o) async => switch (o.uri.path) {
          '/api/auth/refresh' => tokenBaru(o),
          _ => o.headers['Authorization'] == 'Bearer akses-baru' ? (200, {'ok': true}) : (401, {'error': 'x'}),
        });

    await Future.wait([api.getObjek('/a'), api.getObjek('/b'), api.getObjek('/c')]);
    expect(panggilan(api).where((p) => p.contains('/auth/refresh')), hasLength(1));
  });

  test('sesi perangkat dicabut di server: keluar, dan galatnya sampai ke layar', () async {
    final api = klien((o) async => o.uri.path == '/api/auth/refresh' ? (401, {'error': 'Sesi sudah berakhir'}) : (401, {'error': 'x'}));

    await expectLater(api.getObjek('/presensi'), throwsA(isA<GalatApi>().having((g) => g.kodeHttp, 'kodeHttp', 401)));
    expect(sesiHabis, 1);
  });

  test('pertukaran gagal karena jaringan: sesi tidak dihapus, dicoba lagi nanti', () async {
    final api = klien((o) async {
      if (o.uri.path == '/api/auth/refresh') throw DioException.connectionError(requestOptions: o, reason: 'putus');
      return (401, {'error': 'x'});
    });

    await expectLater(api.getObjek('/presensi'), throwsA(isA<GalatApi>()));
    expect(sesiHabis, 0);
    expect(await simpanan.bacaRefreshToken(), 'refresh-1');
  });

  test('tetap 401 dengan token baru: sesi berakhir, tanpa pertukaran kedua', () async {
    final api = klien((o) async => o.uri.path == '/api/auth/refresh' ? await tokenBaru(o) : (401, {'error': 'x'}));

    await expectLater(api.getObjek('/presensi'), throwsA(isA<GalatApi>()));
    expect(panggilan(api).where((p) => p.contains('/auth/refresh')), hasLength(1));
    expect(sesiHabis, 1);
  });

  test('akun tanpa refresh token (login versi lama): 401 tetap mengeluarkan sesi', () async {
    FlutterSecureStorage.setMockInitialValues({'hrd_token': 'akses-lama'});
    final api = klien((o) async => (401, {'error': 'x'}));

    await expectLater(api.getObjek('/presensi'), throwsA(isA<GalatApi>()));
    expect(panggilan(api).where((p) => p.contains('/auth/refresh')), isEmpty);
    expect(sesiHabis, 1);
  });

  test('Keystore tak terbaca saat membuka aplikasi: diminta login ulang, tidak macet di layar memuat', () async {
    final c = ProviderContainer(overrides: [penyimpananSesiProvider.overrideWithValue(PenyimpananRusak())]);
    addTearDown(c.dispose);
    expect(c.read(sesiProvider), isA<SesiMemuat>());
    await Future<void>.delayed(Duration.zero);
    expect(c.read(sesiProvider), isA<SesiKeluar>());
  });

  test('login menyebut perangkat, menyimpan refresh token; keluar mengakhiri sesi di server', () async {
    FlutterSecureStorage.setMockInitialValues({});
    Map<String, dynamic>? badanLogin;
    final api = klien((o) async {
      switch (o.uri.path) {
        case '/api/auth/login':
          badanLogin = Map<String, dynamic>.from(o.data as Map);
          return (200, {'token': 'akses-1', 'refreshToken': 'refresh-1'});
        case '/api/auth/me':
          return (200, {'id': 'E1', 'name': 'Budi Santoso', 'permissions': <String>[]});
        case '/api/auth/logout':
          return (204, null);
      }
      return (404, {'error': 'x'});
    });
    final folder = Directory.systemTemp.createTempSync('sesi-uji');
    addTearDown(() => folder.deleteSync(recursive: true));
    final cache = CacheLokal(simpanan, folderInduk: () async => folder);
    await cache.simpan('gaji-slip', {'milik': 'akun sebelumnya'});
    final c = ProviderContainer(overrides: [
      klienApiProvider.overrideWithValue(api),
      cacheLokalProvider.overrideWithValue(cache),
    ]);
    addTearDown(c.dispose);
    // Status awal (memulihkan sesi) selesai dulu.
    c.read(sesiProvider);
    await Future<void>.delayed(Duration.zero);

    await c.read(sesiProvider.notifier).masuk('0812 3456 7890', 'rahasia');
    expect(badanLogin!['device'], {'platform': 'android'});
    expect(await simpanan.bacaRefreshToken(), 'refresh-1');
    expect(await cache.baca('gaji-slip'), isNull, reason: 'data akun sebelumnya dibuang saat masuk');

    await c.read(sesiProvider.notifier).keluar();
    expect(panggilan(api).last, startsWith('POST /api/auth/logout'));
    expect(await simpanan.bacaRefreshToken(), isNull);
    expect(await simpanan.bacaToken(), isNull);
  });
}
