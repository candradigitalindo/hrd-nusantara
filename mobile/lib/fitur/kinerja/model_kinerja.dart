import '../../core/format.dart';

/// Kriteria pada formulir KPI: nama, bobot (persen), dan skala nilainya.
class KriteriaKinerja {
  const KriteriaKinerja({
    required this.id,
    required this.kode,
    required this.nama,
    required this.bobot,
    required this.nilaiMaks,
    this.keterangan,
    this.kategori,
  });
  final String id;
  final String kode;
  final String nama;
  final num bobot;
  final int nilaiMaks;
  final String? keterangan;
  final String? kategori;

  factory KriteriaKinerja.dariJson(Map<String, dynamic> j) => KriteriaKinerja(
        id: j['id'] as String,
        kode: (j['code'] ?? '') as String,
        nama: (j['name'] ?? '') as String,
        bobot: num.tryParse('${j['weight'] ?? 0}') ?? 0,
        nilaiMaks: (j['maxScore'] as num?)?.toInt() ?? 5,
        keterangan: j['description'] as String?,
        kategori: j['category'] as String?,
      );
}

/// Nilai yang sudah diberikan penilai untuk satu kriteria.
class NilaiKriteria {
  const NilaiKriteria({
    required this.kriteriaId,
    required this.kode,
    required this.nama,
    required this.bobot,
    required this.nilaiMaks,
    required this.nilai,
    this.komentar,
  });
  final String kriteriaId;
  final String kode;
  final String nama;
  final num bobot;
  final int nilaiMaks;
  final num nilai;
  final String? komentar;

  double get porsi => nilaiMaks == 0 ? 0 : (nilai / nilaiMaks).clamp(0, 1).toDouble();

  factory NilaiKriteria.dariJson(Map<String, dynamic> j) {
    final k = (j['criterion'] as Map?) ?? const {};
    return NilaiKriteria(
      kriteriaId: j['criterionId'] as String,
      kode: (k['code'] ?? '') as String,
      nama: (k['name'] ?? '') as String,
      bobot: num.tryParse('${k['weight'] ?? 0}') ?? 0,
      nilaiMaks: (k['maxScore'] as num?)?.toInt() ?? 5,
      nilai: num.tryParse('${j['score'] ?? 0}') ?? 0,
      komentar: j['comment'] as String?,
    );
  }
}

class CatatanDiskusi {
  const CatatanDiskusi({required this.id, required this.penulisId, required this.catatan, this.dibuatPada});
  final String id;
  final String penulisId;
  final String catatan;
  final DateTime? dibuatPada;

  factory CatatanDiskusi.dariJson(Map<String, dynamic> j) => CatatanDiskusi(
        id: j['id'] as String,
        penulisId: (j['authorId'] ?? '') as String,
        catatan: (j['note'] ?? '') as String,
        dibuatPada: parseTanggal(j['createdAt']),
      );
}

/// Satu penilaian: seorang penilai menilai seorang karyawan pada satu siklus
/// dari satu sudut pandang (diri sendiri, atasan, rekan, atau bawahan).
/// Bentuknya mengikuti GET /performance/reviews; rincian menambahkan `criteria`.
class Penilaian {
  const Penilaian({
    required this.id,
    required this.periode,
    required this.dinilaiId,
    required this.dinilaiNama,
    required this.penilaiId,
    required this.penilaiNama,
    required this.sudutPandang,
    required this.status,
    this.nilaiTotal,
    this.rating,
    this.umpanBalik,
    this.dikirimPada,
    this.dibuatPada,
    this.nilai = const [],
    this.kriteria = const [],
    this.diskusi = const [],
  });
  final String id;

  /// Kode siklus, mis. "2026-Q3".
  final String periode;
  final String dinilaiId;
  final String dinilaiNama;
  final String penilaiId;
  final String penilaiNama;

  /// self · manager · peer · subordinate
  final String sudutPandang;

  /// draft · submitted · acknowledged · finalized
  final String status;

  /// Nilai akhir berbobot pada skala 0-100, dihitung server.
  final num? nilaiTotal;

  /// Nilai yang dipetakan ke skala formulir (mis. 4,1 dari 5).
  final num? rating;
  final String? umpanBalik;
  final DateTime? dikirimPada;
  final DateTime? dibuatPada;
  final List<NilaiKriteria> nilai;

  /// Hanya terisi pada rincian; dipakai untuk mengisi penilaian draf.
  final List<KriteriaKinerja> kriteria;
  final List<CatatanDiskusi> diskusi;

  bool sayaDinilai(String id) => dinilaiId == id;
  bool sayaPenilai(String id) => penilaiId == id;
  bool get draf => status == 'draft';
  bool get menungguKonfirmasi => status == 'submitted';
  bool get adaHasil => !draf;
  bool get penilaianDiri => sudutPandang == 'self';
  String get labelSudutPandang => labelPenilai[sudutPandang] ?? sudutPandang;

  /// Skala rating = nilai maksimum terbesar pada formulir (sama dengan server).
  int get skala {
    final semua = [...nilai.map((n) => n.nilaiMaks), ...kriteria.map((k) => k.nilaiMaks)];
    return semua.isEmpty ? 5 : semua.reduce((a, b) => a > b ? a : b);
  }

  factory Penilaian.dariJson(Map<String, dynamic> j) => Penilaian(
        id: j['id'] as String,
        periode: (j['period'] ?? '') as String,
        dinilaiId: (j['revieweeId'] ?? (j['reviewee'] as Map?)?['id'] ?? '') as String,
        dinilaiNama: ((j['reviewee'] as Map?)?['name'] ?? '—') as String,
        penilaiId: (j['reviewerId'] ?? (j['reviewer'] as Map?)?['id'] ?? '') as String,
        penilaiNama: ((j['reviewer'] as Map?)?['name'] ?? '—') as String,
        sudutPandang: (j['reviewerType'] ?? 'manager') as String,
        status: (j['status'] ?? 'draft') as String,
        nilaiTotal: num.tryParse('${j['totalScore'] ?? ''}'),
        rating: num.tryParse('${j['rating'] ?? ''}'),
        umpanBalik: j['feedback'] as String?,
        dikirimPada: parseTanggal(j['submittedAt']),
        dibuatPada: parseTanggal(j['createdAt']),
        nilai: _daftar(j['scores']).map(NilaiKriteria.dariJson).toList(),
        kriteria: _daftar(j['criteria']).map(KriteriaKinerja.dariJson).toList(),
        diskusi: _daftar(j['discussions']).map(CatatanDiskusi.dariJson).toList(),
      );
}

/// Umpan balik informal (apresiasi, perbaikan, catatan) yang ditujukan ke pengguna.
class UmpanBalik {
  const UmpanBalik({
    required this.id,
    required this.tipe,
    required this.pesan,
    required this.pribadi,
    this.penulisNama,
    this.dibuatPada,
  });
  final String id;

  /// praise · improvement · note
  final String tipe;
  final String pesan;
  final bool pribadi;
  final String? penulisNama;
  final DateTime? dibuatPada;

  String get labelTipe => labelUmpan[tipe] ?? tipe;

  factory UmpanBalik.dariJson(Map<String, dynamic> j) => UmpanBalik(
        id: j['id'] as String,
        tipe: (j['type'] ?? 'note') as String,
        pesan: (j['message'] ?? '') as String,
        pribadi: j['isPrivate'] == true,
        penulisNama: (j['author'] as Map?)?['name'] as String?,
        dibuatPada: parseTanggal(j['createdAt']),
      );
}

/// Hasil yang mewakili nilai KPI terakhir: penilaian atasan diutamakan,
/// baru sudut pandang lain. Daftar dari server sudah terurut terbaru dulu.
Penilaian? nilaiTerbaru(List<Penilaian> hasil) {
  final bernilai = hasil.where((r) => r.nilaiTotal != null).toList();
  if (bernilai.isEmpty) return null;
  return bernilai.where((r) => r.sudutPandang == 'manager').firstOrNull ?? bernilai.first;
}

List<Map<String, dynamic>> _daftar(Object? v) =>
    ((v as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
