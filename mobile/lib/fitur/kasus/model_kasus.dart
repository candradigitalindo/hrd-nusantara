import '../../core/format.dart';

/// Keluhan yang diajukan pengguna, atau tindakan disiplin yang ditujukan
/// kepadanya. Bentuknya mengikuti GET /cases.
class Kasus {
  const Kasus({
    required this.id,
    required this.tipe,
    required this.judul,
    required this.uraian,
    required this.status,
    required this.pelaporId,
    required this.karyawanId,
    this.tingkat,
    this.tanggalKejadian,
    this.diselesaikanPada,
    this.catatanPenyelesaian,
    this.pelaporNama,
    this.penanganNama,
    this.karyawanNama,
    this.dibuatPada,
  });
  final String id;

  /// complaint · disciplinary_action
  final String tipe;
  final String judul;
  final String uraian;

  /// open · under_review · resolved · dismissed
  final String status;
  final String pelaporId;
  final String karyawanId;

  /// teguran_lisan · sp1 · sp2 · sp3 (hanya tindakan disiplin)
  final String? tingkat;
  final DateTime? tanggalKejadian;
  final DateTime? diselesaikanPada;
  final String? catatanPenyelesaian;
  final String? pelaporNama;
  final String? penanganNama;
  final String? karyawanNama;
  final DateTime? dibuatPada;

  bool get keluhan => tipe == 'complaint';
  String get labelTipe => keluhan ? 'Keluhan' : 'Tindakan disiplin';
  bool get selesai => status == 'resolved' || status == 'dismissed';

  factory Kasus.dariJson(Map<String, dynamic> j) => Kasus(
        id: j['id'] as String,
        tipe: (j['type'] ?? 'complaint') as String,
        judul: (j['title'] ?? '') as String,
        uraian: (j['description'] ?? '') as String,
        status: (j['status'] ?? 'open') as String,
        pelaporId: (j['reportedById'] ?? '') as String,
        karyawanId: (j['employeeId'] ?? '') as String,
        tingkat: j['severity'] as String?,
        tanggalKejadian: parseTanggal(j['incidentDate']),
        diselesaikanPada: parseTanggal(j['resolvedAt']),
        catatanPenyelesaian: j['resolutionNotes'] as String?,
        pelaporNama: (j['reportedBy'] as Map?)?['name'] as String?,
        penanganNama: (j['handledBy'] as Map?)?['name'] as String?,
        karyawanNama: (j['employee'] as Map?)?['name'] as String?,
        dibuatPada: parseTanggal(j['createdAt']),
      );
}
