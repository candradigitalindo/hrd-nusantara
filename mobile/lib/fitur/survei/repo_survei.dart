import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/klien_api.dart';
import '../../core/api/status_jaringan.dart';
import '../antrean/mesin_antrean.dart';
import '../antrean/pengirim_antrean.dart';
import 'model_survei.dart';

class RepoSurvei {
  RepoSurvei(this._api, this._pengirim);
  final KlienApi _api;
  final PengirimAntrean _pengirim;
  Future<List<Survei>> daftar() async => (await _api.getDaftar('/surveys', query: {'limit': 50}, cache: 'survei')).map(Survei.dariJson).toList();
  /// Jawaban yang diisi offline disimpan di antrean; surveinya tampil
  /// "belum terkirim" dan tidak bisa diisi dua kali (lihat [surveiProvider]).
  Future<HasilKirim> kirim(Survei s, List<Map<String, dynamic>> jawaban) => _pengirim.kirim(
        jenis: 'survei-kirim',
        judul: 'Survei: ${s.judul}',
        metode: 'POST',
        jalur: '/surveys/${s.id}/submit',
        badan: {'answers': jawaban},
        info: {'surveiId': s.id},
      );
}

final repoSurveiProvider = Provider<RepoSurvei>((ref) => RepoSurvei(ref.watch(klienApiProvider), ref.watch(pengirimAntreanProvider)));
final surveiProvider = FutureProvider.autoDispose<List<Survei>>((ref) async {
  ref.watch(sambunganProvider);
  ref.watch(antreanProvider.select((s) => s.terkirim));
  final tertunda = ref.watch(antreanProvider.select((s) => s.item.where((i) => i.jenis == 'survei-kirim' && !i.gagal).map((i) => i.info['surveiId']).join(',')));
  final daftar = await ref.watch(repoSurveiProvider).daftar();
  return [for (final s in daftar) tertunda.split(',').contains(s.id) ? s.denganJawabanTertunda() : s];
});
