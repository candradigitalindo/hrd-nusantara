import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/klien_api.dart';
import 'model_whatsapp.dart';

class RepoWhatsApp {
  RepoWhatsApp(this._api);
  final KlienApi _api;
  Future<List<KejadianSesi>> kejadian() async => (await _api.getDaftar('/whatsapp/session-events', query: {'limit': 20})).map(KejadianSesi.dariJson).toList();
  Future<SesiWhatsApp> sesi(String akunId) async => SesiWhatsApp.dariJson(await _api.getObjek('/whatsapp/accounts/$akunId/session'));
}

final repoWhatsAppProvider = Provider<RepoWhatsApp>((ref) => RepoWhatsApp(ref.watch(klienApiProvider)));
final kejadianSesiProvider = FutureProvider.autoDispose<List<KejadianSesi>>((ref) => ref.watch(repoWhatsAppProvider).kejadian());
final sesiWhatsAppProvider = FutureProvider.autoDispose.family<SesiWhatsApp, String>((ref, id) => ref.watch(repoWhatsAppProvider).sesi(id));
