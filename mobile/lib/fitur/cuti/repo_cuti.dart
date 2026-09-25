import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/api/klien_api.dart';
import '../../core/api/status_jaringan.dart';
import '../../core/format.dart';
import '../antrean/mesin_antrean.dart';
import '../antrean/pengirim_antrean.dart';
import 'model_cuti.dart';

class RepoCuti {
  RepoCuti(this._api, this._pengirim);
  final KlienApi _api;
  final PengirimAntrean _pengirim;

  Future<List<JenisCuti>> jenis() async => (await _api.getDaftar('/leave-types', query: {'limit': 100}, cache: 'cuti-jenis')).map(JenisCuti.dariJson).toList();
  Future<List<SaldoCuti>> saldo() async => (await _api.getDaftar('/leave-balances/me', query: {'year': DateTime.now().year}, cache: 'cuti-saldo')).map(SaldoCuti.dariJson).toList();
  Future<List<Cuti>> riwayat() async => (await _api.getDaftar('/leaves/me', query: {'limit': 50}, cache: 'cuti-riwayat')).map(Cuti.dariJson).toList();

  /// Pengajuan tetap bisa dibuat offline: disimpan di antrean kirim, dan
  /// saldo/tanggal bentrok baru dinilai server saat terkirim.
  Future<HasilKirim> ajukan({required JenisCuti jenis, required DateTime mulai, required DateTime selesai, String? alasan, String? lampiranUrl}) {
    final f = DateFormat('yyyy-MM-dd');
    return _pengirim.kirim(
      jenis: 'cuti-ajukan',
      judul: '${jenis.nama} ${formatTanggal(mulai, pola: 'd MMM')} – ${formatTanggal(selesai, pola: 'd MMM')}',
      metode: 'POST',
      jalur: '/leaves',
      badan: {
        'leaveTypeId': jenis.id,
        'startDate': f.format(mulai),
        'endDate': f.format(selesai),
        if (alasan != null && alasan.isNotEmpty) 'reason': alasan,
        if (lampiranUrl != null && lampiranUrl.isNotEmpty) 'attachmentUrl': lampiranUrl,
      },
    );
  }

  Future<HasilKirim> batalkan(Cuti c, {String? alasan}) => _pengirim.kirim(
        jenis: 'cuti-batal',
        judul: 'Batalkan ${c.jenisNama} ${formatTanggalSaja(c.mulai, pola: 'd MMM')}',
        metode: 'PATCH',
        jalur: '/leaves/${c.id}/cancel',
        badan: {if (alasan != null && alasan.isNotEmpty) 'reason': alasan},
        info: {'cutiId': c.id},
      );
}

final repoCutiProvider = Provider<RepoCuti>((ref) => RepoCuti(ref.watch(klienApiProvider), ref.watch(pengirimAntreanProvider)));
final jenisCutiProvider = FutureProvider.autoDispose<List<JenisCuti>>((ref) {
  ref.watch(sambunganProvider);
  return ref.watch(repoCutiProvider).jenis();
});
final saldoCutiProvider = FutureProvider.autoDispose<List<SaldoCuti>>((ref) {
  ref.watch(sambunganProvider);
  ref.watch(antreanProvider.select((s) => s.terkirim));
  return ref.watch(repoCutiProvider).saldo();
});
final riwayatCutiProvider = FutureProvider.autoDispose<List<Cuti>>((ref) {
  ref.watch(sambunganProvider);
  ref.watch(antreanProvider.select((s) => s.terkirim));
  return ref.watch(repoCutiProvider).riwayat();
});
