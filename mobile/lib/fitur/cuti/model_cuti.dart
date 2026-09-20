import '../../core/format.dart';

class JenisCuti {
  const JenisCuti({required this.id, required this.kode, required this.nama, required this.wajibLampiran, required this.potongSaldo, this.maksHariBerturut, this.keterangan});
  final String id;
  final String kode;
  final String nama;
  final bool wajibLampiran;
  final bool potongSaldo;
  final int? maksHariBerturut;
  final String? keterangan;

  factory JenisCuti.dariJson(Map<String, dynamic> j) => JenisCuti(
        id: j['id'] as String,
        kode: j['code'] as String,
        nama: j['name'] as String,
        wajibLampiran: j['requiresAttachment'] == true,
        potongSaldo: j['deductsBalance'] != false,
        maksHariBerturut: (j['maxConsecutiveDays'] as num?)?.toInt(),
        keterangan: j['description'] as String?,
      );
}

class SaldoCuti {
  const SaldoCuti({required this.jenisId, required this.jenisNama, required this.tahun, required this.jatah, required this.terpakai, required this.sisa, required this.cutiBersama});
  final String jenisId;
  final String jenisNama;
  final int tahun;
  final num jatah;
  final num terpakai;
  final num sisa;
  final num cutiBersama;

  factory SaldoCuti.dariJson(Map<String, dynamic> j) => SaldoCuti(
        jenisId: (j['leaveType'] as Map)['id'] as String,
        jenisNama: (j['leaveType'] as Map)['name'] as String,
        tahun: (j['year'] as num).toInt(),
        jatah: (j['entitledDays'] as num?) ?? 0,
        terpakai: (j['usedDays'] as num?) ?? 0,
        sisa: (j['remainingDays'] as num?) ?? 0,
        cutiBersama: (j['collectiveLeaveDays'] as num?) ?? 0,
      );
}

class Cuti {
  const Cuti({required this.id, required this.jenisNama, required this.mulai, required this.selesai, required this.totalHari, required this.status, this.alasan, this.catatanKeputusan, this.diputuskanPada, this.dibuatPada});
  final String id;
  final String jenisNama;
  final String mulai;
  final String selesai;
  final num totalHari;
  final String status;
  final String? alasan;
  final String? catatanKeputusan;
  final DateTime? diputuskanPada;
  final DateTime? dibuatPada;

  bool get bisaDibatalkan => status == 'pending' || (status == 'approved' && (parseTanggal(mulai)?.isAfter(DateTime.now()) ?? false));

  factory Cuti.dariJson(Map<String, dynamic> j) => Cuti(
        id: j['id'] as String,
        jenisNama: ((j['leaveType'] as Map?)?['name'] ?? '—') as String,
        mulai: j['startDate'] as String,
        selesai: j['endDate'] as String,
        totalHari: (j['totalDays'] as num?) ?? 0,
        status: j['status'] as String,
        alasan: j['reason'] as String?,
        catatanKeputusan: j['decisionNote'] as String?,
        diputuskanPada: parseTanggal(j['decidedAt']),
        dibuatPada: parseTanggal(j['createdAt']),
      );
}
