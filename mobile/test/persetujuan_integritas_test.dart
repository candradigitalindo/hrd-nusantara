import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/core/api/klien_api.dart';
import 'package:hrd_nusantara/fitur/auth/model_pengguna.dart';
import 'package:hrd_nusantara/fitur/auth/sesi_provider.dart';
import 'package:hrd_nusantara/fitur/privasi/persetujuan_integritas.dart';

import 'alat_uji.dart';
import 'data_uji.dart';

Widget tombolPeriksa(ValueChanged<bool> hasil) => Scaffold(
      body: Consumer(builder: (context, ref, _) => FilledButton(
        onPressed: () async => hasil(await mintaPersetujuanIntegritas(context, ref)),
        child: const Text('Periksa'),
      )),
    );

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  testWidgets('menolak pemeriksaan tidak menyimpan persetujuan; persetujuan eksplisit baru mengizinkan', (tester) async {
    ukuranPonsel(tester);
    bool? hasil;
    await tester.pumpWidget(aplikasiUji(tombolPeriksa((h) => hasil = h), overrides: [penggunaProvider.overrideWithValue(pengguna)]));
    final c = ProviderScope.containerOf(tester.element(find.text('Periksa')));
    final penyimpanan = c.read(penyimpananSesiProvider);
    await tester.tap(find.text('Periksa'));
    await tester.pumpAndSettle();
    expect(find.text('Pemeriksaan keaslian presensi'), findsOneWidget);
    await tester.tap(find.text('Batal'));
    await tester.pumpAndSettle();
    expect(hasil, isFalse);
    expect(await penyimpanan.bacaSetujuIntegritas(pengguna.id), isFalse);

    await tester.tap(find.text('Periksa'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Setuju dan lanjut'));
    await tester.pumpAndSettle();
    expect(hasil, isTrue);
    expect(await penyimpanan.bacaSetujuIntegritas(pengguna.id), isTrue);
    expect(await penyimpanan.bacaSetujuIntegritas('K2'), isFalse);
  });

  testWidgets('keluar akun saat dialog terbuka tidak memberikan persetujuan bagi sesi berikutnya', (tester) async {
    ukuranPonsel(tester);
    final akun = StateProvider<Pengguna?>((ref) => pengguna);
    bool? hasil;
    await tester.pumpWidget(aplikasiUji(tombolPeriksa((h) => hasil = h), overrides: [penggunaProvider.overrideWith((ref) => ref.watch(akun))]));
    final c = ProviderScope.containerOf(tester.element(find.text('Periksa')));
    await tester.tap(find.text('Periksa'));
    await tester.pumpAndSettle();
    c.read(akun.notifier).state = null;
    await tester.pump();
    await tester.tap(find.text('Setuju dan lanjut'));
    await tester.pumpAndSettle();
    expect(hasil, isFalse);
    expect(await c.read(penyimpananSesiProvider).bacaSetujuIntegritas(pengguna.id), isFalse);
  });
}
