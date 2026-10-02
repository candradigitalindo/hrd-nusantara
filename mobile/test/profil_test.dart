import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/fitur/auth/sesi_provider.dart';
import 'package:hrd_nusantara/fitur/pemantauan/layanan_pemantauan.dart';
import 'package:hrd_nusantara/fitur/pemantauan/repo_pemantauan.dart';
import 'package:hrd_nusantara/fitur/profil/layar_profil.dart';
import 'package:hrd_nusantara/fitur/wajah/model_wajah.dart';
import 'package:hrd_nusantara/fitur/wajah/repo_wajah.dart';
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
    ukuranPonsel(tester, tinggi: 1400);
    await tester.pumpWidget(aplikasiUji(const LayarProfil(), overrides: [
      penggunaProvider.overrideWithValue(pengguna),
      pemantauLokasiProvider.overrideWith(PemantauTetap.new),
      statusWajahProvider.overrideWith((ref) async => StatusWajah.dariJson(jsonStatusWajah(menunggu: true))),
    ]));
    await tester.pumpAndSettle();

    expect(find.text('Budi Santoso Putra'), findsOneWidget);
    expect(find.text('EMP-0001'), findsOneWidget);
    expect(find.text('Menunggu persetujuan HR'), findsOneWidget);
    for (final menu in ['Jadwal shift', 'Wajah untuk Presensi', 'Kinerja & KPI', 'Pelatihan', 'Keluhan & Disiplin', 'Survei karyawan', 'Chat tim', 'Tautan WhatsApp', 'Ganti password']) {
      expect(find.text(menu), findsOneWidget, reason: menu);
    }
    expect(find.text('Versi 0.2.0+202609230125 · build 29835285'), findsOneWidget);
    await potret(tester, 'profil');
  });

  testWidgets('profil: tidak ada bagian Privasi / baris Pemantauan lokasi, walau pemantauan aktif', (tester) async {
    ukuranPonsel(tester, tinggi: 1400);
    const konfig = KonfigurasiPemantauan(aktif: true, selamaBekerja: false, intervalMenit: 15);
    await tester.pumpWidget(aplikasiUji(const LayarProfil(), overrides: [
      penggunaProvider.overrideWithValue(pengguna),
      pemantauLokasiProvider.overrideWith(() => PemantauTetap(const StatusPemantauan(konfigurasi: konfig, setuju: false, izin: 'denied'))),
      statusWajahProvider.overrideWith((ref) async => StatusWajah.dariJson(jsonStatusWajah())),
    ]));
    await tester.pumpAndSettle();

    // JudulBagian menampilkan judul dengan huruf besar.
    expect(find.text('PRIVASI'), findsNothing);
    expect(find.text('Pemantauan lokasi'), findsNothing);
    expect(find.textContaining('Belum Anda setujui'), findsNothing);
    // Kontrol positif: bagian lain di bawahnya tetap tampil, jadi asersi di atas
    // memang membaca layar yang sama (bukan lolos karena salah huruf).
    expect(find.text('NOTIFIKASI'), findsOneWidget);
    await potret(tester, 'profil-pemantauan-aktif');
  });
}
