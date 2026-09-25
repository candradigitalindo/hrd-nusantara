import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/jam_server.dart';
import '../../core/format.dart';
import '../../core/konfigurasi.dart';
import '../antrean/pengirim_antrean.dart';
import 'model_presensi.dart';

/// Mengirim presensi langsung bila server terjangkau, atau menyimpannya di
/// antrean kirim bila tidak (lihat [PengirimAntrean]) — presensi tetap bisa
/// dilakukan tanpa sinyal, dengan bukti waktu saat diambil.
class PengirimPresensi {
  PengirimPresensi(this._ref);
  final Ref _ref;

  /// Presensi dari server, atau — bila disimpan di antrean — presensi
  /// sementara dengan [Presensi.tertunda].
  Future<Presensi> kirim(PermintaanAbsen permintaan, {required bool pulang, String? namaLokasi, DateTime? waktuGps}) async {
    final waktu = DateTime.now();
    // Bukti jam diambil sekarang, saat presensi dilakukan, bukan saat terkirim.
    final bukti = await _ref.read(jamServerProvider).bukti(waktuGps: waktuGps);
    final badan = permintaan.keJson(sertakanLokasiId: !pulang);
    final pengirim = _ref.read(pengirimAntreanProvider);

    // Check-out untuk check-in yang masih mengantre harus menunggu di
    // belakangnya; dikirim langsung, server menjawab "tidak ada presensi terbuka".
    final masukMengantre = pulang ? pengirim.menunggu('presensi-masuk').lastOrNull : null;
    final berfoto = permintaan.fotoWajahBase64 != null || permintaan.fotoStempelBase64 != null;

    final hasil = await pengirim.kirim(
      jenis: pulang ? 'presensi-pulang' : 'presensi-masuk',
      judul: '${pulang ? 'Check-out' : 'Check-in'} ${formatWaktu(waktu)}${namaLokasi == null ? '' : ' · $namaLokasi'}',
      metode: 'POST',
      jalur: pulang ? '/attendance/check-out' : '/attendance/check-in',
      badan: badan,
      badanAntrean: {...badan, 'offline': bukti},
      bergantungPada: masukMengantre?.id,
      batasWaktu: berfoto ? batasWaktuUnggah : null,
      info: {'waktu': isoMilidetik(waktu), 'lokasi': ?namaLokasi, 'metode': permintaan.metode.kode},
    );
    if (!hasil.tertunda) return Presensi.dariJson(hasil.jawaban);
    return Presensi(
      id: 'antrean-${hasil.antre!.id}',
      status: 'present',
      tanggal: waktu,
      jamMasuk: pulang ? null : waktu,
      jamPulang: pulang ? waktu : null,
      metodeMasuk: permintaan.metode.kode,
      namaLokasi: namaLokasi,
      masukTertunda: !pulang,
      pulangTertunda: pulang,
    );
  }
}

final pengirimPresensiProvider = Provider<PengirimPresensi>((ref) => PengirimPresensi(ref));
