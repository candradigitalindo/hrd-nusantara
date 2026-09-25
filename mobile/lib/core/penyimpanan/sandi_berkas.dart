import 'dart:convert';
import 'dart:io';

import 'package:cryptography/cryptography.dart';

/// Enkripsi AES-GCM untuk berkas di folder privat aplikasi (cache data
/// offline, antrean kirim). Kuncinya acak dan disimpan di penyimpanan aman
/// perangkat lewat [bacaKunci]/[simpanKunci] — bukan di sebelah berkasnya.
class SandiBerkas {
  SandiBerkas({required this.bacaKunci, required this.simpanKunci});

  final Future<String?> Function() bacaKunci;
  final Future<void> Function(String? kunci) simpanKunci;
  final _aes = AesGcm.with256bits();
  Future<SecretKey>? _kunci;

  // Satu Future bersama: dua pemanggil pertama yang bersamaan tidak boleh
  // membuat dua kunci berbeda.
  Future<SecretKey> _kunciAes() => _kunci ??= () async {
        final tersimpan = await bacaKunci();
        if (tersimpan != null) return SecretKey(base64Decode(tersimpan));
        final baru = await _aes.newSecretKey();
        await simpanKunci(base64Encode(await baru.extractBytes()));
        return baru;
      }();

  Future<List<int>> tutup(List<int> isi) async => (await _aes.encrypt(isi, secretKey: await _kunciAes())).concatenation();

  /// Melempar bila rusak atau dienkripsi kunci lain.
  Future<List<int>> buka(List<int> kotak) async => _aes.decrypt(
        SecretBox.fromConcatenation(kotak, nonceLength: _aes.nonceLength, macLength: _aes.macAlgorithm.macLength),
        secretKey: await _kunciAes(),
      );

  /// Membuang kunci: berkas lama tak terbaca lagi, penulisan berikutnya
  /// memakai kunci baru.
  Future<void> lupakanKunci() async {
    _kunci = null;
    await simpanKunci(null);
  }
}

/// Tulis ke berkas sementara lalu ganti nama: aplikasi yang mati di tengah
/// penulisan tidak meninggalkan berkas setengah jadi.
Future<void> tulisUtuh(File tujuan, List<int> isi) async {
  await tujuan.parent.create(recursive: true);
  final sementara = File('${tujuan.path}.${DateTime.now().microsecondsSinceEpoch}.tmp');
  await sementara.writeAsBytes(isi, flush: true);
  await sementara.rename(tujuan.path);
}
