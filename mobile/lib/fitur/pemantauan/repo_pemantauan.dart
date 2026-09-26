import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/jam_server.dart';
import '../../core/api/klien_api.dart';

/// Pengaturan Pemantauan Lokasi dari Super Admin (lihat backend
/// locationTrackingController).
class KonfigurasiPemantauan {
  const KonfigurasiPemantauan({required this.aktif, required this.selamaBekerja, required this.intervalMenit});
  final bool aktif;

  /// false = 24 jam; true = hanya selama presensi hari ini masih terbuka.
  final bool selamaBekerja;
  final int intervalMenit;

  factory KonfigurasiPemantauan.dariJson(Map<String, dynamic> j) => KonfigurasiPemantauan(
        aktif: j['enabled'] == true,
        selamaBekerja: j['mode'] == 'while_working',
        intervalMenit: (j['intervalMinutes'] as num?)?.toInt() ?? 20,
      );

  @override
  bool operator ==(Object other) =>
      other is KonfigurasiPemantauan && other.aktif == aktif && other.selamaBekerja == selamaBekerja && other.intervalMenit == intervalMenit;

  @override
  int get hashCode => Object.hash(aktif, selamaBekerja, intervalMenit);
}

class TitikLokasi {
  const TitikLokasi({required this.latitude, required this.longitude, required this.waktu, this.akurasiMeter, this.palsu = false});
  final double latitude;
  final double longitude;
  final DateTime waktu;
  final double? akurasiMeter;
  final bool palsu;

  Map<String, dynamic> keJson() => {
        'latitude': latitude,
        'longitude': longitude,
        'recordedAt': isoMilidetik(waktu),
        if (akurasiMeter != null) 'accuracyMeters': akurasiMeter,
        'isMocked': palsu,
      };

  factory TitikLokasi.dariJson(Map<String, dynamic> j) => TitikLokasi(
        latitude: (j['latitude'] as num).toDouble(),
        longitude: (j['longitude'] as num).toDouble(),
        waktu: DateTime.parse(j['recordedAt'] as String),
        akurasiMeter: (j['accuracyMeters'] as num?)?.toDouble(),
        palsu: j['isMocked'] == true,
      );
}

class RepoPemantauan {
  RepoPemantauan(this._api);
  final KlienApi _api;

  /// Tersalin offline: ponsel tetap tahu harus memantau walau tanpa sinyal.
  Future<KonfigurasiPemantauan> konfigurasi() async =>
      KonfigurasiPemantauan.dariJson(await _api.getObjek('/location-tracking/config', cache: 'pemantauan-konfigurasi'));

  /// `enabled: false` di jawaban berarti pemantauan sudah dimatikan.
  Future<Map<String, dynamic>> kirim(List<TitikLokasi> titik) =>
      _api.post('/location-tracking/pings', {'pings': titik.map((t) => t.keJson()).toList()});

  Future<void> laporkanStatus({required bool setuju, required String izin, required String platform, String? versi}) =>
      _api.put('/location-tracking/status', {'consent': setuju, 'permission': izin, 'platform': platform, 'appVersion': ?versi});
}

final repoPemantauanProvider = Provider<RepoPemantauan>((ref) => RepoPemantauan(ref.watch(klienApiProvider)));
