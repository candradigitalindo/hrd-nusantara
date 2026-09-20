import '../../core/format.dart';

class Pengumuman {
  const Pengumuman({required this.id, required this.judul, required this.isi, required this.prioritas, required this.wajibKonfirmasi, required this.sudahDibaca, this.dikonfirmasiPada, this.penulis, this.tayangPada, this.berakhirPada});
  final String id;
  final String judul;
  final String isi;
  final String prioritas;
  final bool wajibKonfirmasi;
  final bool sudahDibaca;
  final DateTime? dikonfirmasiPada;
  final String? penulis;
  final DateTime? tayangPada;
  final DateTime? berakhirPada;

  bool get perluKonfirmasi => wajibKonfirmasi && dikonfirmasiPada == null;

  factory Pengumuman.dariJson(Map<String, dynamic> j) => Pengumuman(
        id: j['id'] as String,
        judul: j['title'] as String,
        isi: (j['content'] ?? '') as String,
        prioritas: (j['priority'] ?? 'normal') as String,
        wajibKonfirmasi: j['requiresAcknowledgment'] == true,
        sudahDibaca: j['isRead'] == true,
        dikonfirmasiPada: parseTanggal(j['acknowledgedAt']),
        penulis: (j['author'] as Map?)?['name'] as String?,
        tayangPada: parseTanggal(j['publishedAt'] ?? j['publishDate']),
        berakhirPada: parseTanggal(j['expiresAt']),
      );

  Pengumuman salin({bool? sudahDibaca, DateTime? dikonfirmasiPada}) => Pengumuman(
        id: id, judul: judul, isi: isi, prioritas: prioritas, wajibKonfirmasi: wajibKonfirmasi,
        sudahDibaca: sudahDibaca ?? this.sudahDibaca, dikonfirmasiPada: dikonfirmasiPada ?? this.dikonfirmasiPada,
        penulis: penulis, tayangPada: tayangPada, berakhirPada: berakhirPada,
      );
}
