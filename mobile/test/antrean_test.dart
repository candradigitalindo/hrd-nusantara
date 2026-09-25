import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/core/api/klien_api.dart';
import 'package:hrd_nusantara/core/api/status_jaringan.dart';
import 'package:hrd_nusantara/core/penyimpanan/penyimpanan_sesi.dart';
import 'package:hrd_nusantara/core/widget/bingkai_jaringan.dart';
import 'package:hrd_nusantara/fitur/antrean/layar_antrean.dart';
import 'package:hrd_nusantara/fitur/antrean/mesin_antrean.dart';
import 'package:hrd_nusantara/fitur/antrean/model_antrean.dart';
import 'package:hrd_nusantara/fitur/antrean/penyimpanan_antrean.dart';
import 'package:hrd_nusantara/fitur/auth/model_pengguna.dart';
import 'package:hrd_nusantara/fitur/auth/sesi_provider.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'alat_uji.dart';
import 'data_uji.dart';

const siti = Pengguna(id: 'E2', nik: 'EMP-0002', nama: 'Siti', email: 'siti@contoh.id', peran: 'EMPLOYEE', status: 'active', izin: []);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    await initializeDateFormatting('id_ID');
    await muatFontAsli();
  });
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  group('mesin antrean', () {
    late ServerAntrean server;
    late AntreanMemori simpanan;
    late ProviderContainer c;
    late StateController<Pengguna?> akun;
    final akunUji = StateProvider<Pengguna?>((ref) => pengguna);

    MesinAntrean mesin() => c.read(antreanProvider.notifier);
    StatusAntrean antrean() => c.read(antreanProvider);

    Future<ItemAntrean> tambah(String judul, {String jalur = '/leaves', String? bergantungPada}) => mesin().tambah(
          jenis: 'cuti-ajukan',
          judul: judul,
          metode: 'POST',
          jalur: jalur,
          badan: {'reason': judul},
          bergantungPada: bergantungPada,
        );

    setUp(() async {
      server = ServerAntrean();
      simpanan = AntreanMemori();
      c = ProviderContainer(overrides: [
        penggunaProvider.overrideWith((ref) => ref.watch(akunUji)),
        penyimpananAntreanProvider.overrideWithValue(simpanan),
        klienApiProvider.overrideWith((ref) => KlienApi(
              penyimpanan: PenyimpananSesi(),
              dio: Dio()..httpClientAdapter = server,
              baseUrl: 'https://hrd.contoh/api',
              jaringan: ref.read(statusJaringanProvider.notifier),
            )),
      ]);
      addTearDown(c.dispose);
      akun = c.read(akunUji.notifier);
      c.listen(antreanProvider, (_, _) {});
      await mesin().proses();
    });

    test('online: langsung terkirim, dengan Idempotency-Key = id kiriman', () async {
      final item = await tambah('Cuti 2–3 Okt');
      await mesin().proses();

      expect(server.diterima, ['POST /api/leaves ${item.id}']);
      expect(antrean().item, isEmpty);
      expect(antrean().terkirim, 1);
      expect(antrean().laporan!.terkirim.single.judul, 'Cuti 2–3 Okt');
      expect(simpanan.isi, isEmpty);
    });

    test('offline: menunggu berurutan; saat sambungan pulih terkirim sesuai urutan', () async {
      server.putus = true;
      final a = await tambah('Pertama');
      final b = await tambah('Kedua');
      await mesin().proses();

      expect(antrean().menunggu, 2);
      expect(antrean().item.first.percobaan, 1, reason: 'yang pertama dicoba lalu menunggu');
      expect(antrean().item.last.percobaan, 0, reason: 'urutan dijaga: yang kedua tidak menyalip');
      expect(c.read(statusJaringanProvider).terhubung, isFalse);

      server.putus = false;
      await c.read(statusJaringanProvider.notifier).periksaSekarang();
      await mesin().kirimSekarang();

      expect(server.diterima, ['POST /api/leaves ${a.id}', 'POST /api/leaves ${b.id}']);
      expect(antrean().item, isEmpty);
    });

    test('ditolak server: gagal beserta alasannya; yang bergantung ikut gagal tanpa dikirim; yang lain tetap jalan', () async {
      server.jawab = (o) => o.uri.path == '/api/attendance/check-in' ? (422, {'error': 'Wajah tidak cocok dengan data karyawan ini'}) : (201, {'ok': true});
      server.putus = true;
      final masuk = await tambah('Check-in 07:55', jalur: '/attendance/check-in');
      await tambah('Check-out 17:02', jalur: '/attendance/check-out', bergantungPada: masuk.id);
      final cuti = await tambah('Cuti 2–3 Okt');
      await mesin().proses();
      server.putus = false;
      await c.read(statusJaringanProvider.notifier).periksaSekarang();
      await mesin().kirimSekarang();

      expect(server.diterima, ['POST /api/attendance/check-in ${masuk.id}', 'POST /api/leaves ${cuti.id}']);
      expect(antrean().gagal, 2);
      expect(antrean().item.first.galat, 'Wajah tidak cocok dengan data karyawan ini');
      expect(antrean().item.last.galat, contains('"Check-in 07:55" ditolak'));
      expect(antrean().laporan!.gagal, hasLength(2));
      expect(antrean().laporan!.terkirim.single.judul, 'Cuti 2–3 Okt');
    });

    test('"masih diproses" dan 5xx dicoba lagi, bukan ditolak', () async {
      var giliran = 0;
      server.jawab = (o) => switch (giliran++) {
            0 => (409, {'error': 'Permintaan yang sama masih diproses', 'code': 'idempotency_in_progress'}),
            1 => (503, {'status': 'degraded'}),
            _ => (201, {'ok': true}),
          };
      await tambah('Cuti 2–3 Okt');
      await mesin().proses();
      expect(antrean().menunggu, 1);
      expect(antrean().item.single.gagal, isFalse);

      await mesin().kirimSekarang();
      await c.read(statusJaringanProvider.notifier).periksaSekarang(); // 503 membuatnya dianggap offline
      await mesin().kirimSekarang();
      expect(antrean().item, isEmpty);
      expect(server.diterima, hasLength(3));
    });

    test('kiriman akun lain tidak dikirim sampai akun itu masuk lagi', () async {
      server.putus = true;
      await tambah('Cuti Budi');
      await mesin().proses();
      akun.state = siti;
      server.putus = false;
      await c.read(statusJaringanProvider.notifier).periksaSekarang();
      await mesin().kirimSekarang();

      expect(server.diterima, isEmpty);
      expect(antrean().item, isEmpty);
      expect(antrean().milikAkunLain, 1);

      akun.state = pengguna;
      await mesin().kirimSekarang();
      expect(server.diterima, hasLength(1));
      expect(antrean().milikAkunLain, 0);
    });

    test('akun berganti saat kiriman sedang di jalan: sisa kiriman akun lama tidak ikut terkirim', () async {
      final gerbang = Completer<void>();
      server.putus = true;
      await tambah('Cuti pertama');
      await tambah('Cuti kedua');
      await mesin().proses();

      server
        ..putus = false
        ..tahan = () => gerbang.future;
      await c.read(statusJaringanProvider.notifier).periksaSekarang();
      final berjalan = mesin().kirimSekarang();
      while (server.diterima.isEmpty) {
        await Future<void>.delayed(const Duration(milliseconds: 1));
      }
      akun.state = siti;
      gerbang.complete();
      await berjalan;

      expect(server.diterima, hasLength(1), reason: 'yang sudah di jalan selesai, sisanya berhenti');
      expect(antrean().item, isEmpty);
      expect(antrean().milikAkunLain, 1);
    });

    test('yang ditolak bisa dikirim ulang atau dibuang', () async {
      server.jawab = (_) => (409, {'error': 'Anda sudah mengisi survei ini'});
      final a = await tambah('Survei kepuasan');
      final b = await tambah('Survei lain');
      await mesin().proses();
      expect(antrean().gagal, 2);

      server.jawab = (_) => (201, {'ok': true});
      await mesin().cobaLagi(a.id);
      await mesin().hapus(b.id);
      expect(antrean().item, isEmpty);
      expect(server.diterima.last, 'POST /api/leaves ${a.id}');
    });
  });

  group('penyimpanan antrean di berkas', () {
    late Directory tmp;
    setUp(() => tmp = Directory.systemTemp.createTempSync('antrean-uji'));
    tearDown(() => tmp.deleteSync(recursive: true));

    ItemAntrean item(String alasan) => ItemAntrean(
          id: idAntreanBaru(),
          jenis: 'cuti-ajukan',
          judul: 'Cuti',
          metode: 'POST',
          jalur: '/leaves',
          badan: {'reason': alasan},
          pemilik: 'E1',
          dibuat: DateTime.now(),
        );

    test('urut, terenkripsi, dan tetap terbaca setelah keluar akun', () async {
      final simpanan = PenyimpananAntrean(PenyimpananSesi(), folderInduk: () async => tmp);
      final a = item('Acara keluarga di Medan');
      final b = item('Kontrol dokter');
      await simpanan.simpan(b.salin());
      await simpanan.simpan(a);
      expect(a.id.compareTo(b.id), lessThan(0));

      for (final f in Directory('${tmp.path}/antrean').listSync().whereType<File>()) {
        expect(latin1.decode(f.readAsBytesSync()), isNot(contains('Acara keluarga')));
      }

      // Keluar akun membuang token dan kunci cache, tapi bukan kunci antrean.
      await PenyimpananSesi().hapusSemua();
      final setelahKeluar = PenyimpananAntrean(PenyimpananSesi(), folderInduk: () async => tmp);
      expect((await setelahKeluar.semua()).map((i) => i.badan['reason']), ['Acara keluarga di Medan', 'Kontrol dokter']);

      await setelahKeluar.hapus(a.id);
      expect(await setelahKeluar.semua(), hasLength(1));
    });

    test('id antrean selalu naik dan lolos aturan Idempotency-Key server', () {
      final ids = List.generate(200, (_) => idAntreanBaru());
      expect(ids, orderedEquals([...ids]..sort()));
      expect(ids.toSet(), hasLength(200));
      for (final id in ids) {
        expect(RegExp(r'^[A-Za-z0-9_-]{8,100}$').hasMatch(id), isTrue, reason: id);
      }
    });
  });

  testWidgets('halaman antrean: menunggu, ditolak beserta alasannya, dan milik akun lain', (tester) async {
    ukuranPonsel(tester);
    final simpanan = AntreanMemori();
    ItemAntrean buat(String judul, String jenis, DateTime dibuat, {StatusKiriman status = StatusKiriman.menunggu, int percobaan = 0, String? galat, String pemilik = 'EMP-1'}) {
      final i = ItemAntrean(
        id: idAntreanBaru(),
        jenis: jenis,
        judul: judul,
        metode: 'POST',
        jalur: '/x',
        badan: const {},
        pemilik: pemilik,
        dibuat: dibuat,
        status: status,
        percobaan: percobaan,
        galat: galat,
      );
      simpanan.isi[i.id] = i;
      return i;
    }

    buat('Check-in 07:55 · Outlet Sudirman', 'presensi-masuk', jam(7, 55), percobaan: 3, galat: 'Tidak bisa terhubung ke server. Periksa koneksi internet Anda.');
    buat('Pesan ke Tim Dapur', 'chat-kirim', jam(8, 10));
    buat('Cuti Tahunan 2–3 Okt', 'cuti-ajukan', jam(9, 30, -1), status: StatusKiriman.gagal, galat: 'Saldo cuti tahunan tidak mencukupi (sisa 1 hari)');
    buat('Cuti Siti', 'cuti-ajukan', jam(9, 0), pemilik: 'EMP-2');
    final server = ServerAntrean()..putus = true;

    await tester.pumpWidget(aplikasiUji(
      const LayarAntrean(),
      builder: (context, child) => Consumer(
        builder: (context, ref, _) {
          final a = ref.watch(antreanProvider);
          return BingkaiJaringan(menunggu: a.menunggu, ditolak: a.gagal, child: child!);
        },
      ),
      overrides: [
        penggunaProvider.overrideWithValue(Pengguna(id: 'EMP-1', nik: pengguna.nik, nama: pengguna.nama, email: pengguna.email, peran: 'EMPLOYEE', status: 'active', izin: const [])),
        penyimpananAntreanProvider.overrideWithValue(simpanan),
        klienApiProvider.overrideWith((ref) => KlienApi(
              penyimpanan: PenyimpananSesi(),
              dio: Dio()..httpClientAdapter = server,
              baseUrl: 'https://hrd.contoh/api',
              jaringan: ref.read(statusJaringanProvider.notifier),
            )),
      ],
    ));
    await tester.pumpAndSettle();

    expect(find.text('Check-in 07:55 · Outlet Sudirman'), findsOneWidget);
    expect(find.textContaining('dicoba'), findsWidgets);
    expect(find.text('Saldo cuti tahunan tidak mencukupi (sisa 1 hari)'), findsOneWidget);
    expect(find.text('Ditolak'), findsOneWidget);
    expect(find.text('1 kiriman milik akun lain'), findsOneWidget);
    expect(find.textContaining('Offline · Tidak terhubung ke server · 2 menunggu terkirim · 1 ditolak'), findsOneWidget);
    await potret(tester, 'antrean');

    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('saat online, kiriman yang ditolak tetap diberi pita sampai diperiksa', (tester) async {
    await tester.pumpWidget(aplikasiUji(
      const Scaffold(body: Text('Beranda')),
      builder: (context, child) => BingkaiJaringan(ditolak: 2, bukaAntrean: () {}, child: child!),
    ));
    expect(find.textContaining('2 kiriman ditolak server'), findsOneWidget);
    expect(find.text('Lihat'), findsOneWidget);
  });
}
