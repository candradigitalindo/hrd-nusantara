import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../konfigurasi.dart';
import '../penyimpanan/penyimpanan_sesi.dart';
import 'galat_api.dart';

/// Dipanggil saat backend menjawab 401: token kedaluwarsa atau dicabut.
typedef PenangananSesiHabis = Future<void> Function();

/// Klien HTTP tunggal: menempelkan token, menerjemahkan galat, dan menyerah
/// bersih saat sesi habis supaya layar tidak menampilkan "401" mentah.
class KlienApi {
  KlienApi({
    required PenyimpananSesi penyimpanan,
    Dio? dio,
    String? baseUrl,
    this.saatSesiHabis,
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
        onError: (e, handler) async {
          final jalur = e.requestOptions.path;
          // Login yang salah juga 401, tapi itu bukan sesi habis.
          if (e.response?.statusCode == 401 && !jalur.contains('/auth/login')) {
            await saatSesiHabis?.call();
          }
          handler.next(e);
        },
      ),
    );
  }

  final Dio dio;
  final PenyimpananSesi _penyimpanan;
  PenangananSesiHabis? saatSesiHabis;

  Future<T> _bungkus<T>(Future<Response<dynamic>> Function() aksi, T Function(dynamic) ubah) async {
    try {
      final res = await aksi();
      return ubah(res.data);
    } on DioException catch (e) {
      throw GalatApi.dari(e);
    }
  }

  Future<Map<String, dynamic>> getObjek(String jalur, {Map<String, dynamic>? query}) =>
      _bungkus(() => dio.get(jalur, queryParameters: query), (d) => Map<String, dynamic>.from(d as Map));

  /// Backend membungkus daftar dalam `{ data: [...] }` (kadang plus `pagination`).
  Future<List<Map<String, dynamic>>> getDaftar(String jalur, {Map<String, dynamic>? query}) =>
      _bungkus(() => dio.get(jalur, queryParameters: query), (d) {
        final isi = d is Map ? d['data'] : d;
        return (isi as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
      });

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
}

final penyimpananSesiProvider = Provider<PenyimpananSesi>((ref) => PenyimpananSesi());

final klienApiProvider = Provider<KlienApi>((ref) {
  return KlienApi(penyimpanan: ref.watch(penyimpananSesiProvider));
});
