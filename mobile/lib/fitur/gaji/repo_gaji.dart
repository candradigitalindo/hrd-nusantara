import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/klien_api.dart';
import 'model_gaji.dart';

class RepoGaji {
  RepoGaji(this._api);
  final KlienApi _api;
  Future<List<SlipGaji>> slipSaya() async => (await _api.getDaftar('/payrolls/me', query: {'limit': 24})).map(SlipGaji.dariJson).toList();
  Future<SlipGaji> slip(String id) async => SlipGaji.dariJson(await _api.getObjek('/payrolls/$id'));
}

final repoGajiProvider = Provider<RepoGaji>((ref) => RepoGaji(ref.watch(klienApiProvider)));
final slipSayaProvider = FutureProvider.autoDispose<List<SlipGaji>>((ref) => ref.watch(repoGajiProvider).slipSaya());
final slipProvider = FutureProvider.autoDispose.family<SlipGaji, String>((ref, id) => ref.watch(repoGajiProvider).slip(id));
