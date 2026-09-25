import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

/// Pembacaan jam monotonik perangkat: [ms] tetap berjalan saat ponsel tidur
/// dan tidak ikut berubah bila jam ponsel diputar. [boot] berbeda setiap kali
/// ponsel dinyalakan ulang (Android); null bila tidak diketahui (iOS).
typedef BacaanMonotonik = ({int ms, String? boot});

const _kanal = MethodChannel('id.nusantara.hrd/integritas');

// Cadangan bila kanal native tidak ada (tes, platform lain): hanya berlaku
// selama proses aplikasi hidup — patokan dari proses sebelumnya ditolak.
final _jamProses = Stopwatch()..start();
final _idProses = 'proses-${Random().nextInt(1 << 32)}';

Future<BacaanMonotonik> bacaMonotonikPerangkat() async {
  try {
    final h = await _kanal.invokeMethod<Map<Object?, Object?>>('jamMonotonik');
    final ms = (h?['monotonikMs'] as num?)?.toInt();
    if (ms != null) {
      final boot = (h?['hitunganBoot'] as num?)?.toInt();
      return (ms: ms, boot: boot == null ? null : 'boot-$boot');
    }
  } catch (_) {}
  return (ms: _jamProses.elapsedMilliseconds, boot: _idProses);
}

/// Perkiraan jam server untuk presensi yang diambil saat offline.
///
/// Setiap jawaban server membawa header Date. Jam itu dicatat bersama jam
/// monotonik perangkat; saat offline, jam server ≈ jam tercatat + selisih
/// jam monotonik sejak itu. Jam ponsel yang diputar mundur tidak
/// memengaruhinya — server memakai perkiraan ini dan menandai selisihnya
/// dengan jam ponsel (backend utils/offlineAttendance.ts).
///
/// Perkiraan tidak diberikan (null → server menandai clock_unverified) bila
/// ponsel sempat dinyalakan ulang sejak patokan dicatat: jam monotonik
/// mulai dari nol lagi. Tanpa hitungan boot (iOS), nyala ulang dikenali dari
/// waktu nyala perangkat menurut jam dinding — yang juga bergeser bila jam
/// ponsel diputar, sehingga perkiraan ikut ditahan. Berhati-hati: lebih baik
/// "tidak terverifikasi" daripada mencatat jam yang salah.
class JamServer {
  JamServer({Future<Directory> Function()? folderInduk, Future<BacaanMonotonik> Function()? bacaMonotonik, DateTime Function()? jamDinding})
      : _folderInduk = folderInduk ?? getApplicationSupportDirectory,
        _bacaMonotonik = bacaMonotonik ?? bacaMonotonikPerangkat,
        _jamDinding = jamDinding ?? DateTime.now;

  static const catatPalingSering = Duration(minutes: 1);
  static const umurPatokanMaks = Duration(days: 30);
  static const toleransiNyalaUlang = Duration(minutes: 2);

  final Future<Directory> Function() _folderInduk;
  final Future<BacaanMonotonik> Function() _bacaMonotonik;
  final DateTime Function() _jamDinding;
  Map<String, dynamic>? _patokan;
  bool _dimuat = false;

  Future<File> _berkas() async => File('${(await _folderInduk()).path}/jam-server.json');

  Future<Map<String, dynamic>?> _muat() async {
    if (_dimuat) return _patokan;
    _dimuat = true;
    try {
      final f = await _berkas();
      if (await f.exists()) _patokan = jsonDecode(await f.readAsString()) as Map<String, dynamic>;
    } catch (_) {}
    return _patokan;
  }

  /// Dipanggil klien API untuk setiap jawaban server yang membawa jam.
  Future<void> catat(DateTime waktuServer) async {
    try {
      final m = await _bacaMonotonik();
      final lama = await _muat();
      if (lama != null && lama['boot'] == m.boot && m.ms - (lama['mono'] as int) < catatPalingSering.inMilliseconds && m.ms >= (lama['mono'] as int)) {
        return;
      }
      _patokan = {
        'server': waktuServer.millisecondsSinceEpoch,
        'mono': m.ms,
        'boot': m.boot,
        'nyala': _jamDinding().millisecondsSinceEpoch - m.ms,
      };
      await (await _berkas()).writeAsString(jsonEncode(_patokan));
    } catch (e) {
      debugPrint('Jam server tidak tercatat: $e');
    }
  }

  /// Perkiraan jam server sekarang, atau null bila tidak bisa dipercaya.
  Future<DateTime?> perkiraan() async {
    final p = await _muat();
    if (p == null) return null;
    final m = await _bacaMonotonik();
    final monoPatokan = p['mono'] as int;
    if (m.boot != p['boot'] || m.ms < monoPatokan || m.ms - monoPatokan > umurPatokanMaks.inMilliseconds) return null;
    if (m.boot == null) {
      final nyala = _jamDinding().millisecondsSinceEpoch - m.ms;
      if ((nyala - (p['nyala'] as int)).abs() > toleransiNyalaUlang.inMilliseconds) return null;
    }
    return DateTime.fromMillisecondsSinceEpoch((p['server'] as int) + m.ms - monoPatokan, isUtc: true);
  }

  /// Bukti waktu untuk field `offline` presensi (lihat backend
  /// attendanceSchema.offlineSchema), diambil saat presensi dilakukan.
  Future<Map<String, dynamic>> bukti({DateTime? waktuGps}) async {
    final server = await perkiraan();
    return {
      'capturedAt': isoMilidetik(_jamDinding()),
      'serverTimeEstimate': server == null ? null : isoMilidetik(server),
      'gpsTime': waktuGps == null ? null : isoMilidetik(waktuGps),
    };
  }
}

/// ISO 8601 UTC dengan presisi milidetik, seperti Date.toISOString() di server.
String isoMilidetik(DateTime t) => DateTime.fromMillisecondsSinceEpoch(t.millisecondsSinceEpoch, isUtc: true).toIso8601String();

final jamServerProvider = Provider<JamServer>((ref) => JamServer());
