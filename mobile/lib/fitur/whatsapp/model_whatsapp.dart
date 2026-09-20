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
