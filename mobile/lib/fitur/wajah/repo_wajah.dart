import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/klien_api.dart';
import '../../core/api/status_jaringan.dart';
import '../../core/format.dart';
import '../../core/konfigurasi.dart';
import '../presensi/layar_kamera_wajah.dart';
import 'model_wajah.dart';

/// Pendaftaran wajah milik sendiri. Sengaja tanpa salinan offline dan tanpa
/// antrean kirim: status yang basi bisa menahan check-in wajah yang sudah
/// disetujui HR, dan foto harus diperiksa server (keaslian, satu wajah)
/// selagi karyawan masih di depan kamera untuk memotret ulang.
class RepoWajah {
  RepoWajah(this._api);
  final KlienApi _api;

  Future<StatusWajah> status() async => StatusWajah.dariJson(await _api.getObjek('/face-enrollments/me'));

  /// [dataUriBase64] adalah hasil [LayarKameraWajah]. Kiriman yang masih
  /// menunggu dibatalkan server dan digantikan yang ini.
  Future<KirimanWajah> kirim(String dataUriBase64) async {
    final j = await _api.post('/face-enrollments/me', {'image': dataUriBase64}, batasWaktu: batasWaktuUnggah);
    return KirimanWajah(id: j['id'] as String, dikirimPada: parseTanggal(j['createdAt']));
  }
}

final repoWajahProvider = Provider<RepoWajah>((ref) => RepoWajah(ref.watch(klienApiProvider)));

final statusWajahProvider = FutureProvider.autoDispose<StatusWajah>((ref) {
  ref.watch(sambunganProvider);
  return ref.watch(repoWajahProvider).status();
});

/// Membuka kamera depan untuk selfie pendaftaran. Lewat provider supaya tes
/// bisa menggantinya: kamera sungguhan tidak ada di `flutter test`.
final ambilSelfieWajahProvider = Provider<Future<String?> Function(BuildContext context)>(
  (ref) => (context) => LayarKameraWajah.buka(context, judul: 'Daftarkan Wajah'),
);

/// Memuat ulang status yang mungkin sudah lama tersimpan di memori (Profil
/// menjaganya tetap hidup), karena HR bisa saja baru memutuskan. Yang sedang
/// dimuat dibiarkan supaya tidak ada permintaan kedua.
void segarkanStatusWajah(WidgetRef ref) {
  if (!ref.read(statusWajahProvider).isLoading) ref.invalidate(statusWajahProvider);
}
