import 'package:intl/intl.dart';

/// Pemformat berbahasa Indonesia. `initializeDateFormatting('id_ID')` harus
/// sudah dipanggil di main() sebelum salah satu fungsi tanggal dipakai.
DateTime? parseTanggal(Object? nilai) {
  if (nilai == null) return null;
  if (nilai is DateTime) return nilai;
  return DateTime.tryParse(nilai.toString())?.toLocal();
}

String formatTanggal(Object? nilai, {String pola = 'd MMM yyyy'}) {
  final t = parseTanggal(nilai);
  return t == null ? '—' : DateFormat(pola, 'id_ID').format(t);
}

String formatWaktu(Object? nilai) {
  final t = parseTanggal(nilai);
  return t == null ? '—' : DateFormat('HH:mm', 'id_ID').format(t);
}

String formatTanggalWaktu(Object? nilai) => formatTanggal(nilai, pola: 'd MMM yyyy HH:mm');

/// Tanggal hanya-tanggal dari server ("2026-09-20" atau ISO tengah malam UTC)
/// diformat tanpa digeser ke zona lokal, supaya 20 September tetap 20 September.
String formatTanggalSaja(Object? nilai, {String pola = 'd MMM yyyy'}) {
  if (nilai == null) return '—';
  final s = nilai.toString();
  final t = DateTime.tryParse(s);
  if (t == null) return '—';
  final utc = s.endsWith('Z') || s.contains('T') ? t.toUtc() : t;
  return DateFormat(pola, 'id_ID').format(DateTime(utc.year, utc.month, utc.day));
}

String formatRupiah(Object? nilai) {
  final angka = nilai is num ? nilai : num.tryParse(nilai?.toString() ?? '');
  if (angka == null) return '—';
  return NumberFormat.currency(locale: 'id_ID', symbol: 'Rp ', decimalDigits: 0).format(angka);
}

String formatAngka(Object? nilai) {
  final angka = nilai is num ? nilai : num.tryParse(nilai?.toString() ?? '');
  return angka == null ? '—' : NumberFormat.decimalPattern('id_ID').format(angka);
}

/// "2 jam 15 menit" dari menit.
String formatDurasiMenit(num? menit) {
  if (menit == null) return '—';
  final m = menit.round();
  final jam = m ~/ 60;
  final sisa = m % 60;
  if (jam == 0) return '$sisa menit';
  return sisa == 0 ? '$jam jam' : '$jam jam $sisa menit';
}

/// "Baru saja", "5 menit lalu", "Kemarin 14:20", atau tanggal.
String formatRelatif(Object? nilai) {
  final t = parseTanggal(nilai);
  if (t == null) return '—';
  final selisih = DateTime.now().difference(t);
  if (selisih.inSeconds < 60) return 'Baru saja';
  if (selisih.inMinutes < 60) return '${selisih.inMinutes} menit lalu';
  if (selisih.inHours < 24 && t.day == DateTime.now().day) return 'Hari ini ${formatWaktu(t)}';
  if (selisih.inHours < 48) return 'Kemarin ${formatWaktu(t)}';
  return formatTanggal(t);
}

const Map<String, String> labelStatus = {
  'active': 'Aktif',
  'probation': 'Probation',
  'contract': 'Kontrak',
  'internship': 'Magang',
  'on_leave': 'Cuti',
  'inactive': 'Non-Aktif',
  'resign': 'Resign',
  'terminated': 'Dihentikan',
  'present': 'Hadir',
  'late': 'Terlambat',
  'absent': 'Absen',
  'no_checkout': 'Lupa Check-out',
  'pending': 'Menunggu',
  'approved': 'Disetujui',
  'rejected': 'Ditolak',
  'cancelled': 'Dibatalkan',
  'draft': 'Draft',
  'calculated': 'Terhitung',
  'paid': 'Dibayar',
  'scheduled': 'Terjadwal',
  'confirmed': 'Terjadwal',
  'completed': 'Selesai',
  'published': 'Tayang',
  'closed': 'Ditutup',
  'connected': 'Tersambung',
  'disconnected': 'Terputus',
  'pending_scan': 'Menunggu Scan',
  'scan_required': 'Perlu Scan Ulang',
  'logged_out': 'Keluar',
  'qr_required': 'Perlu Scan Ulang',
  'reconnected': 'Tersambung Kembali',
  'normal': 'Normal',
  'important': 'Penting',
  'urgent': 'Mendesak',
};

String labelUntuk(String? kode) {
  if (kode == null || kode.isEmpty) return '—';
  return labelStatus[kode] ?? kode.replaceAll('_', ' ');
}

const Map<String, String> labelMetode = {'gps': 'GPS', 'qr': 'QR', 'face': 'Wajah'};
