import '../../core/format.dart';

/// Pendaftaran pelatihan milik pengguna, dengan ringkasan sesinya.
/// Bentuknya mengikuti GET /training/registrations.
class PendaftaranPelatihan {
  const PendaftaranPelatihan({
    required this.id,
    required this.sesiId,
    required this.status,
    required this.judul,
    required this.mulai,
    this.selesai,
    this.lokasi,
    this.pelatih,
    this.program,
    this.nilai,
    this.lulus,
    this.berlakuSampai,
    this.sertifikatUrl,
    this.catatan,
    this.tanggalDaftar,
  });

  final String id;
  final String sesiId;

  /// registered · waitlisted · attended · completed · failed · cancelled · no_show
  final String status;
  final String judul;
  final DateTime? mulai;
  final DateTime? selesai;
  final String? lokasi;
  final String? pelatih;
  final String? program;
  final num? nilai;
  final bool? lulus;
  final DateTime? berlakuSampai;
  final String? sertifikatUrl;
  final String? catatan;
  final DateTime? tanggalDaftar;

  bool get mendatang => mulai != null && mulai!.isAfter(DateTime.now()) && status != 'cancelled';

  /// Masih memegang kursi, jadi masih bisa dibatalkan.
  bool get aktif => status == 'registered' || status == 'waitlisted';

  factory PendaftaranPelatihan.dariJson(Map<String, dynamic> j) {
    final sesi = (j['trainingSession'] as Map?) ?? const {};
    return PendaftaranPelatihan(
      id: j['id'] as String,
      sesiId: (j['trainingSessionId'] ?? sesi['id'] ?? '') as String,
      status: (j['status'] ?? 'registered') as String,
      judul: (sesi['title'] ?? '-') as String,
      mulai: parseTanggal(sesi['startDateTime']),
      selesai: parseTanggal(sesi['endDateTime']),
      lokasi: sesi['location'] as String?,
      pelatih: sesi['trainer'] as String?,
      program: (sesi['program'] as Map?)?['name'] as String?,
      nilai: num.tryParse('${j['evaluationScore'] ?? ''}'),
      lulus: j['passed'] as bool?,
      berlakuSampai: parseTanggal(j['expiresAt']),
      sertifikatUrl: j['certificateUrl'] as String?,
      catatan: j['note'] as String?,
      tanggalDaftar: parseTanggal(j['registrationDate']),
    );
  }
}

/// Sesi pelatihan yang dibuka HR. Bentuknya mengikuti GET /training/sessions.
class SesiPelatihan {
  const SesiPelatihan({
    required this.id,
    required this.judul,
    required this.status,
    required this.jumlahPendaftar,
    required this.wajib,
    this.keterangan,
    this.pelatih,
    this.mulai,
    this.selesai,
    this.lokasi,
    this.kuota,
    this.batasDaftar,
    this.biaya,
    this.program,
  });
  final String id;
  final String judul;

  /// scheduled · ongoing · completed · cancelled
  final String status;
  final int jumlahPendaftar;
  final bool wajib;
  final String? keterangan;
  final String? pelatih;
  final DateTime? mulai;
  final DateTime? selesai;
  final String? lokasi;
  final int? kuota;
  final DateTime? batasDaftar;
  final num? biaya;
  final String? program;

  bool get penuh => kuota != null && jumlahPendaftar >= kuota!;

  /// Terjadwal dan batas pendaftarannya (atau jam mulainya) belum lewat.
  bool get bukaPendaftaran => status == 'scheduled' && (batasDaftar ?? mulai ?? DateTime(1970)).isAfter(DateTime.now());

  factory SesiPelatihan.dariJson(Map<String, dynamic> j) => SesiPelatihan(
        id: j['id'] as String,
        judul: (j['title'] ?? '-') as String,
        status: (j['status'] ?? 'scheduled') as String,
        jumlahPendaftar: (j['registrationCount'] as num?)?.toInt() ?? 0,
        wajib: (j['program'] as Map?)?['isMandatory'] == true,
        keterangan: j['description'] as String?,
        pelatih: j['trainer'] as String?,
        mulai: parseTanggal(j['startDateTime']),
        selesai: parseTanggal(j['endDateTime']),
        lokasi: j['location'] as String?,
        kuota: (j['maxParticipants'] as num?)?.toInt(),
        batasDaftar: parseTanggal(j['registrationDeadline']),
        biaya: num.tryParse('${j['cost'] ?? ''}'),
        program: (j['program'] as Map?)?['name'] as String?,
      );
}
