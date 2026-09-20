class Shift {
  const Shift({required this.id, required this.tanggal, required this.mulai, required this.selesai, required this.status, this.istirahatJam, this.catatan});
  final String id;
  final String tanggal; // yyyy-mm-dd (ISO tengah malam UTC dari server)
  final String mulai; // HH:mm
  final String selesai;
  final String status;
  final num? istirahatJam;
  final String? catatan;

  /// Shift malam: selesai lebih kecil dari mulai, mis. 22:00–06:00.
  bool get lintasHari => selesai.compareTo(mulai) < 0;

  factory Shift.dariJson(Map<String, dynamic> j) => Shift(
        id: j['id'] as String,
        tanggal: j['date'] as String,
        mulai: j['startTime'] as String,
        selesai: j['endTime'] as String,
        status: (j['status'] ?? 'scheduled') as String,
        istirahatJam: num.tryParse('${j['breakDuration'] ?? ''}'),
        catatan: j['notes'] as String?,
      );
}
