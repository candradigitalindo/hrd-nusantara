import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/fitur/auth/model_pengguna.dart';
import 'package:hrd_nusantara/fitur/cuti/model_cuti.dart';
import 'package:hrd_nusantara/fitur/gaji/model_gaji.dart';
import 'package:hrd_nusantara/fitur/jadwal/model_shift.dart';
import 'package:hrd_nusantara/fitur/notifikasi/layanan_push.dart';
import 'package:hrd_nusantara/fitur/pengumuman/model_pengumuman.dart';
import 'package:hrd_nusantara/fitur/presensi/model_presensi.dart';
import 'package:hrd_nusantara/fitur/whatsapp/model_whatsapp.dart';
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

  test('shift dari penugasan: jenis shift, penanda berulang dan ubahan manual', () {
    final s = Shift.dariJson({
      'id': 'S1', 'date': '2026-10-01T00:00:00.000Z', 'startTime': '07:00', 'endTime': '15:00', 'breakDuration': '1', 'status': 'tentative',
      'templateId': 'T1', 'template': {'id': 'T1', 'name': 'Pagi', 'code': 'P', 'color': 'amber'}, 'assignmentId': 'A1', 'isOverride': true,
    });
    expect(s.jenis?.nama, 'Pagi');
    expect(s.jenis?.kode, 'P');
    expect(s.jenis?.warna, 'amber');
    expect(s.berulang, isTrue);
    expect(s.diubahManual, isTrue);
    expect(s.judul, 'Pagi · 07:00–15:00');
    expect(s.dibatalkan, isFalse);
  });

  test('shift dari server lama (tanpa jenis/penugasan) tetap terbaca', () {
    final s = Shift.dariJson({'id': 'S2', 'date': '2026-10-01T00:00:00.000Z', 'startTime': '22:00', 'endTime': '06:00', 'status': 'cancelled'});
    expect(s.jenis, isNull);
    expect(s.berulang, isFalse);
    expect(s.diubahManual, isFalse);
    expect(s.judul, '22:00 – 06:00');
    expect(s.dibatalkan, isTrue);
    // Bentuk jenis yang tidak dikenal diabaikan, bukan menjatuhkan daftar.
    expect(Shift.dariJson({'id': 'S3', 'date': '2026-10-01', 'startTime': '08:00', 'endTime': '16:00', 'template': 'Pagi'}).jenis, isNull);
  });

  test('presensi fleksibel ditandai, dan tandanya ikut saat check-out masih mengantre', () {
    final p = Presensi.dariJson({'id': 'P1', 'status': 'present', 'checkInTime': '2026-10-01T02:00:00.000Z', 'checkOutTime': null, 'lateMinutes': 0, 'isFlexible': true});
    expect(p.fleksibel, isTrue);
    expect(p.denganPulangTertunda(DateTime.utc(2026, 10, 1, 9)).fleksibel, isTrue);
    expect(Presensi.dariJson({'id': 'P2', 'status': 'present'}).fleksibel, isFalse);
  });

  test('pengguna: jam fleksibel dari /auth/me, bawaan mati, ikut tersimpan untuk sesi offline', () {
    final dasar = {'id': 'K1', 'nik': 'EMP-1', 'name': 'Siti', 'email': 's@contoh.id', 'role': 'MANAGER', 'status': 'active'};
    expect(Pengguna.dariJson(dasar).jamFleksibel, isFalse);
    final fleksibel = Pengguna.dariJson({...dasar, 'flexibleHours': true});
    expect(fleksibel.jamFleksibel, isTrue);
    expect(Pengguna.dariJson(fleksibel.keJson()).jamFleksibel, isTrue);
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
    expect(ruteUntukPesan({'jenis': 'wajah', 'status': 'approved'}), '/wajah');
    expect(ruteUntukPesan({}), isNull);
  });
  test('tautan WhatsApp: belum pernah → wajib; menunggu scan membawa QR; tersambung tidak perlu tindakan', () {
    final belum = TautanWhatsApp.dariJson({'status': 'never_linked', 'driverAktif': true, 'account': null, 'qr': null});
    expect(belum.belumPernah, isTrue);
    expect(belum.perluTindakan, isTrue);
    final scan = TautanWhatsApp.dariJson({'status': 'pending_scan', 'driverAktif': true, 'account': {'phoneNumber': null}, 'qr': 'data:image/png;base64,AAAA'});
    expect(scan.menungguScan, isTrue);
    expect(scan.qrDataUrl, startsWith('data:image'));
    final ok = TautanWhatsApp.dariJson({'status': 'connected', 'driverAktif': true, 'account': {'phoneNumber': '628111111111', 'lastConnectedAt': '2026-09-21T01:00:00.000Z'}});
    expect(ok.tersambung, isTrue);
    expect(ok.perluTindakan, isFalse);
    expect(ok.phoneNumber, '628111111111');
    expect(TautanWhatsApp.dariJson({'status': 'inactive', 'driverAktif': true}).perluTindakan, isFalse);
    final grup = TautanWhatsApp.dariJson({'status': 'connected', 'driverAktif': true, 'account': {'phoneNumber': '628', 'attendanceGroup': {'jid': '1@g.us', 'name': 'Absensi Kemang'}}});
    expect(grup.adaGrup, isTrue);
    expect(grup.grupNama, 'Absensi Kemang');
    expect(ok.adaGrup, isFalse);
  });
}
