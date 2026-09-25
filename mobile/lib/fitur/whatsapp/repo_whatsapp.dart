import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/klien_api.dart';
import '../../core/api/status_jaringan.dart';
import 'model_whatsapp.dart';

/// Mobile hanya MEMERIKSA tautan WhatsApp. Pemindaian QR dilakukan lewat
/// aplikasi web (halaman WhatsApp Saya), bukan dari ponsel — ponsel yang
/// sama tidak bisa memindai QR yang tampil di layarnya sendiri.
class RepoWhatsApp {
  RepoWhatsApp(this._api);
  final KlienApi _api;

  Future<TautanWhatsApp> saya() async => TautanWhatsApp.dariJson(await _api.getObjek('/whatsapp/me', cache: 'whatsapp'));
  Future<List<KejadianSesi>> kejadian() async => (await _api.getDaftar('/whatsapp/session-events', query: {'limit': 20}, cache: 'whatsapp-kejadian')).map(KejadianSesi.dariJson).toList();
}

final repoWhatsAppProvider = Provider<RepoWhatsApp>((ref) => RepoWhatsApp(ref.watch(klienApiProvider)));
final tautanWhatsAppProvider = FutureProvider.autoDispose<TautanWhatsApp>((ref) {
  ref.watch(sambunganProvider);
  return ref.watch(repoWhatsAppProvider).saya();
});
final kejadianSesiProvider = FutureProvider.autoDispose<List<KejadianSesi>>((ref) {
  ref.watch(sambunganProvider);
  return ref.watch(repoWhatsAppProvider).kejadian();
});
