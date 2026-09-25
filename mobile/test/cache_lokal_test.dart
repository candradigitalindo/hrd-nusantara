import 'dart:convert';
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/core/penyimpanan/cache_lokal.dart';
import 'package:hrd_nusantara/core/penyimpanan/penyimpanan_sesi.dart';

void main() {
  late Directory tmp;
  late CacheLokal cache;
  const slip = {
    'data': [
      {'id': 'G1', 'netSalary': '5485000', 'employee': {'name': 'Budi Santoso Putra'}},
    ],
  };

  List<File> berkasCache() => Directory('${tmp.path}/cache-data').listSync().whereType<File>().toList();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    tmp = Directory.systemTemp.createTempSync('cache-uji');
    cache = CacheLokal(PenyimpananSesi(), folderInduk: () async => tmp);
  });
  tearDown(() => tmp.deleteSync(recursive: true));

  test('salinan terbaca kembali utuh beserta jam pengambilannya', () async {
    final sebelum = DateTime.now();
    await cache.simpan('gaji-slip', slip);

    final entri = await cache.baca('gaji-slip');
    expect(entri, isNotNull);
    expect(entri!.data, slip);
    expect(entri.diambilPada.isBefore(sebelum.subtract(const Duration(seconds: 1))), isFalse);
    expect(await cache.baca('belum-pernah'), isNull);
  });

  test('isi berkas terenkripsi: nominal gaji dan nama tidak terbaca di disk', () async {
    await cache.simpan('gaji-slip', slip);

    final berkas = berkasCache();
    expect(berkas, hasLength(1));
    final mentah = latin1.decode(berkas.single.readAsBytesSync());
    expect(mentah, isNot(contains('5485000')));
    expect(mentah, isNot(contains('Budi')));
  });

  test('keluar akun: berkas dan kuncinya dihapus; berkas sisa tak terbaca lagi', () async {
    await cache.simpan('gaji-slip', slip);
    final berkas = berkasCache().single;
    final salinanBerkas = berkas.readAsBytesSync();

    await cache.hapusSemua();
    expect(Directory('${tmp.path}/cache-data').existsSync(), isFalse);
    expect(await PenyimpananSesi().bacaKunciCache(), isNull);

    // Berkas yang gagal terhapus (atau dipulihkan dari cadangan) tidak bisa
    // dibuka dengan kunci akun berikutnya.
    await cache.simpan('lain', {'x': 1});
    File(berkas.path).writeAsBytesSync(salinanBerkas);
    expect(await cache.baca('gaji-slip'), isNull);
    expect((await cache.baca('lain'))!.data, {'x': 1});
  });

  test('berkas rusak dianggap tidak ada', () async {
    await cache.simpan('jadwal', {'data': []});
    berkasCache().single.writeAsStringSync('bukan isi terenkripsi');
    expect(await cache.baca('jadwal'), isNull);
  });

  test('dua penyimpanan pertama yang bersamaan memakai satu kunci yang sama', () async {
    await Future.wait([cache.simpan('a', {'n': 1}), cache.simpan('b', {'n': 2})]);

    // Instans baru: kunci dibaca dari penyimpanan aman, bukan dari memori.
    final baru = CacheLokal(PenyimpananSesi(), folderInduk: () async => tmp);
    expect((await baru.baca('a'))!.data, {'n': 1});
    expect((await baru.baca('b'))!.data, {'n': 2});
  });
}
