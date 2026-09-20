import 'dart:math' as math;

import 'package:geolocator/geolocator.dart';

import 'model_presensi.dart';

class GalatLokasi implements Exception {
  GalatLokasi(this.pesan, {this.bukaPengaturan = false});
  final String pesan;
  final bool bukaPengaturan;
  @override
  String toString() => pesan;
}

class PosisiSaatIni {
  const PosisiSaatIni(this.latitude, this.longitude, this.akurasiMeter);
  final double latitude;
  final double longitude;
  final double akurasiMeter;
}

/// Jarak permukaan bumi (haversine) dalam meter. Murni, supaya bisa diuji.
double jarakMeter(double lat1, double lng1, double lat2, double lng2) {
  const r = 6371000.0;
  double rad(double d) => d * math.pi / 180;
  final dLat = rad(lat2 - lat1);
  final dLng = rad(lng2 - lng1);
  final a = math.sin(dLat / 2) * math.sin(dLat / 2) + math.cos(rad(lat1)) * math.cos(rad(lat2)) * math.sin(dLng / 2) * math.sin(dLng / 2);
  return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a));
}

class LokasiTerdekat {
  const LokasiTerdekat(this.lokasi, this.jarak);
  final LokasiKerja lokasi;
  final double jarak;
  bool get diDalamRadius => jarak <= lokasi.radiusMeter;
}

/// Lokasi kerja terdekat dari posisi, atau null bila daftar kosong.
LokasiTerdekat? lokasiTerdekat(List<LokasiKerja> daftar, double lat, double lng) {
  LokasiTerdekat? terbaik;
  for (final l in daftar) {
    final d = jarakMeter(lat, lng, l.latitude, l.longitude);
    if (terbaik == null || d < terbaik.jarak) terbaik = LokasiTerdekat(l, d);
  }
  return terbaik;
}

/// Meminta izin dan mengambil posisi. Pesan galatnya sudah untuk pengguna.
Future<PosisiSaatIni> ambilPosisi() async {
  if (!await Geolocator.isLocationServiceEnabled()) {
    throw GalatLokasi('Layanan lokasi (GPS) mati. Nyalakan dulu di pengaturan ponsel.', bukaPengaturan: true);
  }
  var izin = await Geolocator.checkPermission();
  if (izin == LocationPermission.denied) izin = await Geolocator.requestPermission();
  if (izin == LocationPermission.deniedForever) {
    throw GalatLokasi('Izin lokasi ditolak permanen. Izinkan lewat pengaturan aplikasi.', bukaPengaturan: true);
  }
  if (izin == LocationPermission.denied) throw GalatLokasi('Izin lokasi dibutuhkan untuk presensi.');
  final p = await Geolocator.getCurrentPosition(
    locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 15)),
  );
  return PosisiSaatIni(p.latitude, p.longitude, p.accuracy);
}
