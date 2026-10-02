import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:hrd_nusantara/core/api/klien_api.dart';
import 'package:hrd_nusantara/core/api/status_jaringan.dart';
import 'package:hrd_nusantara/core/penyimpanan/cache_lokal.dart';
import 'package:hrd_nusantara/core/penyimpanan/penyimpanan_sesi.dart';
import 'package:hrd_nusantara/fitur/auth/model_pengguna.dart';
import 'package:hrd_nusantara/fitur/auth/sesi_provider.dart';
import 'package:hrd_nusantara/fitur/pemantauan/kanal_pemantauan.dart';
import 'package:hrd_nusantara/fitur/pemantauan/layanan_pemantauan.dart';
import 'package:hrd_nusantara/fitur/pemantauan/layar_pemantauan.dart';
import 'package:hrd_nusantara/fitur/pemantauan/repo_pemantauan.dart';
import 'package:hrd_nusantara/fitur/presensi/model_presensi.dart';
import 'package:hrd_nusantara/fitur/presensi/repo_presensi.dart';
import 'package:hrd_nusantara/router.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'alat_uji.dart';
import 'data_uji.dart';
import 'pemantauan_test.dart' show CacheMemori, IzinTiruan, posisi;

/// Sisi Android tiruan: mencatat apa yang diminta pemantauan darinya.
class KanalTiruan extends KanalPemantauan {
  KanalTiruan([this.status]);
  StatusPenyiapan? status;
  final mulaian = <int>[];
  final denyutan = <int>[];
  int berhentiDipanggil = 0; // setUp sudah memanggilnya (belum setuju = dimatikan); tes membandingkan dengan nilai sebelumnya
  final catatan = <String>[];
  VoidCallback? saatDitutup;

  @override
  Future<void> mulai(int intervalMenit) async => mulaian.add(intervalMenit);
  @override
  Future<void> denyut(int intervalMenit) async => denyutan.add(intervalMenit);
  @override
  Future<void> berhenti() async => berhentiDipanggil++;
  @override
  Future<StatusPenyiapan?> statusPenyiapan() async => status;
  @override
  Future<bool> mintaPengecualianBaterai() async {
    catatan.add('baterai');
    return true;
  }

  @override
  Future<bool> mintaIzinNotifikasi() async {
    catatan.add('minta-notifikasi');
    return false;
  }

  @override
  Future<bool> bukaPengaturanNotifikasi() async {
    catatan.add('pengaturan-notifikasi');
    return true;
  }

  @override
  void saatAktivitasDitutup(VoidCallback aksi) => saatDitutup = aksi;
}

class IzinNaik extends IzinTiruan {
  IzinNaik(super.kode);
  int dinaikkan = 0;
  @override
  Future<String> tingkatkan() async {
    dinaikkan++;
    return kode = 'granted_always';
  }
}

/// Sesi yang bisa diubah tes, tanpa memulihkan apa pun dari penyimpanan.
class SesiUji extends SesiNotifier {
  @override
  StatusSesi build() => const SesiMemuat();
  void ubah(StatusSesi s) => state = s;
}

/// Penyimpanan yang kunci waktu penyiapannya tidak terbaca (Keystore rusak).
class PenyimpananPenyiapanRusak extends PenyimpananSesi {
  @override
  Future<DateTime?> bacaPenyiapanTerakhir(String karyawanId) => Future.error(Exception('keystore'));
}

/// Pemantau dengan keadaan tetap, tetapi segarkanPenyiapan membaca [dibaca]
/// seperti aslinya membaca pengaturan Android.
class PemantauPenyiapanUji extends PemantauTetap {
  PemantauPenyiapanUji(super.awal, this.dibaca);
  final StatusPenyiapan Function() dibaca;
  @override
  Future<void> segarkanPenyiapan() async => state = state.salin(penyiapan: dibaca());

  /// Meniru hasil pembacaan keadaan oleh segarkan().
  void ubah(StatusPemantauan baru) => state = baru;
}

void main() {
  final binding = TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    await initializeDateFormatting('id_ID');
    await muatFontAsli();
  });

  group('PemantauLokasi di Android yang tahan lama', () {
    late ServerAntrean server;
    late StreamController<Position> gps;
    late IzinTiruan izin;
    late Map<String, dynamic> konfigurasi;
    late ProviderContainer c;
    late List<int> intervalDiminta;
    late KanalTiruan kanal;
    late List<Map<String, dynamic>> laporan;
    Presensi? presensiHariIni;

    PemantauLokasi pemantau() => c.read(pemantauLokasiProvider.notifier);
    StatusPemantauan status() => c.read(pemantauLokasiProvider);
    Future<void> tunggu() => Future<void>.delayed(const Duration(milliseconds: 20));
    Future<void> setuju() => c.read(penyimpananSesiProvider).simpanSetujuPantau(pengguna.id, true);

    ProviderContainer wadah({List<Override> tambahan = const [], KanalTiruan? kanalSendiri, Override? akun, Override? presensi, Override? klien}) {
      final wadah = ProviderContainer(overrides: [
        akun ?? penggunaProvider.overrideWithValue(pengguna),
        klien ?? klienTiruan(server),
        cacheLokalProvider.overrideWithValue(CacheMemori()),
        izinLokasiProvider.overrideWithValue(izin),
        kanalPemantauanProvider.overrideWithValue(kanalSendiri ?? kanal),
        sumberPosisiProvider.overrideWithValue((menit) {
          intervalDiminta.add(menit);
          return gps.stream;
        }),
        presensi ?? presensiHariIniProvider.overrideWith((ref) async => presensiHariIni),
        ...tambahan,
      ]);
      addTearDown(wadah.dispose);
      return wadah;
    }

    setUp(() async {
      // Di tes status siklus awalnya null — sama seperti mesin tanpa layar
      // setelah restart. Sebagian besar tes ini tentang aplikasi yang dibuka.
      binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      FlutterSecureStorage.setMockInitialValues({});
      intervalDiminta = [];
      laporan = [];
      presensiHariIni = null;
      konfigurasi = {'enabled': true, 'mode': 'always', 'intervalMinutes': 5};
      izin = IzinTiruan('granted_while_in_use');
      kanal = KanalTiruan();
      gps = StreamController<Position>.broadcast();
      server = ServerAntrean()
        ..jawab = (o) => switch (o.uri.path) {
              '/api/location-tracking/config' => (200, konfigurasi),
              '/api/location-tracking/pings' => (200, {'diterima': ((o.data as Map)['pings'] as List).length, 'enabled': konfigurasi['enabled']}),
              '/api/location-tracking/status' => () {
                  laporan.add(Map<String, dynamic>.from(o.data as Map));
                  return (204, null);
                }(),
              _ => (404, {'error': 'x'}),
            };
      c = wadah();
      c.listen(pemantauLokasiProvider, (_, _) {});
      await pemantau().segarkan();
    });

    tearDown(() => binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed));

    test('mesin tanpa layar (belum ada status siklus) dianggap tidak tampil; inactive masih tampil', () {
      expect(tampilDiLayar(null), isFalse);
      expect(tampilDiLayar(AppLifecycleState.resumed), isTrue);
      expect(tampilDiLayar(AppLifecycleState.inactive), isTrue, reason: 'mis. dialog izin sistem sedang di atas aplikasi');
      expect(tampilDiLayar(AppLifecycleState.hidden), isFalse);
      expect(tampilDiLayar(AppLifecycleState.paused), isFalse);
      expect(tampilDiLayar(AppLifecycleState.detached), isFalse);
    });

    test('mulai memastikan alarm "terhenti" terpasang; hanya titik yang diterima yang menggesernya', () async {
      await pemantau().setujui();
      expect(kanal.mulaian, [5], reason: 'dimulai: alarm dipastikan terpasang walau titik pertama belum datang');
      expect(kanal.denyutan, isEmpty, reason: 'memulai bukan titik: notifikasi "terhenti" tidak boleh ditarik');

      final t0 = DateTime.utc(2026, 10, 2, 3);
      gps.add(posisi(t0));
      await tunggu();
      expect(kanal.denyutan, [5]);
      gps.add(posisi(t0.add(const Duration(minutes: 2)))); // terlalu rapat: dibuang
      await tunggu();
      expect(kanal.denyutan, [5]);
      gps.add(posisi(t0.add(const Duration(minutes: 5))));
      await tunggu();
      expect(kanal.denyutan, [5, 5]);
    });

    test('dimatikan Super Admin: pengingat dibatalkan, bukan dibiarkan', () async {
      await pemantau().setujui();
      final sebelum = kanal.berhentiDipanggil;

      konfigurasi = {'enabled': false, 'mode': 'always', 'intervalMinutes': 5};
      await pemantau().segarkan();
      expect(status().berjalan, isFalse);
      expect(kanal.berhentiDipanggil, greaterThan(sebelum));
    });

    test('izin dicabut padahal seharusnya jalan: pengambilan berhenti, pengingat dibiarkan agar karyawan diberi tahu', () async {
      await pemantau().setujui();
      final sebelum = kanal.berhentiDipanggil;

      izin.kode = 'denied';
      await pemantau().segarkan();
      expect(status().berjalan, isFalse);
      expect(kanal.berhentiDipanggil, sebelum, reason: 'penghentian bukan atas kehendak karyawan/admin');

      izin.kode = 'granted_while_in_use';
      await pemantau().segarkan();
      expect(status().berjalan, isTrue);
    });

    test('mode "selama bekerja": check-out menghentikan dengan sengaja dan membatalkan pengingat', () async {
      konfigurasi = {'enabled': true, 'mode': 'while_working', 'intervalMinutes': 10};
      await pemantau().setujui();
      presensiHariIni = Presensi(id: 'P1', status: 'present', jamMasuk: DateTime.now());
      c.invalidate(presensiHariIniProvider);
      await c.read(presensiHariIniProvider.future);
      await pemantau().segarkan();
      expect(status().berjalan, isTrue);
      final sebelum = kanal.berhentiDipanggil;

      presensiHariIni = Presensi(id: 'P1', status: 'present', jamMasuk: DateTime.now().subtract(const Duration(hours: 8)), jamPulang: DateTime.now());
      c.invalidate(presensiHariIniProvider);
      await c.read(presensiHariIniProvider.future);
      await pemantau().segarkan();
      expect(status().berjalan, isFalse);
      expect(kanal.berhentiDipanggil, greaterThan(sebelum));
    });

    test('pengaturan belum pernah terbaca (offline sejak awal): tidak memulai dan tidak membatalkan pengingat', () async {
      final kanalBaru = KanalTiruan();
      server.putus = true;
      final baru = wadah(kanalSendiri: kanalBaru);
      baru.listen(pemantauLokasiProvider, (_, _) {});
      await baru.read(pemantauLokasiProvider.notifier).segarkan();
      expect(baru.read(pemantauLokasiProvider).berjalan, isFalse);
      expect(kanalBaru.berhentiDipanggil, 0);
    });

    test('keluar akun membatalkan pengingat; akun yang belum dikenal saat aplikasi baru dibuka tidak', () async {
      final kanalBaru = KanalTiruan();
      final akun = StateProvider<Pengguna?>((ref) => null);
      final baru = wadah(kanalSendiri: kanalBaru, akun: penggunaProvider.overrideWith((ref) => ref.watch(akun)));
      baru.listen(pemantauLokasiProvider, (_, _) {});
      await baru.read(pemantauLokasiProvider.notifier).segarkan();
      await tunggu();
      expect(kanalBaru.berhentiDipanggil, 0, reason: 'sesi belum pulih bukan berarti keluar');

      await baru.read(penyimpananSesiProvider).simpanSetujuPantau(pengguna.id, true);
      baru.read(akun.notifier).state = pengguna;
      await tunggu();
      await tunggu();
      expect(baru.read(pemantauLokasiProvider).berjalan, isTrue, reason: 'sesi pulih: pemantauan menyala');
      expect(kanalBaru.berhentiDipanggil, 0, reason: 'masuk bukan keluar');

      baru.read(akun.notifier).state = null;
      await tunggu();
      await tunggu();
      expect(baru.read(pemantauLokasiProvider).berjalan, isFalse);
      expect(kanalBaru.berhentiDipanggil, greaterThan(0), reason: 'keluar akun: tidak ada lagi yang perlu diingatkan');
    });

    test('tidak memulai pengambilan dari latar tanpa izin "sepanjang waktu"', () async {
      await setuju();
      binding.handleAppLifecycleStateChanged(AppLifecycleState.detached);
      await pemantau().segarkan();
      expect(intervalDiminta, isEmpty);
      expect(status().berjalan, isFalse);

      izin.kode = 'granted_always';
      await pemantau().segarkan();
      expect(intervalDiminta, [5], reason: 'dengan izin sepanjang waktu, boleh dimulai tanpa layar (mis. setelah restart)');
    });

    test('aliran yang sudah jalan tidak diganti dari latar, walau izinnya sepanjang waktu; diganti begitu aplikasi dibuka', () async {
      await pemantau().setujui();
      expect(intervalDiminta, [5]);
      expect(izin.kode, 'granted_always');

      konfigurasi = {'enabled': true, 'mode': 'always', 'intervalMinutes': 10};
      binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await pemantau().segarkan();
      expect(intervalDiminta, [5]);
      expect(status().berjalan, isTrue);

      binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await pemantau().segarkan();
      expect(intervalDiminta, [5, 10]);
    });

    test('interval berubah selagi aliran lama masih ditutup: pemicu kedua tidak menyalakan aliran baru kedua', () async {
      final baru = ProviderContainer(overrides: [
        penggunaProvider.overrideWithValue(pengguna),
        klienTiruan(server),
        cacheLokalProvider.overrideWithValue(CacheMemori()),
        izinLokasiProvider.overrideWithValue(izin),
        kanalPemantauanProvider.overrideWithValue(KanalTiruan()),
        sumberPosisiProvider.overrideWithValue((menit) {
          intervalDiminta.add(menit);
          // Menutup aliran lama butuh waktu. Sengaja bukan broadcast: hanya
          // aliran sekali-langganan yang cancel()-nya menunggu onCancel.
          return StreamController<Position>(onCancel: () => Future<void>.delayed(const Duration(milliseconds: 150))).stream;
        }),
        presensiHariIniProvider.overrideWith((ref) async => presensiHariIni),
      ]);
      addTearDown(baru.dispose);
      baru.listen(pemantauLokasiProvider, (_, _) {});
      final pemantauBaru = baru.read(pemantauLokasiProvider.notifier);
      await baru.read(penyimpananSesiProvider).simpanSetujuPantau(pengguna.id, true);
      await pemantauBaru.segarkan();
      expect(intervalDiminta, [5]);

      konfigurasi = {'enabled': true, 'mode': 'always', 'intervalMinutes': 10};
      final pertama = pemantauBaru.segarkan();
      await Future<void>.delayed(const Duration(milliseconds: 40)); // pertama sedang menutup aliran lama
      await Future.wait([pertama, pemantauBaru.segarkan()]);
      expect(intervalDiminta, [5, 10], reason: 'satu aliran baru, bukan dua yang saling menimpa');
    });

    test('penyiapan: ditawarkan sesudah izin lokasi, tidak berulang dalam 7 hari, dan hilang bila semuanya beres', () async {
      kanal.status = const StatusPenyiapan(notifikasi: false, penghematBaterai: false);
      await setuju();
      await pemantau().segarkan();
      expect(status().perluPenyiapan, isTrue);
      expect(status().langkahKurang, [LangkahPenyiapan.notifikasi, LangkahPenyiapan.baterai, LangkahPenyiapan.sepanjangWaktu]);

      await pemantau().catatPenyiapanDitampilkan();
      expect(status().perluPenyiapan, isFalse);

      final simpanan = c.read(penyimpananSesiProvider);
      await simpanan.simpanPenyiapanTerakhir(pengguna.id, DateTime.now().subtract(const Duration(days: 6)));
      await pemantau().segarkan();
      expect(status().perluPenyiapan, isFalse, reason: '6 hari: belum waktunya');

      await simpanan.simpanPenyiapanTerakhir(pengguna.id, DateTime.now().subtract(const Duration(days: 8)));
      await pemantau().segarkan();
      expect(status().perluPenyiapan, isTrue, reason: '8 hari: masih kurang, ditawarkan lagi');

      kanal.status = const StatusPenyiapan(notifikasi: true, penghematBaterai: true);
      izin.kode = 'granted_always';
      await pemantau().segarkan();
      expect(status().langkahKurang, isEmpty);
      expect(status().perluPenyiapan, isFalse);
    });

    test('penyiapan tidak ditawarkan sebelum izin lokasi diberikan atau persetujuan dibaca', () async {
      kanal.status = const StatusPenyiapan(notifikasi: false, penghematBaterai: false);
      await pemantau().segarkan();
      expect(status().perluPenyiapan, isFalse, reason: 'belum setuju');

      await setuju();
      izin.kode = 'denied';
      await pemantau().segarkan();
      expect(status().perluPenyiapan, isFalse, reason: 'izin lokasi ditolak: itu urusan pertama');
    });

    test('bukan Android (kanal tak memberi status): tidak ada penyiapan', () async {
      kanal.status = null;
      await setuju();
      await pemantau().segarkan();
      expect(status().penyiapan, isNull);
      expect(status().perluPenyiapan, isFalse);
    });

    test('aplikasi ditutup: pertanyaan yang tadi ditunda diajukan lagi saat dibuka', () async {
      expect(status().perluPersetujuan, isTrue);
      pemantau().tunda();
      expect(status().perluPersetujuan, isFalse);
      pemantau().aktivitasDitutup();
      expect(status().perluPersetujuan, isTrue);
    });

    test('aliran yang dimulai di latar dan belum menghasilkan posisi dimulai ulang begitu aplikasi tampil', () async {
      kanal.status = const StatusPenyiapan(notifikasi: true, penghematBaterai: true);
      izin.kode = 'granted_always';
      await setuju();
      binding.handleAppLifecycleStateChanged(AppLifecycleState.detached);
      await pemantau().segarkan();
      expect(intervalDiminta, [5], reason: 'sepanjang waktu + bebas penghemat baterai: boleh dimulai dari latar');

      binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await pemantau().segarkan();
      expect(intervalDiminta, [5, 5], reason: 'layanannya mungkin ditolak Android: tanpa posisi, dimulai ulang di depan layar');

      gps.add(posisi(DateTime.utc(2026, 10, 2, 3)));
      await tunggu();
      await pemantau().segarkan();
      expect(intervalDiminta, [5, 5], reason: 'sudah ada posisi: aliran dipercaya');
    });

    test('aliran yang galat dimulai ulang begitu aplikasi tampil, tidak dari latar tanpa izin', () async {
      await pemantau().setujui();
      expect(intervalDiminta, [5]);
      izin.kode = 'granted_while_in_use';

      gps.addError(Exception('layanan lokasi mati'));
      await tunggu();
      binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await pemantau().segarkan();
      expect(intervalDiminta, [5], reason: 'di latar dengan izin saat dipakai: tidak boleh memulai layanan baru');

      binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await pemantau().segarkan();
      expect(intervalDiminta, [5, 5]);
    });

    test('izin notifikasi diberikan sesudah aliran jalan: aliran dimulai ulang sekali agar notifikasinya tampil', () async {
      kanal.status = const StatusPenyiapan(notifikasi: false, penghematBaterai: true);
      await pemantau().setujui();
      expect(intervalDiminta, [5]);

      kanal.status = const StatusPenyiapan(notifikasi: true, penghematBaterai: true);
      await pemantau().segarkan();
      expect(intervalDiminta, [5, 5]);
      await pemantau().segarkan();
      expect(intervalDiminta, [5, 5]);
    });

    test('dari latar, izin sepanjang waktu saja tidak cukup: perlu bebas penghemat baterai atau jendela boot', () async {
      izin.kode = 'granted_always';
      await setuju();
      binding.handleAppLifecycleStateChanged(AppLifecycleState.detached);
      kanal.status = const StatusPenyiapan(notifikasi: true, penghematBaterai: false);
      await pemantau().segarkan();
      expect(intervalDiminta, isEmpty, reason: 'Android 12+ menolak layanan latar depan yang dimulai dari latar');

      kanal.status = const StatusPenyiapan(notifikasi: true, penghematBaterai: false, jendelaBoot: true);
      await pemantau().segarkan();
      expect(intervalDiminta, [5], reason: 'baru dibangunkan siaran boot');
    });

    test('dari latar dengan izin sepanjang waktu dan bebas penghemat baterai: aliran baru boleh dimulai', () async {
      izin.kode = 'granted_always';
      await setuju();
      binding.handleAppLifecycleStateChanged(AppLifecycleState.detached);
      kanal.status = const StatusPenyiapan(notifikasi: true, penghematBaterai: true);
      await pemantau().segarkan();
      expect(intervalDiminta, [5]);
    });

    test('mode "selama bekerja": presensi yang sedang dimuat tidak dianggap check-out', () async {
      konfigurasi = {'enabled': true, 'mode': 'while_working', 'intervalMinutes': 10};
      final kanalBaru = KanalTiruan();
      var muat = Completer<Presensi?>()..complete(null);
      final baru = wadah(kanalSendiri: kanalBaru, presensi: presensiHariIniProvider.overrideWith((ref) => muat.future));
      baru.listen(pemantauLokasiProvider, (_, _) {});
      await baru.read(penyimpananSesiProvider).simpanSetujuPantau(pengguna.id, true);
      await baru.read(presensiHariIniProvider.future);
      await baru.read(pemantauLokasiProvider.notifier).segarkan();
      final sebelum = kanalBaru.berhentiDipanggil;
      expect(sebelum, greaterThan(0), reason: 'belum check-in: memang dihentikan');

      // Dibaca ulang (mis. sesudah sesi pulih): selama memuat, nilai lamanya (kosong) tidak dipakai.
      muat = Completer<Presensi?>();
      baru.invalidate(presensiHariIniProvider);
      unawaited(baru.read(pemantauLokasiProvider.notifier).segarkan());
      await tunggu();
      expect(kanalBaru.berhentiDipanggil, sebelum);

      muat.complete(Presensi(id: 'P1', status: 'present', jamMasuk: DateTime.now()));
      await tunggu();
      await tunggu();
      expect(intervalDiminta, [10], reason: 'selesai dimuat: putaran baru menyalakan pemantauan');
      expect(kanalBaru.berhentiDipanggil, sebelum);
    });

    test('tanpa frame (mesin tanpa layar): pemulihan sesi tetap menyalakan pemantauan', () async {
      // Mesin dari siaran boot berstatus detached: Flutter tidak membuat frame,
      // dan di bawah ProviderScope Riverpod menunda penyegaran provider turunan
      // (penggunaProvider) sampai frame berikutnya. Ditiru di sini dengan
      // penjadwal yang tidak pernah menjalankan tugasnya.
      binding.handleAppLifecycleStateChanged(AppLifecycleState.detached);
      izin.kode = 'granted_always';
      final baru = ProviderContainer(overrides: [
        sesiProvider.overrideWith(SesiUji.new),
        klienTiruan(server),
        cacheLokalProvider.overrideWithValue(CacheMemori()),
        izinLokasiProvider.overrideWithValue(izin),
        kanalPemantauanProvider.overrideWithValue(KanalTiruan()),
        sumberPosisiProvider.overrideWithValue((menit) {
          intervalDiminta.add(menit);
          return gps.stream;
        }),
        presensiHariIniProvider.overrideWith((ref) async => null),
      ]);
      addTearDown(baru.dispose);
      // ignore: invalid_use_of_internal_member
      baru.scheduler.flutterVsyncs.add((_) {});
      baru.listen(pemantauLokasiProvider, (_, _) {});
      await baru.read(penyimpananSesiProvider).simpanSetujuPantau(pengguna.id, true);
      await tunggu();
      expect(intervalDiminta, isEmpty, reason: 'sesi belum pulih');

      (baru.read(sesiProvider.notifier) as SesiUji).ubah(const SesiMasuk(pengguna));
      await tunggu();
      await tunggu();
      expect(intervalDiminta, [5], reason: 'tanpa menunggu frame yang tidak pernah datang');
    });

    test('status dilaporkan per akun: akun berikutnya di ponsel yang sama tetap melapor', () async {
      final akun = StateProvider<Pengguna?>((ref) => pengguna);
      final baru = wadah(kanalSendiri: KanalTiruan(), akun: penggunaProvider.overrideWith((ref) => ref.watch(akun)));
      baru.listen(pemantauLokasiProvider, (_, _) {});
      await baru.read(pemantauLokasiProvider.notifier).segarkan();
      laporan.clear();
      const lain = Pengguna(id: 'K9', nik: 'EMP-0009', nama: 'Rina', email: 'rina@contoh.id', peran: 'EMPLOYEE', status: 'active');
      baru.read(akun.notifier).state = null;
      await tunggu();
      baru.read(akun.notifier).state = lain;
      await tunggu();
      await tunggu();
      expect(laporan, isNotEmpty, reason: 'persetujuan & izin akun baru sama dengan akun lama, tetap harus dilaporkan');
    });

    test('kunci waktu penyiapan tak terbaca tidak ikut menghentikan pemantauan', () async {
      final simpanan = PenyimpananPenyiapanRusak();
      final baru = wadah(kanalSendiri: KanalTiruan(), tambahan: [penyimpananSesiProvider.overrideWithValue(simpanan)]);
      baru.listen(pemantauLokasiProvider, (_, _) {});
      await simpanan.simpanSetujuPantau(pengguna.id, true);
      await baru.read(pemantauLokasiProvider.notifier).segarkan();
      expect(baru.read(pemantauLokasiProvider).berjalan, isTrue);
    });

    test('tanpa layar (mesin dari siaran boot): pengaturan tersimpan dipakai tanpa menunggu jaringan', () async {
      binding.handleAppLifecycleStateChanged(AppLifecycleState.detached);
      izin.kode = 'granted_always';
      final cache = CacheMemori();
      await cache.simpan('pemantauan-konfigurasi', {'enabled': true, 'mode': 'always', 'intervalMinutes': 7});
      final klien = klienApiProvider.overrideWith((ref) => KlienApi(
            penyimpanan: PenyimpananSesi(),
            dio: Dio()..httpClientAdapter = server,
            baseUrl: 'https://hrd.contoh/api',
            jaringan: ref.read(statusJaringanProvider.notifier),
            cache: cache,
          ));
      // Semua permintaan tertahan, seperti jaringan yang belum tersambung.
      server.tahan = () => Completer<void>().future;
      await c.read(penyimpananSesiProvider).simpanSetujuPantau(pengguna.id, true);
      final baru = wadah(kanalSendiri: KanalTiruan(), klien: klien);
      baru.listen(pemantauLokasiProvider, (_, _) {});
      unawaited(baru.read(pemantauLokasiProvider.notifier).segarkan());
      await tunggu();
      expect(intervalDiminta, [7], reason: 'dimulai dari salinan, sementara permintaan ke server masih tertahan');
    });

    test('di depan layar pengaturan terbaru dibaca dulu: pengaturan lama di memori tidak menyalakan apa pun', () async {
      // setUp sudah membaca pengaturan "24 jam"; Super Admin lalu mengubahnya ke "selama bekerja".
      konfigurasi = {'enabled': true, 'mode': 'while_working', 'intervalMinutes': 10};
      await pemantau().setujui();
      expect(intervalDiminta, isEmpty, reason: 'belum check-in');
      expect(status().konfigurasi?.selamaBekerja, isTrue);
    });
  });

  group('tampilan', () {
    late KanalTiruan kanal;
    late StatusPenyiapan keadaan;
    late IzinNaik izin;

    const konfig = KonfigurasiPemantauan(aktif: true, selamaBekerja: false, intervalMenit: 15);

    Widget aplikasi(StatusPemantauan awal) {
      return ProviderScope(
        overrides: [
          penggunaProvider.overrideWithValue(pengguna),
          kanalPemantauanProvider.overrideWithValue(kanal),
          izinLokasiProvider.overrideWithValue(izin),
          pemantauLokasiProvider.overrideWith(() => PemantauPenyiapanUji(awal, () => keadaan)),
        ],
        child: MaterialApp(
          navigatorKey: kunciNavigatorAkar,
          builder: (context, child) => PendengarPemantauan(child: child ?? const SizedBox.shrink()),
          home: const Scaffold(body: Center(child: Text('Beranda uji'))),
        ),
      );
    }

    setUp(() {
      binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      FlutterSecureStorage.setMockInitialValues({});
      keadaan = const StatusPenyiapan(notifikasi: false, penghematBaterai: false);
      kanal = KanalTiruan(keadaan);
      izin = IzinNaik('granted_while_in_use');
    });

    tearDown(() => binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed));

    testWidgets('penyiapan muncul sekali, dan tiap langkah dikerjakan dari barisnya', (tester) async {
      ukuranPonsel(tester);
      await tester.pumpWidget(aplikasi(StatusPemantauan(konfigurasi: konfig, setuju: true, izin: 'granted_while_in_use', penyiapan: keadaan)));
      await tester.pumpAndSettle();

      expect(find.text('Agar pemantauan tidak terputus'), findsOneWidget);
      expect(find.text('Atur'), findsNWidgets(3));
      await potret(tester, 'pemantauan-penyiapan');

      // Pengecualian baterai: dialog sistem dibuka; hasilnya terbaca saat kembali.
      keadaan = const StatusPenyiapan(notifikasi: false, penghematBaterai: true); // yang akan terbaca setelah dialog sistem ditutup
      await tester.tap(find.widgetWithText(TextButton, 'Atur').at(1));
      await tester.pumpAndSettle();
      expect(kanal.catatan, ['baterai']);
      expect(find.text('Atur'), findsNWidgets(2));

      // Notifikasi: dialog sistem dulu, lalu pengaturan bila ditolak (tombol tak boleh mati).
      await tester.tap(find.widgetWithText(TextButton, 'Atur').first);
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Atur').first);
      await tester.pumpAndSettle();
      expect(kanal.catatan, ['baterai', 'minta-notifikasi', 'pengaturan-notifikasi']);

      // Lokasi sepanjang waktu.
      await tester.tap(find.widgetWithText(TextButton, 'Atur').last);
      await tester.pumpAndSettle();
      expect(izin.dinaikkan, 1);

      // Tutup: tidak muncul lagi (dicatat 7 hari), juga saat aplikasi kembali ke depan.
      await tester.tap(find.text('Nanti saja'));
      await tester.pumpAndSettle();
      expect(find.text('Agar pemantauan tidak terputus'), findsNothing);
      binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(find.text('Agar pemantauan tidak terputus'), findsNothing);
    });

    testWidgets('baris notifikasi tetap tampil, tercentang, setelah izinnya diberikan', (tester) async {
      ukuranPonsel(tester);
      await tester.pumpWidget(aplikasi(StatusPemantauan(konfigurasi: konfig, setuju: true, izin: 'granted_while_in_use', penyiapan: keadaan)));
      await tester.pumpAndSettle();
      expect(find.text('Izinkan notifikasi'), findsOneWidget);

      keadaan = const StatusPenyiapan(notifikasi: true, penghematBaterai: false); // yang terbaca setelah dialog sistem ditutup
      await tester.tap(find.widgetWithText(TextButton, 'Atur').first);
      await tester.pumpAndSettle();
      expect(find.text('Izinkan notifikasi'), findsOneWidget);
      expect(find.text('Atur'), findsNWidgets(2), reason: 'notifikasi selesai; baterai dan sepanjang waktu tersisa');
    });

    testWidgets('pemberitahuan persetujuan lebih dulu; penyiapan menyusul setelah persetujuan', (tester) async {
      ukuranPonsel(tester);
      await tester.pumpWidget(aplikasi(StatusPemantauan(konfigurasi: konfig, setuju: false, izin: 'granted_while_in_use', penyiapan: keadaan)));
      await tester.pumpAndSettle();
      expect(find.text('Akses Lokasi'), findsOneWidget);
      expect(find.text('Agar pemantauan tidak terputus'), findsNothing);

      await tester.tap(find.text('Saya mengerti'));
      await tester.pumpAndSettle();
      expect(find.text('Akses Lokasi'), findsNothing);
      expect(find.text('Agar pemantauan tidak terputus'), findsOneWidget);
    });

    testWidgets('tidak ada dialog bila semuanya sudah beres', (tester) async {
      ukuranPonsel(tester);
      keadaan = const StatusPenyiapan(notifikasi: true, penghematBaterai: true);
      await tester.pumpWidget(aplikasi(StatusPemantauan(konfigurasi: konfig, setuju: true, izin: 'granted_always', penyiapan: keadaan)));
      await tester.pumpAndSettle();
      expect(find.text('Agar pemantauan tidak terputus'), findsNothing);
      expect(find.text('Akses Lokasi'), findsNothing);
    });

    testWidgets('mesin dipertahankan tanpa layar: keadaan yang menuntut dialog tidak menampilkannya, dan tidak dianggap sudah ditawarkan', (tester) async {
      ukuranPonsel(tester);
      keadaan = const StatusPenyiapan(notifikasi: false, penghematBaterai: false);
      await tester.pumpWidget(aplikasi(StatusPemantauan(konfigurasi: konfig, setuju: true, izin: 'granted_always', penyiapan: const StatusPenyiapan(notifikasi: true, penghematBaterai: true))));
      await tester.pumpAndSettle();
      final wadah = ProviderScope.containerOf(tester.element(find.byType(Scaffold)));
      final pemantau = wadah.read(pemantauLokasiProvider.notifier) as PemantauPenyiapanUji;

      // Aplikasi ditutup, mesin tetap hidup; lalu pembacaan di latar menemukan yang kurang.
      binding.handleAppLifecycleStateChanged(AppLifecycleState.detached);
      pemantau.ubah(StatusPemantauan(konfigurasi: konfig, setuju: true, izin: 'granted_while_in_use', penyiapan: keadaan));
      await tester.pump();
      expect(wadah.read(pemantauLokasiProvider).perluPenyiapan, isTrue);
      expect(wadah.read(pemantauLokasiProvider).penyiapanDitunda, isFalse, reason: 'belum ada yang melihat, jangan dihitung sudah ditawarkan');
      expect(kunciNavigatorAkar.currentState!.canPop(), isFalse, reason: 'tidak ada layar/dialog yang didorong ke navigator');

      binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(find.text('Agar pemantauan tidak terputus'), findsOneWidget, reason: 'begitu aplikasi dibuka, dialog yang tertunda tampil');
      expect(wadah.read(pemantauLokasiProvider).penyiapanDitunda, isTrue);
    });

    testWidgets('kembaliKeBeranda juga menutup layar di navigator tab: kamera dan lembar absen', (tester) async {
      final router = GoRouter(
        navigatorKey: kunciNavigatorAkar,
        routes: [
          StatefulShellRoute.indexedStack(
            builder: (context, state, shell) => Scaffold(body: shell),
            branches: [
              StatefulShellBranch(navigatorKey: kunciNavigatorTab[0], routes: [GoRoute(path: '/', builder: (_, _) => const Text('Beranda'))]),
              StatefulShellBranch(navigatorKey: kunciNavigatorTab[1], routes: [GoRoute(path: '/presensi', builder: (_, _) => const Text('Tab presensi'))]),
            ],
          ),
        ],
      );
      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      router.go('/presensi');
      await tester.pumpAndSettle();
      // Seperti LayarKameraWajah.buka dan LayarAbsen.buka: di navigator tab, bukan akar.
      unawaited(Navigator.of(kunciNavigatorTab[1].currentContext!).push(MaterialPageRoute<void>(builder: (_) => const Scaffold(body: Text('Kamera wajah')))));
      await tester.pumpAndSettle();
      unawaited(showModalBottomSheet<void>(context: tester.element(find.text('Kamera wajah')), builder: (_) => const Text('Lembar absen')));
      await tester.pumpAndSettle();
      expect(find.text('Lembar absen'), findsOneWidget);

      kembaliKeBeranda(router);
      await tester.pumpAndSettle();
      expect(find.text('Lembar absen'), findsNothing);
      expect(find.text('Kamera wajah'), findsNothing);
      expect(find.text('Beranda'), findsOneWidget);
      expect(router.state.matchedLocation, '/');

      router.go('/presensi');
      await tester.pumpAndSettle();
      expect(find.text('Tab presensi'), findsOneWidget, reason: 'tab presensi kembali ke layar awalnya');
      expect(find.text('Kamera wajah'), findsNothing);
    });

    testWidgets('kembaliKeBeranda menutup dialog dan layar yang terbuka', (tester) async {
      final router = GoRouter(
        navigatorKey: kunciNavigatorAkar,
        routes: [
          GoRoute(path: '/', builder: (_, _) => const Scaffold(body: Text('Beranda'))),
          GoRoute(path: '/dalam', builder: (_, _) => const Scaffold(body: Text('Layar dalam'))),
        ],
      );
      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pumpAndSettle();
      unawaited(router.push('/dalam'));
      await tester.pumpAndSettle();
      expect(find.text('Layar dalam'), findsOneWidget);
      unawaited(showDialog<void>(context: kunciNavigatorAkar.currentContext!, builder: (_) => const AlertDialog(title: Text('Dialog terbuka'))));
      await tester.pumpAndSettle();
      expect(find.text('Dialog terbuka'), findsOneWidget);

      kembaliKeBeranda(router);
      await tester.pumpAndSettle();
      expect(find.text('Dialog terbuka'), findsNothing);
      expect(find.text('Layar dalam'), findsNothing);
      expect(find.text('Beranda'), findsOneWidget);
      expect(router.state.matchedLocation, '/');
    });
  });
}
