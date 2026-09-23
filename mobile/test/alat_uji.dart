import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/core/tema.dart';

/// Folder tujuan potret layar. Kosong = tes tidak memotret apa pun.
///   flutter test --dart-define=POTRET_DIR=/tmp/potret
const potretDir = String.fromEnvironment('POTRET_DIR');

/// Font Roboto dan ikon Material dari SDK Flutter, supaya potret terbaca —
/// bawaan `flutter test` menggambar teks sebagai kotak-kotak.
Future<void> muatFontAsli() async {
  final dir = _folderFont();
  if (dir == null) return;
  Future<void> muat(String keluarga, List<String> berkas) async {
    final loader = FontLoader(keluarga);
    var ada = false;
    for (final nama in berkas) {
      final f = File('${dir.path}/$nama');
      if (!f.existsSync()) continue;
      ada = true;
      loader.addFont(f.readAsBytes().then((d) => ByteData.view(d.buffer)));
    }
    if (ada) await loader.load();
  }

  await muat('Roboto', ['Roboto-Light.ttf', 'Roboto-Regular.ttf', 'Roboto-Medium.ttf', 'Roboto-Bold.ttf', 'Roboto-Black.ttf']);
  await muat('MaterialIcons', ['MaterialIcons-Regular.otf']);
}

/// Mencari `bin/cache/artifacts/material_fonts` dari FLUTTER_ROOT atau dari
/// letak biner uji (berada di dalam SDK).
Directory? _folderFont() {
  final kandidat = <String>[
    if (Platform.environment['FLUTTER_ROOT'] != null) Platform.environment['FLUTTER_ROOT']!,
  ];
  var d = File(Platform.resolvedExecutable).parent;
  for (var i = 0; i < 8; i++) {
    kandidat.add(d.path);
    d = d.parent;
  }
  for (final akar in kandidat) {
    final f = Directory('$akar/bin/cache/artifacts/material_fonts');
    if (f.existsSync()) return f;
  }
  return null;
}

/// Ukuran layar ponsel (390 dp lebar); tinggi bisa dilebihkan agar seluruh
/// daftar ikut terpotret.
void ukuranPonsel(WidgetTester tester, {double tinggi = 844}) {
  tester.view.physicalSize = Size(390 * 3, tinggi * 3);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);
}

/// Aplikasi minimal dengan tema, lokal id_ID, dan provider yang ditimpa.
Widget aplikasiUji(Widget layar, {List<Override> overrides = const []}) => ProviderScope(
      overrides: overrides,
      child: MaterialApp(
        theme: temaTerang(),
        locale: const Locale('id', 'ID'),
        supportedLocales: const [Locale('id', 'ID')],
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: layar,
      ),
    );

class _PenulisPotret extends GoldenFileComparator {
  _PenulisPotret(this.dir);
  final Directory dir;

  @override
  Future<bool> compare(Uint8List imageBytes, Uri golden) async {
    final f = File('${dir.path}/${golden.pathSegments.last}');
    await f.parent.create(recursive: true);
    await f.writeAsBytes(imageBytes);
    return true;
  }

  @override
  Future<void> update(Uri golden, Uint8List imageBytes) => compare(imageBytes, golden);
}

/// Menyimpan tampilan saat ini ke `POTRET_DIR/<nama>.png`. Bukan golden test:
/// tidak pernah gagal karena selisih piksel, hanya menulis berkasnya.
Future<void> potret(WidgetTester tester, String nama) async {
  if (potretDir.isEmpty) return;
  goldenFileComparator = _PenulisPotret(Directory(potretDir));
  await expectLater(find.byType(MaterialApp), matchesGoldenFile('$nama.png'));
}
