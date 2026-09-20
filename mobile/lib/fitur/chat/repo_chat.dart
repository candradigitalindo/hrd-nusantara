import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/klien_api.dart';
import 'model_chat.dart';

class RepoChat {
  RepoChat(this._api);
  final KlienApi _api;
  Future<List<RuangChat>> ruang() async => (await _api.getDaftar('/chat/rooms')).map(RuangChat.dariJson).toList();
  Future<List<PesanChat>> pesan(String ruangId) async => (await _api.getDaftar('/chat/rooms/$ruangId/messages', query: {'limit': 100})).map(PesanChat.dariJson).toList();
  Future<void> kirim(String ruangId, String isi) => _api.post('/chat/rooms/$ruangId/messages', {'message': isi});
  Future<void> hapus(String pesanId) => _api.delete('/chat/messages/$pesanId');
}

final repoChatProvider = Provider<RepoChat>((ref) => RepoChat(ref.watch(klienApiProvider)));
final ruangChatProvider = FutureProvider.autoDispose<List<RuangChat>>((ref) => ref.watch(repoChatProvider).ruang());
final pesanChatProvider = FutureProvider.autoDispose.family<List<PesanChat>, String>((ref, id) => ref.watch(repoChatProvider).pesan(id));
