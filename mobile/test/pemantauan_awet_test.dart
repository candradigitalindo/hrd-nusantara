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
import 'package:package_info_plus/package_info_plus.dart';

import 'alat_uji.dart';
import 'data_uji.dart';
import 'pemantauan_test.dart' show CacheMemori, IzinTiruan, posisi;

/// Sisi Android tiruan: mencatat apa yang diminta pemantauan darinya.
class KanalTiruan extends KanalPemantauan {
  KanalTiruan([this.status]);
  StatusPenyiapan? status;
  bool platformDidukung = false;
  Future<StatusPenyiapan?> Function()? bacaStatus;
  final mulaian = <int>[];
  final denyutan = <int>[];
  int berhentiDipanggil = 0; // setUp sudah memanggilnya (belum setuju = dimatikan); tes membandingkan dengan nilai sebelumnya
  final catatan = <String>[];
  VoidCallback? saatDitutup;

  @override
  bool get didukung => platformDidukung;

  @override
  Future<void> mulai(int intervalMenit) async => mulaian.add(intervalMenit);
  @override
  Future<void> denyut(int intervalMenit) async => denyutan.add(intervalMenit);
  @override
  Future<void> berhenti() async => berhentiDipanggil++;
  @override
  Future<StatusPenyiapan?> statusPenyiapan() async => bacaStatus == null ? status : await bacaStatus!();
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
      PackageInfo.setMockInitialValues(appName: 'HRD Nusantara', packageName: 'id.nusantara.hrd.hrd_nusantara', version: '9.8.7', buildNumber: '987', buildSignature: 'test');
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

    test('persetujuan ditarik: berhenti, lapor ke server, dan tetap berhenti setelah dibuka ulang', () async {
      await pemantau().setujui();
      expect(status().berjalan, isTrue);
      final sebelum = kanal.berhentiDipanggil;
      await pemantau().cabutPersetujuan();
      expect(status().setuju, isFalse);
      expect(status().berjalan, isFalse);
      expect(kanal.berhentiDipanggil, greaterThan(sebelum));
      expect(laporan.last['consent'], isFalse);
      final kiriman = server.percobaan.where((p) => p.uri.path.endsWith('/pings')).length;
      gps.add(posisi(DateTime.now()));
      await tunggu();
      expect(server.percobaan.where((p) => p.uri.path.endsWith('/pings')).length, kiriman);
      pemantau().aktivitasDitutup();
      await pemantau().segarkan();
      expect(status().perluPersetujuan, isFalse, reason: 'penarikan tidak memaksa dialog baru saat aplikasi dibuka');
      expect(status().berjalan, isFalse);
      await pemantau().setujui();
      expect(status().berjalan, isTrue, reason: 'persetujuan baru tetap dapat diberikan dari kebijakan privasi');
    });

    test('pembacaan izin lama yang selesai setelah penarikan tidak menyalakan kembali pemantauan', () async {
      await pemantau().setujui();
      final tertahan = Completer<StatusPenyiapan?>();
      kanal.bacaStatus = () => tertahan.future;
      final penyegaran = pemantau().segarkan();
      await tunggu();
      await pemantau().cabutPersetujuan();
      kanal.bacaStatus = null;
      tertahan.complete(null);
      await penyegaran;
      expect(status().setuju, isFalse);
      expect(status().berjalan, isFalse);
      expect(laporan.last['consent'], isFalse);
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

    for (final kasus in [
      (nama: 'ditutup otomatis tanpa check-out', status: 'no_checkout', usia: const Duration(hours: 1)),
      (nama: 'tepat mencapai batas 16 jam', status: 'present', usia: const Duration(hours: 16)),
      (nama: 'lebih lama dari 16 jam', status: 'present', usia: const Duration(hours: 17)),
      (nama: 'jam masuk masih di masa depan', status: 'present', usia: const Duration(minutes: -1)),
    ]) {
      test('mode "selama bekerja": sesi ${kasus.nama} tidak melanjutkan pemantauan', () async {
        konfigurasi = {'enabled': true, 'mode': 'while_working', 'intervalMinutes': 5};
        presensiHariIni = Presensi(id: 'P1', status: 'present', jamMasuk: DateTime.now().subtract(const Duration(hours: 1)));
        c.invalidate(presensiHariIniProvider);
        await c.read(presensiHariIniProvider.future);
        await pemantau().setujui();
        expect(status().berjalan, isTrue);
        expect(gps.hasListener, isTrue);
        final sebelum = kanal.berhentiDipanggil;

        // Jam pulang tetap kosong: aturan lama hanya memeriksa masihTerbuka.
        presensiHariIni = Presensi(id: 'P1', status: kasus.status, jamMasuk: DateTime.now().subtract(kasus.usia));
        c.invalidate(presensiHariIniProvider);
        await c.read(presensiHariIniProvider.future);
        await pemantau().segarkan();
        expect(status().berjalan, isFalse);
        expect(gps.hasListener, isFalse);
        expect(kanal.berhentiDipanggil, greaterThan(sebelum), reason: 'sesi kerja berakhir, jadi pengingat juga dibatalkan');
        expect(intervalDiminta, [5], reason: 'tidak membuka aliran pengganti untuk sesi yang tak berlaku');
      });
    }

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

    test('penundaan penyiapan versi lama tidak menyembunyikan kebutuhan notifikasi setelah persetujuan baru', () async {
      await const FlutterSecureStorage().write(
        key: 'hrd_penyiapan_pantau_${pengguna.id}',
        value: DateTime.now().toUtc().toIso8601String(),
      );
      kanal.status = const StatusPenyiapan(notifikasi: false, penghematBaterai: true);
      await pemantau().setujui();

      expect(status().setuju, isTrue);
      expect(status().perluPenyiapan, isTrue);
      expect(status().langkahKurang, [LangkahPenyiapan.notifikasi]);
      expect(status().berjalan, isFalse);
      expect(laporan.last['permission'], 'notifications_denied');

      await pemantau().catatPenyiapanDitampilkan();
      await pemantau().segarkan();
      expect(status().perluPenyiapan, isFalse, reason: 'penundaan versi baru tetap dihormati');
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

    test('notifikasi diblokir: tidak mengambil lokasi; setelah diizinkan baru mulai', () async {
      kanal.status = const StatusPenyiapan(notifikasi: false, penghematBaterai: true);
      await pemantau().setujui();
      expect(intervalDiminta, isEmpty);
      expect(status().berjalan, isFalse);

      kanal.status = const StatusPenyiapan(notifikasi: true, penghematBaterai: true);
      await pemantau().segarkan();
      expect(intervalDiminta, [5]);
      expect(status().berjalan, isTrue);
      await pemantau().segarkan();
      expect(intervalDiminta, [5], reason: 'tidak membuat aliran ganda');

      kanal.status = const StatusPenyiapan(notifikasi: false, penghematBaterai: true);
      await pemantau().segarkan();
      expect(status().berjalan, isFalse, reason: 'pencabutan izin notifikasi menghentikan pemantauan');
      expect(gps.hasListener, isFalse);
    });

    test('status native Android berubah dari diizinkan menjadi tidak terbaca: berhenti dan laporkan unavailable', () async {
      kanal.platformDidukung = true;
      kanal.status = const StatusPenyiapan(notifikasi: true, penghematBaterai: true);
      await pemantau().setujui();
      expect(status().berjalan, isTrue);
      expect(laporan.last['permission'], 'granted_always');
      expect(laporan.last['appVersion'], '9.8.7 (987)', reason: 'status operasional menyertakan versi aplikasi yang benar-benar terpasang');

      kanal.status = null;
      await pemantau().segarkan();
      expect(status().penyiapan, isNull, reason: 'izin lama tidak boleh tertinggal setelah pembacaan gagal');
      expect(status().berjalan, isFalse);
      expect(gps.hasListener, isFalse);
      expect(laporan.last['permission'], 'unavailable');

      kanal.status = const StatusPenyiapan(notifikasi: true, penghematBaterai: true);
      await pemantau().segarkan();
      expect(status().berjalan, isTrue);
      expect(laporan.last['permission'], 'granted_always', reason: 'pemulihan izin dilaporkan tanpa menunggu jeda 15 menit');
    });

    for (final tidakTerbaca in [false, true]) {
      test('titik masuk ketika notifikasi ${tidakTerbaca ? 'tidak terbaca' : 'dicabut'} tidak disimpan atau dikirim', () async {
        kanal.platformDidukung = true;
        kanal.status = const StatusPenyiapan(notifikasi: true, penghematBaterai: true);
        await pemantau().setujui();
        expect(gps.hasListener, isTrue);
        final cache = c.read(cacheLokalProvider) as CacheMemori;
        expect(cache.isi['pemantauan-buffer'], isNull);

        // Tanpa segarkan()/resume: perubahan izin harus terbaca dari jalur titik masuk.
        kanal.status = tidakTerbaca ? null : const StatusPenyiapan(notifikasi: false, penghematBaterai: true);
        gps.add(posisi(DateTime.utc(2026, 10, 13, 3)));
        await tunggu();
        await tunggu();

        expect(status().berjalan, isFalse);
        expect(gps.hasListener, isFalse);
        expect(cache.isi['pemantauan-buffer'], isNull, reason: 'titik ditolak sebelum ditulis ke penyimpanan');
        expect(server.percobaan.where((p) => p.uri.path.endsWith('/location-tracking/pings')), isEmpty);
        expect(kanal.denyutan, isEmpty, reason: 'titik yang ditolak bukan bukti pemantauan masih berjalan');
        expect(status().terakhirDiambil, isNull);
        expect(laporan.last['permission'], tidakTerbaca ? 'unavailable' : 'notifications_denied');

        kanal.status = const StatusPenyiapan(notifikasi: true, penghematBaterai: true);
        await pemantau().segarkan();
        expect(laporan.last['permission'], 'granted_always');
        expect(status().izin, 'granted_always', reason: 'penghambat notifikasi tidak mengganti izin lokasi asli');
        gps.add(posisi(DateTime.utc(2026, 10, 13, 3, 1)));
        await tunggu();
        await tunggu();
        expect(kanal.denyutan, [5]);
        expect(server.percobaan.where((p) => p.uri.path.endsWith('/location-tracking/pings')), hasLength(1));
        expect(status().terakhirDiambil, DateTime.utc(2026, 10, 13, 3, 1), reason: 'titik yang ditolak tidak memajukan pembatas interval');
      });
    }

    test('dua titik serentak yang menunggu izin native tetap menghasilkan satu titik per interval', () async {
      kanal.platformDidukung = true;
      kanal.status = const StatusPenyiapan(notifikasi: true, penghematBaterai: true);
      await pemantau().setujui();

      final jawabanNative = Completer<StatusPenyiapan?>();
      var pembacaan = 0;
      kanal.bacaStatus = () {
        pembacaan++;
        return jawabanNative.future;
      };
      final awal = DateTime.utc(2026, 10, 13, 4);
      gps.add(posisi(awal));
      gps.add(posisi(awal.add(const Duration(seconds: 1))));
      await tunggu();
      expect(pembacaan, 2, reason: 'kedua callback tertahan setelah pemeriksaan interval awal');
      expect(server.percobaan.where((p) => p.uri.path.endsWith('/location-tracking/pings')), isEmpty);

      jawabanNative.complete(kanal.status);
      await tunggu();
      await tunggu();
      final kiriman = server.percobaan.where((p) => p.uri.path.endsWith('/location-tracking/pings')).toList();
      expect(kiriman, hasLength(1));
      final titik = (kiriman.single.data as Map)['pings'] as List;
      expect(titik, hasLength(1));
      expect(titik.single['recordedAt'], awal.toIso8601String());
      expect(kanal.denyutan, [5]);
      expect(status().terakhirDiambil, awal);
      expect(status().tertunda, 0);
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

    testWidgets('beranda tidak ditutup popup penyiapan walau semua pengaturan ponsel belum lengkap', (tester) async {
      ukuranPonsel(tester);
      await tester.pumpWidget(aplikasi(StatusPemantauan(konfigurasi: konfig, setuju: true, izin: 'granted_while_in_use', penyiapan: keadaan)));
      await tester.pumpAndSettle();

      expect(find.text('Pengaturan ponsel'), findsNothing);
      expect(find.text('Atur'), findsNothing);
      expect(find.text('Beranda uji'), findsOneWidget);
      expect(kunciNavigatorAkar.currentState!.canPop(), isFalse);
      expect(kanal.catatan, isEmpty, reason: 'tidak memaksa layar pengaturan ponsel terbuka');
      expect(izin.dinaikkan, 0);
      await potret(tester, 'beranda-tanpa-popup-pengaturan');

      binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(find.text('Pengaturan ponsel'), findsNothing);
      expect(kunciNavigatorAkar.currentState!.canPop(), isFalse);
    });

    testWidgets('notifikasi yang diblokir tidak membuka popup atau pengaturan secara otomatis', (tester) async {
      ukuranPonsel(tester);
      keadaan = const StatusPenyiapan(notifikasi: false, penghematBaterai: true);
      await tester.pumpWidget(aplikasi(StatusPemantauan(konfigurasi: konfig, setuju: true, izin: 'granted_always', penyiapan: keadaan)));
      await tester.pumpAndSettle();
      expect(find.text('Pengaturan ponsel'), findsNothing);
      expect(find.text('Atur'), findsNothing);
      expect(kanal.catatan, isEmpty);
      expect(izin.dinaikkan, 0);
    });

    testWidgets('persetujuan pemantauan tetap diminta; tidak disusul popup pengaturan ponsel', (tester) async {
      ukuranPonsel(tester);
      await tester.pumpWidget(aplikasi(StatusPemantauan(konfigurasi: konfig, setuju: false, izin: 'granted_while_in_use', penyiapan: keadaan)));
      await tester.pumpAndSettle();
      expect(find.text('Pemantauan lokasi'), findsOneWidget);
      expect(find.text('Pengaturan ponsel'), findsNothing);

      await tester.tap(find.text('Setuju & lanjut'));
      await tester.pumpAndSettle();
      expect(find.text('Pemantauan lokasi'), findsNothing);
      expect(find.text('Pengaturan ponsel'), findsNothing);
      expect(find.text('Beranda uji'), findsOneWidget);
      expect(kunciNavigatorAkar.currentState!.canPop(), isFalse);
    });

    testWidgets('tidak ada dialog bila semuanya sudah beres', (tester) async {
      ukuranPonsel(tester);
      keadaan = const StatusPenyiapan(notifikasi: true, penghematBaterai: true);
      await tester.pumpWidget(aplikasi(StatusPemantauan(konfigurasi: konfig, setuju: true, izin: 'granted_always', penyiapan: keadaan)));
      await tester.pumpAndSettle();
      expect(find.text('Pengaturan ponsel'), findsNothing);
      expect(find.text('Pemantauan lokasi'), findsNothing);
    });

    testWidgets('mesin tanpa layar yang dibuka lagi tidak memunculkan penyiapan ponsel', (tester) async {
      ukuranPonsel(tester);
      keadaan = const StatusPenyiapan(notifikasi: false, penghematBaterai: false);
      await tester.pumpWidget(aplikasi(StatusPemantauan(konfigurasi: konfig, setuju: true, izin: 'granted_always', penyiapan: const StatusPenyiapan(notifikasi: true, penghematBaterai: true))));
      await tester.pumpAndSettle();
      final wadah = ProviderScope.containerOf(tester.element(find.byType(Scaffold)));
      final pemantau = wadah.read(pemantauLokasiProvider.notifier) as PemantauPenyiapanUji;

      binding.handleAppLifecycleStateChanged(AppLifecycleState.detached);
      pemantau.ubah(StatusPemantauan(konfigurasi: konfig, setuju: true, izin: 'granted_while_in_use', penyiapan: keadaan));
      await tester.pump();
      expect(find.text('Pengaturan ponsel'), findsNothing);
      expect(wadah.read(pemantauLokasiProvider).penyiapanDitunda, isFalse);
      expect(kunciNavigatorAkar.currentState!.canPop(), isFalse);

      binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(find.text('Pengaturan ponsel'), findsNothing);
      expect(wadah.read(pemantauLokasiProvider).penyiapanDitunda, isFalse);
      expect(kunciNavigatorAkar.currentState!.canPop(), isFalse);
      expect(kanal.catatan, isEmpty);
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
