import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/klien_api.dart';
import '../../core/api/status_jaringan.dart';
import '../antrean/mesin_antrean.dart';
import '../antrean/model_antrean.dart';
import '../antrean/pengirim_antrean.dart';
import 'model_chat.dart';

class RepoChat {
  RepoChat(this._api, this._pengirim);
  final KlienApi _api;
  final PengirimAntrean _pengirim;
  Future<List<RuangChat>> ruang() async => (await _api.getDaftar('/chat/rooms', cache: 'chat-ruang')).map(RuangChat.dariJson).toList();
  Future<List<PesanChat>> pesan(String ruangId) async => (await _api.getDaftar('/chat/rooms/$ruangId/messages', query: {'limit': 100}, cache: 'chat-pesan-$ruangId')).map(PesanChat.dariJson).toList();
  /// Pesan yang ditulis offline disimpan di antrean dan tampil di ruang
  /// dengan tanda "menunggu" sampai terkirim (lihat [pesanTertunda]).
  Future<HasilKirim> kirim(RuangChat ruang, String isi) => _pengirim.kirim(
        jenis: 'chat-kirim',
        judul: 'Pesan ke ${ruang.nama}: ${isi.length > 40 ? '${isi.substring(0, 40)}…' : isi}',
        metode: 'POST',
        jalur: '/chat/rooms/${ruang.id}/messages',
        badan: {'message': isi},
        info: {'ruangId': ruang.id, 'isi': isi},
      );
  Future<void> hapus(String pesanId) => _api.delete('/chat/messages/$pesanId');
}

final repoChatProvider = Provider<RepoChat>((ref) => RepoChat(ref.watch(klienApiProvider), ref.watch(pengirimAntreanProvider)));
final ruangChatProvider = FutureProvider.autoDispose<List<RuangChat>>((ref) {
  ref.watch(sambunganProvider);
  ref.watch(antreanProvider.select((s) => s.terkirim));
  return ref.watch(repoChatProvider).ruang();
});
final pesanChatProvider = FutureProvider.autoDispose.family<List<PesanChat>, String>((ref, id) {
  ref.watch(sambunganProvider);
  ref.watch(antreanProvider.select((s) => s.terkirim));
  return ref.watch(repoChatProvider).pesan(id);
});

/// Pesan ruang ini yang masih di antrean kirim, terbaru dulu (urutan yang
/// sama dengan daftar dari server).
List<PesanChat> pesanTertunda(Iterable<ItemAntrean> antrean, String ruangId, {required String saya, required String namaSaya}) => [
      for (final i in antrean.where((i) => i.jenis == 'chat-kirim' && i.info['ruangId'] == ruangId).toList().reversed)
        PesanChat(
          id: 'antrean-${i.id}',
          pengirimId: saya,
          pengirim: namaSaya,
          isi: i.info['isi'] as String?,
          dihapus: false,
          waktu: i.dibuat,
          tertunda: true,
          ditolak: i.gagal ? i.galat : null,
        ),
    ];
