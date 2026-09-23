import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/klien_api.dart';
import 'model_kasus.dart';

class RepoKasus {
  RepoKasus(this._api);
  final KlienApi _api;

  /// Server membatasi: karyawan hanya melihat keluhan yang ia ajukan dan
  /// tindakan disiplin yang ditujukan kepadanya.
  Future<List<Kasus>> daftar() async => (await _api.getDaftar('/cases', query: {'limit': 50})).map(Kasus.dariJson).toList();

  /// Tanggal kejadian dalam format YYYY-MM-DD.
  Future<Kasus> ajukanKeluhan({required String judul, required String uraian, String? tanggalKejadian}) async =>
      Kasus.dariJson(await _api.post('/complaints', {
        'title': judul,
        'description': uraian,
        if (tanggalKejadian != null && tanggalKejadian.isNotEmpty) 'incidentDate': tanggalKejadian,
      }));
}

final repoKasusProvider = Provider<RepoKasus>((ref) => RepoKasus(ref.watch(klienApiProvider)));
final kasusProvider = FutureProvider.autoDispose<List<Kasus>>((ref) => ref.watch(repoKasusProvider).daftar());
