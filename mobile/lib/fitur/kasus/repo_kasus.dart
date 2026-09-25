import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/klien_api.dart';
import '../../core/api/status_jaringan.dart';
import '../antrean/mesin_antrean.dart';
import '../antrean/pengirim_antrean.dart';
import 'model_kasus.dart';

class RepoKasus {
  RepoKasus(this._api, this._pengirim);
  final KlienApi _api;
  final PengirimAntrean _pengirim;

  /// Server membatasi: karyawan hanya melihat keluhan yang ia ajukan dan
  /// tindakan disiplin yang ditujukan kepadanya.
  Future<List<Kasus>> daftar() async => (await _api.getDaftar('/cases', query: {'limit': 50}, cache: 'kasus')).map(Kasus.dariJson).toList();

  /// Tanggal kejadian dalam format YYYY-MM-DD. Bisa dibuat offline:
  /// disimpan di antrean kirim sampai tersambung.
  Future<HasilKirim> ajukanKeluhan({required String judul, required String uraian, String? tanggalKejadian}) => _pengirim.kirim(
        jenis: 'keluhan-ajukan',
        judul: 'Keluhan: $judul',
        metode: 'POST',
        jalur: '/complaints',
        badan: {
          'title': judul,
          'description': uraian,
          if (tanggalKejadian != null && tanggalKejadian.isNotEmpty) 'incidentDate': tanggalKejadian,
        },
      );
}

final repoKasusProvider = Provider<RepoKasus>((ref) => RepoKasus(ref.watch(klienApiProvider), ref.watch(pengirimAntreanProvider)));
final kasusProvider = FutureProvider.autoDispose<List<Kasus>>((ref) {
  ref.watch(sambunganProvider);
  ref.watch(antreanProvider.select((s) => s.terkirim));
  return ref.watch(repoKasusProvider).daftar();
});
