import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../core/api/galat_api.dart';
import '../../core/api/klien_api.dart';
import '../../core/api/status_jaringan.dart' show statusJaringanProvider;
import '../../core/penyimpanan/cache_lokal.dart';
import '../auth/sesi_provider.dart';
import '../presensi/repo_presensi.dart';
import 'kanal_pemantauan.dart';
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

  /// Naik dari "saat aplikasi dipakai" ke "Izinkan sepanjang waktu". Geolocator
  /// baru meminta izin latar pada panggilan kedua, setelah izin pertama
  /// diberikan; di Android 11+ itu membuka halaman izin aplikasi di pengaturan
  /// (sistem tidak lagi menampilkan dialognya).
  Future<String> tingkatkan() async {
    var izin = await Geolocator.checkPermission();
    if (izin == LocationPermission.whileInUse) izin = await Geolocator.requestPermission();
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

/// Penyiapan yang masih kurang tidak ditawarkan lagi sebelum selewat jeda ini.
const jedaPenyiapan = Duration(days: 7);

/// Aplikasi sedang tampil di layar. Mesin Flutter yang dinyalakan tanpa layar
/// (siaran boot, lihat BootReceiver.kt) melapor detached; null — platform
/// belum mengabarkan siklus hidup apa pun — juga dianggap tidak tampil.
bool tampilDiLayar(AppLifecycleState? s) => s == AppLifecycleState.resumed || s == AppLifecycleState.inactive;

/// Aliran lokasi yang tidak menghasilkan posisi selama ini dianggap macet.
Duration ambangMacet(int intervalMenit) => Duration(minutes: math.max(5, intervalMenit * 2 + 1));

class StatusPemantauan {
  const StatusPemantauan({
    this.konfigurasi,
    this.setuju,
    this.izin,
    this.berjalan = false,
    this.tertunda = 0,
    this.terakhirDiambil,
    this.ditunda = false,
    this.penyiapan,
    this.penyiapanDitunda = false,
  });

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

  /// Pengaturan Android yang menentukan apakah pemantauan bertahan di latar.
  /// null = belum diketahui, atau bukan Android.
  final StatusPenyiapan? penyiapan;

  /// Penyiapan sudah ditawarkan dalam [jedaPenyiapan] terakhir.
  final bool penyiapanDitunda;

  bool get aktif => konfigurasi?.aktif == true;
  bool get perluPersetujuan => aktif && setuju == false && !ditunda;
  bool get izinDitolak => izin == 'denied' || izin == 'denied_forever' || izin == 'service_off';

  /// Hal yang masih perlu diatur karyawan agar pemantauan bertahan di latar.
  List<LangkahPenyiapan> get langkahKurang => penyiapan?.kurang(izin) ?? const [];

  /// Sesudah persetujuan dan izin lokasi: tawarkan pengaturan yang masih
  /// kurang, paling sering sekali per [jedaPenyiapan].
  bool get perluPenyiapan => aktif && setuju == true && !izinDitolak && !penyiapanDitunda && langkahKurang.isNotEmpty;

  StatusPemantauan salin({
    KonfigurasiPemantauan? konfigurasi,
    bool? setuju,
    String? izin,
    bool? berjalan,
    int? tertunda,
    DateTime? terakhirDiambil,
    bool? ditunda,
    StatusPenyiapan? penyiapan,
    bool? penyiapanDitunda,
  }) =>
      StatusPemantauan(
        konfigurasi: konfigurasi ?? this.konfigurasi,
        setuju: setuju ?? this.setuju,
        izin: izin ?? this.izin,
        berjalan: berjalan ?? this.berjalan,
        tertunda: tertunda ?? this.tertunda,
        terakhirDiambil: terakhirDiambil ?? this.terakhirDiambil,
        ditunda: ditunda ?? this.ditunda,
        penyiapan: penyiapan ?? this.penyiapan,
        penyiapanDitunda: penyiapanDitunda ?? this.penyiapanDitunda,
      );
}

/// Apa yang harus dikerjakan pemantauan setelah keadaannya dibaca.
enum _Putusan {
  /// Jalankan pengambilan lokasi.
  jalan,

  /// Seharusnya jalan tetapi tak bisa (izin/layanan lokasi mati): hentikan
  /// pengambilan, biarkan pengingat "terhenti" agar karyawan diberi tahu.
  tertahan,

  /// Dimatikan dengan sengaja (admin, belum setuju, check-out): hentikan
  /// semuanya, tak ada yang perlu diingatkan.
  henti,

  /// Keadaan belum jelas (pengaturan atau presensi belum terbaca): jangan
  /// ubah apa pun, supaya jeda singkat tidak mematikan pemantauan yang jalan.
  biarkan,
}

/// Pemantauan Lokasi di ponsel: berjalan hanya bila Super Admin
/// mengaktifkannya, karyawan sudah membaca pemberitahuannya (setuju), dan
/// izin lokasi diberikan — plus, pada mode "selama bekerja", selama presensi
/// hari ini masih terbuka.
///
/// Titik diambil tiap `intervalMenit`, disimpan terenkripsi di ponsel
/// (CacheLokal), lalu dikirim berkelompok; yang terkumpul saat offline
/// dikirim begitu tersambung. Server mengabaikan kiriman ulang titik yang sama.
///
/// Di Android, notifier ini hidup di mesin Flutter yang dipertahankan setelah
/// aplikasi ditutup (lihat MesinFlutter.kt), dan bisa dinyalakan tanpa layar
/// setelah ponsel restart. Akibatnya:
/// - dari latar, aliran lokasi baru hanya dimulai bila Android mengizinkannya
///   ([_bolehMulaiDariLatar]); aliran yang sudah jalan tidak diganti;
/// - aliran bisa mati diam-diam, jadi begitu aplikasi tampil aliran yang tak
///   menghasilkan posisi dimulai ulang ([_alirannyaSehat]);
/// - aliran yang dimulai memastikan alarm "pemantauan terhenti" terpasang di
///   sisi native, dan setiap titik menggeser batasnya.
class PemantauLokasi extends Notifier<StatusPemantauan> {
  static const _kunciBuffer = 'pemantauan-buffer';
  static const bufferMaks = 2000;
  static const kirimSekaligus = 200;

  /// Mode "selama bekerja": selama titik masuk, presensi dibaca ulang paling
  /// lama selang ini — check-out dari perangkat lain atau sesi yang ditutup
  /// server mematikan pemantauan tanpa menunggu aplikasi dibuka.
  static const segarkanPresensiTiap = Duration(minutes: 15);

  StreamSubscription<Position>? _langganan;
  int? _intervalBerjalan;
  DateTime? _terakhir;
  bool _mengirim = false;
  bool _dibuang = false;
  String? _statusTerlapor;
  Future<void> _antrian = Future.value();
  Future<void>? _sedangSegarkan;
  bool _segarkanLagi = false;

  /// Keluar akun: putaran berikutnya menghentikan pemantauan dengan sengaja.
  bool _keluarAkun = false;

  // Kesehatan aliran yang sedang jalan (lihat [_alirannyaSehat]).
  DateTime? _mulaiPada;
  DateTime? _posisiTerakhirPada;
  bool _dimulaiDiLatar = false;
  bool _aliranRusak = false;
  bool? _notifikasiSaatMulai;
  DateTime? _presensiDibacaPada;

  KanalPemantauan get _kanal => ref.read(kanalPemantauanProvider);

  /// Operasi buffer satu per satu: titik baru dan pengiriman tidak saling timpa.
  Future<T> _berurutan<T>(Future<T> Function() kerja) {
    final hasil = _antrian.then((_) => kerja());
    _antrian = hasil.then((_) {}, onError: (_) {});
    return hasil;
  }

  @override
  StatusPemantauan build() {
    // Tanpa layar — mesin dari siaran boot, atau aplikasi yang sudah ditutup —
    // Flutter tidak membuat frame, dan Riverpod menunda penyegaran provider
    // turunan (penggunaProvider, sambunganProvider, presensi) beserta
    // pendengarnya sampai frame berikutnya. Maka pemicu yang harus jalan tanpa
    // layar didengarkan langsung pada provider sumbernya, dan nilai yang
    // diperlukan dibaca langsung di dalam putaran.
    ref.listen(sesiProvider, (sebelum, sesudah) {
      // Keluar akun — bukan sesi yang masih dipulihkan saat aplikasi baru
      // dibuka. Dihentikan di dalam putaran, supaya tidak didahului `mulai`
      // dari putaran yang masih berjalan.
      if (sebelum is SesiMasuk && sesudah is SesiKeluar) _keluarAkun = true;
      segarkan();
    });
    ref.listen(penggunaProvider.select((p) => p?.id), (sebelum, sesudah) {
      if (sebelum != null && sesudah == null) _keluarAkun = true;
      _terakhir = null;
      segarkan();
    });
    ref.listen(statusJaringanProvider.select((s) => s.sambungan), (_, _) => segarkan());
    // Mode "selama bekerja": check-in/out langsung menyalakan/mematikan, dan
    // presensi yang selesai dibaca menilai ulang keputusan yang ditunda.
    ref.listen(presensiHariIniProvider.select((p) => (p.isLoading, p.valueOrNull?.masihTerbuka)), (_, _) {
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
  /// mematikan pengambilan lokasi sesuai hasilnya. Panggilan yang datang saat
  /// pembacaan masih berjalan digabung menjadi satu putaran ulang, jadi dua
  /// pemicu yang berdekatan (mis. sesi pulih dan sambungan kembali) tidak
  /// sempat menyalakan dua aliran lokasi sekaligus.
  Future<void> segarkan() {
    if (_dibuang) return Future.value();
    final berjalan = _sedangSegarkan;
    if (berjalan != null) {
      _segarkanLagi = true;
      return berjalan;
    }
    final kerja = _segarkanBerulang().whenComplete(() => _sedangSegarkan = null);
    _sedangSegarkan = kerja;
    return kerja;
  }

  Future<void> _segarkanBerulang() async {
    do {
      _segarkanLagi = false;
      await _segarkanSekali();
    } while (_segarkanLagi && !_dibuang);
  }

  Future<void> _segarkanSekali() async {
    if (_dibuang) return;
    final pengguna = ref.read(penggunaProvider);
    if (pengguna == null) {
      if (_keluarAkun) {
        _keluarAkun = false;
        await _berhenti();
      } else {
        await _hentikanAliran();
      }
      if (!_dibuang) state = const StatusPemantauan();
      return;
    }
    final repo = ref.read(repoPemantauanProvider);
    var konfigurasi = state.konfigurasi;
    var sudahTerbaru = false;
    if (konfigurasi == null && !tampilDiLayar(WidgetsBinding.instance.lifecycleState)) {
      // Putaran pertama mesin tanpa layar (dinyalakan siaran boot): salinan
      // tersimpan dulu, tanpa jaringan — setelah restart sinyal sering belum
      // siap, sedangkan Android hanya memberi jendela singkat untuk memulai
      // layanan lokasi. Pengaturan terbaru menyusul di bawah.
      try {
        konfigurasi = await repo.konfigurasiTersimpan();
      } catch (e) {
        debugPrint('Salinan pengaturan pemantauan tidak terbaca: $e');
      }
    } else {
      // Selain itu pengaturan terbaru dibaca dulu (salinannya bila offline):
      // yang di memori bisa saja sudah diubah Super Admin.
      try {
        konfigurasi = await repo.konfigurasi();
        sudahTerbaru = true;
      } catch (e) {
        debugPrint('Pengaturan pemantauan tidak terbaca: $e');
      }
    }
    if (_dibuang) return;
    bool setuju;
    String izin;
    try {
      setuju = await ref.read(penyimpananSesiProvider).bacaSetujuPantau(pengguna.id);
      izin = await ref.read(izinLokasiProvider).periksa();
    } catch (e) {
      // Keystore atau layanan lokasi tak terbaca: jangan jalan, jangan ikut rusak.
      // Pengingat dibiarkan — ini bukan penghentian yang disengaja.
      debugPrint('Keadaan pemantauan tidak terbaca: $e');
      await _hentikanAliran();
      return;
    }
    final penyiapanDitunda = await _penyiapanDitunda(pengguna.id);
    final penyiapan = await _kanal.statusPenyiapan();
    if (_dibuang) return;
    state = state.salin(konfigurasi: konfigurasi, setuju: setuju, izin: izin, penyiapan: penyiapan, penyiapanDitunda: penyiapanDitunda);
    await _terapkan(konfigurasi, setuju, izin);
    if (_dibuang) return;
    await _laporkanStatus(pengguna.id);
    if (_dibuang) return;

    if (!sudahTerbaru) {
      try {
        final terbaru = await repo.konfigurasi();
        if (_dibuang) return;
        if (terbaru != konfigurasi) {
          state = state.salin(konfigurasi: terbaru);
          await _terapkan(terbaru, setuju, izin);
        }
      } catch (e) {
        debugPrint('Pengaturan pemantauan tidak terbaca: $e');
      }
    }
    if (!_dibuang) await kirimTertunda();
  }

  Future<void> _terapkan(KonfigurasiPemantauan? k, bool setuju, String izin) async {
    if (k != null && k.aktif && setuju && k.selamaBekerja) {
      // Presensi dibaca dan ditunggu langsung (lihat [build]).
      try {
        await ref.read(presensiHariIniProvider.future).timeout(const Duration(seconds: 30));
      } catch (e) {
        debugPrint('Presensi hari ini tidak terbaca: $e');
      }
      if (_dibuang) return;
    }
    switch (_putuskan(k, setuju, izin)) {
      case _Putusan.jalan:
        await _mulai(k!.intervalMenit, izin: izin);
      case _Putusan.tertahan:
        await _hentikanAliran();
      case _Putusan.henti:
        await _berhenti();
      case _Putusan.biarkan:
        break;
    }
  }

  _Putusan _putuskan(KonfigurasiPemantauan? k, bool setuju, String izin) {
    if (k == null) return _Putusan.biarkan;
    if (!k.aktif || !setuju) return _Putusan.henti;
    if (k.selamaBekerja) {
      final presensi = ref.read(presensiHariIniProvider);
      // Belum terbaca, atau sedang dibaca ulang — nilai yang terbawa bisa basi,
      // mis. kosong dari sebelum sesi pulih: jangan diputuskan dulu. Selesainya
      // pembacaan memicu putaran baru (lihat [build]).
      if (!presensi.hasValue || presensi.isLoading) return _Putusan.biarkan;
      if (presensi.valueOrNull?.masihTerbuka != true) return _Putusan.henti;
    }
    return izin == 'granted_always' || izin == 'granted_while_in_use' ? _Putusan.jalan : _Putusan.tertahan;
  }

  /// Penyiapan sudah ditawarkan dalam [jedaPenyiapan] terakhir. Gagal dibaca
  /// dianggap belum: kunci ini tidak boleh ikut menghentikan pemantauan.
  Future<bool> _penyiapanDitunda(String idPengguna) async {
    try {
      final terakhir = await ref.read(penyimpananSesiProvider).bacaPenyiapanTerakhir(idPengguna);
      return terakhir != null && DateTime.now().difference(terakhir) < jedaPenyiapan;
    } catch (e) {
      debugPrint('Waktu penyiapan tidak terbaca: $e');
      return false;
    }
  }

  /// Karyawan menyatakan telah membaca pemberitahuan; izin lokasi diminta.
  Future<void> setujui() async {
    final pengguna = ref.read(penggunaProvider);
    if (pengguna == null) return;
    await ref.read(penyimpananSesiProvider).simpanSetujuPantau(pengguna.id, true);
    // Persetujuan dicatat sebelum dialog izin sistem muncul: saat aplikasi
    // kembali ke depan, pemberitahuan tidak boleh tampil lagi.
    state = state.salin(setuju: true, ditunda: false);
    final izin = await ref.read(izinLokasiProvider).minta();
    if (_dibuang) return;
    state = state.salin(izin: izin);
    await segarkan();
  }

  void tunda() => state = state.salin(ditunda: true);

  /// Layar aplikasi ditutup padahal mesin Flutter dipertahankan untuk
  /// pemantauan. Pertanyaan yang tadi ditunda diajukan lagi saat aplikasi
  /// dibuka berikutnya, seperti ketika prosesnya ikut berakhir.
  void aktivitasDitutup() => state = state.salin(ditunda: false);

  /// Dialog penyiapan sedang ditampilkan: jangan tawarkan lagi selama [jedaPenyiapan].
  Future<void> catatPenyiapanDitampilkan() async {
    final pengguna = ref.read(penggunaProvider);
    if (pengguna == null || _dibuang) return;
    state = state.salin(penyiapanDitunda: true);
    try {
      await ref.read(penyimpananSesiProvider).simpanPenyiapanTerakhir(pengguna.id, DateTime.now());
    } catch (e) {
      debugPrint('Waktu penyiapan tidak tersimpan: $e');
    }
  }

  /// Hanya membaca ulang izin dan pengaturan Android — untuk menyegarkan
  /// dialog penyiapan begitu karyawan kembali dari layar sistem.
  Future<void> segarkanPenyiapan() async {
    if (_dibuang) return;
    try {
      final izin = await ref.read(izinLokasiProvider).periksa();
      final penyiapan = await _kanal.statusPenyiapan();
      if (!_dibuang) state = state.salin(izin: izin, penyiapan: penyiapan);
    } catch (e) {
      debugPrint('Penyiapan pemantauan tidak terbaca: $e');
    }
  }

  Future<void> _mulai(int interval, {required String izin}) async {
    final diLayar = tampilDiLayar(WidgetsBinding.instance.lifecycleState);
    if (_alirannyaSehat(interval, diLayar: diLayar)) return;
    // Dari latar (aplikasi ditutup, atau mesin menyala tanpa layar setelah
    // restart) aliran yang masih jalan dibiarkan — memulainya ulang bisa
    // ditolak Android, lalu aliran diam tanpa titik; interval baru berlaku
    // begitu aplikasi dibuka — dan aliran baru hanya dimulai bila diizinkan.
    if (!diLayar && ((_langganan != null && !_aliranRusak) || !_bolehMulaiDariLatar(izin))) return;
    await _langganan?.cancel();
    _langganan = null;
    if (_dibuang) return;
    _intervalBerjalan = interval;
    _mulaiPada = DateTime.now();
    _posisiTerakhirPada = null;
    _dimulaiDiLatar = !diLayar;
    _aliranRusak = false;
    _notifikasiSaatMulai = state.penyiapan?.notifikasi;
    _langganan = ref.read(sumberPosisiProvider)(interval).listen(
      _diterima,
      onError: (Object e) {
        debugPrint('Posisi pemantauan gagal dibaca: $e');
        _aliranRusak = true;
      },
      onDone: () => _aliranRusak = true,
    );
    if (!_dibuang) state = state.salin(berjalan: true);
    // Bila tak ada titik sampai batasnya, karyawan diingatkan.
    unawaited(_kanal.mulai(interval));
  }

  /// Aliran yang sedang jalan masih bisa dipercaya untuk [interval]. Aliran
  /// bisa mati diam-diam — layanan latar depan ditolak Android saat dimulai
  /// dari latar, atau pengaturan lokasi ponsel tidak memenuhi — tanpa posisi
  /// dan tanpa galat. Di latar tidak dinilai ulang; begitu aplikasi tampil,
  /// aliran yang macet dimulai ulang, begitu pula aliran yang dimulai sebelum
  /// izin notifikasi diberikan: notifikasi "Pemantauan lokasi aktif"-nya tidak
  /// pernah muncul di Android 13+ walau izinnya kemudian diberikan.
  bool _alirannyaSehat(int interval, {required bool diLayar}) {
    if (_langganan == null || _aliranRusak || _intervalBerjalan != interval) return false;
    if (!diLayar) return true;
    if (_notifikasiSaatMulai == false && state.penyiapan?.notifikasi == true) return false;
    final posisi = _posisiTerakhirPada;
    if (posisi == null && _dimulaiDiLatar) return false;
    return DateTime.now().difference(posisi ?? _mulaiPada!) <= ambangMacet(interval);
  }

  /// Di latar Android hanya mengambil lokasi dengan izin sepanjang waktu, dan
  /// (Android 12+) hanya mengizinkan layanan latar depan dimulai bila aplikasi
  /// bebas penghemat baterai atau baru dibangunkan siaran boot. Di luar
  /// Android (status penyiapan tidak ada) cukup izinnya.
  bool _bolehMulaiDariLatar(String izin) {
    if (izin != 'granted_always') return false;
    final p = state.penyiapan;
    return p == null || p.penghematBaterai || p.jendelaBoot;
  }

  /// Menghentikan pengambilan lokasi, pengingat dibiarkan.
  Future<void> _hentikanAliran() async {
    await _langganan?.cancel();
    _langganan = null;
    _intervalBerjalan = null;
    _aliranRusak = false;
    if (!_dibuang && state.berjalan) state = state.salin(berjalan: false);
  }

  /// Menghentikan pemantauan dengan sengaja: pengingat "terhenti" juga dibatalkan.
  Future<void> _berhenti() async {
    await _hentikanAliran();
    unawaited(_kanal.berhenti());
  }

  Future<void> _diterima(Position p) async {
    final interval = _intervalBerjalan;
    if (interval == null || _dibuang) return;
    _posisiTerakhirPada = DateTime.now();
    // Sudah keluar akun: putaran berikutnya menghentikan aliran ini.
    if (ref.read(penggunaProvider) == null) return;
    // Sebagian ponsel mengirim lebih sering dari yang diminta (dan iOS tidak
    // mengenal interval): cukup satu titik per interval.
    if (_terakhir != null && p.timestamp.difference(_terakhir!) < Duration(minutes: interval) - const Duration(seconds: 30)) return;
    _terakhir = p.timestamp;
    unawaited(_kanal.denyut(interval));
    _segarkanPresensiBilaPerlu();
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

  /// Mode "selama bekerja": presensi dibaca ulang paling lama tiap
  /// [segarkanPresensiTiap] selama titik masuk.
  void _segarkanPresensiBilaPerlu() {
    if (state.konfigurasi?.selamaBekerja != true) return;
    final sekarang = DateTime.now();
    final terakhir = _presensiDibacaPada;
    if (terakhir != null && sekarang.difference(terakhir) < segarkanPresensiTiap) return;
    _presensiDibacaPada = sekarang;
    // Titik pertama hanya memulai hitungan: presensinya baru saja dibaca.
    if (terakhir == null) return;
    ref.invalidate(riwayatPresensiProvider);
    // Langsung, bukan lewat pendengar presensi (lihat [build]).
    unawaited(segarkan());
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

  Future<void> _laporkanStatus(String idPengguna) async {
    if (_dibuang) return;
    final s = state;
    final izin = s.izin;
    if (s.setuju == null || izin == null) return;
    // Per akun: ponsel bisa dipakai bergantian.
    final kunci = '$idPengguna:${s.setuju}:$izin';
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
