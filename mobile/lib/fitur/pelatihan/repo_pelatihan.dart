import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/klien_api.dart';
import '../../core/api/status_jaringan.dart';
import 'model_pelatihan.dart';

export 'model_pelatihan.dart';

class RepoPelatihan {
  RepoPelatihan(this._api);
  final KlienApi _api;

  /// Server hanya mengembalikan pendaftaran milik pengguna sendiri.
  Future<List<PendaftaranPelatihan>> pendaftaranSaya() async =>
      (await _api.getDaftar('/training/registrations', query: {'limit': 50}, cache: 'pelatihan-saya')).map(PendaftaranPelatihan.dariJson).toList();

  Future<List<SesiPelatihan>> sesiTerjadwal() async =>
      (await _api.getDaftar('/training/sessions', query: {'limit': 50, 'status': 'scheduled'}, cache: 'pelatihan-sesi')).map(SesiPelatihan.dariJson).toList();

  /// Tanpa employeeId = mendaftarkan diri sendiri; kalau kuota penuh server
  /// menempatkannya di daftar tunggu.
  Future<PendaftaranPelatihan> daftar(String sesiId) async =>
      PendaftaranPelatihan.dariJson(await _api.post('/training/sessions/$sesiId/register', {}));

  Future<void> batalkan(String pendaftaranId) => _api.patch('/training/registrations/$pendaftaranId/cancel', {});
}

final repoPelatihanProvider = Provider<RepoPelatihan>((ref) => RepoPelatihan(ref.watch(klienApiProvider)));

final pendaftaranSayaProvider = FutureProvider.autoDispose<List<PendaftaranPelatihan>>((ref) {
  ref.watch(sambunganProvider);
  return ref.watch(repoPelatihanProvider).pendaftaranSaya();
});

final sesiTerjadwalProvider = FutureProvider.autoDispose<List<SesiPelatihan>>((ref) {
  ref.watch(sambunganProvider);
  return ref.watch(repoPelatihanProvider).sesiTerjadwal();
});

/// Sesi yang belum dimulai, terdekat lebih dulu (untuk beranda).
final pelatihanMendatangProvider = FutureProvider.autoDispose<List<PendaftaranPelatihan>>((ref) async {
  final semua = await ref.watch(pendaftaranSayaProvider.future);
  final mendatang = semua.where((p) => p.mendatang).toList()..sort((a, b) => a.mulai!.compareTo(b.mulai!));
  return mendatang;
});
