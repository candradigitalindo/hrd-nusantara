import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import '../api/klien_api.dart';
import 'penyimpanan_sesi.dart';
import 'sandi_berkas.dart';

/// Satu salinan jawaban server beserta kapan diambil.
class EntriCache {
  const EntriCache(this.data, this.diambilPada);
  final Object? data;
  final DateTime diambilPada;
}

/// Salinan terakhir jawaban server per layar, supaya aplikasi tetap bisa
/// dibaca saat internet mati.
///
/// Isinya data pribadi karyawan (slip gaji, presensi, kinerja), jadi tiap
/// entri dienkripsi (lihat [SandiBerkas]). Keluar akun menghapus berkas
/// sekaligus kuncinya, sehingga sisa berkas yang gagal terhapus pun tak
/// terbaca.
class CacheLokal {
  CacheLokal(PenyimpananSesi sesi, {Future<Directory> Function()? folderInduk})
      : _folderInduk = folderInduk ?? getApplicationSupportDirectory,
        _sandi = SandiBerkas(bacaKunci: sesi.bacaKunciCache, simpanKunci: sesi.simpanKunciCache);

  final Future<Directory> Function() _folderInduk;
  final SandiBerkas _sandi;

  Future<Directory> _folder() async => Directory('${(await _folderInduk()).path}/cache-data');

  File _berkas(Directory folder, String kunci) => File('${folder.path}/${kunci.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_')}.bin');

  Future<void> simpan(String kunci, Object? data) async {
    final isi = utf8.encode(jsonEncode({'t': DateTime.now().toUtc().toIso8601String(), 'd': data}));
    await tulisUtuh(_berkas(await _folder(), kunci), await _sandi.tutup(isi));
  }

  /// null bila belum ada, rusak, atau dienkripsi kunci lain (mis. berkas
  /// yang dipulihkan dari cadangan ponsel tanpa kuncinya).
  Future<EntriCache?> baca(String kunci) async {
    try {
      final berkas = _berkas(await _folder(), kunci);
      if (!await berkas.exists()) return null;
      final isi = jsonDecode(utf8.decode(await _sandi.buka(await berkas.readAsBytes()))) as Map<String, dynamic>;
      return EntriCache(isi['d'], DateTime.parse(isi['t'] as String).toLocal());
    } catch (_) {
      return null;
    }
  }

  Future<void> hapusSemua() async {
    await _sandi.lupakanKunci();
    final folder = await _folder();
    if (await folder.exists()) await folder.delete(recursive: true);
  }
}

final cacheLokalProvider = Provider<CacheLokal>((ref) => CacheLokal(ref.watch(penyimpananSesiProvider)));
