import '../../core/format.dart';

/// Keadaan pendaftaran wajah milik sendiri, sebagaimana tampil di aplikasi.
enum KeadaanWajah {
  /// Server tidak memakai pengenalan wajah; check-in wajah pasti gagal.
  nonaktif,
  belum,
  menunggu,
  ditolak,
  terdaftar,
}

/// Kiriman foto wajah yang sedang menunggu persetujuan HR.
class KirimanWajah {
  const KirimanWajah({required this.id, this.dikirimPada});
  final String id;
  final DateTime? dikirimPada;
}

/// Kiriman foto wajah terakhir yang ditolak HR, beserta alasannya.
class PenolakanWajah {
  const PenolakanWajah({required this.id, this.alasan, this.ditolakPada});
  final String id;
  final String? alasan;
  final DateTime? ditolakPada;
}

/// Jawaban GET /face-enrollments/me.
class StatusWajah {
  const StatusWajah({required this.terdaftar, required this.pengenalanAktif, this.menunggu, this.penolakan});

  /// Ada pendaftaran yang dipakai untuk mencocokkan check-in — syaratnya sama
  /// dengan yang dipakai server saat check-in wajah.
  final bool terdaftar;
  final bool pengenalanAktif;
  final KirimanWajah? menunggu;

  /// Hanya terisi bila kiriman mandiri TERBARU ditolak; kiriman sesudahnya
  /// (atau pendaftaran oleh HR) menghapusnya.
  final PenolakanWajah? penolakan;

  factory StatusWajah.dariJson(Map<String, dynamic> j) {
    final menunggu = j['pending'];
    final tolak = j['lastRejection'];
    final alasan = tolak is Map && tolak['reason'] is String ? (tolak['reason'] as String).trim() : '';
    return StatusWajah(
      terdaftar: j['enrolled'] == true,
      pengenalanAktif: j['recognitionEnabled'] != false,
      menunggu: menunggu is Map ? KirimanWajah(id: menunggu['id'] as String, dikirimPada: parseTanggal(menunggu['createdAt'])) : null,
      penolakan: tolak is Map
          ? PenolakanWajah(id: tolak['id'] as String, alasan: alasan.isEmpty ? null : alasan, ditolakPada: parseTanggal(tolak['reviewedAt']))
          : null,
    );
  }

  /// Yang terdaftar tetap "terdaftar" walau sedang menunggu foto pengganti:
  /// check-in wajah tetap memakai foto lama sampai yang baru disetujui.
  KeadaanWajah get keadaan {
    if (!pengenalanAktif) return KeadaanWajah.nonaktif;
    if (terdaftar) return KeadaanWajah.terdaftar;
    if (menunggu != null) return KeadaanWajah.menunggu;
    if (penolakan != null) return KeadaanWajah.ditolak;
    return KeadaanWajah.belum;
  }

  /// Check-in wajah pasti ditolak server dan belum ada foto yang sedang
  /// diperiksa HR: karyawan perlu mengirim foto dulu.
  bool get perluMendaftar => keadaan == KeadaanWajah.belum || keadaan == KeadaanWajah.ditolak;

  /// Ringkasan satu baris, mis. untuk subjudul menu Profil.
  String get ringkasan => switch (keadaan) {
        KeadaanWajah.nonaktif => 'Verifikasi wajah dinonaktifkan',
        KeadaanWajah.belum => 'Belum terdaftar',
        KeadaanWajah.menunggu => 'Menunggu persetujuan HR',
        KeadaanWajah.ditolak => 'Ditolak — kirim ulang',
        KeadaanWajah.terdaftar => menunggu != null ? 'Terdaftar · foto baru menunggu persetujuan HR' : 'Terdaftar',
      };
}
