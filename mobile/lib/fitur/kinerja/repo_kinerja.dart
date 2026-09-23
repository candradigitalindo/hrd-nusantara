import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/klien_api.dart';
import 'model_kinerja.dart';

class RepoKinerja {
  RepoKinerja(this._api);
  final KlienApi _api;

  /// Server sudah menyaring: yang bukan HR hanya menerima penilaian yang
  /// melibatkan dirinya, sebagai penilai maupun yang dinilai.
  Future<List<Penilaian>> daftar() async =>
      (await _api.getDaftar('/performance/reviews', query: {'limit': 50})).map(Penilaian.dariJson).toList();

  Future<Penilaian> rincian(String id) async => Penilaian.dariJson(await _api.getObjek('/performance/reviews/$id'));

  /// Nilai akhir dihitung server dari bobot kriteria; klien hanya mengirim
  /// skor mentah per kriteria.
  Future<Penilaian> kirim(String id, {required Map<String, num> nilai, Map<String, String> komentar = const {}, String? umpanBalik}) async =>
      Penilaian.dariJson(await _api.post('/performance/reviews/$id/submit', {
        'scores': [
          for (final e in nilai.entries)
            {
              'criterionId': e.key,
              'score': e.value,
              if ((komentar[e.key] ?? '').trim().isNotEmpty) 'comment': komentar[e.key]!.trim(),
            },
        ],
        if (umpanBalik != null && umpanBalik.trim().isNotEmpty) 'feedback': umpanBalik.trim(),
      }));

  Future<Penilaian> akui(String id) async => Penilaian.dariJson(await _api.post('/performance/reviews/$id/acknowledge', {}));

  Future<void> tambahDiskusi(String id, String catatan) => _api.post('/performance/reviews/$id/discussions', {'note': catatan});

  /// Umpan balik yang ditujukan ke pengguna sendiri (bawaan server).
  Future<List<UmpanBalik>> umpanBalik() async =>
      (await _api.getDaftar('/feedback', query: {'limit': 50})).map(UmpanBalik.dariJson).toList();
}

final repoKinerjaProvider = Provider<RepoKinerja>((ref) => RepoKinerja(ref.watch(klienApiProvider)));
final penilaianProvider = FutureProvider.autoDispose<List<Penilaian>>((ref) => ref.watch(repoKinerjaProvider).daftar());
final penilaianDetailProvider = FutureProvider.autoDispose.family<Penilaian, String>((ref, id) => ref.watch(repoKinerjaProvider).rincian(id));
final umpanBalikProvider = FutureProvider.autoDispose<List<UmpanBalik>>((ref) => ref.watch(repoKinerjaProvider).umpanBalik());
