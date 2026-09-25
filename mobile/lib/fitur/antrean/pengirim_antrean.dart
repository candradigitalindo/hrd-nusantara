import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/galat_api.dart';
import '../../core/api/klien_api.dart';
import '../../core/api/status_jaringan.dart';
import 'mesin_antrean.dart';
import 'model_antrean.dart';

/// Hasil kiriman: sampai ke server ([jawaban]), atau disimpan di antrean
/// kirim ([antre]) karena server tak terjangkau.
class HasilKirim {
  const HasilKirim.terkirim(this.jawaban) : antre = null;
  const HasilKirim.tertunda(ItemAntrean this.antre) : jawaban = const {};
  final Map<String, dynamic> jawaban;
  final ItemAntrean? antre;
  bool get tertunda => antre != null;
}

/// Kirim langsung bila server terjangkau, simpan di antrean bila tidak —
/// satu jalur untuk semua fitur yang boleh dipakai offline.
///
/// Kiriman langsung pun memakai Idempotency-Key, dan kiriman yang gagal
/// karena jaringan masuk antrean dengan kunci yang SAMA: bila permintaan
/// tadi ternyata sudah sampai (jawabannya yang hilang), server menjawab
/// kiriman ulangnya dengan hasil yang sama, bukan membuat data kedua.
/// Penolakan server (validasi, hak akses) dilempar apa adanya, tidak
/// diantrekan.
class PengirimAntrean {
  PengirimAntrean(this._ref);
  final Ref _ref;

  Future<HasilKirim> kirim({
    required String jenis,
    required String judul,
    required String metode,
    required String jalur,
    required Map<String, dynamic> badan,
    /// Badan yang disimpan bila masuk antrean, bila berbeda (mis. presensi
    /// menambahkan bukti waktu offline).
    Map<String, dynamic>? badanAntrean,
    Map<String, dynamic> info = const {},
    String? bergantungPada,
    Duration? batasWaktu,
    /// false = langsung ke antrean, mis. karena harus menunggu kiriman lain.
    bool bolehLangsung = true,
  }) async {
    final id = idAntreanBaru();
    if (bolehLangsung && bergantungPada == null && _ref.read(statusJaringanProvider).terhubung) {
      try {
        return HasilKirim.terkirim(await _ref.read(klienApiProvider).kirimAntrean(metode, jalur, badan, kunci: id, batasWaktu: batasWaktu));
      } on GalatApi catch (g) {
        if (!g.serverTakTerjangkau) rethrow;
      }
    }
    final item = await _ref.read(antreanProvider.notifier).tambah(
          id: id,
          jenis: jenis,
          judul: judul,
          metode: metode,
          jalur: jalur,
          badan: badanAntrean ?? badan,
          bergantungPada: bergantungPada,
          info: info,
        );
    return HasilKirim.tertunda(item);
  }

  /// Kiriman milik pengguna ini yang masih menunggu (belum ditolak).
  Iterable<ItemAntrean> menunggu(String jenis) => _ref.read(antreanProvider).item.where((i) => i.jenis == jenis && !i.gagal);
}

final pengirimAntreanProvider = Provider<PengirimAntrean>((ref) => PengirimAntrean(ref));
