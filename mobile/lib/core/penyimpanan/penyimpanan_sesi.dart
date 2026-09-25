import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Token JWT dan data pengguna disimpan di penyimpanan aman perangkat
/// (Keychain di iOS, Keystore di Android), bukan SharedPreferences biasa —
/// token yang bocor sama saja dengan password yang bocor.
class PenyimpananSesi {
  PenyimpananSesi([FlutterSecureStorage? storage]) : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;
  static const _kunciToken = 'hrd_token';
  static const _kunciRefresh = 'hrd_refresh';
  static const _kunciPengguna = 'hrd_pengguna';
  static const _kunciTokenPush = 'hrd_token_push';
  static const _kunciCache = 'hrd_kunci_cache';
  static const _kunciAntrean = 'hrd_kunci_antrean';
  static const _awalanSetujuPantau = 'hrd_setuju_pantau_';

  Future<String?> bacaToken() => _storage.read(key: _kunciToken);
  Future<void> simpanToken(String token) => _storage.write(key: _kunciToken, value: token);

  /// Refresh token sesi perangkat: menukar token akses yang kedaluwarsa
  /// tanpa login ulang (lihat KlienApi).
  Future<String?> bacaRefreshToken() => _storage.read(key: _kunciRefresh);
  Future<void> simpanRefreshToken(String? token) =>
      token == null ? _storage.delete(key: _kunciRefresh) : _storage.write(key: _kunciRefresh, value: token);

  Future<Map<String, dynamic>?> bacaPengguna() async {
    final raw = await _storage.read(key: _kunciPengguna);
    if (raw == null) return null;
    try {
      return jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  Future<void> simpanPengguna(Map<String, dynamic> pengguna) =>
      _storage.write(key: _kunciPengguna, value: jsonEncode(pengguna));

  Future<String?> bacaTokenPush() => _storage.read(key: _kunciTokenPush);
  Future<void> simpanTokenPush(String? token) =>
      token == null ? _storage.delete(key: _kunciTokenPush) : _storage.write(key: _kunciTokenPush, value: token);

  /// Kunci AES untuk cache data offline (lihat cache_lokal.dart), base64.
  Future<String?> bacaKunciCache() => _storage.read(key: _kunciCache);
  Future<void> simpanKunciCache(String? kunci) =>
      kunci == null ? _storage.delete(key: _kunciCache) : _storage.write(key: _kunciCache, value: kunci);

  /// Kunci AES antrean kirim. Sengaja TIDAK ikut dihapus saat keluar: data
  /// yang belum terkirim tetap bisa dikirim setelah pemiliknya masuk lagi.
  Future<String?> bacaKunciAntrean() => _storage.read(key: _kunciAntrean);
  Future<void> simpanKunciAntrean(String? kunci) =>
      kunci == null ? _storage.delete(key: _kunciAntrean) : _storage.write(key: _kunciAntrean, value: kunci);

  /// Persetujuan Pemantauan Lokasi, per akun (ponsel bisa dipakai bergantian).
  Future<bool> bacaSetujuPantau(String karyawanId) async => (await _storage.read(key: '$_awalanSetujuPantau$karyawanId')) != null;
  Future<void> simpanSetujuPantau(String karyawanId, bool setuju) => setuju
      ? _storage.write(key: '$_awalanSetujuPantau$karyawanId', value: DateTime.now().toUtc().toIso8601String())
      : _storage.delete(key: '$_awalanSetujuPantau$karyawanId');

  Future<void> hapusSemua() async {
    await _storage.delete(key: _kunciToken);
    await _storage.delete(key: _kunciRefresh);
    await _storage.delete(key: _kunciPengguna);
  }
}
