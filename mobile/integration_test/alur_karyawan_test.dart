import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/main.dart' as app;
import 'package:integration_test/integration_test.dart';

/// Alur karyawan terhadap backend sungguhan. Jalankan dengan:
///   flutter test integration_test/alur_karyawan_test.dart -d emulator-5554 \
///     --dart-define=API_URL=http://10.0.2.2:3000/api \
///     --dart-define=UJI_EMAIL=m-emp@uji.local --dart-define=UJI_PASSWORD=UjiMobile#2026
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const email = String.fromEnvironment('UJI_EMAIL');
  const password = String.fromEnvironment('UJI_PASSWORD');

  Future<void> tunggu(WidgetTester tester, Finder f, {int detik = 20}) async {
    final batas = DateTime.now().add(Duration(seconds: detik));
    while (DateTime.now().isBefore(batas)) {
      await tester.pump(const Duration(milliseconds: 250));
      if (f.evaluate().isNotEmpty) return;
    }
    throw TestFailure('Tidak muncul dalam $detik detik: $f');
  }

  testWidgets('login → beranda → presensi → cuti → gaji → profil → keluar', (tester) async {
    app.main();
    await tester.pump(const Duration(seconds: 2));

    // Layar login.
    await tunggu(tester, find.text('HRD Nusantara'));
    await tester.enterText(find.byType(TextFormField).at(0), email);
    await tester.enterText(find.byType(TextFormField).at(1), password);
    await tester.tap(find.widgetWithText(FilledButton, 'Masuk'));

    // Beranda: sapaan, kartu presensi, akses cepat.
    await tunggu(tester, find.text('Akses cepat'.toUpperCase()));
    await tunggu(tester, find.textContaining('Check-in'));
    expect(find.text('Beranda'), findsOneWidget);

    // Presensi: riwayat 30 hari.
    await tester.tap(find.text('Presensi').last);
    await tunggu(tester, find.text('30 hari terakhir'.toUpperCase()));

    // Cuti: saldo tahun ini dari backend.
    await tester.tap(find.text('Cuti').last);
    await tunggu(tester, find.text('Saldo tahun ini'.toUpperCase()));
    await tunggu(tester, find.textContaining('/ 12 hari'));

    // Gaji: daftar slip (boleh kosong).
    await tester.tap(find.text('Gaji').last);
    await tunggu(tester, find.text('Slip Gaji'));

    // Profil: data dari /auth/me lalu keluar.
    await tester.tap(find.text('Profil').last);
    await tunggu(tester, find.text('Data diri'.toUpperCase()));
    expect(find.text('Uji Cook Mobile'), findsOneWidget);
    // Tombol keluar ada di ujung bawah daftar; gulir sampai terbangun.
    await tester.scrollUntilVisible(find.text('Keluar'), 250, scrollable: find.byType(Scrollable).last);
    await tester.tap(find.text('Keluar'));
    await tunggu(tester, find.widgetWithText(FilledButton, 'Keluar'));
    await tester.tap(find.widgetWithText(FilledButton, 'Keluar'));
    await tunggu(tester, find.text('Masuk dengan akun karyawan Anda'));
  });
}
