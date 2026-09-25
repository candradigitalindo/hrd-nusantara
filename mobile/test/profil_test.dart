import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/fitur/auth/sesi_provider.dart';
import 'package:hrd_nusantara/fitur/pemantauan/layanan_pemantauan.dart';
import 'package:hrd_nusantara/fitur/profil/layar_profil.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:package_info_plus/package_info_plus.dart';

import 'alat_uji.dart';
import 'data_uji.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('id_ID');
    await muatFontAsli();
    PackageInfo.setMockInitialValues(
      appName: 'HRD Nusantara',
      packageName: 'id.nusantara.hrd.hrd_nusantara',
      version: '0.2.0+202609230125',
      buildNumber: '29835285',
      buildSignature: '',
      installerStore: null,
    );
  });

  testWidgets('profil: data diri, menu sesuai izin, dan versi build terpasang', (tester) async {
    ukuranPonsel(tester, tinggi: 1300);
    await tester.pumpWidget(aplikasiUji(const LayarProfil(), overrides: [
      penggunaProvider.overrideWithValue(pengguna),
      pemantauLokasiProvider.overrideWith(PemantauTetap.new),
    ]));
    await tester.pumpAndSettle();

    expect(find.text('Budi Santoso Putra'), findsOneWidget);
    expect(find.text('EMP-0001'), findsOneWidget);
    for (final menu in ['Jadwal shift', 'Kinerja & KPI', 'Pelatihan', 'Keluhan & Disiplin', 'Survei karyawan', 'Chat tim', 'Tautan WhatsApp', 'Ganti password']) {
      expect(find.text(menu), findsOneWidget, reason: menu);
    }
    expect(find.text('Versi 0.2.0+202609230125 · build 29835285'), findsOneWidget);
    await potret(tester, 'profil');
  });
}
