import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../core/api/galat_api.dart';
import '../../core/api/klien_api.dart';
import '../../core/api/status_jaringan.dart';
import '../../core/penyimpanan/cache_lokal.dart';
import '../auth/sesi_provider.dart';
import '../presensi/repo_presensi.dart';
import 'repo_pemantauan.dart';

/// Posisi berkala. Di Android lewat layanan latar depan geolocator — ada
/// notifikasi tetap "Pemantauan lokasi aktif" selama berjalan, dan
/// pengambilan tetap jalan saat aplikasi di latar. Di tes diganti.
typedef SumberPosisi = Stream<Position> Function(int intervalMenit);

Stream<Position> posisiBerkala(int menit) => Geolocator.getPositionStream(
      locationSettings: switch (defaultTargetPlatform) {
        TargetPlatform.android => AndroidSettings(
            accuracy: LocationAccuracy.high,
            distanceFilter: 0,
            intervalDuration: Duration(minutes: menit),
            foregroundNotificationConfig: ForegroundNotificationConfig(
              notificationTitle: 'Pemantauan lokasi aktif',
              notificationText: 'HRD Nusantara mengirim lokasi Anda setiap $menit menit.',
              notificationChannelName: 'Pemantauan lokasi',
              enableWakeLock: true,
              setOngoing: true,
            ),
          ),
        TargetPlatform.iOS => AppleSettings(
            accuracy: LocationAccuracy.high,
            distanceFilter: 0,
            pauseLocationUpdatesAutomatically: false,
            showBackgroundLocationIndicator: true,
            allowBackgroundLocationUpdates: true,
          ),
        _ => const LocationSettings(accuracy: LocationAccuracy.high),
      },
    );

final sumberPosisiProvider = Provider<SumberPosisi>((ref) => posisiBerkala);

/// Izin lokasi dengan kode yang sama dengan backend (trackingStatusSchema).
class IzinLokasi {
  const IzinLokasi();

  Future<String> periksa() async {
    if (!await Geolocator.isLocationServiceEnabled()) return 'service_off';
    return _kode(await Geolocator.checkPermission());
  }

  Future<String> minta() async {
    var izin = await Geolocator.checkPermission();
    if (izin == LocationPermission.denied) izin = await Geolocator.requestPermission();
    return _kode(izin);
  }

  static String _kode(LocationPermission izin) => switch (izin) {
        LocationPermission.always => 'granted_always',
        LocationPermission.whileInUse => 'granted_while_in_use',
        LocationPermission.deniedForever => 'denied_forever',
        _ => 'denied',
      };
}

final izinLokasiProvider = Provider<IzinLokasi>((ref) => const IzinLokasi());

class StatusPemantauan {
  const StatusPemantauan({this.konfigurasi, this.setuju, this.izin, this.berjalan = false, this.tertunda = 0, this.terakhirDiambil, this.ditunda = false});

  /// null = belum diketahui (belum pernah dimuat).
  final KonfigurasiPemantauan? konfigurasi;
  final bool? setuju;
  final String? izin;
  final bool berjalan;

  /// Titik yang belum sampai ke server (mis. ponsel offline).
  final int tertunda;
  final DateTime? terakhirDiambil;

  /// Pengguna memilih "Nanti" pada pemberitahuan; ditanya lagi saat aplikasi dibuka ulang.
  final bool ditunda;

  bool get aktif => konfigurasi?.aktif == true;
  bool get perluPersetujuan => aktif && setuju == false && !ditunda;
  bool get izinDitolak => izin == 'denied' || izin == 'denied_forever' || izin == 'service_off';

  StatusPemantauan salin({KonfigurasiPemantauan? konfigurasi, bool? setuju, String? izin, bool? berjalan, int? tertunda, DateTime? terakhirDiambil, bool? ditunda}) => StatusPemantauan(
        konfigurasi: konfigurasi ?? this.konfigurasi,
        setuju: setuju ?? this.setuju,
        izin: izin ?? this.izin,
        berjalan: berjalan ?? this.berjalan,
        tertunda: tertunda ?? this.tertunda,
        terakhirDiambil: terakhirDiambil ?? this.terakhirDiambil,
        ditunda: ditunda ?? this.ditunda,
      );
}

/// Pemantauan Lokasi di ponsel: berjalan hanya bila Super Admin
/// mengaktifkannya, karyawan sudah membaca pemberitahuannya (setuju), dan
/// izin lokasi diberikan — plus, pada mode "selama bekerja", selama presensi
/// hari ini masih terbuka.
///
/// Titik diambil tiap `intervalMenit`, disimpan terenkripsi di ponsel
/// (CacheLokal), lalu dikirim berkelompok; yang terkumpul saat offline
/// dikirim begitu tersambung. Server mengabaikan kiriman ulang titik yang sama.
class PemantauLokasi extends Notifier<StatusPemantauan> {
  static const _kunciBuffer = 'pemantauan-buffer';
  static const bufferMaks = 2000;
  static const kirimSekaligus = 200;

  StreamSubscription<Position>? _langganan;
  int? _intervalBerjalan;
  DateTime? _terakhir;
  bool _mengirim = false;
  bool _dibuang = false;
  String? _statusTerlapor;
  Future<void> _antrian = Future.value();

  /// Operasi buffer satu per satu: titik baru dan pengiriman tidak saling timpa.
  Future<T> _berurutan<T>(Future<T> Function() kerja) {
    final hasil = _antrian.then((_) => kerja());
    _antrian = hasil.then((_) {}, onError: (_) {});
    return hasil;
  }

  @override
  StatusPemantauan build() {
    ref.listen(penggunaProvider.select((p) => p?.id), (_, _) => segarkan());
    ref.listen(sambunganProvider, (_, _) => segarkan());
    // Mode "selama bekerja": check-in/out langsung menyalakan/mematikan.
    ref.listen(presensiHariIniProvider.select((p) => p.value?.masihTerbuka), (_, _) {
      if (state.konfigurasi?.selamaBekerja == true) segarkan();
    });
    final siklus = AppLifecycleListener(onResume: segarkan);
    ref.onDispose(() {
      _dibuang = true;
      _langganan?.cancel();
      siklus.dispose();
    });
    Future.microtask(segarkan);
    return const StatusPemantauan();
  }

  /// Membaca ulang pengaturan, persetujuan, dan izin, lalu menyalakan atau
  /// mematikan pengambilan lokasi sesuai hasilnya.
  Future<void> segarkan() async {
    if (_dibuang) return;
    final pengguna = ref.read(penggunaProvider);
    if (pengguna == null) {
      await _berhenti();
      if (!_dibuang) state = const StatusPemantauan();
      return;
    }
    KonfigurasiPemantauan? konfigurasi = state.konfigurasi;
    try {
      konfigurasi = await ref.read(repoPemantauanProvider).konfigurasi();
    } catch (e) {
      debugPrint('Pengaturan pemantauan tidak terbaca: $e');
    }
    if (_dibuang) return;
    bool setuju;
    String izin;
    try {
      setuju = await ref.read(penyimpananSesiProvider).bacaSetujuPantau(pengguna.id);
      izin = await ref.read(izinLokasiProvider).periksa();
    } catch (e) {
      // Keystore atau layanan lokasi tak terbaca: jangan jalan, jangan ikut rusak.
      debugPrint('Keadaan pemantauan tidak terbaca: $e');
      await _berhenti();
      return;
    }
    if (_dibuang) return;
    state = state.salin(konfigurasi: konfigurasi, setuju: setuju, izin: izin);
    await _laporkanStatus();
    if (_dibuang) return;

    final k = konfigurasi;
    final bekerja = k != null && k.selamaBekerja ? ref.read(presensiHariIniProvider).value?.masihTerbuka == true : true;
    if (k != null && k.aktif && setuju && bekerja && (izin == 'granted_always' || izin == 'granted_while_in_use')) {
      await _mulai(k.intervalMenit);
    } else {
      await _berhenti();
    }
    if (!_dibuang) await kirimTertunda();
  }

  /// Karyawan menyatakan telah membaca pemberitahuan; izin lokasi diminta.
  Future<void> setujui() async {
    final pengguna = ref.read(penggunaProvider);
    if (pengguna == null) return;
    await ref.read(penyimpananSesiProvider).simpanSetujuPantau(pengguna.id, true);
    final izin = await ref.read(izinLokasiProvider).minta();
    if (_dibuang) return;
    state = state.salin(setuju: true, izin: izin, ditunda: false);
    await segarkan();
  }

  void tunda() => state = state.salin(ditunda: true);

  Future<void> _mulai(int interval) async {
    if (_langganan != null && _intervalBerjalan == interval) return;
    await _langganan?.cancel();
    _intervalBerjalan = interval;
    _langganan = ref.read(sumberPosisiProvider)(interval).listen(
      _diterima,
      onError: (Object e) => debugPrint('Posisi pemantauan gagal dibaca: $e'),
    );
    if (!_dibuang) state = state.salin(berjalan: true);
  }

  Future<void> _berhenti() async {
    await _langganan?.cancel();
    _langganan = null;
    _intervalBerjalan = null;
    if (!_dibuang && state.berjalan) state = state.salin(berjalan: false);
  }

  Future<void> _diterima(Position p) async {
    final interval = _intervalBerjalan;
    if (interval == null || _dibuang) return;
    // Sebagian ponsel mengirim lebih sering dari yang diminta (dan iOS tidak
    // mengenal interval): cukup satu titik per interval.
    if (_terakhir != null && p.timestamp.difference(_terakhir!) < Duration(minutes: interval) - const Duration(seconds: 30)) return;
    _terakhir = p.timestamp;
    final titik = TitikLokasi(latitude: p.latitude, longitude: p.longitude, waktu: p.timestamp, akurasiMeter: p.accuracy, palsu: p.isMocked);
    final jumlah = await _berurutan(() async {
      final buffer = [...await _bacaBuffer(), titik];
      if (_dibuang) return 0;
      final dipotong = buffer.length > bufferMaks ? buffer.sublist(buffer.length - bufferMaks) : buffer;
      await ref.read(cacheLokalProvider).simpan(_kunciBuffer, dipotong.map((t) => t.keJson()).toList());
      return dipotong.length;
    });
    if (_dibuang) return;
    state = state.salin(tertunda: jumlah, terakhirDiambil: p.timestamp);
    await kirimTertunda();
  }

  Future<List<TitikLokasi>> _bacaBuffer() async {
    if (_dibuang) return [];
    final isi = (await ref.read(cacheLokalProvider).baca(_kunciBuffer))?.data;
    return isi is List ? isi.map((e) => TitikLokasi.dariJson(Map<String, dynamic>.from(e as Map))).toList() : [];
  }

  /// Mengirim titik yang terkumpul, berkelompok, sampai habis atau gagal.
  Future<void> kirimTertunda() async {
    if (_dibuang || _mengirim || ref.read(penggunaProvider) == null) return;
    _mengirim = true;
    try {
      while (!_dibuang) {
        final kelompok = (await _berurutan(_bacaBuffer)).take(kirimSekaligus).toList();
        if (kelompok.isEmpty) break;
        Map<String, dynamic> jawaban = const {};
        try {
          jawaban = await ref.read(repoPemantauanProvider).kirim(kelompok);
        } on GalatApi catch (g) {
          // Tak terjangkau: coba lagi saat tersambung. Ditolak (mis. titik
          // rusak): buang kelompok ini supaya antrean tidak macet selamanya.
          if (g.serverTakTerjangkau || g.kodeHttp == 401 || g.kodeHttp == 429) break;
        }
        if (_dibuang) break;
        final terkirim = kelompok.map((t) => t.waktu).toSet();
        final sisa = await _berurutan(() async {
          final buffer = (await _bacaBuffer()).where((t) => !terkirim.contains(t.waktu)).toList();
          if (_dibuang) return buffer.length;
          await ref.read(cacheLokalProvider).simpan(_kunciBuffer, buffer.map((t) => t.keJson()).toList());
          return buffer.length;
        });
        if (!_dibuang) state = state.salin(tertunda: sisa);
        if (jawaban['enabled'] == false) {
          // Dimatikan Super Admin sejak terakhir dibaca.
          unawaited(segarkan());
          break;
        }
      }
    } finally {
      _mengirim = false;
    }
  }

  Future<void> _laporkanStatus() async {
    if (_dibuang) return;
    final s = state;
    final izin = s.izin;
    if (s.setuju == null || izin == null) return;
    final kunci = '${s.setuju}:$izin';
    if (kunci == _statusTerlapor) return;
    try {
      await ref.read(repoPemantauanProvider).laporkanStatus(
            setuju: s.setuju!,
            izin: izin,
            platform: defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android',
          );
      _statusTerlapor = kunci;
    } catch (e) {
      debugPrint('Status pemantauan belum terlapor: $e');
    }
  }
}

final pemantauLokasiProvider = NotifierProvider<PemantauLokasi, StatusPemantauan>(PemantauLokasi.new);
