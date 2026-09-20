import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/api/klien_api.dart';
import '../../core/konfigurasi.dart';
import 'model_presensi.dart';

class RepoPresensi {
  RepoPresensi(this._api);
  final KlienApi _api;

  Future<List<LokasiKerja>> lokasiKerja() async =>
      (await _api.getDaftar('/work-locations', query: {'limit': 100})).map(LokasiKerja.dariJson).toList();

  Future<List<Presensi>> riwayat({DateTime? mulai, DateTime? selesai, int limit = 30}) async {
    final f = DateFormat('yyyy-MM-dd');
    return (await _api.getDaftar('/attendance/me', query: {
      'limit': limit,
      if (mulai != null) 'startDate': f.format(mulai),
      if (selesai != null) 'endDate': f.format(selesai),
    }))
        .map(Presensi.dariJson)
        .toList();
  }

  /// Presensi hari ini, bila ada — dipakai untuk memutuskan tombol masuk/pulang.
  Future<Presensi?> hariIni() async {
    final sekarang = DateTime.now();
    final daftar = await riwayat(mulai: sekarang, selesai: sekarang, limit: 5);
    return daftar.isEmpty ? null : daftar.first;
  }

  Future<Presensi> masuk(PermintaanAbsen p) async =>
      Presensi.dariJson(await _api.post('/attendance/check-in', p.keJson(), batasWaktu: p.fotoWajahBase64 != null ? batasWaktuUnggah : null));

  Future<Presensi> pulang(PermintaanAbsen p) async =>
      Presensi.dariJson(await _api.post('/attendance/check-out', p.keJson(sertakanLokasiId: false), batasWaktu: p.fotoWajahBase64 != null ? batasWaktuUnggah : null));
}

final repoPresensiProvider = Provider<RepoPresensi>((ref) => RepoPresensi(ref.watch(klienApiProvider)));

final presensiHariIniProvider = FutureProvider.autoDispose<Presensi?>((ref) => ref.watch(repoPresensiProvider).hariIni());

final riwayatPresensiProvider = FutureProvider.autoDispose<List<Presensi>>((ref) {
  final sekarang = DateTime.now();
  return ref.watch(repoPresensiProvider).riwayat(mulai: sekarang.subtract(const Duration(days: 30)), selesai: sekarang, limit: 60);
});

final lokasiKerjaProvider = FutureProvider.autoDispose<List<LokasiKerja>>((ref) => ref.watch(repoPresensiProvider).lokasiKerja());
