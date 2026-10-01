import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hrd_nusantara/core/api/galat_api.dart';
import 'package:hrd_nusantara/core/api/status_jaringan.dart';
import 'package:hrd_nusantara/core/tema.dart';
import 'package:hrd_nusantara/fitur/presensi/layar_absen.dart';
import 'package:hrd_nusantara/fitur/wajah/layar_wajah.dart';
import 'package:hrd_nusantara/fitur/wajah/model_wajah.dart';
import 'package:hrd_nusantara/fitur/wajah/repo_wajah.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'alat_uji.dart';
import 'data_uji.dart';

/// Status jaringan tetap, tanpa pemeriksaan server berkala.
class JaringanTetap extends PemantauJaringan {
  JaringanTetap(this.awal);
  final StatusJaringan awal;
  @override
  StatusJaringan build() => awal;
}

const fotoContoh = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/';

Override statusTetap(Map<String, dynamic> json) => statusWajahProvider.overrideWith((ref) async => StatusWajah.dariJson(json));

/// Tombol berjenis [T] berlabel [teks]. Bukan `find.widgetWithText`:
/// `FilledButton.icon` dan sejenisnya adalah subkelas, tidak cocok dengan byType.
Finder tombol<T extends Widget>(String teks) => find.ancestor(of: find.text(teks), matching: find.byWidgetPredicate((w) => w is T));

/// Pohon baru setiap kali, supaya override dari pemasangan sebelumnya tidak terbawa.
Future<void> pasang(WidgetTester tester, Widget aplikasi) => tester.pumpWidget(KeyedSubtree(key: UniqueKey(), child: aplikasi));

void main() {
  setUpAll(() async {
    await initializeDateFormatting('id_ID');
    await muatFontAsli();
  });
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  group('StatusWajah.dariJson', () {
    test('belum pernah mengirim', () {
      final s = StatusWajah.dariJson(jsonStatusWajah());
      expect(s.terdaftar, isFalse);
      expect(s.menunggu, isNull);
      expect(s.penolakan, isNull);
      expect(s.keadaan, KeadaanWajah.belum);
      expect(s.perluMendaftar, isTrue);
      expect(s.ringkasan, 'Belum terdaftar');
    });

    test('menunggu persetujuan HR: id dan waktu kirim terbaca', () {
      final s = StatusWajah.dariJson(jsonStatusWajah(menunggu: true));
      expect(s.keadaan, KeadaanWajah.menunggu);
      expect(s.menunggu!.id, 'FE-2');
      expect(DateTime.now().difference(s.menunggu!.dikirimPada!).inMinutes, 25);
      expect(s.perluMendaftar, isFalse);
      expect(s.ringkasan, 'Menunggu persetujuan HR');
    });

    test('ditolak: alasan HR terbaca; alasan kosong dianggap tidak ada', () {
      final s = StatusWajah.dariJson(jsonStatusWajah(ditolak: '  Foto buram '));
      expect(s.keadaan, KeadaanWajah.ditolak);
      expect(s.penolakan!.alasan, 'Foto buram');
      expect(s.penolakan!.ditolakPada, isNotNull);
      expect(s.perluMendaftar, isTrue);
      expect(s.ringkasan, 'Ditolak — kirim ulang');

      final tanpaAlasan = StatusWajah.dariJson({...jsonStatusWajah(), 'lastRejection': {'id': 'FE-1', 'reason': null, 'reviewedAt': null}});
      expect(tanpaAlasan.keadaan, KeadaanWajah.ditolak);
      expect(tanpaAlasan.penolakan!.alasan, isNull);
      expect(StatusWajah.dariJson(jsonStatusWajah(ditolak: '   ')).penolakan!.alasan, isNull);
    });

    test('terdaftar tetap terdaftar walau foto penggantinya menunggu atau ditolak', () {
      final s = StatusWajah.dariJson(jsonStatusWajah(terdaftar: true));
      expect(s.keadaan, KeadaanWajah.terdaftar);
      expect(s.ringkasan, 'Terdaftar');

      final ganti = StatusWajah.dariJson(jsonStatusWajah(terdaftar: true, menunggu: true));
      expect(ganti.keadaan, KeadaanWajah.terdaftar);
      expect(ganti.perluMendaftar, isFalse);
      expect(ganti.ringkasan, 'Terdaftar · foto baru menunggu persetujuan HR');

      expect(StatusWajah.dariJson(jsonStatusWajah(terdaftar: true, ditolak: 'Bukan wajah karyawan ini')).keadaan, KeadaanWajah.terdaftar);
    });

    test('dinonaktifkan server mengalahkan keadaan lain', () {
      final s = StatusWajah.dariJson(jsonStatusWajah(terdaftar: true, aktif: false));
      expect(s.keadaan, KeadaanWajah.nonaktif);
      expect(s.perluMendaftar, isFalse);
      expect(s.ringkasan, 'Verifikasi wajah dinonaktifkan');
      // Tanpa kolomnya (server lama) dianggap aktif.
      expect(StatusWajah.dariJson({'enrolled': false}).keadaan, KeadaanWajah.belum);
    });
  });

  group('layar wajah', () {
    Future<void> buka(WidgetTester tester, Map<String, dynamic> json) async {
      ukuranPonsel(tester, tinggi: 1100);
      await pasang(tester, aplikasiUji(const LayarWajah(), overrides: [statusTetap(json)]));
      await tester.pumpAndSettle();
    }

    testWidgets('belum terdaftar: penjelasan dan tombol Ambil selfie', (tester) async {
      await buka(tester, jsonStatusWajah());
      expect(find.text('Wajah belum terdaftar'), findsOneWidget);
      expect(find.text('Diperlukan untuk check-in Verifikasi Wajah'), findsOneWidget);
      expect(tombol<FilledButton>('Ambil selfie'), findsOneWidget);
      expect(find.text('CARA KERJA'), findsOneWidget);
      expect(find.text('AGAR FOTO DITERIMA'), findsOneWidget);
      await potret(tester, 'wajah-belum');
    });

    testWidgets('menunggu: waktu kirim, saran GPS/QR, dan kirim ulang', (tester) async {
      await buka(tester, jsonStatusWajah(menunggu: true));
      expect(find.text('Menunggu persetujuan HR'), findsOneWidget);
      expect(find.text('Dikirim 25 menit lalu'), findsOneWidget);
      expect(find.textContaining('check-in pakai Lokasi GPS atau Pindai QR'), findsOneWidget);
      expect(tombol<OutlinedButton>('Kirim ulang foto'), findsOneWidget);
      await potret(tester, 'wajah-menunggu');
    });

    testWidgets('ditolak: alasan dari HR dan tombol Kirim ulang', (tester) async {
      await buka(tester, jsonStatusWajah(ditolak: 'Foto buram, wajah tertutup bayangan'));
      expect(find.text('Foto ditolak HR'), findsOneWidget);
      expect(find.text('Diperiksa kemarin 09:15'), findsOneWidget);
      expect(find.text('Alasan HR: Foto buram, wajah tertutup bayangan'), findsOneWidget);
      expect(tombol<FilledButton>('Kirim ulang'), findsOneWidget);
      await potret(tester, 'wajah-ditolak');
    });

    testWidgets('terdaftar: centang hijau, Perbarui foto; foto pengganti yang menunggu disebut', (tester) async {
      await buka(tester, jsonStatusWajah(terdaftar: true));
      expect(find.text('Wajah terdaftar'), findsOneWidget);
      expect(find.byIcon(Icons.check_circle), findsOneWidget);
      expect(tombol<OutlinedButton>('Perbarui foto'), findsOneWidget);
      expect(find.textContaining('menunggu persetujuan HR'), findsNothing);
      await potret(tester, 'wajah-terdaftar');

      await buka(tester, jsonStatusWajah(terdaftar: true, menunggu: true));
      expect(find.text('Wajah terdaftar'), findsOneWidget);
      expect(find.text('Foto baru dikirim 25 menit lalu, menunggu persetujuan HR.'), findsOneWidget);
    });

    testWidgets('dinonaktifkan server: tanpa tombol kirim', (tester) async {
      await buka(tester, jsonStatusWajah(aktif: false));
      expect(find.text('Verifikasi wajah dinonaktifkan'), findsOneWidget);
      expect(find.byWidgetPredicate((w) => w is ButtonStyleButton), findsNothing);
    });

    testWidgets('status tidak bisa dimuat: panel galat dengan Coba lagi', (tester) async {
      ukuranPonsel(tester);
      await tester.pumpWidget(aplikasiUji(const LayarWajah(), overrides: [
        statusWajahProvider.overrideWith((ref) async => throw GalatApi('Tidak bisa terhubung ke server. Periksa koneksi internet Anda.')),
      ]));
      await tester.pumpAndSettle();
      expect(find.text('Tidak terhubung'), findsOneWidget);
      expect(find.text('Coba lagi'), findsOneWidget);
      expect(find.text('Ambil selfie'), findsNothing);
    });
  });

  group('kirim selfie', () {
    late ServerAntrean server;
    late int kamera;
    late bool sudahKirim;

    Future<void> buka(WidgetTester tester, {List<Override> tambahan = const []}) async {
      ukuranPonsel(tester, tinggi: 1100);
      await tester.pumpWidget(aplikasiUji(const LayarWajah(), overrides: [
        klienTiruan(server),
        ambilSelfieWajahProvider.overrideWithValue((_) async {
          kamera++;
          return fotoContoh;
        }),
        ...tambahan,
      ]));
      await tester.pumpAndSettle();
    }

    setUp(() {
      kamera = 0;
      sudahKirim = false;
      server = ServerAntrean()
        ..jawab = (o) {
          if (o.method == 'POST') {
            sudahKirim = true;
            return (201, {'id': 'FE-9', 'status': 'pending', 'createdAt': iso(DateTime.now())});
          }
          return (200, sudahKirim ? jsonStatusWajah(menunggu: true) : jsonStatusWajah());
        };
    });

    testWidgets('foto dikirim ke POST /face-enrollments/me, lalu status dimuat ulang', (tester) async {
      await buka(tester);
      expect(find.text('Wajah belum terdaftar'), findsOneWidget);

      await tester.tap(find.text('Ambil selfie'));
      await tester.pumpAndSettle();

      expect(kamera, 1);
      final kiriman = server.percobaan.where((o) => o.method == 'POST').toList();
      expect(kiriman, hasLength(1));
      expect(kiriman.single.uri.path, '/api/face-enrollments/me');
      expect(kiriman.single.data, {'image': fotoContoh});
      // Bukan kiriman antrean: tanpa Idempotency-Key.
      expect(kiriman.single.headers['Idempotency-Key'], isNull);
      expect(find.text('Foto terkirim ke HR'), findsOneWidget);
      // Belum punya foto yang disetujui: sementara pakai GPS/QR.
      expect(find.text('Anda diberi tahu setelah HR memeriksanya. Sementara itu, check-in pakai Lokasi GPS atau Pindai QR.'), findsOneWidget);
      expect(find.text('Menunggu persetujuan HR'), findsOneWidget);
      expect(find.text('Kirim ulang foto'), findsOneWidget);
    });

    testWidgets('perbarui foto saat sudah terdaftar: tidak disuruh pindah ke GPS/QR', (tester) async {
      // Foto lama tetap dipakai check-in sampai foto baru disetujui HR.
      server.jawab = (o) {
        if (o.method == 'POST') {
          sudahKirim = true;
          return (201, {'id': 'FE-9', 'status': 'pending', 'createdAt': iso(DateTime.now())});
        }
        return (200, jsonStatusWajah(terdaftar: true, menunggu: sudahKirim));
      };
      await buka(tester);

      await tester.tap(find.text('Perbarui foto'));
      await tester.pumpAndSettle();

      expect(find.text('Foto terkirim ke HR'), findsOneWidget);
      expect(find.textContaining('check-in wajah tetap memakai foto lama'), findsOneWidget);
      expect(find.textContaining('Lokasi GPS atau Pindai QR'), findsNothing);
    });

    testWidgets('ditolak pemeriksaan otomatis (422): alasannya tetap tampil di kartu', (tester) async {
      const pesan = 'Foto terdeteksi bukan wajah langsung. Arahkan kamera ke wajah Anda, bukan ke foto atau layar.';
      server.jawab = (o) => o.method == 'POST' ? (422, {'error': pesan, 'reason': 'spoof_detected'}) : (200, jsonStatusWajah());
      await buka(tester);

      await tester.tap(find.text('Ambil selfie'));
      await tester.pumpAndSettle();

      expect(find.text('Foto belum bisa dipakai'), findsOneWidget);
      expect(find.text('Foto tadi belum bisa dipakai: $pesan'), findsOneWidget);
      expect(find.text('Wajah belum terdaftar'), findsOneWidget);
      await potret(tester, 'wajah-ditolak-sistem');
    });

    testWidgets('offline: kamera tidak dibuka dan tidak ada yang dikirim atau diantrekan', (tester) async {
      await buka(tester, tambahan: [
        statusTetap(jsonStatusWajah()),
        statusJaringanProvider.overrideWith(() => JaringanTetap(const StatusJaringan(terhubung: false))),
      ]);

      await tester.tap(find.text('Ambil selfie'));
      await tester.pumpAndSettle();

      expect(kamera, 0);
      expect(server.percobaan, isEmpty);
      expect(find.text('Butuh koneksi internet'), findsOneWidget);
    });
  });

  group('lembar absen', () {
    Future<void> bukaLembar(WidgetTester tester, Override status) async {
      ukuranPonsel(tester);
      final router = GoRouter(routes: [
        GoRoute(
          path: '/',
          builder: (context, _) => Scaffold(
            body: Center(child: FilledButton(onPressed: () => LayarAbsen.buka(context, pulang: false), child: const Text('Absen'))),
          ),
        ),
        GoRoute(path: '/wajah', builder: (_, _) => const Scaffold(body: Text('LAYAR WAJAH'))),
      ]);
      addTearDown(router.dispose);
      await pasang(tester, ProviderScope(
        overrides: [status],
        child: MaterialApp.router(
          theme: temaTerang(),
          locale: const Locale('id', 'ID'),
          supportedLocales: const [Locale('id', 'ID')],
          localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
          routerConfig: router,
        ),
      ));
      await tester.tap(find.text('Absen'));
      await tester.pumpAndSettle();
    }

    testWidgets('belum terdaftar: ketukan menutup lembar dan membuka layar wajah, bukan check-in', (tester) async {
      await bukaLembar(tester, statusTetap(jsonStatusWajah()));
      expect(find.text('Belum terdaftar — ketuk untuk mendaftar'), findsOneWidget);
      await potret(tester, 'absen-wajah-belum');

      await tester.tap(find.text('Verifikasi Wajah'));
      await tester.pumpAndSettle();
      expect(find.text('LAYAR WAJAH'), findsOneWidget);
      expect(find.text('Check-in'), findsNothing, reason: 'lembar absen sudah ditutup');
    });

    testWidgets('ditolak juga diarahkan mendaftar ulang', (tester) async {
      await bukaLembar(tester, statusTetap(jsonStatusWajah(ditolak: 'Foto buram')));
      expect(find.text('Belum terdaftar — ketuk untuk mendaftar'), findsOneWidget);
    });

    testWidgets('menunggu: ketukan menjelaskan pakai GPS atau QR; Lihat status membuka layar wajah', (tester) async {
      await bukaLembar(tester, statusTetap(jsonStatusWajah(menunggu: true)));
      expect(find.text('Menunggu persetujuan HR'), findsOneWidget);

      await tester.tap(find.text('Verifikasi Wajah'));
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsOneWidget);
      expect(find.textContaining('pakai Lokasi GPS atau Pindai QR'), findsOneWidget);

      await tester.tap(find.text('Mengerti'));
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
      expect(find.text('Check-in'), findsOneWidget, reason: 'lembar tetap terbuka untuk memilih GPS atau QR');

      await tester.tap(find.text('Verifikasi Wajah'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Lihat status'));
      await tester.pumpAndSettle();
      expect(find.text('LAYAR WAJAH'), findsOneWidget);
    });

    testWidgets('terdaftar, atau status tidak terbaca (offline): keterangan seperti biasa', (tester) async {
      await bukaLembar(tester, statusTetap(jsonStatusWajah(terdaftar: true)));
      expect(find.text('Selfie + lokasi GPS. Paling kuat, dianjurkan.'), findsOneWidget);

      await bukaLembar(tester, statusWajahProvider.overrideWith((ref) async => throw GalatApi('Tidak bisa terhubung ke server.')));
      expect(find.text('Selfie + lokasi GPS. Paling kuat, dianjurkan.'), findsOneWidget);
    });
  });
}
