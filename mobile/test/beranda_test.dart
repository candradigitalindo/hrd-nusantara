import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/fitur/auth/model_pengguna.dart';
import 'package:hrd_nusantara/fitur/auth/sesi_provider.dart';
import 'package:hrd_nusantara/fitur/beranda/layar_beranda.dart';
import 'package:hrd_nusantara/fitur/cuti/model_cuti.dart';
import 'package:hrd_nusantara/fitur/cuti/repo_cuti.dart';
import 'package:hrd_nusantara/fitur/gaji/model_gaji.dart';
import 'package:hrd_nusantara/fitur/gaji/repo_gaji.dart';
import 'package:hrd_nusantara/fitur/jadwal/model_shift.dart';
import 'package:hrd_nusantara/fitur/jadwal/repo_jadwal.dart';
import 'package:hrd_nusantara/fitur/kinerja/repo_kinerja.dart';
import 'package:hrd_nusantara/fitur/pelatihan/repo_pelatihan.dart';
import 'package:hrd_nusantara/fitur/pengumuman/model_pengumuman.dart';
import 'package:hrd_nusantara/fitur/pengumuman/repo_pengumuman.dart';
import 'package:hrd_nusantara/fitur/presensi/model_presensi.dart';
import 'package:hrd_nusantara/fitur/presensi/repo_presensi.dart';
import 'package:hrd_nusantara/fitur/survei/model_survei.dart';
import 'package:hrd_nusantara/fitur/survei/repo_survei.dart';
import 'package:hrd_nusantara/fitur/whatsapp/model_whatsapp.dart';
import 'package:hrd_nusantara/fitur/whatsapp/repo_whatsapp.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'alat_uji.dart';
import 'data_uji.dart';

/// Hari kerja: Senin–Sabtu, dengan satu hari libur tengah minggu contoh.
Shift shiftPada(int geser) => Shift.dariJson({
      'id': 'S$geser',
      'date': tanggalSaja(jam(0, 0, geser)),
      'startTime': '08:00',
      'endTime': '16:00',
      'status': 'scheduled',
      'breakDuration': 1,
    });

Presensi presensiPada(int geser, {bool telat = false, bool terbuka = false}) => Presensi.dariJson({
      'id': 'P$geser',
      'status': telat ? 'late' : 'present',
      'date': tanggalSaja(jam(0, 0, geser)),
      'checkInTime': geser == 0 ? iso(DateTime.now().subtract(const Duration(hours: 2, minutes: 14))) : iso(jam(8, telat ? 12 : 0, geser)),
      'checkOutTime': terbuka ? null : iso(jam(16, 5, geser)),
      'checkInMethod': 'face',
      'lateMinutes': telat ? 12 : 0,
      'workedMinutes': terbuka ? null : 425,
      'overtimeHours': geser == -2 ? '1.5' : '0',
      'overtimeApproved': true,
      'faceVerified': true,
      'workLocation': {'id': 'L1', 'name': 'Outlet Sudirman'},
      'shiftSchedule': {'startTime': '08:00', 'endTime': '16:00'},
    });

void main() {
  setUpAll(() async {
    await initializeDateFormatting('id_ID');
    await muatFontAsli();
  });

  testWidgets('beranda karyawan: presensi, tindakan, kehadiran, cuti & gaji, kinerja, pelatihan, akses cepat', (tester) async {
    ukuranPonsel(tester, tinggi: 2800);
    final libur = {2, -3};
    await tester.pumpWidget(aplikasiUji(const LayarBeranda(), overrides: [
      penggunaProvider.overrideWithValue(pengguna),
      presensiHariIniProvider.overrideWith((ref) async => presensiPada(0, telat: true, terbuka: true)),
      shiftHariIniProvider.overrideWith((ref) async => shiftPada(0)),
      jadwalProvider.overrideWith((ref) async => [for (var i = -7; i <= 14; i++) if (!libur.contains(i)) shiftPada(i)]),
      lokasiKerjaProvider.overrideWith((ref) async => []),
      riwayatPresensiProvider.overrideWith((ref) async => [for (var i = -29; i < 0; i++) if (!libur.contains(i) && i % 7 != 0) presensiPada(i, telat: i == -1 || i == -8), presensiPada(0, telat: true, terbuka: true)]),
      saldoCutiProvider.overrideWith((ref) async => [
            SaldoCuti.dariJson({'leaveType': {'id': 'T1', 'name': 'Cuti Tahunan'}, 'year': hariIni.year, 'entitledDays': 12, 'usedDays': 4, 'remainingDays': 8, 'collectiveLeaveDays': 0}),
          ]),
      riwayatCutiProvider.overrideWith((ref) async => [
            Cuti.dariJson({'id': 'C1', 'leaveType': {'name': 'Cuti Tahunan'}, 'startDate': tanggalSaja(jam(0, 0, 12)), 'endDate': tanggalSaja(jam(0, 0, 13)), 'totalDays': 2, 'status': 'pending', 'reason': 'Acara keluarga', 'createdAt': iso(jam(9, 0, -1))}),
          ]),
      slipSayaProvider.overrideWith((ref) async => [
            SlipGaji.dariJson({'id': 'G1', 'payPeriodStart': tanggalSaja(DateTime(hariIni.year, hariIni.month - 1, 1)), 'payPeriodEnd': tanggalSaja(DateTime(hariIni.year, hariIni.month, 0)), 'status': 'paid', 'basicSalary': '4800000', 'overtimePay': '225000', 'totalAllowances': '650000', 'totalDeductions': '190000', 'grossSalary': '5675000', 'netSalary': '5485000', 'items': []}),
          ]),
      pengumumanProvider.overrideWith((ref) async => [
            Pengumuman.dariJson({'id': 'A1', 'title': 'Jadwal libur Lebaran dan cuti bersama', 'content': '…', 'priority': 'important', 'requiresAcknowledgment': true, 'isRead': false, 'author': {'name': 'HR'}, 'publishedAt': iso(jam(8, 0, -1))}),
            Pengumuman.dariJson({'id': 'A2', 'title': 'Menu baru musim hujan mulai pekan depan', 'content': '…', 'priority': 'normal', 'requiresAcknowledgment': false, 'isRead': true, 'author': {'name': 'Operasional'}, 'publishedAt': iso(jam(8, 0, -3))}),
          ]),
      surveiProvider.overrideWith((ref) async => [
            Survei.dariJson({'id': 'V1', 'title': 'Kepuasan kerja triwulan', 'status': 'published', 'endDate': tanggalSaja(jam(0, 0, 6)), 'hasSubmitted': false, 'questions': []}),
          ]),
      pendaftaranSayaProvider.overrideWith((ref) async => daftarPendaftaran()),
      tautanWhatsAppProvider.overrideWith((ref) async => TautanWhatsApp.dariJson({'status': 'connected', 'driverAktif': true, 'account': {'phoneNumber': '628123456789', 'label': 'Budi', 'attendanceGroup': {'jid': 'g@g.us', 'name': 'Absensi Kitchen'}}})),
      penilaianProvider.overrideWith((ref) async => daftarPenilaian()),
    ]));
    await tester.pumpAndSettle();

    expect(find.text('Budi Santoso Putra'), findsOneWidget);
    expect(find.text('Sedang bekerja'), findsOneWidget);
    expect(find.text('Check-out'), findsOneWidget);
    expect(find.text('PERLU TINDAKAN'), findsOneWidget);
    expect(find.text('1 pengumuman perlu konfirmasi'), findsOneWidget);
    expect(find.textContaining('menunggu jawaban Anda'), findsOneWidget);
    expect(find.text('Pengajuan cuti tahunan menunggu persetujuan'), findsOneWidget);
    expect(find.text('Penilaian diri periode 2026-Q3 belum diisi'), findsOneWidget);
    expect(find.text('Hasil penilaian kinerja Anda sudah keluar'), findsOneWidget);
    expect(find.text('KEHADIRAN 30 HARI TERAKHIR'), findsOneWidget);
    expect(find.text('CUTI & GAJI'), findsOneWidget);
    expect(find.text('8 hari'), findsOneWidget);
    expect(find.text('Rp 5.485.000'), findsOneWidget);
    expect(find.text('KINERJA'), findsOneWidget);
    expect(find.text('82,5 / 100'), findsOneWidget);
    expect(find.text('PELATIHAN MENDATANG'), findsOneWidget);
    expect(find.text('Food Safety & Hygiene Level 1'), findsOneWidget);
    for (final ubin in ['Jadwal', 'Riwayat', 'Cuti', 'Slip Gaji', 'KPI', 'Pelatihan', 'Pengumuman', 'Survei', 'Chat Tim', 'WhatsApp', 'Keluhan']) {
      expect(find.text(ubin), findsWidgets, reason: 'ubin akses cepat "$ubin"');
    }
    expect(find.text('PENGUMUMAN TERBARU'), findsOneWidget);
    await potret(tester, 'beranda');
  });

  testWidgets('beranda peran terbatas: bagian yang menunya tidak ada tidak tampil dan tidak memanggil API', (tester) async {
    ukuranPonsel(tester, tinggi: 1200);
    const terbatas = pengguna;
    await tester.pumpWidget(aplikasiUji(const LayarBeranda(), overrides: [
      penggunaProvider.overrideWithValue(
        // Hanya presensi & pengumuman: cuti, gaji, kinerja, pelatihan, keluhan tersembunyi.
        Pengguna(id: terbatas.id, nik: terbatas.nik, nama: terbatas.nama, email: terbatas.email, peran: 'EMPLOYEE', status: 'active', izin: const ['dashboard.lihat', 'presensi.lihat', 'pengumuman.lihat']),
      ),
      presensiHariIniProvider.overrideWith((ref) async => null),
      shiftHariIniProvider.overrideWith((ref) async => null),
      jadwalProvider.overrideWith((ref) async => <Shift>[]),
      lokasiKerjaProvider.overrideWith((ref) async => []),
      riwayatPresensiProvider.overrideWith((ref) async => <Presensi>[]),
      pengumumanProvider.overrideWith((ref) async => <Pengumuman>[]),
      surveiProvider.overrideWith((ref) async => <Survei>[]),
      // Provider lain sengaja tidak ditimpa: bila beranda memanggilnya, tes
      // gagal karena klien API sungguhan tidak tersedia.
    ]));
    await tester.pumpAndSettle();
    expect(find.text('Hari libur'), findsOneWidget);
    expect(find.text('CUTI & GAJI'), findsNothing);
    expect(find.text('KINERJA'), findsNothing);
    expect(find.text('KPI'), findsNothing);
    expect(find.text('Keluhan'), findsNothing);
    expect(find.text('Belum ada pengumuman'), findsOneWidget);
  });

  group('jam fleksibel', () {
    // Manajer berjam fleksibel; menunya dibatasi supaya hanya penyedia yang
    // ditimpa di bawah yang boleh dipanggil.
    final manajer = Pengguna(
      id: pengguna.id,
      nik: pengguna.nik,
      nama: 'Siti Rahma',
      email: 'siti@contoh.id',
      peran: 'MANAGER',
      status: 'active',
      izin: const ['dashboard.lihat', 'presensi.lihat', 'pengumuman.lihat'],
      jamFleksibel: true,
    );
    Presensi sesi(String id, DateTime masuk, {DateTime? pulang, int? menit}) => Presensi.dariJson({
          'id': id,
          'status': 'present',
          'checkInTime': iso(masuk),
          'checkOutTime': pulang == null ? null : iso(pulang),
          'checkInMethod': 'gps',
          'lateMinutes': 0,
          'workedMinutes': menit,
          'overtimeHours': '0',
          'isFlexible': true,
          'workLocation': {'id': 'L1', 'name': 'Kantor Pusat'},
          'shiftSchedule': null,
        });

    Future<bool> pasang(WidgetTester tester, {Presensi? hariIni, List<Presensi> riwayat = const []}) async {
      var jadwalDiminta = false;
      await tester.pumpWidget(aplikasiUji(const LayarBeranda(), overrides: [
        penggunaProvider.overrideWithValue(manajer),
        presensiHariIniProvider.overrideWith((ref) async => hariIni),
        // Bila beranda masih memakai roster, kartunya akan berbunyi "Hari
        // libur" / "Tidak ada shift" — dan ini tercatat.
        shiftHariIniProvider.overrideWith((ref) async {
          jadwalDiminta = true;
          return null;
        }),
        jadwalProvider.overrideWith((ref) async {
          jadwalDiminta = true;
          return <Shift>[];
        }),
        lokasiKerjaProvider.overrideWith((ref) async => []),
        riwayatPresensiProvider.overrideWith((ref) async => riwayat),
        pengumumanProvider.overrideWith((ref) async => <Pengumuman>[]),
        surveiProvider.overrideWith((ref) async => <Survei>[]),
      ]));
      await tester.pumpAndSettle();
      return jadwalDiminta;
    }

    testWidgets('sebelum check-in: kartu JAM FLEKSIBEL, bukan hari libur; jadwal tidak diminta', (tester) async {
      ukuranPonsel(tester, tinggi: 1400);
      final jadwalDiminta = await pasang(tester);
      expect(find.text('JAM FLEKSIBEL'), findsOneWidget);
      expect(find.text('Masuk dan pulang kapan saja'), findsOneWidget);
      expect(find.text('Belum check-in'), findsOneWidget);
      expect(find.text('Check-in sekarang'), findsOneWidget);
      for (final teks in ['Hari libur', 'Tidak ada shift', 'Nikmati hari libur Anda', 'SHIFT HARI INI', 'JADWAL 7 HARI KE DEPAN']) {
        expect(find.text(teks), findsNothing, reason: teks);
      }
      expect(find.text('Anda memakai jam fleksibel — tidak ada roster shift'), findsOneWidget);
      // Hari tanpa presensi di strip 7 hari tidak dicap libur atau absen.
      final ketStrip = tester.widgetList<Tooltip>(find.byType(Tooltip)).map((t) => t.message ?? '');
      expect(ketStrip.where((m) => m.startsWith('Libur') || m.startsWith('Absen') || m.startsWith('Belum')), isEmpty);
      expect(jadwalDiminta, isFalse);
      await potret(tester, 'beranda-fleksibel');
    });

    testWidgets('setelah sesi selesai: check-in lagi tersedia dan jam kerja menjumlah semua sesi', (tester) async {
      ukuranPonsel(tester, tinggi: 1400);
      final pagi = sesi('P1', jam(8), pulang: jam(10), menit: 120);
      final siang = sesi('P2', jam(13), pulang: jam(14, 30), menit: 90);
      await pasang(tester, hariIni: siang, riwayat: [siang, pagi]);
      expect(find.text('Sesi selesai'), findsOneWidget);
      expect(find.text('Check-in lagi'), findsOneWidget);
      expect(find.textContaining('Presensi hari ini lengkap'), findsNothing);
      expect(find.text('3 jam 30 menit'), findsOneWidget);
      expect(find.text('2 sesi hari ini'), findsOneWidget);
      expect(find.text('Hari libur'), findsNothing);
      // Dua sesi pada tanggal yang sama tetap satu hari hadir.
      expect(find.text('1 hari'), findsOneWidget);
    });

    testWidgets('sedang bekerja: tombol check-out, jam kerja berjalan', (tester) async {
      ukuranPonsel(tester, tinggi: 1400);
      final berjalan = sesi('P3', DateTime.now().subtract(const Duration(minutes: 45)));
      await pasang(tester, hariIni: berjalan, riwayat: [berjalan]);
      expect(find.text('Sedang bekerja'), findsOneWidget);
      expect(find.text('Check-out'), findsOneWidget);
      expect(find.text('Check-in lagi'), findsNothing);
      expect(find.textContaining('menit'), findsWidgets);
    });
  });
}
