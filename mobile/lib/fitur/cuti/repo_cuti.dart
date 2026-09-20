import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/klien_api.dart';
import 'model_cuti.dart';

class RepoCuti {
  RepoCuti(this._api);
  final KlienApi _api;

  Future<List<JenisCuti>> jenis() async => (await _api.getDaftar('/leave-types', query: {'limit': 100})).map(JenisCuti.dariJson).toList();
  Future<List<SaldoCuti>> saldo() async => (await _api.getDaftar('/leave-balances/me', query: {'year': DateTime.now().year})).map(SaldoCuti.dariJson).toList();
  Future<List<Cuti>> riwayat() async => (await _api.getDaftar('/leaves/me', query: {'limit': 50})).map(Cuti.dariJson).toList();

  Future<Cuti> ajukan({required String jenisId, required String mulai, required String selesai, String? alasan, String? lampiranUrl}) async =>
      Cuti.dariJson(await _api.post('/leaves', {
        'leaveTypeId': jenisId,
        'startDate': mulai,
        'endDate': selesai,
        if (alasan != null && alasan.isNotEmpty) 'reason': alasan,
        if (lampiranUrl != null && lampiranUrl.isNotEmpty) 'attachmentUrl': lampiranUrl,
      }));

  Future<void> batalkan(String id, {String? alasan}) => _api.post('/leaves/$id/cancel', {if (alasan != null && alasan.isNotEmpty) 'reason': alasan});
}

final repoCutiProvider = Provider<RepoCuti>((ref) => RepoCuti(ref.watch(klienApiProvider)));
final jenisCutiProvider = FutureProvider.autoDispose<List<JenisCuti>>((ref) => ref.watch(repoCutiProvider).jenis());
final saldoCutiProvider = FutureProvider.autoDispose<List<SaldoCuti>>((ref) => ref.watch(repoCutiProvider).saldo());
final riwayatCutiProvider = FutureProvider.autoDispose<List<Cuti>>((ref) => ref.watch(repoCutiProvider).riwayat());
