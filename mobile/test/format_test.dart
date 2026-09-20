import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/core/format.dart';
import 'package:intl/date_symbol_data_local.dart';

void main() {
  setUpAll(() => initializeDateFormatting('id_ID'));

  group('formatRupiah', () {
    test('memformat angka dengan pemisah ribuan Indonesia', () {
      expect(formatRupiah(4500000), 'Rp 4.500.000');
      expect(formatRupiah('1250000.50'), 'Rp 1.250.001');
    });
    test('nilai kosong jadi strip', () {
      expect(formatRupiah(null), '—');
      expect(formatRupiah('bukan angka'), '—');
    });
  });

  group('tanggal', () {
    test('tanggal-saja dari server tidak digeser zona waktu', () {
      // Tengah malam UTC; di zona +7 tetap harus 20 September, bukan 20 pukul 07:00 -> tetap 20.
      expect(formatTanggalSaja('2026-09-20T00:00:00.000Z'), '20 Sep 2026');
      expect(formatTanggalSaja('2026-09-20'), '20 Sep 2026');
    });
    test('nama hari dan bulan berbahasa Indonesia', () {
      expect(formatTanggalSaja('2026-09-20', pola: 'EEEE, d MMMM yyyy'), 'Minggu, 20 September 2026');
    });
  });

  group('durasi & label', () {
    test('durasi menit jadi jam dan menit', () {
      expect(formatDurasiMenit(0), '0 menit');
      expect(formatDurasiMenit(45), '45 menit');
      expect(formatDurasiMenit(120), '2 jam');
      expect(formatDurasiMenit(135), '2 jam 15 menit');
      expect(formatDurasiMenit(null), '—');
    });
    test('label status dikenal, kode asing dirapikan', () {
      expect(labelUntuk('late'), 'Terlambat');
      expect(labelUntuk('scan_required'), 'Perlu Scan Ulang');
      expect(labelUntuk('kode_baru'), 'kode baru');
      expect(labelUntuk(null), '—');
    });
  });
}
