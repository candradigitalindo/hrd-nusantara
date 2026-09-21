import '../../core/format.dart';

class KejadianSesi {
  const KejadianSesi({required this.id, required this.akunId, required this.jenis, required this.labelAkun, required this.nomor, required this.waktu, this.diberitahuPada});
  final String id;
  final String akunId;
  final String jenis;
  final String labelAkun;
  final String nomor;
  final DateTime waktu;
  final DateTime? diberitahuPada;

  bool get perluScanUlang => jenis == 'logged_out' || jenis == 'qr_required' || jenis == 'disconnected';

  factory KejadianSesi.dariJson(Map<String, dynamic> j) {
    final akun = (j['account'] as Map?) ?? {};
    return KejadianSesi(
      id: j['id'] as String,
      akunId: (akun['id'] ?? j['accountId'] ?? '') as String,
      jenis: (j['eventType'] ?? '') as String,
      labelAkun: (akun['label'] ?? '') as String,
      nomor: (akun['phoneNumber'] ?? '') as String,
      waktu: parseTanggal(j['occurredAt'] ?? j['createdAt']) ?? DateTime.now(),
      diberitahuPada: parseTanggal(j['notifiedAt']),
    );
  }
}

class SesiWhatsApp {
  const SesiWhatsApp({required this.akunId, required this.nomor, required this.label, required this.status, required this.qrTersedia, this.qrDataUrl, this.catatan});
  final String akunId;
  final String nomor;
  final String label;
  final String status;
  final bool qrTersedia;
  final String? qrDataUrl;
  final String? catatan;

  factory SesiWhatsApp.dariJson(Map<String, dynamic> j) => SesiWhatsApp(
        akunId: (j['accountId'] ?? '') as String,
        nomor: (j['phoneNumber'] ?? '') as String,
        label: (j['label'] ?? '') as String,
        status: (j['status'] ?? '') as String,
        qrTersedia: j['qrTersedia'] == true,
        qrDataUrl: j['qr'] as String?,
        catatan: j['catatan'] as String?,
      );
}

/// Keadaan tautan WhatsApp pribadi pengguna yang login (GET /whatsapp/me).
class TautanWhatsApp {
  const TautanWhatsApp({required this.status, required this.driverAktif, this.phoneNumber, this.label, this.qrDataUrl, this.catatan, this.tersambungPada, this.terputusPada, this.grupJid, this.grupNama});
  /// never_linked · connecting · pending_scan · connected · disconnected · inactive
  final String status;
  final bool driverAktif;
  final String? phoneNumber;
  final String? label;
  final String? qrDataUrl;
  final String? catatan;
  final DateTime? tersambungPada;
  final DateTime? terputusPada;
  /// Grup tujuan foto absensi ber-stempel (dipilih di web).
  final String? grupJid;
  final String? grupNama;

  bool get adaGrup => grupJid != null;
  bool get tersambung => status == 'connected';
  bool get belumPernah => status == 'never_linked';
  bool get menungguScan => status == 'pending_scan' || status == 'connecting';
  bool get perluTindakan => !tersambung && status != 'inactive';

  factory TautanWhatsApp.dariJson(Map<String, dynamic> j) {
    final akun = j['account'] as Map?;
    return TautanWhatsApp(
      status: (j['status'] ?? 'never_linked') as String,
      driverAktif: j['driverAktif'] != false,
      phoneNumber: akun?['phoneNumber'] as String?,
      label: akun?['label'] as String?,
      qrDataUrl: j['qr'] as String?,
      catatan: j['catatan'] as String?,
      tersambungPada: parseTanggal(akun?['lastConnectedAt']),
      terputusPada: parseTanggal(akun?['lastDisconnectedAt']),
      grupJid: (akun?['attendanceGroup'] as Map?)?['jid'] as String?,
      grupNama: (akun?['attendanceGroup'] as Map?)?['name'] as String?,
    );
  }
}
