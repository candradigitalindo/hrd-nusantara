import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/klien_api.dart';
import '../../core/api/status_jaringan.dart';
import '../antrean/mesin_antrean.dart';
import '../antrean/pengirim_antrean.dart';
import 'model_pengumuman.dart';

class RepoPengumuman {
  RepoPengumuman(this._api, this._pengirim);
  final KlienApi _api;
  final PengirimAntrean _pengirim;
  Future<List<Pengumuman>> daftar() async => (await _api.getDaftar('/announcements', query: {'limit': 50}, cache: 'pengumuman')).map(Pengumuman.dariJson).toList();
  /// Tanda baca/konfirmasi yang dibuat offline disimpan di antrean dan
  /// langsung berlaku di daftar (lihat [pengumumanProvider]). Bila tanda
  /// yang sama (atau konfirmasi, yang mencakup tanda baca) sudah mengantre,
  /// tidak diantrekan dua kali — membuka pengumuman berulang kali saat
  /// offline tidak menumpuk kiriman.
  Future<HasilKirim> tandaiBaca(Pengumuman p, {bool konfirmasi = false}) async {
    final sudah = _pengirim.menunggu('pengumuman-baca').where((i) => i.info['pengumumanId'] == p.id && (i.info['konfirmasi'] == true || !konfirmasi)).firstOrNull;
    if (sudah != null) return HasilKirim.tertunda(sudah);
    return _pengirim.kirim(
      jenis: 'pengumuman-baca',
      judul: '${konfirmasi ? 'Konfirmasi' : 'Tandai dibaca'}: ${p.judul}',
      metode: 'POST',
      jalur: '/announcements/${p.id}/read',
      badan: {'acknowledge': konfirmasi},
      info: {'pengumumanId': p.id, 'konfirmasi': konfirmasi},
    );
  }
}

final repoPengumumanProvider = Provider<RepoPengumuman>((ref) => RepoPengumuman(ref.watch(klienApiProvider), ref.watch(pengirimAntreanProvider)));
final pengumumanProvider = FutureProvider.autoDispose<List<Pengumuman>>((ref) async {
  ref.watch(sambunganProvider);
  ref.watch(antreanProvider.select((s) => s.terkirim));
  ref.watch(antreanProvider.select((s) => s.item.where((i) => i.jenis == 'pengumuman-baca').map((i) => '${i.id}:${i.status.name}').join(',')));
  final daftar = await ref.watch(repoPengumumanProvider).daftar();
  final tanda = ref.read(antreanProvider).item.where((i) => i.jenis == 'pengumuman-baca' && !i.gagal);
  return [
    for (final p in daftar)
      switch (tanda.where((i) => i.info['pengumumanId'] == p.id).toList()) {
        [] => p,
        final t => p.salin(sudahDibaca: true, dikonfirmasiPada: t.any((i) => i.info['konfirmasi'] == true) ? t.first.dibuat : null),
      },
  ];
});
