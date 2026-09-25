import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import '../../core/api/klien_api.dart';
import '../../core/penyimpanan/penyimpanan_sesi.dart';
import '../../core/penyimpanan/sandi_berkas.dart';
import 'model_antrean.dart';

/// Antrean kirim di folder privat aplikasi: satu berkas terenkripsi per
/// kiriman, supaya satu berkas rusak tidak menghilangkan yang lain.
///
/// Isinya bisa foto wajah dan alasan cuti, jadi dienkripsi seperti cache —
/// tapi dengan kunci sendiri yang tidak dibuang saat keluar akun: kiriman
/// yang belum terkirim harus tetap bisa dibuka setelah pemiliknya masuk lagi.
class PenyimpananAntrean {
  PenyimpananAntrean(PenyimpananSesi sesi, {Future<Directory> Function()? folderInduk})
      : _folderInduk = folderInduk ?? getApplicationSupportDirectory,
        _sandi = SandiBerkas(bacaKunci: sesi.bacaKunciAntrean, simpanKunci: sesi.simpanKunciAntrean);

  final Future<Directory> Function() _folderInduk;
  final SandiBerkas _sandi;

  Future<Directory> _folder() async => Directory('${(await _folderInduk()).path}/antrean');

  /// Semua kiriman (semua akun), urut menurut waktu dibuat.
  Future<List<ItemAntrean>> semua() async {
    final folder = await _folder();
    if (!await folder.exists()) return [];
    final berkas = await folder.list().where((e) => e is File && e.path.endsWith('.bin')).cast<File>().toList();
    berkas.sort((a, b) => a.path.compareTo(b.path));
    final hasil = <ItemAntrean>[];
    for (final b in berkas) {
      try {
        hasil.add(ItemAntrean.dariJson(jsonDecode(utf8.decode(await _sandi.buka(await b.readAsBytes()))) as Map<String, dynamic>));
      } catch (e) {
        // Rusak, atau kuncinya hilang (mis. dipulihkan dari cadangan tanpa
        // Keystore): tidak mungkin dikirim, jangan menghentikan yang lain.
        debugPrint('Kiriman ${b.path} tidak terbaca: $e');
      }
    }
    return hasil;
  }

  Future<void> simpan(ItemAntrean item) async =>
      tulisUtuh(File('${(await _folder()).path}/${item.id}.bin'), await _sandi.tutup(utf8.encode(jsonEncode(item.keJson()))));

  Future<void> hapus(String id) async {
    final berkas = File('${(await _folder()).path}/$id.bin');
    if (await berkas.exists()) await berkas.delete();
  }
}

final penyimpananAntreanProvider = Provider<PenyimpananAntrean>((ref) => PenyimpananAntrean(ref.watch(penyimpananSesiProvider)));
