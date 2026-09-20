import '../../core/format.dart';

class KomponenSlip {
  const KomponenSlip({required this.kode, required this.nama, required this.tipe, required this.jumlah, this.catatan});
  final String kode;
  final String nama;
  final String tipe; // allowance | deduction | ...
  final num jumlah;
  final String? catatan;
  bool get potongan => tipe == 'deduction';

  factory KomponenSlip.dariJson(Map<String, dynamic> j) => KomponenSlip(
        kode: (j['code'] ?? '') as String,
        nama: (j['name'] ?? '') as String,
        tipe: (j['type'] ?? '') as String,
        jumlah: num.tryParse('${j['amount']}') ?? 0,
        catatan: j['calculationNote'] as String?,
      );
}

class SlipGaji {
  const SlipGaji({
    required this.id,
    required this.periodeMulai,
    required this.periodeSelesai,
    required this.status,
    required this.gajiPokok,
    required this.lembur,
    required this.tunjangan,
    required this.potongan,
    required this.bruto,
    required this.bersih,
    required this.komponen,
    this.hariTerjadwal,
    this.hariKerja,
    this.jamLembur,
    this.catatan,
  });
  final String id;
  final String periodeMulai;
  final String periodeSelesai;
  final String status;
  final num gajiPokok;
  final num lembur;
  final num tunjangan;
  final num potongan;
  final num bruto;
  final num bersih;
  final List<KomponenSlip> komponen;
  final int? hariTerjadwal;
  final int? hariKerja;
  final num? jamLembur;
  final String? catatan;

  String get labelPeriode => '${formatTanggalSaja(periodeMulai, pola: 'd MMM')} – ${formatTanggalSaja(periodeSelesai)}';

  factory SlipGaji.dariJson(Map<String, dynamic> j) {
    num n(Object? v) => num.tryParse('${v ?? 0}') ?? 0;
    return SlipGaji(
      id: j['id'] as String,
      periodeMulai: j['payPeriodStart'] as String,
      periodeSelesai: j['payPeriodEnd'] as String,
      status: (j['status'] ?? 'draft') as String,
      gajiPokok: n(j['basicSalary']),
      lembur: n(j['overtimePay']),
      tunjangan: n(j['totalAllowances']),
      potongan: n(j['totalDeductions']),
      bruto: n(j['grossSalary']),
      bersih: n(j['netSalary']),
      komponen: ((j['items'] as List?) ?? []).map((e) => KomponenSlip.dariJson(Map<String, dynamic>.from(e as Map))).toList(),
      hariTerjadwal: (j['scheduledDays'] as num?)?.toInt(),
      hariKerja: (j['workedDays'] as num?)?.toInt(),
      jamLembur: num.tryParse('${j['overtimeHours'] ?? ''}'),
      catatan: j['note'] as String?,
    );
  }
}
