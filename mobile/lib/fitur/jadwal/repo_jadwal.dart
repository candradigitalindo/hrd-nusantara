import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/api/klien_api.dart';
import '../../core/api/status_jaringan.dart';
import 'model_shift.dart';

class RepoJadwal {
  RepoJadwal(this._api);
  final KlienApi _api;

  Future<List<Shift>> rentang(DateTime mulai, DateTime selesai, {String? cache}) async {
    final f = DateFormat('yyyy-MM-dd');
    return (await _api.getDaftar('/shifts/me', query: {'startDate': f.format(mulai), 'endDate': f.format(selesai), 'limit': 100}, cache: cache))
        .map(Shift.dariJson)
        .toList();
  }
}

final repoJadwalProvider = Provider<RepoJadwal>((ref) => RepoJadwal(ref.watch(klienApiProvider)));

/// Dua minggu ke depan mulai hari ini, plus 7 hari ke belakang.
final jadwalProvider = FutureProvider.autoDispose<List<Shift>>((ref) {
  ref.watch(sambunganProvider);
  final hariIni = DateTime.now();
  return ref.watch(repoJadwalProvider).rentang(hariIni.subtract(const Duration(days: 7)), hariIni.add(const Duration(days: 14)), cache: 'jadwal');
});

/// Disaring dari [jadwalProvider] dengan alasan yang sama seperti
/// presensiHariIniProvider: jadwal tersimpan kemarin masih memuat hari ini.
final shiftHariIniProvider = FutureProvider.autoDispose<Shift?>((ref) async {
  final hariIni = DateFormat('yyyy-MM-dd').format(DateTime.now());
  final daftar = await ref.watch(jadwalProvider.future);
  return daftar.where((s) => s.tanggal.startsWith(hariIni)).firstOrNull;
});
