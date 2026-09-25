import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/api/klien_api.dart';
import '../../core/api/status_jaringan.dart';
import '../../core/format.dart';
import '../antrean/mesin_antrean.dart';
import '../antrean/model_antrean.dart';
import 'model_presensi.dart';

class RepoPresensi {
  RepoPresensi(this._api);
  final KlienApi _api;

  Future<List<LokasiKerja>> lokasiKerja() async =>
      (await _api.getDaftar('/work-locations', query: {'limit': 100}, cache: 'lokasi-kerja')).map(LokasiKerja.dariJson).toList();

  Future<List<Presensi>> riwayat({DateTime? mulai, DateTime? selesai, int limit = 30, String? cache}) async {
    final f = DateFormat('yyyy-MM-dd');
    return (await _api.getDaftar('/attendance/me', query: {
      'limit': limit,
      if (mulai != null) 'startDate': f.format(mulai),
      if (selesai != null) 'endDate': f.format(selesai),
    }, cache: cache))
        .map(Presensi.dariJson)
        .toList();
  }

}

DateTime _waktuKiriman(ItemAntrean i) => parseTanggal(i.info['waktu']) ?? i.dibuat;

/// Presensi hari ini menurut server, dilengkapi presensi yang masih di
/// antrean kirim (diambil saat offline): check-in yang belum terkirim tetap
/// tampil — dan tombol check-out muncul — begitu pula check-out-nya.
Presensi? gabungTertunda(Presensi? server, Iterable<ItemAntrean> antrean, DateTime sekarang) {
  final f = DateFormat('yyyy-MM-dd');
  final hari = f.format(sekarang);
  final aktif = antrean.where((i) => !i.gagal && i.jenis.startsWith('presensi-')).toList();
  bool hariIni(ItemAntrean i) => f.format(_waktuKiriman(i)) == hari;

  final masuk = aktif.where((i) => i.jenis == 'presensi-masuk' && hariIni(i)).lastOrNull;
  if (masuk != null) {
    final pulang = aktif.where((i) => i.jenis == 'presensi-pulang' && i.bergantungPada == masuk.id).lastOrNull;
    return Presensi(
      id: 'antrean-${masuk.id}',
      status: 'present',
      tanggal: _waktuKiriman(masuk),
      jamMasuk: _waktuKiriman(masuk),
      jamPulang: pulang == null ? null : _waktuKiriman(pulang),
      metodeMasuk: masuk.info['metode'] as String?,
      namaLokasi: masuk.info['lokasi'] as String?,
      masukTertunda: true,
      pulangTertunda: pulang != null,
    );
  }
  final pulang = aktif.where((i) => i.jenis == 'presensi-pulang' && i.bergantungPada == null && hariIni(i)).lastOrNull;
  if (server != null && server.masihTerbuka && pulang != null) return server.denganPulangTertunda(_waktuKiriman(pulang));
  return server;
}

final repoPresensiProvider = Provider<RepoPresensi>((ref) => RepoPresensi(ref.watch(klienApiProvider)));

final riwayatPresensiProvider = FutureProvider.autoDispose<List<Presensi>>((ref) {
  ref.watch(sambunganProvider);
  // Presensi dari antrean yang baru terkirim harus segera tampil dari server.
  ref.watch(antreanProvider.select((s) => s.terkirim));
  final sekarang = DateTime.now();
  return ref.watch(repoPresensiProvider).riwayat(mulai: sekarang.subtract(const Duration(days: 30)), selesai: sekarang, limit: 60, cache: 'presensi-riwayat');
});

/// Presensi hari ini, bila ada — dipakai untuk memutuskan tombol masuk/pulang.
/// Disaring dari riwayat, bukan permintaan bertanggal tersendiri: saat offline
/// riwayat tersimpan kemarin tetap terpakai, dan presensi kemarin tidak
/// tampil sebagai presensi hari ini. Untuk menyegarkan, invalidasi
/// [riwayatPresensiProvider].
final presensiHariIniProvider = FutureProvider.autoDispose<Presensi?>((ref) async {
  final sekarang = DateTime.now();
  final hariIni = DateFormat('yyyy-MM-dd').format(sekarang);
  // Diawasi lewat tanda tangan teks: berubah hanya bila kiriman presensi di
  // antrean berubah, bukan setiap kali status antrean lain bergerak.
  ref.watch(antreanProvider.select((s) => s.item.where((i) => i.jenis.startsWith('presensi-')).map((i) => '${i.id}:${i.status.name}').join(',')));
  final daftar = await ref.watch(riwayatPresensiProvider.future);
  final server = daftar.where((p) => p.tanggal != null && DateFormat('yyyy-MM-dd').format(p.tanggal!) == hariIni).firstOrNull;
  return gabungTertunda(server, ref.read(antreanProvider).item, sekarang);
});

final lokasiKerjaProvider = FutureProvider.autoDispose<List<LokasiKerja>>((ref) {
  ref.watch(sambunganProvider);
  return ref.watch(repoPresensiProvider).lokasiKerja();
});
