import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/klien_api.dart';
import 'model_pengumuman.dart';

class RepoPengumuman {
  RepoPengumuman(this._api);
  final KlienApi _api;
  Future<List<Pengumuman>> daftar() async => (await _api.getDaftar('/announcements', query: {'limit': 50})).map(Pengumuman.dariJson).toList();
  Future<void> tandaiBaca(String id, {bool konfirmasi = false}) => _api.post('/announcements/$id/read', {'acknowledge': konfirmasi});
}

final repoPengumumanProvider = Provider<RepoPengumuman>((ref) => RepoPengumuman(ref.watch(klienApiProvider)));
final pengumumanProvider = FutureProvider.autoDispose<List<Pengumuman>>((ref) => ref.watch(repoPengumumanProvider).daftar());
