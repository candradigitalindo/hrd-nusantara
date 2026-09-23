import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/fitur/kasus/layar_kasus.dart';
import 'package:hrd_nusantara/fitur/kasus/model_kasus.dart';
import 'package:hrd_nusantara/fitur/kasus/repo_kasus.dart';
import 'package:hrd_nusantara/fitur/pelatihan/layar_pelatihan.dart';
import 'package:hrd_nusantara/fitur/pelatihan/repo_pelatihan.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'alat_uji.dart';
import 'data_uji.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('id_ID');
    await muatFontAsli();
  });

  group('model pelatihan & kasus', () {
    test('sesi: penuh → daftar tunggu; batas pendaftaran menutup pendaftaran', () {
      final sesi = daftarSesi();
      expect(sesi[0].penuh, isFalse);
      expect(sesi[0].bukaPendaftaran, isTrue);
      expect(sesi[0].wajib, isTrue);
      expect(sesi[1].penuh, isTrue);
      expect(sesi[1].bukaPendaftaran, isTrue);
      final lewat = SesiPelatihan.dariJson({'id': 'X', 'title': 'Lama', 'status': 'scheduled', 'startDateTime': iso(jam(9, 0, -1)), 'registrationCount': 0});
      expect(lewat.bukaPendaftaran, isFalse);
    });

    test('pendaftaran: yang masih memegang kursi bisa dibatalkan, hasil evaluasi terbaca', () {
      final daftar = daftarPendaftaran();
      expect(daftar[0].aktif, isTrue);
      expect(daftar[0].mendatang, isTrue);
      expect(daftar[1].aktif, isFalse);
      expect(daftar[1].nilai, 88);
      expect(daftar[1].lulus, isTrue);
      expect(daftar[1].berlakuSampai, isNotNull);
    });

    test('kasus: keluhan vs tindakan disiplin', () {
      final k = daftarKasus();
      expect(k[0].keluhan, isTrue);
      expect(k[0].labelTipe, 'Keluhan');
      expect(k[0].selesai, isFalse);
      expect(k[1].keluhan, isFalse);
      expect(k[1].tingkat, 'sp1');
      expect(k[1].selesai, isTrue);
      expect(k[1].penanganNama, 'Administrator');
    });
  });

  testWidgets('layar pelatihan: daftar / daftar tunggu / batalkan dan riwayat', (tester) async {
    ukuranPonsel(tester, tinggi: 1200);
    await tester.pumpWidget(aplikasiUji(const LayarPelatihan(), overrides: [
      sesiTerjadwalProvider.overrideWith((ref) async => daftarSesi()),
      pendaftaranSayaProvider.overrideWith((ref) async => daftarPendaftaran()),
    ]));
    await tester.pumpAndSettle();

    expect(find.text('SESI YANG BISA DIIKUTI'), findsOneWidget);
    expect(find.text('Food Safety & Hygiene Level 1'), findsNWidgets(2)); // sesi + riwayat
    expect(find.text('Wajib'), findsOneWidget);
    expect(find.text('Batalkan'), findsOneWidget);
    expect(find.text('Daftar Tunggu'), findsOneWidget);
    expect(find.textContaining('6/6 peserta'), findsOneWidget);
    expect(find.text('RIWAYAT PELATIHAN SAYA'), findsOneWidget);
    expect(find.textContaining('nilai 88 · lulus'), findsOneWidget);
    await potret(tester, 'pelatihan');

    await tester.tap(find.text('Batalkan'));
    await tester.pumpAndSettle();
    expect(find.text('Batalkan pendaftaran?'), findsOneWidget);
    await tester.tap(find.text('Tidak'));
    await tester.pumpAndSettle();
  });

  testWidgets('layar kasus: daftar, rincian SP, dan formulir keluhan', (tester) async {
    ukuranPonsel(tester, tinggi: 900);
    await tester.pumpWidget(aplikasiUji(const LayarKasus(), overrides: [
      kasusProvider.overrideWith((ref) async => daftarKasus()),
    ]));
    await tester.pumpAndSettle();

    expect(find.text('Ajukan Keluhan'), findsOneWidget);
    expect(find.text('SP 1'), findsOneWidget);
    expect(find.text('Ditinjau'), findsOneWidget);
    expect(find.text('Selesai'), findsOneWidget);
    await potret(tester, 'kasus');

    await tester.tap(find.text('Terlambat 3 kali dalam seminggu'));
    await tester.pumpAndSettle();
    expect(find.text('CATATAN PENYELESAIAN'), findsOneWidget);
    expect(find.textContaining('SP 1 berlaku 6 bulan'), findsOneWidget);
    expect(find.text('Ditujukan kepada'), findsOneWidget);
    await potret(tester, 'kasus-rincian');
  });

  testWidgets('formulir keluhan memvalidasi sebelum memanggil server', (tester) async {
    ukuranPonsel(tester);
    await tester.pumpWidget(aplikasiUji(const LayarAjukanKeluhan(), overrides: [
      kasusProvider.overrideWith((ref) async => <Kasus>[]),
    ]));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Kirim Keluhan'));
    await tester.pump();
    expect(find.text('Minimal 3 karakter'), findsOneWidget);
    expect(find.text('Uraikan kejadiannya, minimal 10 karakter'), findsOneWidget);
    await tester.enterText(find.byType(TextFormField).first, 'Jadwal berubah mendadak');
    await tester.enterText(find.byType(TextFormField).at(1), 'Shift Sabtu diganti Jumat malam tanpa pemberitahuan.');
    await tester.pumpAndSettle();
    expect(find.text('Minimal 3 karakter'), findsNothing);
    await potret(tester, 'kasus-form');
  });
}
