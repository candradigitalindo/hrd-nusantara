import 'dart:async';
import 'dart:io' show HttpDate, HttpException;

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../konfigurasi.dart';
import '../penyimpanan/cache_lokal.dart';
import '../penyimpanan/penyimpanan_sesi.dart';
import 'galat_api.dart';
import 'jam_server.dart';
import 'status_jaringan.dart';

/// Dipanggil saat backend menjawab 401: token kedaluwarsa atau dicabut.
typedef PenangananSesiHabis = Future<void> Function();

/// Klien HTTP tunggal: menempelkan token, menerjemahkan galat, dan menyerah
/// bersih saat sesi habis supaya layar tidak menampilkan "401" mentah.
///
/// Juga dasar mode offline: setiap permintaan melapor ke [jaringan], dan
/// pembacaan yang diberi kunci `cache` menyimpan salinan jawabannya di
/// [cache] untuk dipakai saat server tak terjangkau.
class KlienApi {
  KlienApi({
    required PenyimpananSesi penyimpanan,
    Dio? dio,
    String? baseUrl,
    this.saatSesiHabis,
    this.cache,
    this.jaringan,
    this.jamServer,
  })  : _penyimpanan = penyimpanan,
        dio = dio ?? Dio() {
    this.dio.options
      ..baseUrl = baseUrl ?? apiUrl
      ..connectTimeout = batasWaktuHttp
      ..receiveTimeout = batasWaktuHttp
      ..headers = {'Accept': 'application/json'};
    this.dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await _penyimpanan.bacaToken();
          if (token != null && options.headers['Authorization'] == null) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onResponse: (res, handler) {
          jaringan?.berhasil();
          // Patokan jam server untuk presensi yang nanti diambil saat offline.
          final tanggal = res.headers.value('date');
          if (tanggal != null && jamServer != null) {
            try {
              unawaited(jamServer!.catat(HttpDate.parse(tanggal)));
            } on HttpException catch (_) {}
          }
          handler.next(res);
        },
        onError: (e, handler) async {
          // Jawaban 4xx tetap bukti server terjangkau.
          if (GalatApi.dari(e).serverTakTerjangkau) {
            jaringan?.terputus();
          } else if (e.response != null) {
            jaringan?.berhasil();
          }
          final jalur = e.requestOptions.path;
          // Login yang salah juga 401, tapi itu bukan sesi habis; rute sesi
          // sendiri tidak ikut diperbarui supaya tidak berputar-putar.
          final ruteSesi = jalur.contains('/auth/login') || jalur.contains('/auth/refresh') || jalur.contains('/auth/logout');
          if (e.response?.statusCode == 401 && !ruteSesi) {
            // Token akses kedaluwarsa: tukar lewat refresh token lalu ulangi
            // permintaannya sekali. Yang sudah diulang dan tetap 401 berarti
            // sesinya memang berakhir.
            final diperbarui = e.requestOptions.extra['sudahDiulang'] == true ? false : await _perbaruiToken();
            if (diperbarui == true) {
              final ulang = e.requestOptions
                ..extra['sudahDiulang'] = true
                ..headers['Authorization'] = 'Bearer ${await _penyimpanan.bacaToken()}';
              try {
                return handler.resolve(await this.dio.fetch<dynamic>(ulang));
              } on DioException catch (galat) {
                return handler.next(galat);
              }
            }
            // null = pembaruan gagal karena jaringan: sesi dibiarkan, dicoba lagi nanti.
            if (diperbarui == false) await saatSesiHabis?.call();
          }
          handler.next(e);
        },
      ),
    );
  }

  final Dio dio;
  final PenyimpananSesi _penyimpanan;
  PenangananSesiHabis? saatSesiHabis;
  final CacheLokal? cache;
  final PemantauJaringan? jaringan;
  final JamServer? jamServer;
  Future<bool?>? _pembaruan;

  /// Beberapa permintaan yang bersamaan mendapat 401 berbagi satu pembaruan:
  /// refresh token berputar, jadi menukarnya dua kali membatalkan yang pertama.
  ///
  /// true = token baru tersimpan; false = sesi memang berakhir (login ulang);
  /// null = belum bisa ditentukan (jaringan), sesi dibiarkan.
  Future<bool?> _perbaruiToken() => _pembaruan ??= _tukarRefreshToken().whenComplete(() => _pembaruan = null);

  Future<bool?> _tukarRefreshToken() async {
    final refresh = await _penyimpanan.bacaRefreshToken();
    if (refresh == null) return false;
    try {
      final res = await dio.post<dynamic>('/auth/refresh', data: {'refreshToken': refresh});
      final d = Map<String, dynamic>.from(res.data as Map);
      await _penyimpanan.simpanToken(d['token'] as String);
      await _penyimpanan.simpanRefreshToken(d['refreshToken'] as String);
      return true;
    } on DioException catch (e) {
      final kode = e.response?.statusCode;
      return kode == 401 || kode == 403 ? false : null;
    }
  }

  Future<T> _bungkus<T>(Future<Response<dynamic>> Function() aksi, T Function(dynamic) ubah) async {
    try {
      final res = await aksi();
      return ubah(res.data);
    } on DioException catch (e) {
      throw GalatApi.dari(e);
    }
  }

  /// GET dengan salinan offline. Kunci [kunciCache] harus tetap untuk layar
  /// yang sama walaupun query-nya berubah (mis. rentang tanggal bergeser
  /// tiap hari), supaya salinan kemarin tetap bisa dipakai hari ini.
  Future<T> _ambil<T>(String jalur, Map<String, dynamic>? query, String? kunciCache, T Function(dynamic) ubah) async {
    try {
      final res = await dio.get(jalur, queryParameters: query);
      if (kunciCache != null && cache != null) {
        try {
          await cache!.simpan(kunciCache, res.data);
        } catch (e) {
          debugPrint('Salinan offline $kunciCache gagal disimpan: $e');
        }
      }
      return ubah(res.data);
    } on DioException catch (e) {
      final galat = GalatApi.dari(e);
      final simpanan = kunciCache != null && galat.serverTakTerjangkau ? await cache?.baca(kunciCache) : null;
      if (simpanan == null) throw galat;
      jaringan?.tampilkanSimpanan(simpanan.diambilPada);
      return ubah(simpanan.data);
    }
  }

  Future<Map<String, dynamic>> getObjek(String jalur, {Map<String, dynamic>? query, String? cache}) =>
      _ambil(jalur, query, cache, (d) => Map<String, dynamic>.from(d as Map));

  /// Backend membungkus daftar dalam `{ data: [...] }` (kadang plus `pagination`).
  Future<List<Map<String, dynamic>>> getDaftar(String jalur, {Map<String, dynamic>? query, String? cache}) =>
      _ambil(jalur, query, cache, (d) {
        final isi = d is Map ? d['data'] : d;
        return (isi as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
      });

  /// Pemeriksaan ringan apakah server terjangkau; hasilnya sampai ke
  /// [jaringan] lewat interceptor. Rute /health ada di akar, bukan di /api.
  Future<void> cekServer() async {
    try {
      await dio.getUri(Uri.parse(dio.options.baseUrl).resolve('/health'), options: Options(sendTimeout: const Duration(seconds: 5), receiveTimeout: const Duration(seconds: 5)));
    } on DioException catch (_) {}
  }

  Future<Map<String, dynamic>> post(String jalur, Map<String, dynamic> badan, {Duration? batasWaktu}) => _bungkus(
        () => dio.post(jalur, data: badan, options: batasWaktu == null ? null : Options(sendTimeout: batasWaktu, receiveTimeout: batasWaktu)),
        (d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{},
      );

  Future<Map<String, dynamic>> patch(String jalur, Map<String, dynamic> badan) =>
      _bungkus(() => dio.patch(jalur, data: badan), (d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{});

  Future<Map<String, dynamic>> put(String jalur, Map<String, dynamic> badan) =>
      _bungkus(() => dio.put(jalur, data: badan), (d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{});

  Future<void> delete(String jalur, {Map<String, dynamic>? badan}) =>
      _bungkus(() => dio.delete(jalur, data: badan), (_) {});

  /// Kiriman dari antrean offline. [kunci] menjadi header Idempotency-Key:
  /// kiriman ulang karena jawaban sebelumnya hilang di jaringan menerima
  /// jawaban yang sama dari server, tanpa data kedua.
  Future<Map<String, dynamic>> kirimAntrean(String metode, String jalur, Map<String, dynamic> badan, {required String kunci, Duration? batasWaktu}) =>
      _bungkus(
        () => dio.request(
          jalur,
          data: badan,
          options: Options(method: metode, headers: {'Idempotency-Key': kunci}, sendTimeout: batasWaktu, receiveTimeout: batasWaktu),
        ),
        (d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{},
      );
}

final penyimpananSesiProvider = Provider<PenyimpananSesi>((ref) => PenyimpananSesi());

final klienApiProvider = Provider<KlienApi>((ref) {
  return KlienApi(
    penyimpanan: ref.watch(penyimpananSesiProvider),
    cache: ref.watch(cacheLokalProvider),
    jaringan: ref.read(statusJaringanProvider.notifier),
    jamServer: ref.watch(jamServerProvider),
  );
});
