import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Hal yang perlu diatur karyawan di ponsel agar Pemantauan Lokasi bertahan
/// saat aplikasi ditutup (Android).
enum LangkahPenyiapan { notifikasi, baterai, sepanjangWaktu }

/// Keadaan pengaturan Android yang menentukan apakah pemantauan bertahan.
class StatusPenyiapan {
  const StatusPenyiapan({required this.notifikasi, required this.penghematBaterai, this.jendelaBoot = false});

  /// Notifikasi aplikasi diizinkan (di Android 13+ perlu persetujuan sendiri).
  final bool notifikasi;

  /// true = aplikasi dikecualikan dari pembatasan baterai — juga berarti
  /// Android mengizinkan layanan lokasi dimulai dari latar.
  final bool penghematBaterai;

  /// Mesin baru dinyalakan siaran boot dan jendela singkatnya masih terbuka:
  /// layanan lokasi boleh dimulai dari latar walau belum bebas penghemat baterai.
  final bool jendelaBoot;

  /// Yang masih kurang, urut sesuai urutan menawarkannya. "Sepanjang waktu"
  /// hanya relevan bila izin lokasi baru "saat aplikasi dipakai".
  List<LangkahPenyiapan> kurang(String? izin) => [
        if (!notifikasi) LangkahPenyiapan.notifikasi,
        if (!penghematBaterai) LangkahPenyiapan.baterai,
        if (izin == 'granted_while_in_use') LangkahPenyiapan.sepanjangWaktu,
      ];
}

/// Jembatan ke sisi Android Pemantauan Lokasi (KanalNative.kt): alarm
/// "pemantauan terhenti", pengecualian baterai, dan kabar bahwa layar ditutup.
///
/// Semua panggilan aman di platform lain dan di tes: tidak melempar galat dan
/// tidak melakukan apa pun di luar Android.
class KanalPemantauan {
  const KanalPemantauan();

  static const _kanal = MethodChannel('id.nusantara.hrd/pemantauan');

  bool get didukung => !kIsWeb && Platform.isAndroid;

  /// Aliran lokasi baru dimulai: Android memastikan alarm "terhenti" terpasang
  /// tanpa memajukan batas yang masih berjalan.
  Future<void> mulai(int intervalMenit) => _coba(() => _kanal.invokeMethod<void>('mulai', {'intervalMenit': intervalMenit}));

  /// Titik lokasi diterima. Android memasang ulang alarm; bila tak ada titik
  /// lagi sampai batasnya (satu jam, atau dua kali interval), karyawan
  /// diingatkan lewat notifikasi.
  Future<void> denyut(int intervalMenit) => _coba(() => _kanal.invokeMethod<void>('denyut', {'intervalMenit': intervalMenit}));

  /// Pemantauan dihentikan dengan sengaja: batalkan alarm dan notifikasinya.
  Future<void> berhenti() => _coba(() => _kanal.invokeMethod<void>('berhenti'));

  /// null = tidak diketahui (bukan Android, atau sisi native tak menjawab).
  Future<StatusPenyiapan?> statusPenyiapan() async {
    final j = await _coba(() => _kanal.invokeMapMethod<String, Object?>('statusPenyiapan'));
    if (j == null) return null;
    return StatusPenyiapan(notifikasi: j['notifikasi'] == true, penghematBaterai: j['penghematBaterai'] == true, jendelaBoot: j['jendelaBoot'] == true);
  }

  /// Membuka dialog sistem pengecualian baterai. Hasilnya baru diketahui dari
  /// [statusPenyiapan] setelah aplikasi kembali ke depan.
  Future<bool> mintaPengecualianBaterai() async => await _coba(() => _kanal.invokeMethod<bool>('mintaPengecualianBaterai')) ?? false;

  Future<bool> bukaPengaturanNotifikasi() async => await _coba(() => _kanal.invokeMethod<bool>('bukaPengaturanNotifikasi')) ?? false;

  /// Dialog izin notifikasi Android 13+ (tidak melakukan apa pun di versi lama).
  Future<bool> mintaIzinNotifikasi() async {
    if (!didukung) return false;
    try {
      final plugin = FlutterLocalNotificationsPlugin().resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      return await plugin?.requestNotificationsPermission() ?? false;
    } catch (e) {
      debugPrint('Izin notifikasi tidak bisa diminta: $e');
      return false;
    }
  }

  /// Aplikasi ditutup (diusap / Kembali) padahal mesin Flutter dipertahankan
  /// untuk pemantauan; dipanggil sekali per penutupan.
  void saatAktivitasDitutup(VoidCallback aksi) {
    if (!didukung) return;
    _kanal.setMethodCallHandler((panggilan) async {
      if (panggilan.method == 'aktivitasDitutup') aksi();
    });
  }

  Future<T?> _coba<T>(Future<T?> Function() kerja) async {
    if (!didukung) return null;
    try {
      return await kerja();
    } on MissingPluginException {
      debugPrint('Kanal pemantauan belum terpasang di sisi native');
    } catch (e) {
      // Bantuan tambahan untuk pemantauan; galatnya tidak boleh merusak pemantauan itu sendiri.
      debugPrint('Kanal pemantauan gagal: $e');
    }
    return null;
  }
}

final kanalPemantauanProvider = Provider<KanalPemantauan>((ref) => const KanalPemantauan());
