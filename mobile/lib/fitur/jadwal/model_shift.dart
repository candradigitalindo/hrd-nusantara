import 'package:flutter/material.dart';

/// Jenis shift (mis. "Pagi 07:00–15:00") yang dibuat HR; hanya ringkasannya
/// yang ikut di setiap baris jadwal.
class JenisShift {
  const JenisShift({required this.id, required this.nama, this.kode, this.warna});
  final String id;
  final String nama;

  /// Label pendek untuk chip (maks 4 huruf), mis. "P".
  final String? kode;

  /// Kunci palet tetap dari server: teal, blue, amber, violet, rose, slate,
  /// green, orange.
  final String? warna;

  /// null bila bentuknya tidak dikenal, supaya jawaban yang aneh tidak
  /// menjatuhkan seluruh daftar jadwal.
  static JenisShift? dariJson(Object? j) {
    if (j is! Map) return null;
    final id = j['id'];
    final nama = j['name'];
    if (id is! String || nama is! String) return null;
    return JenisShift(id: id, nama: nama, kode: j['code'] as String?, warna: j['color'] as String?);
  }
}

class Shift {
  const Shift({
    required this.id,
    required this.tanggal,
    required this.mulai,
    required this.selesai,
    required this.status,
    this.istirahatJam,
    this.catatan,
    this.jenis,
    this.penugasanId,
    this.diubahManual = false,
  });
  final String id;
  final String tanggal; // yyyy-mm-dd (ISO tengah malam UTC dari server)
  final String mulai; // HH:mm
  final String selesai;
  final String status;
  final num? istirahatJam;
  final String? catatan;

  /// Jenis shift asal baris ini; null untuk shift berjam kustom atau dari
  /// server versi lama.
  final JenisShift? jenis;

  /// Baris yang dibuat otomatis dari penugasan berjangka (mis. "Pagi, Sen–Sab,
  /// seterusnya"), bukan diisi satu per satu.
  final String? penugasanId;

  /// Baris penugasan yang sudah diubah khusus untuk tanggal ini.
  final bool diubahManual;

  /// Shift malam: selesai lebih kecil dari mulai, mis. 22:00–06:00.
  bool get lintasHari => selesai.compareTo(mulai) < 0;

  bool get dibatalkan => status == 'cancelled';
  bool get berulang => penugasanId != null;

  /// "Pagi · 07:00–15:00", atau jamnya saja bila tanpa jenis shift.
  String get judul => jenis == null ? '$mulai – $selesai' : '${jenis!.nama} · $mulai–$selesai';

  factory Shift.dariJson(Map<String, dynamic> j) => Shift(
        id: j['id'] as String,
        tanggal: j['date'] as String,
        mulai: j['startTime'] as String,
        selesai: j['endTime'] as String,
        status: (j['status'] ?? 'scheduled') as String,
        istirahatJam: num.tryParse('${j['breakDuration'] ?? ''}'),
        catatan: j['notes'] as String?,
        jenis: JenisShift.dariJson(j['template']),
        penugasanId: j['assignmentId'] as String?,
        diubahManual: j['isOverride'] == true,
      );
}

/// Warna jenis shift, sama dengan palet roster di web (globals.css
/// `--jenis-*`): tua di tema terang, muda di tema gelap supaya tetap
/// terbaca. Kunci asing jatuh ke teal, seperti di web.
Color warnaJenisShift(String? kunci, Brightness kecerahan) {
  final terang = kecerahan == Brightness.light;
  final (gelapnya, mudanya) = switch (kunci) {
    'blue' => (0xFF1D4ED8, 0xFF93C5FD),
    'amber' => (0xFF92400E, 0xFFFCD34D),
    'violet' => (0xFF6D28D9, 0xFFC4B5FD),
    'rose' => (0xFFBE123C, 0xFFFDA4AF),
    'slate' => (0xFF334155, 0xFFCBD5E1),
    'green' => (0xFF15803D, 0xFF86EFAC),
    'orange' => (0xFFC2410C, 0xFFFDBA74),
    _ => (0xFF0F766E, 0xFF5EEAD4),
  };
  return Color(terang ? gelapnya : mudanya);
}
