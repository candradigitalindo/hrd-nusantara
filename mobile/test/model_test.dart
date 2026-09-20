import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/fitur/cuti/model_cuti.dart';
import 'package:hrd_nusantara/fitur/gaji/model_gaji.dart';
import 'package:hrd_nusantara/fitur/jadwal/model_shift.dart';
import 'package:hrd_nusantara/fitur/notifikasi/layanan_push.dart';
import 'package:hrd_nusantara/fitur/pengumuman/model_pengumuman.dart';
import 'package:hrd_nusantara/fitur/presensi/model_presensi.dart';
import 'package:intl/date_symbol_data_local.dart';

void main() {
  setUpAll(() => initializeDateFormatting('id_ID'));

  test('presensi dari JSON server: terbuka bila belum check-out', () {
    final p = Presensi.dariJson({
      'id': '01A', 'status': 'late', 'checkInTime': '2026-09-20T01:05:00.000Z', 'checkOutTime': null,
      'checkInMethod': 'face', 'lateMinutes': 5, 'workedMinutes': null, 'overtimeHours': '0', 'overtimeApproved': false,
      'faceVerified': true, 'workLocation': {'id': 'x', 'name': 'Outlet HI'}, 'shiftSchedule': {'startTime': '08:00', 'endTime': '16:00'},
    });
    expect(p.masihTerbuka, isTrue);
    expect(p.menitTerlambat, 5);
    expect(p.namaLokasi, 'Outlet HI');
    expect(p.wajahTerverifikasi, isTrue);
    expect(p.jamLembur, 0);
  });

  test('slip gaji: Decimal string jadi angka, komponen dipisah tunjangan/potongan', () {
    final s = SlipGaji.dariJson({
      'id': '01B', 'payPeriodStart': '2026-08-01T00:00:00.000Z', 'payPeriodEnd': '2026-08-31T00:00:00.000Z', 'status': 'paid',
      'basicSalary': '4500000', 'overtimePay': '250000.5', 'totalAllowances': '600000', 'totalDeductions': '150000',
      'grossSalary': '5350000.5', 'netSalary': '5200000.5',
      'items': [
        {'code': 'MAKAN', 'name': 'Tunjangan makan', 'type': 'allowance', 'amount': '600000'},
        {'code': 'BPJS', 'name': 'BPJS Kesehatan', 'type': 'deduction', 'amount': '150000'},
      ],
    });
    expect(s.bersih, 5200000.5);
    expect(s.komponen.where((k) => k.potongan).single.nama, 'BPJS Kesehatan');
    expect(s.labelPeriode, '1 Agu – 31 Agu 2026');
  });

  test('shift malam terdeteksi lintas hari', () {
    expect(Shift.dariJson({'id': '1', 'date': '2026-09-20T00:00:00.000Z', 'startTime': '22:00', 'endTime': '06:00'}).lintasHari, isTrue);
    expect(Shift.dariJson({'id': '2', 'date': '2026-09-20T00:00:00.000Z', 'startTime': '08:00', 'endTime': '16:00'}).lintasHari, isFalse);
  });

  test('cuti bisa dibatalkan bila menunggu, atau disetujui tapi belum mulai', () {
    final besok = DateTime.now().add(const Duration(days: 2)).toIso8601String();
    final kemarin = DateTime.now().subtract(const Duration(days: 2)).toIso8601String();
    Cuti buat(String status, String mulai) => Cuti.dariJson({'id': '1', 'startDate': mulai, 'endDate': mulai, 'totalDays': 1, 'status': status, 'leaveType': {'name': 'Tahunan'}});
    expect(buat('pending', kemarin).bisaDibatalkan, isTrue);
    expect(buat('approved', besok).bisaDibatalkan, isTrue);
    expect(buat('approved', kemarin).bisaDibatalkan, isFalse);
    expect(buat('rejected', besok).bisaDibatalkan, isFalse);
  });

  test('pengumuman wajib konfirmasi dianggap belum selesai sampai dikonfirmasi', () {
    final p = Pengumuman.dariJson({'id': '1', 'title': 'SOP baru', 'content': '…', 'priority': 'urgent', 'requiresAcknowledgment': true, 'isRead': true, 'acknowledgedAt': null});
    expect(p.perluKonfirmasi, isTrue);
    expect(p.salin(dikonfirmasiPada: DateTime.now()).perluKonfirmasi, isFalse);
  });

  test('notifikasi push diarahkan ke layar yang tepat berdasarkan jenisnya', () {
    expect(ruteUntukPesan({'jenis': 'whatsapp_session', 'eventType': 'logged_out'}), '/whatsapp');
    expect(ruteUntukPesan({'jenis': 'cuti'}), '/cuti');
    expect(ruteUntukPesan({}), isNull);
  });
}
