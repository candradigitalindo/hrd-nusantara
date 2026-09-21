import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/core/api/klien_api.dart';
import 'package:hrd_nusantara/core/penyimpanan/penyimpanan_sesi.dart';
import 'package:hrd_nusantara/fitur/auth/layar_login.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  testWidgets('validasi form sebelum memanggil server', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [penyimpananSesiProvider.overrideWithValue(PenyimpananSesi(const FlutterSecureStorage()))],
        child: const MaterialApp(home: LayarLogin()),
      ),
    );
    expect(find.text('HRD Nusantara'), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, 'Masuk'));
    await tester.pump();
    expect(find.text('Masukkan nomor HP (08xx) atau email'), findsOneWidget);
    expect(find.text('Password wajib diisi'), findsOneWidget);

    await tester.enterText(find.byType(TextFormField).first, '0812 3456 7890');
    await tester.tap(find.widgetWithText(FilledButton, 'Masuk'));
    await tester.pump();
    expect(find.text('Masukkan nomor HP (08xx) atau email'), findsNothing);
    expect(find.text('Password wajib diisi'), findsOneWidget);
  });

  testWidgets('tombol mata menampilkan dan menyembunyikan password', (tester) async {
    await tester.pumpWidget(ProviderScope(child: const MaterialApp(home: LayarLogin())));
    expect(find.byIcon(Icons.visibility_outlined), findsOneWidget);
    await tester.tap(find.byIcon(Icons.visibility_outlined));
    await tester.pump();
    expect(find.byIcon(Icons.visibility_off_outlined), findsOneWidget);
  });
}
