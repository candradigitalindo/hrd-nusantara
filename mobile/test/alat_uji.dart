import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/core/api/klien_api.dart';
import 'package:hrd_nusantara/core/api/status_jaringan.dart';
import 'package:hrd_nusantara/core/penyimpanan/penyimpanan_sesi.dart';
import 'package:hrd_nusantara/core/tema.dart';
import 'package:hrd_nusantara/fitur/antrean/model_antrean.dart';
import 'package:hrd_nusantara/fitur/antrean/penyimpanan_antrean.dart';
import 'package:hrd_nusantara/fitur/pemantauan/layanan_pemantauan.dart';

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
/// [builder] sama dengan MaterialApp.builder di app.dart (mis. BingkaiJaringan).
Widget aplikasiUji(Widget layar, {List<Override> overrides = const [], TransitionBuilder? builder}) => ProviderScope(
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
        builder: builder,
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

/// Server tiruan: [jawab] menentukan jawaban per permintaan; [putus] meniru
/// ponsel tanpa sinyal.
class ServerAntrean implements HttpClientAdapter {
  bool putus = false;
  (int, Object?) Function(RequestOptions o) jawab = (_) => (201, {'ok': true});
  /// Menahan jawaban kiriman (bukan /health) sampai Future-nya selesai.
  Future<void> Function()? tahan;
  final diterima = <String>[];
  /// Semua percobaan kiriman (juga yang gagal karena putus), untuk memeriksa
  /// kunci dan badannya.
  final percobaan = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    if (o.uri.path != '/health') percobaan.add(o);
    if (putus) throw DioException.connectionError(requestOptions: o, reason: 'jaringan mati');
    if (o.uri.path != '/health') {
      diterima.add('${o.method} ${o.uri.path} ${o.headers['Idempotency-Key'] ?? '-'}');
      await tahan?.call();
    }
    final (kode, isi) = o.uri.path == '/health' ? (200, {'status': 'ok'}) : jawab(o);
    return ResponseBody.fromString(jsonEncode(isi), kode, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });
  }

  @override
  void close({bool force = false}) {}
}

/// Antrean di memori untuk tes; yang berkas diuji terpisah di bawah.
class AntreanMemori extends PenyimpananAntrean {
  AntreanMemori() : super(PenyimpananSesi());
  final isi = <String, ItemAntrean>{};

  @override
  Future<List<ItemAntrean>> semua() async => (isi.values.toList()..sort((a, b) => a.id.compareTo(b.id)));
  @override
  Future<void> simpan(ItemAntrean item) async => isi[item.id] = item;
  @override
  Future<void> hapus(String id) async => isi.remove(id);
}

/// Klien API sungguhan di atas [server] tiruan, melapor ke status jaringan.
Override klienTiruan(ServerAntrean server) => klienApiProvider.overrideWith((ref) => KlienApi(
      penyimpanan: PenyimpananSesi(),
      dio: Dio()..httpClientAdapter = server,
      baseUrl: 'https://hrd.contoh/api',
      jaringan: ref.read(statusJaringanProvider.notifier),
    ));

/// Pemantauan Lokasi dengan keadaan tetap: tidak membaca izin, penyimpanan,
/// maupun server — untuk tes layar yang hanya menampilkan statusnya.
class PemantauTetap extends PemantauLokasi {
  PemantauTetap([this.awal = const StatusPemantauan()]);
  final StatusPemantauan awal;
  @override
  StatusPemantauan build() => awal;
  @override
  Future<void> segarkan() async {}
  @override
  Future<void> setujui() async => state = state.salin(setuju: true, izin: 'granted_always', berjalan: true);
}
