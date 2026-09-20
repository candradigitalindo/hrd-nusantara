class PertanyaanSurvei {
  const PertanyaanSurvei({required this.id, required this.teks, required this.tipe, required this.wajib, this.opsi = const [], this.skalaMin, this.skalaMaks});
  final String id;
  final String teks;
  final String tipe; // scale | text | choice
  final bool wajib;
  final List<String> opsi;
  final int? skalaMin;
  final int? skalaMaks;

  factory PertanyaanSurvei.dariJson(Map<String, dynamic> j) => PertanyaanSurvei(
        id: j['id'] as String,
        teks: j['text'] as String,
        tipe: j['type'] as String,
        wajib: j['isRequired'] != false,
        opsi: ((j['options'] as List?) ?? []).map((e) => e.toString()).toList(),
        skalaMin: (j['minScale'] as num?)?.toInt(),
        skalaMaks: (j['maxScale'] as num?)?.toInt(),
      );
}

class Survei {
  const Survei({required this.id, required this.judul, required this.anonim, required this.status, required this.selesai, required this.sudahIsi, required this.pertanyaan, this.deskripsi, this.mulai});
  final String id;
  final String judul;
  final String? deskripsi;
  final bool anonim;
  final String status;
  final String? mulai;
  final String selesai;
  final bool sudahIsi;
  final List<PertanyaanSurvei> pertanyaan;

  bool get bisaDiisi => status == 'published' && !sudahIsi;

  factory Survei.dariJson(Map<String, dynamic> j) => Survei(
        id: j['id'] as String,
        judul: j['title'] as String,
        deskripsi: j['description'] as String?,
        anonim: j['isAnonymous'] != false,
        status: (j['status'] ?? 'draft') as String,
        mulai: j['startDate'] as String?,
        selesai: (j['endDate'] ?? '') as String,
        sudahIsi: j['hasSubmitted'] == true,
        pertanyaan: ((j['questions'] as List?) ?? []).map((e) => PertanyaanSurvei.dariJson(Map<String, dynamic>.from(e as Map))).toList(),
      );
}
