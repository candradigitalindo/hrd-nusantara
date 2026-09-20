import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Token JWT dan data pengguna disimpan di penyimpanan aman perangkat
/// (Keychain di iOS, Keystore di Android), bukan SharedPreferences biasa —
/// token yang bocor sama saja dengan password yang bocor.
class PenyimpananSesi {
  PenyimpananSesi([FlutterSecureStorage? storage]) : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;
  static const _kunciToken = 'hrd_token';
  static const _kunciPengguna = 'hrd_pengguna';
  static const _kunciTokenPush = 'hrd_token_push';

  Future<String?> bacaToken() => _storage.read(key: _kunciToken);
  Future<void> simpanToken(String token) => _storage.write(key: _kunciToken, value: token);

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

  Future<void> hapusSemua() async {
    await _storage.delete(key: _kunciToken);
    await _storage.delete(key: _kunciPengguna);
  }
}
