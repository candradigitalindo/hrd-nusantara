import '../../core/format.dart';

class RuangChat {
  const RuangChat({required this.id, required this.nama, required this.tipe, required this.privat, required this.jumlahAnggota, required this.peranSaya, this.deskripsi, this.pesanTerakhir, this.pengirimTerakhir, this.waktuTerakhir, this.terakhirDihapus = false});
  final String id;
  final String nama;
  final String tipe;
  final bool privat;
  final int jumlahAnggota;
  final String peranSaya;
  final String? deskripsi;
  final String? pesanTerakhir;
  final String? pengirimTerakhir;
  final DateTime? waktuTerakhir;
  final bool terakhirDihapus;

  factory RuangChat.dariJson(Map<String, dynamic> j) {
    final last = j['lastMessage'] as Map?;
    return RuangChat(
      id: j['id'] as String,
      nama: j['name'] as String,
      tipe: (j['type'] ?? 'general') as String,
      privat: j['isPrivate'] == true,
      jumlahAnggota: ((j['_count'] as Map?)?['members'] as num?)?.toInt() ?? 0,
      peranSaya: (j['myRole'] ?? 'member') as String,
      deskripsi: j['description'] as String?,
      pesanTerakhir: last?['message'] as String?,
      pengirimTerakhir: last?['senderName'] as String?,
      waktuTerakhir: parseTanggal(last?['timestamp']),
      terakhirDihapus: last?['isDeleted'] == true,
    );
  }
}

class PesanChat {
  const PesanChat({required this.id, required this.pengirimId, required this.pengirim, required this.dihapus, required this.waktu, this.isi, this.tertunda = false, this.ditolak});
  final String id;
  final String pengirimId;
  final String pengirim;
  final String? isi;
  final bool dihapus;
  final DateTime waktu;

  /// Masih di antrean kirim (ditulis saat offline).
  final bool tertunda;

  /// Alasan server menolak kiriman tertunda ini, bila ditolak.
  final String? ditolak;

  factory PesanChat.dariJson(Map<String, dynamic> j) => PesanChat(
        id: j['id'] as String,
        pengirimId: j['senderId'] as String,
        pengirim: ((j['sender'] as Map?)?['name'] ?? '—') as String,
        isi: j['message'] as String?,
        dihapus: j['isDeleted'] == true,
        waktu: parseTanggal(j['timestamp']) ?? DateTime.now(),
      );
}
