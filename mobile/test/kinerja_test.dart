import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/fitur/auth/sesi_provider.dart';
import 'package:hrd_nusantara/fitur/kinerja/layar_isi_penilaian.dart';
import 'package:hrd_nusantara/fitur/kinerja/layar_kinerja.dart';
import 'package:hrd_nusantara/fitur/kinerja/layar_penilaian.dart';
import 'package:hrd_nusantara/fitur/kinerja/model_kinerja.dart';
import 'package:hrd_nusantara/fitur/kinerja/repo_kinerja.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'alat_uji.dart';
import 'data_uji.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('id_ID');
    await muatFontAsli();
  });

  group('model penilaian', () {
    test('Decimal string dari server jadi angka; skala mengikuti kriteria', () {
      final r = Penilaian.dariJson(jsonPenilaianAtasan());
      expect(r.nilaiTotal, 82.5);
      expect(r.rating, 4.13);
      expect(r.skala, 5);
      expect(r.nilai.length, 3);
      expect(r.nilai.first.porsi, 0.9);
      expect(r.kriteria.length, 3);
      expect(r.sayaDinilai('K1'), isTrue);
      expect(r.sayaPenilai('K1'), isFalse);
      expect(r.menungguKonfirmasi, isTrue);
      expect(r.labelSudutPandang, 'Atasan');
    });

    test('draf penilaian diri: tanpa nilai, harus diisi pengguna sendiri', () {
      final r = Penilaian.dariJson(jsonPenilaianDiri());
      expect(r.nilaiTotal, isNull);
      expect(r.draf, isTrue);
      expect(r.penilaianDiri, isTrue);
      expect(r.sayaPenilai('K1'), isTrue);
    });

    test('nilai terbaru mengutamakan penilaian atasan yang sudah bernilai', () {
      final semua = daftarPenilaian();
      final hasil = semua.where((r) => r.sayaDinilai('K1') && r.adaHasil).toList();
      expect(nilaiTerbaru(hasil)?.id, 'R1');
      expect(nilaiTerbaru(const []), isNull);
    });
  });

  testWidgets('layar kinerja: nilai terakhir, tugas, hasil, umpan balik', (tester) async {
    ukuranPonsel(tester, tinggi: 1400);
    await tester.pumpWidget(aplikasiUji(const LayarKinerja(), overrides: [
      penggunaProvider.overrideWithValue(pengguna),
      penilaianProvider.overrideWith((ref) async => daftarPenilaian()),
      umpanBalikProvider.overrideWith((ref) async => daftarUmpan()),
    ]));
    await tester.pumpAndSettle();

    expect(find.text('NILAI KINERJA TERAKHIR'), findsOneWidget);
    expect(find.text('82,5'), findsOneWidget);
    expect(find.text('PERLU SAYA ISI'), findsOneWidget);
    expect(find.text('Penilaian diri'), findsOneWidget);
    expect(find.text('HASIL PENILAIAN SAYA'), findsOneWidget);
    expect(find.text('Perlu konfirmasi'), findsOneWidget);
    expect(find.text('Periode 2026-Q2'), findsOneWidget);
    expect(find.text('Apresiasi'), findsOneWidget);
    expect(find.text('Perbaikan'), findsOneWidget);
    await potret(tester, 'kinerja');
  });

  testWidgets('rincian penilaian: nilai per kriteria dan tombol konfirmasi', (tester) async {
    ukuranPonsel(tester, tinggi: 1300);
    await tester.pumpWidget(aplikasiUji(const LayarPenilaian(id: 'R1'), overrides: [
      penggunaProvider.overrideWithValue(pengguna),
      penilaianDetailProvider.overrideWith((ref, id) async => Penilaian.dariJson(jsonPenilaianAtasan())),
    ]));
    await tester.pumpAndSettle();

    expect(find.text('Saya sudah membaca'), findsOneWidget);
    expect(find.text('NILAI PER KRITERIA'), findsOneWidget);
    expect(find.text('Kecepatan pelayanan'), findsOneWidget);
    expect(find.textContaining('Bobot 40%'), findsOneWidget);
    expect(find.text('CATATAN PENILAI'), findsOneWidget);
    expect(find.text('Dinilai oleh Siti Rahma (atasan)'), findsOneWidget);
    expect(find.textContaining('one-on-one'), findsOneWidget);
    await potret(tester, 'kinerja-rincian');

    await tester.tap(find.text('Saya sudah membaca'));
    await tester.pumpAndSettle();
    expect(find.text('Konfirmasi penilaian?'), findsOneWidget);
    await tester.tap(find.text('Batal'));
    await tester.pumpAndSettle();
  });

  testWidgets('isi penilaian diri: semua kriteria wajib, perkiraan nilai dihitung', (tester) async {
    ukuranPonsel(tester, tinggi: 1500);
    await tester.pumpWidget(aplikasiUji(const LayarIsiPenilaian(id: 'R2'), overrides: [
      penggunaProvider.overrideWithValue(pengguna),
      penilaianDetailProvider.overrideWith((ref, id) async => Penilaian.dariJson(jsonPenilaianDiri())),
    ]));
    await tester.pumpAndSettle();

    expect(find.text('Penilaian diri sendiri'), findsOneWidget);
    expect(find.text('Nilai akhir dihitung setelah semua kriteria diisi'), findsOneWidget);

    // Kirim tanpa mengisi → ditolak di klien, tanpa memanggil server.
    await tester.tap(find.text('Kirim Penilaian'));
    await tester.pump();
    expect(find.text('Masih ada kriteria yang belum dinilai'), findsOneWidget);
    await tester.pump(const Duration(seconds: 5)); // snackbar hilang

    // Pilih 4, 3, 5 → (4/5)*40 + (3/5)*35 + (5/5)*25 = 78.
    final chips = find.byType(ChoiceChip);
    await tester.tap(chips.at(3)); // kriteria 1: nilai 4
    await tester.tap(chips.at(5 + 2)); // kriteria 2: nilai 3
    await tester.tap(chips.at(10 + 4)); // kriteria 3: nilai 5
    await tester.pumpAndSettle();
    expect(find.text('Perkiraan nilai akhir'), findsOneWidget);
    expect(find.text('78 / 100'), findsOneWidget);
    await potret(tester, 'kinerja-isi');

    await tester.tap(find.text('Kirim Penilaian'));
    await tester.pumpAndSettle();
    expect(find.text('Kirim penilaian?'), findsOneWidget);
    await tester.tap(find.text('Periksa lagi'));
    await tester.pumpAndSettle();
  });
}
