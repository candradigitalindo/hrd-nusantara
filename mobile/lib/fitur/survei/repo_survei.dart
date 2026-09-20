import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/klien_api.dart';
import 'model_survei.dart';

class RepoSurvei {
  RepoSurvei(this._api);
  final KlienApi _api;
  Future<List<Survei>> daftar() async => (await _api.getDaftar('/surveys', query: {'limit': 50})).map(Survei.dariJson).toList();
  Future<void> kirim(String id, List<Map<String, dynamic>> jawaban) => _api.post('/surveys/$id/submit', {'answers': jawaban});
}

final repoSurveiProvider = Provider<RepoSurvei>((ref) => RepoSurvei(ref.watch(klienApiProvider)));
final surveiProvider = FutureProvider.autoDispose<List<Survei>>((ref) => ref.watch(repoSurveiProvider).daftar());
