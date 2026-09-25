import 'dart:math';

enum StatusKiriman { menunggu, gagal }

/// Satu kiriman yang menunggu dikirim ke server: diambil saat offline, atau
/// sudah dicoba tapi server tak terjangkau.
class ItemAntrean {
  const ItemAntrean({
    required this.id,
    required this.jenis,
    required this.judul,
    required this.metode,
    required this.jalur,
    required this.badan,
    required this.pemilik,
    required this.dibuat,
    this.status = StatusKiriman.menunggu,
    this.percobaan = 0,
    this.galat,
    this.bergantungPada,
    this.info = const {},
  });

  /// Urut menurut waktu dibuat, dan sekaligus Idempotency-Key-nya.
  final String id;

  /// Kelompok fitur, mis. `presensi-masuk`, `cuti-ajukan`.
  final String jenis;

  /// Untuk dibaca pengguna di halaman Antrean kirim.
  final String judul;
  final String metode;
  final String jalur;
  final Map<String, dynamic> badan;

  /// Id karyawan yang membuatnya; hanya dikirim saat akun ini yang masuk.
  final String pemilik;
  final DateTime dibuat;
  final StatusKiriman status;
  final int percobaan;

  /// Pesan terakhir: alasan ditolak (gagal) atau galat sementara (menunggu).
  final String? galat;

  /// Id kiriman yang harus berhasil lebih dulu (mis. check-out setelah
  /// check-in yang juga masih mengantre). Bila itu gagal, ini ikut gagal.
  final String? bergantungPada;

  /// Keterangan untuk tampilan di ponsel (mis. waktu dan lokasi presensi);
  /// tidak ikut dikirim — skema server menolak field yang tidak dikenal.
  final Map<String, dynamic> info;

  bool get gagal => status == StatusKiriman.gagal;

  ItemAntrean salin({StatusKiriman? status, int? percobaan, String? galat, bool hapusGalat = false}) => ItemAntrean(
        id: id,
        jenis: jenis,
        judul: judul,
        metode: metode,
        jalur: jalur,
        badan: badan,
        pemilik: pemilik,
        dibuat: dibuat,
        status: status ?? this.status,
        percobaan: percobaan ?? this.percobaan,
        galat: hapusGalat ? null : (galat ?? this.galat),
        bergantungPada: bergantungPada,
        info: info,
      );

  Map<String, dynamic> keJson() => {
        'id': id,
        'jenis': jenis,
        'judul': judul,
        'metode': metode,
        'jalur': jalur,
        'badan': badan,
        'pemilik': pemilik,
        'dibuat': dibuat.toUtc().toIso8601String(),
        'status': status.name,
        'percobaan': percobaan,
        if (galat != null) 'galat': galat,
        if (bergantungPada != null) 'bergantungPada': bergantungPada,
        if (info.isNotEmpty) 'info': info,
      };

  factory ItemAntrean.dariJson(Map<String, dynamic> j) => ItemAntrean(
        id: j['id'] as String,
        jenis: j['jenis'] as String,
        judul: j['judul'] as String,
        metode: j['metode'] as String,
        jalur: j['jalur'] as String,
        badan: Map<String, dynamic>.from(j['badan'] as Map),
        pemilik: j['pemilik'] as String,
        dibuat: DateTime.parse(j['dibuat'] as String).toLocal(),
        status: StatusKiriman.values.byName(j['status'] as String),
        percobaan: (j['percobaan'] as num?)?.toInt() ?? 0,
        galat: j['galat'] as String?,
        bergantungPada: j['bergantungPada'] as String?,
        info: j['info'] is Map ? Map<String, dynamic>.from(j['info'] as Map) : const {},
      );
}

final _acak = Random.secure();
int _terakhir = 0;

/// Id yang urut menurut waktu (mikrodetik, dipaksa naik bila dua dibuat
/// bersamaan) plus akhiran acak. Bentuknya lolos aturan Idempotency-Key
/// server: 8–100 karakter huruf, angka, - atau _.
String idAntreanBaru() {
  final sekarang = DateTime.now().microsecondsSinceEpoch;
  _terakhir = sekarang > _terakhir ? sekarang : _terakhir + 1;
  final akhiran = List.generate(8, (_) => _acak.nextInt(16).toRadixString(16)).join();
  return '${_terakhir.toString().padLeft(17, '0')}-$akhiran';
}
