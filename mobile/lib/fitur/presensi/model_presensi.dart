import '../../core/format.dart';

class LokasiKerja {
  const LokasiKerja({required this.id, required this.nama, required this.latitude, required this.longitude, required this.radiusMeter, this.alamat});
  final String id;
  final String nama;
  final double latitude;
  final double longitude;
  final int radiusMeter;
  final String? alamat;

  factory LokasiKerja.dariJson(Map<String, dynamic> j) => LokasiKerja(
        id: j['id'] as String,
        nama: j['name'] as String,
        latitude: (j['latitude'] as num).toDouble(),
        longitude: (j['longitude'] as num).toDouble(),
        radiusMeter: (j['radiusMeters'] as num).toInt(),
        alamat: j['address'] as String?,
      );
}

class Presensi {
  const Presensi({
    required this.id,
    required this.status,
    this.tanggal,
    this.jamMasuk,
    this.jamPulang,
    this.metodeMasuk,
    this.menitTerlambat,
    this.menitKerja,
    this.jamLembur,
    this.lemburDisetujui = false,
    this.wajahTerverifikasi = false,
    this.catatan,
    this.namaLokasi,
    this.shiftMulai,
    this.shiftSelesai,
  });

  final String id;
  final String status;
  final DateTime? tanggal;
  final DateTime? jamMasuk;
  final DateTime? jamPulang;
  final String? metodeMasuk;
  final int? menitTerlambat;
  final int? menitKerja;
  final num? jamLembur;
  final bool lemburDisetujui;
  final bool wajahTerverifikasi;
  final String? catatan;
  final String? namaLokasi;
  final String? shiftMulai;
  final String? shiftSelesai;

  bool get masihTerbuka => jamMasuk != null && jamPulang == null;

  factory Presensi.dariJson(Map<String, dynamic> j) => Presensi(
        id: j['id'] as String,
        status: (j['status'] ?? 'present') as String,
        tanggal: parseTanggal(j['date'] ?? j['checkInTime']),
        jamMasuk: parseTanggal(j['checkInTime']),
        jamPulang: parseTanggal(j['checkOutTime']),
        metodeMasuk: j['checkInMethod'] as String?,
        menitTerlambat: (j['lateMinutes'] as num?)?.toInt(),
        menitKerja: (j['workedMinutes'] as num?)?.toInt(),
        jamLembur: j['overtimeHours'] is num ? j['overtimeHours'] as num : num.tryParse('${j['overtimeHours'] ?? ''}'),
        lemburDisetujui: j['overtimeApproved'] == true,
        wajahTerverifikasi: j['faceVerified'] == true,
        catatan: j['notes'] as String?,
        namaLokasi: (j['workLocation'] as Map?)?['name'] as String?,
        shiftMulai: (j['shiftSchedule'] as Map?)?['startTime'] as String?,
        shiftSelesai: (j['shiftSchedule'] as Map?)?['endTime'] as String?,
      );
}

enum MetodeAbsen { gps, wajah, qr }

extension MetodeAbsenKode on MetodeAbsen {
  String get kode => switch (this) { MetodeAbsen.gps => 'gps', MetodeAbsen.wajah => 'face', MetodeAbsen.qr => 'qr' };
  String get label => switch (this) { MetodeAbsen.gps => 'Lokasi GPS', MetodeAbsen.wajah => 'Verifikasi Wajah', MetodeAbsen.qr => 'Pindai QR' };
}

/// Data yang dikirim ke POST /attendance/check-in atau /check-out.
class PermintaanAbsen {
  const PermintaanAbsen({required this.metode, this.latitude, this.longitude, this.lokasiId, this.qrToken, this.fotoWajahBase64, this.catatan});
  final MetodeAbsen metode;
  final double? latitude;
  final double? longitude;
  final String? lokasiId;
  final String? qrToken;
  final String? fotoWajahBase64;
  final String? catatan;

  Map<String, dynamic> keJson({bool sertakanLokasiId = true}) => {
        'method': metode.kode,
        if (latitude != null) 'latitude': latitude,
        if (longitude != null) 'longitude': longitude,
        if (sertakanLokasiId && lokasiId != null) 'workLocationId': lokasiId,
        if (qrToken != null) 'qrToken': qrToken,
        if (fotoWajahBase64 != null) 'faceImage': fotoWajahBase64,
        if (catatan != null && catatan!.isNotEmpty) 'notes': catatan,
      };
}
