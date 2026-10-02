import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/fitur/antrean/penyimpanan_antrean.dart';
import 'package:hrd_nusantara/fitur/auth/model_pengguna.dart';
import 'package:hrd_nusantara/fitur/auth/sesi_provider.dart';
import 'package:hrd_nusantara/fitur/beranda/layar_beranda.dart';
import 'package:hrd_nusantara/fitur/jadwal/model_shift.dart';
import 'package:hrd_nusantara/fitur/jadwal/repo_jadwal.dart';
import 'package:hrd_nusantara/fitur/pemantauan/layanan_pemantauan.dart';
import 'package:hrd_nusantara/fitur/presensi/repo_presensi.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'alat_uji.dart';
import 'data_uji.dart';

/// Akun yang login, bisa diganti di tengah tes (null = belum login).
final akunUji = StateProvider<Pengguna?>((ref) => null);

Map<String, Object?> presensiTerbukaHariIni({Duration sejak = const Duration(minutes: 10)}) {
  final masuk = DateTime.now().subtract(sejak);
  return {
    'id': 'P-terbuka',
    'status': 'present',
    'checkInTime': iso(masuk),
    'checkOutTime': null,
    'checkInMethod': 'gps',
    'lateMinutes': 0,
    'workedMinutes': null,
    'overtimeHours': '0',
    'faceVerified': false,
    'workLocation': {'id': 'L1', 'name': 'Outlet Sudirman'},
  };
}

/// Antrean kirim punya timer berulang, jadi pumpAndSettle tidak pernah
/// selesai; cukup beri waktu permintaan dan penggambaran ulang.
Future<void> tunggu(WidgetTester tester) async {
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 250));
  }
}

(int, Object?) daftarKosong() => (200, {'data': <Object>[], 'pagination': {'page': 1, 'limit': 100, 'total': 0, 'totalPages': 1}});

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    await initializeDateFormatting('id_ID');
  });
  // Klien API membaca token dari penyimpanan aman pada setiap permintaan;
  // tanpa tiruan ini pembacaannya tidak pernah selesai di lingkungan tes.
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  final karyawan = Pengguna(id: pengguna.id, nik: pengguna.nik, nama: pengguna.nama, email: pengguna.email, peran: 'EMPLOYEE', status: 'active', izin: const ['dashboard.lihat', 'presensi.lihat']);

  testWidgets('login pertama: riwayat presensi tidak diminta sebelum login, dan Beranda tampil begitu login', (tester) async {
    // Laporan pengguna: setelah login pertama (lalu dialog Akses Lokasi dan
    // izin lokasi), Beranda tidak muncul. Penyebabnya: Pemantauan Lokasi
    // dibangun sejak aplikasi mulai dan ikut menghidupkan presensi hari ini,
    // sehingga riwayat diminta saat masih di layar login (401). Galat itu
    // tersimpan, dan Beranda sesudah login membacanya — lalu rusak.
    ukuranPonsel(tester, tinggi: 1600);
    final server = ServerAntrean();
    var sudahLogin = false;
    server.jawab = (o) {
      if (o.uri.path.endsWith('/attendance/me')) {
        if (!sudahLogin) return (401, {'error': 'Token akses dibutuhkan'});
        return (200, {'data': [presensiTerbukaHariIni()], 'pagination': {'page': 1, 'limit': 60, 'total': 1, 'totalPages': 1}});
      }
      return daftarKosong();
    };

    await tester.pumpWidget(aplikasiUji(
      Consumer(builder: (context, ref, _) {
        // Seperti PendengarPemantauan di akar aplikasi: hidup sebelum login.
        ref.watch(pemantauLokasiProvider);
        return ref.watch(penggunaProvider) == null ? const Scaffold(body: Center(child: Text('Layar login'))) : const LayarBeranda();
      }),
      overrides: [
        klienTiruan(server),
        penyimpananAntreanProvider.overrideWithValue(AntreanMemori()),
        penggunaProvider.overrideWith((ref) => ref.watch(akunUji)),
        shiftHariIniProvider.overrideWith((ref) async => null),
        jadwalProvider.overrideWith((ref) async => <Shift>[]),
        lokasiKerjaProvider.overrideWith((ref) async => []),
      ],
    ));
    await tunggu(tester);
    expect(find.text('Layar login'), findsOneWidget);
    // Belum login: tidak ada permintaan riwayat yang terkirim tanpa token.
    expect(server.percobaan.where((o) => o.uri.path.endsWith('/attendance/me')), isEmpty);

    sudahLogin = true;
    final wadah = ProviderScope.containerOf(tester.element(find.byType(Consumer).first));
    wadah.read(akunUji.notifier).state = karyawan;
    await tunggu(tester);

    expect(tester.takeException(), isNull);
    expect(find.byType(LayarBeranda), findsOneWidget);
    expect(find.text('Budi Santoso Putra'), findsOneWidget);
    // Riwayat dimuat ulang sesudah login: presensi hari ini yang masih terbuka terbaca.
    expect(find.text('Check-out'), findsOneWidget);
    expect(server.percobaan.where((o) => o.uri.path.endsWith('/attendance/me')).length, 1);
  });

  testWidgets('shift malam: sesi yang dibuka sebelum tengah malam tetap sesi hari ini, tombolnya Check-out', (tester) async {
    // Dulu presensi hari ini disaring dari tanggal check-in, sehingga lewat
    // pukul 00:00 tombol berubah jadi "Check-in" — ditolak server ("sudah
    // check-in") — dan karyawan shift malam tidak bisa check-out.
    ukuranPonsel(tester, tinggi: 1600);
    final server = ServerAntrean()
      ..jawab = (o) => o.uri.path.endsWith('/attendance/me')
          ? (200, {'data': [presensiTerbukaHariIni(sejak: const Duration(hours: 5))], 'pagination': {'page': 1, 'limit': 60, 'total': 1, 'totalPages': 1}})
          : daftarKosong();

    await tester.pumpWidget(aplikasiUji(const LayarBeranda(), overrides: [
      klienTiruan(server),
      penyimpananAntreanProvider.overrideWithValue(AntreanMemori()),
      penggunaProvider.overrideWithValue(karyawan),
      pemantauLokasiProvider.overrideWith(() => PemantauTetap()),
      shiftHariIniProvider.overrideWith((ref) async => null),
      jadwalProvider.overrideWith((ref) async => <Shift>[]),
      lokasiKerjaProvider.overrideWith((ref) async => []),
    ]));
    await tunggu(tester);

    expect(tester.takeException(), isNull);
    expect(find.text('Check-out'), findsOneWidget);
  });

  testWidgets('dibuka lagi setelah layar ditutup (mesin tetap hidup): Beranda memuat ulang presensi hari ini', (tester) async {
    // Mesin Flutter dipertahankan untuk Pemantauan Lokasi, jadi Beranda tidak
    // dibangun ulang dari nol saat aplikasi dibuka lagi keesokan harinya.
    ukuranPonsel(tester, tinggi: 1600);
    final server = ServerAntrean()
      ..jawab = (o) => o.uri.path.endsWith('/attendance/me')
          ? (200, {'data': [presensiTerbukaHariIni()], 'pagination': {'page': 1, 'limit': 60, 'total': 1, 'totalPages': 1}})
          : daftarKosong();

    await tester.pumpWidget(aplikasiUji(const LayarBeranda(), overrides: [
      klienTiruan(server),
      penyimpananAntreanProvider.overrideWithValue(AntreanMemori()),
      penggunaProvider.overrideWithValue(karyawan),
      pemantauLokasiProvider.overrideWith(() => PemantauTetap()),
      shiftHariIniProvider.overrideWith((ref) async => null),
      jadwalProvider.overrideWith((ref) async => <Shift>[]),
      lokasiKerjaProvider.overrideWith((ref) async => []),
    ]));
    await tunggu(tester);
    int permintaanRiwayat() => server.percobaan.where((o) => o.uri.path.endsWith('/attendance/me')).length;
    expect(permintaanRiwayat(), 1);

    ProviderScope.containerOf(tester.element(find.byType(LayarBeranda))).read(dibukaUlangProvider.notifier).state++;
    await tunggu(tester);
    expect(tester.takeException(), isNull);
    expect(permintaanRiwayat(), 2);
  });

  testWidgets('satu bagian Beranda yang gagal dimuat tidak merusak seluruh Beranda', (tester) async {
    // Riverpod 2.6: AsyncValue.value melempar ulang galat; Beranda yang
    // membacanya begitu akan hilang seluruhnya karena satu permintaan gagal.
    ukuranPonsel(tester, tinggi: 2400);
    final server = ServerAntrean()..jawab = (o) => (500, {'error': 'Server sedang bermasalah'});

    await tester.pumpWidget(aplikasiUji(const LayarBeranda(), overrides: [
      klienTiruan(server),
      penyimpananAntreanProvider.overrideWithValue(AntreanMemori()),
      penggunaProvider.overrideWithValue(pengguna),
      pemantauLokasiProvider.overrideWith(() => PemantauTetap()),
    ]));
    await tunggu(tester);

    expect(tester.takeException(), isNull);
    expect(find.byType(LayarBeranda), findsOneWidget);
    expect(find.text('Budi Santoso Putra'), findsOneWidget);
    for (final ubin in ['Jadwal', 'Riwayat', 'Cuti', 'Slip Gaji']) {
      expect(find.text(ubin), findsWidgets, reason: 'ubin akses cepat "$ubin" tetap tampil');
    }
  });
}
