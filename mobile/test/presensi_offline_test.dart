import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/core/api/galat_api.dart';
import 'package:hrd_nusantara/core/api/jam_server.dart';
import 'package:hrd_nusantara/core/api/status_jaringan.dart';
import 'package:hrd_nusantara/core/widget/bingkai_jaringan.dart';
import 'package:hrd_nusantara/fitur/antrean/mesin_antrean.dart';
import 'package:hrd_nusantara/fitur/antrean/model_antrean.dart';
import 'package:hrd_nusantara/fitur/antrean/penyimpanan_antrean.dart';
import 'package:hrd_nusantara/fitur/auth/sesi_provider.dart';
import 'package:hrd_nusantara/fitur/presensi/layar_presensi.dart';
import 'package:hrd_nusantara/fitur/presensi/model_presensi.dart';
import 'package:hrd_nusantara/fitur/presensi/pengirim_presensi.dart';
import 'package:hrd_nusantara/fitur/presensi/repo_presensi.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'alat_uji.dart';
import 'data_uji.dart';

/// Jam monotonik dan jam dinding yang bisa diatur tes.
class JamTiruan {
  int mono = 5 * 3600 * 1000;
  String? boot = 'boot-7';
  DateTime dinding = DateTime.utc(2026, 9, 25, 3);

  void maju(Duration d) {
    mono += d.inMilliseconds;
    dinding = dinding.add(d);
  }

  JamServer jamServer(Directory folder) =>
      JamServer(folderInduk: () async => folder, bacaMonotonik: () async => (ms: mono, boot: boot), jamDinding: () => dinding);
}

ItemAntrean kiriman(String jenis, DateTime waktu, {String? bergantungPada, StatusKiriman status = StatusKiriman.menunggu, String? lokasi}) => ItemAntrean(
      id: idAntreanBaru(),
      jenis: jenis,
      judul: jenis,
      metode: 'POST',
      jalur: '/attendance/x',
      badan: const {},
      pemilik: pengguna.id,
      dibuat: waktu,
      status: status,
      bergantungPada: bergantungPada,
      info: {'waktu': waktu.toUtc().toIso8601String(), 'metode': 'gps', 'lokasi': ?lokasi},
    );

Map<String, dynamic> jsonPresensiServer(DateTime masuk, {DateTime? pulang}) => {
      'id': 'P-server',
      'status': 'present',
      'checkInTime': iso(masuk),
      if (pulang != null) 'checkOutTime': iso(pulang),
      'checkInMethod': 'gps',
      'lateMinutes': 0,
      'workLocation': {'name': 'Outlet Sudirman'},
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    await initializeDateFormatting('id_ID');
    await muatFontAsli();
  });
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  group('jam server (bukti waktu presensi offline)', () {
    late Directory tmp;
    late JamTiruan jam;
    setUp(() {
      tmp = Directory.systemTemp.createTempSync('jam-uji');
      jam = JamTiruan();
    });
    tearDown(() => tmp.deleteSync(recursive: true));

    final jamSepuluh = DateTime.utc(2026, 9, 25, 3); // 10.00 WIB

    test('perkiraan = jam server tercatat + jam monotonik sejak itu, walau jam ponsel diputar', () async {
      final js = jam.jamServer(tmp);
      await js.catat(jamSepuluh);
      jam.maju(const Duration(hours: 2, minutes: 5));
      jam.dinding = jam.dinding.subtract(const Duration(hours: 3)); // karyawan memutar jam ponsel

      expect(await js.perkiraan(), jamSepuluh.add(const Duration(hours: 2, minutes: 5)));
      // Patokan tersimpan di berkas: tetap berlaku setelah aplikasi dibuka ulang.
      expect(await jam.jamServer(tmp).perkiraan(), jamSepuluh.add(const Duration(hours: 2, minutes: 5)));
    });

    test('ponsel sempat dinyalakan ulang, atau jam monotonik mundur: tanpa perkiraan', () async {
      final js = jam.jamServer(tmp);
      await js.catat(jamSepuluh);
      jam
        ..maju(const Duration(hours: 1))
        ..boot = 'boot-8';
      expect(await js.perkiraan(), isNull);

      jam
        ..boot = 'boot-7'
        ..mono = 1000;
      expect(await js.perkiraan(), isNull);
    });

    test('tanpa hitungan boot (iOS): nyala ulang dan jam ponsel yang diputar sama-sama menahan perkiraan', () async {
      jam.boot = null;
      final js = jam.jamServer(tmp);
      await js.catat(jamSepuluh);
      jam.maju(const Duration(minutes: 40));
      expect(await js.perkiraan(), jamSepuluh.add(const Duration(minutes: 40)));

      jam.dinding = jam.dinding.subtract(const Duration(hours: 1));
      expect(await js.perkiraan(), isNull);
    });

    test('dicatat paling sering semenit sekali; bukti waktu berpresisi milidetik', () async {
      final js = jam.jamServer(tmp);
      await js.catat(jamSepuluh);
      jam.maju(const Duration(seconds: 20));
      await js.catat(jamSepuluh.add(const Duration(hours: 5))); // diabaikan
      expect(await js.perkiraan(), jamSepuluh.add(const Duration(seconds: 20)));

      final b = await js.bukti(waktuGps: DateTime.utc(2026, 9, 25, 3, 0, 18, 123, 456));
      expect(b['capturedAt'], '2026-09-25T03:00:20.000Z');
      expect(b['serverTimeEstimate'], '2026-09-25T03:00:20.000Z');
      expect(b['gpsTime'], '2026-09-25T03:00:18.123Z');
      expect(await JamServer(folderInduk: () async => Directory.systemTemp.createTempSync()).bukti(), containsPair('serverTimeEstimate', null));
    });
  });

  group('gabungTertunda', () {
    final sekarang = DateTime(2026, 9, 25, 12);

    test('check-in di antrean tampil sebagai presensi terbuka (tombol check-out muncul)', () {
      final p = gabungTertunda(null, [kiriman('presensi-masuk', DateTime(2026, 9, 25, 7, 55), lokasi: 'Outlet Sudirman')], sekarang)!;
      expect(p.masihTerbuka, isTrue);
      expect(p.masukTertunda, isTrue);
      expect(p.jamMasuk, DateTime(2026, 9, 25, 7, 55));
      expect(p.namaLokasi, 'Outlet Sudirman');
    });

    test('check-out yang bergantung pada check-in itu melengkapinya', () {
      final masuk = kiriman('presensi-masuk', DateTime(2026, 9, 25, 7, 55));
      final p = gabungTertunda(null, [masuk, kiriman('presensi-pulang', DateTime(2026, 9, 25, 17, 2), bergantungPada: masuk.id)], sekarang)!;
      expect(p.masihTerbuka, isFalse);
      expect(p.pulangTertunda, isTrue);
      expect(p.jamPulang, DateTime(2026, 9, 25, 17, 2));
    });

    test('check-out di antrean untuk check-in yang sudah di server', () {
      final server = Presensi.dariJson(jsonPresensiServer(DateTime(2026, 9, 25, 7, 50)));
      final p = gabungTertunda(server, [kiriman('presensi-pulang', DateTime(2026, 9, 25, 17, 2))], sekarang)!;
      expect(p.id, 'P-server');
      expect(p.masukTertunda, isFalse);
      expect(p.pulangTertunda, isTrue);
      expect(p.jamPulang, DateTime(2026, 9, 25, 17, 2));
    });

    test('kiriman kemarin dan yang ditolak server tidak dihitung', () {
      expect(gabungTertunda(null, [kiriman('presensi-masuk', DateTime(2026, 9, 24, 22))], sekarang), isNull);
      expect(gabungTertunda(null, [kiriman('presensi-masuk', DateTime(2026, 9, 25, 8), status: StatusKiriman.gagal)], sekarang), isNull);
    });
  });

  group('pengirim presensi', () {
    late ServerAntrean server;
    late AntreanMemori antrean;
    late ProviderContainer c;
    late Directory tmp;
    late JamTiruan jam;

    const permintaan = PermintaanAbsen(metode: MetodeAbsen.gps, latitude: -6.2, longitude: 106.8, lokasiId: 'L1', integritas: {'platform': 'android'});
    Future<Presensi> kirim({bool pulang = false}) =>
        c.read(pengirimPresensiProvider).kirim(permintaan, pulang: pulang, namaLokasi: 'Outlet Sudirman', waktuGps: DateTime.now());

    setUp(() async {
      tmp = Directory.systemTemp.createTempSync('pengirim-uji');
      jam = JamTiruan();
      server = ServerAntrean()..jawab = (o) => (o.uri.path.endsWith('check-out') ? 200 : 201, jsonPresensiServer(DateTime.now()));
      antrean = AntreanMemori();
      final js = jam.jamServer(tmp);
      await js.catat(DateTime.now().toUtc());
      c = ProviderContainer(overrides: [
        penggunaProvider.overrideWithValue(pengguna),
        penyimpananAntreanProvider.overrideWithValue(antrean),
        jamServerProvider.overrideWithValue(js),
        klienTiruan(server),
      ]);
      addTearDown(c.dispose);
      addTearDown(() => tmp.deleteSync(recursive: true));
      c.listen(antreanProvider, (_, _) {});
      await c.read(antreanProvider.notifier).proses();
    });

    test('online: langsung tercatat, ber-Idempotency-Key, tanpa bukti offline', () async {
      final hasil = await kirim();
      expect(hasil.tertunda, isFalse);
      expect(hasil.id, 'P-server');
      final o = server.percobaan.single;
      expect(o.uri.path, '/api/attendance/check-in');
      expect(o.headers['Idempotency-Key'], isNotNull);
      expect((o.data as Map).containsKey('offline'), isFalse);
      expect(antrean.isi, isEmpty);
    });

    test('ponsel diketahui offline: langsung disimpan di antrean beserta bukti waktunya', () async {
      c.read(statusJaringanProvider.notifier).terputus();
      final hasil = await kirim();

      expect(hasil.masukTertunda, isTrue);
      expect(server.percobaan, isEmpty);
      final item = antrean.isi.values.single;
      expect(item.jenis, 'presensi-masuk');
      expect(item.judul, startsWith('Check-in '));
      expect(item.judul, endsWith(' · Outlet Sudirman'));
      final offline = item.badan['offline'] as Map;
      expect(offline['capturedAt'], isNotNull);
      expect(offline['serverTimeEstimate'], isNotNull);
      expect(offline['gpsTime'], isNotNull);
      expect(item.badan['workLocationId'], 'L1');
    });

    test('sinyal putus saat dikirim: masuk antrean dengan kunci yang SAMA', () async {
      server.putus = true;
      final hasil = await kirim();

      expect(hasil.tertunda, isTrue);
      final dicoba = server.percobaan.single.headers['Idempotency-Key'];
      expect(antrean.isi.keys.single, dicoba, reason: 'kiriman ulang dijawab server dengan presensi yang sama bila tadi sempat sampai');
    });

    test('check-out saat check-in masih mengantre: ikut mengantre di belakangnya, tidak dikirim langsung', () async {
      server.jawab = (o) => (503, {'status': 'degraded'});
      c.read(statusJaringanProvider.notifier).terputus();
      await kirim();
      c.read(statusJaringanProvider.notifier).berhasil();
      await c.read(antreanProvider.notifier).proses();

      final pulang = await kirim(pulang: true);
      expect(pulang.pulangTertunda, isTrue);
      expect(server.percobaan.where((o) => o.uri.path.endsWith('check-out')), isEmpty);
      final (masuk, keluar) = (antrean.isi.values.first, antrean.isi.values.last);
      expect(keluar.bergantungPada, masuk.id);
      expect(keluar.badan.containsKey('workLocationId'), isFalse);
    });

    test('ditolak server saat online (mis. di luar radius): galat tampil, tidak masuk antrean', () async {
      server.jawab = (_) => (400, {'error': 'Anda berada di luar radius lokasi kerja'});
      await expectLater(kirim(), throwsA(isA<GalatApi>().having((g) => g.pesan, 'pesan', 'Anda berada di luar radius lokasi kerja')));
      expect(antrean.isi, isEmpty);
    });
  });

  testWidgets('layar presensi: check-in yang masih di antrean tampil, tombol check-out tersedia', (tester) async {
    ukuranPonsel(tester);
    final antrean = AntreanMemori();
    final masuk = kiriman('presensi-masuk', jam(7, 55), lokasi: 'Outlet Sudirman');
    antrean.isi[masuk.id] = ItemAntrean(
      id: masuk.id,
      jenis: masuk.jenis,
      judul: 'Check-in 07:55 · Outlet Sudirman',
      metode: 'POST',
      jalur: '/attendance/check-in',
      badan: const {},
      pemilik: pengguna.id,
      dibuat: jam(7, 55),
      info: masuk.info,
    );
    final server = ServerAntrean()..putus = true;

    await tester.pumpWidget(aplikasiUji(
      const LayarPresensi(),
      builder: (context, child) => Consumer(
        builder: (context, ref, _) {
          final a = ref.watch(antreanProvider);
          return BingkaiJaringan(menunggu: a.menunggu, ditolak: a.gagal, child: child!);
        },
      ),
      overrides: [
        penggunaProvider.overrideWithValue(pengguna),
        penyimpananAntreanProvider.overrideWithValue(antrean),
        riwayatPresensiProvider.overrideWith((ref) async => [
              Presensi.dariJson(jsonPresensiServer(jam(7, 58, -1), pulang: jam(17, 4, -1))),
            ]),
        klienTiruan(server),
      ],
    ));
    await tester.pumpAndSettle();

    expect(find.text('07:55'), findsOneWidget);
    expect(find.text('belum terkirim'), findsOneWidget);
    expect(find.text('Check-out'), findsOneWidget);
    expect(find.textContaining('Diambil saat offline'), findsOneWidget);
    expect(find.textContaining('1 menunggu terkirim'), findsOneWidget);
    await potret(tester, 'presensi-tertunda');

    await tester.pumpWidget(const SizedBox());
  });
}
