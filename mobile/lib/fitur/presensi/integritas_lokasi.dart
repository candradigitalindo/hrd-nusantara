import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'layanan_lokasi.dart';

/// Sinyal-sinyal keaslian lokasi yang dikumpulkan ponsel sebelum presensi.
///
/// Tidak ada satu sinyal yang cukup: aplikasi lokasi palsu bisa menyembunyikan
/// penanda mock, ponsel di-root bisa memalsukan apa saja. Ponsel mengumpulkan
/// semuanya, memblokir yang jelas curang, dan mengirim laporan lengkap ke
/// server — server yang membuat keputusan akhir dan menyimpannya untuk HR.
class LaporanIntegritas {
  const LaporanIntegritas({
    required this.mockLocation,
    required this.mockApps,
    required this.rooted,
    required this.emulator,
    required this.developerOptions,
    this.networkDistanceMeters,
    this.positionAgeSeconds,
    this.locationSimulated,
  });

  /// Sistem operasi menandai posisi berasal dari penyedia mock (Android).
  final bool mockLocation;
  /// Aplikasi lokasi palsu yang terpasang (nama paket).
  final List<String> mockApps;
  final bool rooted;
  final bool emulator;
  final bool developerOptions;
  /// Jarak GPS ke lokasi jaringan seluler/Wi-Fi terakhir; null bila tak ada.
  final double? networkDistanceMeters;
  /// Umur pembacaan GPS; posisi tua = bukan pembacaan saat ini.
  final double? positionAgeSeconds;
  /// iOS 15+: lokasi disimulasikan perangkat lunak / aksesori luar.
  final bool? locationSimulated;

  /// Yang memblokir di ponsel — sama dengan aturan server (BLOCKING_FLAGS).
  List<String> get alasanBlokir => [
        if (mockLocation || locationSimulated == true) 'Lokasi ditandai palsu oleh sistem operasi',
        if (mockApps.isNotEmpty) 'Aplikasi lokasi palsu terpasang: ${mockApps.take(3).join(', ')}',
        if (rooted) Platform.isIOS ? 'Perangkat jailbreak' : 'Perangkat di-root',
      ];

  bool get diblokir => alasanBlokir.isNotEmpty;

  /// Peringatan yang tidak memblokir tapi akan ditandai server untuk HR.
  List<String> get peringatan => [
        if (emulator) 'Berjalan di emulator',
        if (developerOptions) 'Opsi pengembang aktif',
        if ((networkDistanceMeters ?? 0) > 1500) 'GPS jauh dari lokasi jaringan seluler',
        if ((positionAgeSeconds ?? 0) > 120) 'Posisi GPS bukan pembacaan baru',
      ];

  Map<String, dynamic> keJson() => {
        'mockLocation': mockLocation || locationSimulated == true,
        'mockApps': mockApps,
        'rooted': rooted,
        'emulator': emulator,
        'developerOptions': developerOptions,
        'networkDistanceMeters': networkDistanceMeters,
        'positionAgeSeconds': positionAgeSeconds,
        'platform': Platform.isIOS ? 'ios' : 'android',
      };
}

/// Hasil mentah dari kode native; dipisah supaya bisa diuji tanpa perangkat.
class SinyalNative {
  const SinyalNative({this.developerOptions = false, this.emulator = false, this.rooted = false, this.mockApps = const [], this.networkLocation, this.locationSimulated});
  final bool developerOptions;
  final bool emulator;
  final bool rooted;
  final List<String> mockApps;
  /// {latitude, longitude, accuracy, ageSeconds, mocked}
  final Map<String, dynamic>? networkLocation;
  final bool? locationSimulated;

  factory SinyalNative.dariMap(Map<Object?, Object?> m) => SinyalNative(
        developerOptions: m['developerOptions'] == true,
        emulator: m['emulator'] == true,
        rooted: m['rooted'] == true,
        mockApps: ((m['mockApps'] as List?) ?? const []).map((e) => e.toString()).toList(),
        networkLocation: m['networkLocation'] is Map ? Map<String, dynamic>.from(m['networkLocation'] as Map) : null,
        locationSimulated: m['locationSimulated'] is bool ? m['locationSimulated'] as bool : null,
      );
}

/// Menggabungkan posisi GPS dan sinyal native menjadi laporan. Murni.
LaporanIntegritas susunLaporan({required PosisiSaatIni posisi, required SinyalNative native, DateTime? sekarang}) {
  final kini = sekarang ?? DateTime.now();
  double? jarakJaringan;
  final n = native.networkLocation;
  if (n != null && n['latitude'] is num && n['longitude'] is num) {
    // Lokasi jaringan yang terlalu tua tidak layak jadi pembanding.
    final umur = (n['ageSeconds'] as num?)?.toDouble() ?? 0;
    if (umur <= 600) jarakJaringan = jarakMeter(posisi.latitude, posisi.longitude, (n['latitude'] as num).toDouble(), (n['longitude'] as num).toDouble());
  }
  final umurPosisi = posisi.waktu == null ? null : kini.difference(posisi.waktu!).inMilliseconds / 1000.0;
  return LaporanIntegritas(
    mockLocation: posisi.mocked || (n?['mocked'] == true),
    mockApps: native.mockApps,
    rooted: native.rooted,
    emulator: native.emulator,
    developerOptions: native.developerOptions,
    networkDistanceMeters: jarakJaringan,
    positionAgeSeconds: umurPosisi == null ? null : (umurPosisi < 0 ? 0 : umurPosisi),
    locationSimulated: native.locationSimulated,
  );
}

const _kanal = MethodChannel('id.nusantara.hrd/integritas');

/// Memeriksa keaslian lokasi. Kegagalan kode native tidak menghentikan
/// presensi — laporannya saja yang lebih tipis, dan server menandainya.
Future<LaporanIntegritas> periksaIntegritas(PosisiSaatIni posisi) async {
  SinyalNative native = const SinyalNative();
  try {
    final hasil = await _kanal.invokeMethod<Map<Object?, Object?>>('periksa').timeout(const Duration(seconds: 10));
    if (hasil != null) native = SinyalNative.dariMap(hasil);
  } catch (e) {
    debugPrint('Sinyal integritas native tidak tersedia: $e');
  }
  return susunLaporan(posisi: posisi, native: native);
}
