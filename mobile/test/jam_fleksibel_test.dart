import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/fitur/auth/model_pengguna.dart';
import 'package:hrd_nusantara/fitur/auth/sesi_provider.dart';
import 'package:hrd_nusantara/fitur/jadwal/layar_jadwal.dart';
import 'package:hrd_nusantara/fitur/jadwal/model_shift.dart';
import 'package:hrd_nusantara/fitur/jadwal/repo_jadwal.dart';
import 'package:hrd_nusantara/fitur/presensi/layar_presensi.dart';
import 'package:hrd_nusantara/fitur/presensi/model_presensi.dart';
import 'package:hrd_nusantara/fitur/presensi/repo_presensi.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'alat_uji.dart';
import 'data_uji.dart';

/// Manajer berjam fleksibel: masuk dan pulang kapan saja, tanpa roster.
Pengguna penggunaFleksibel() => Pengguna.dariJson({...pengguna.keJson(), 'role': 'MANAGER', 'flexibleHours': true});

/// Baris GET /shifts/me; [jenis] dan [penugasan] meniru baris hasil penugasan
/// berjangka.
Map<String, dynamic> jsonShift(String id, int geser, {String mulai = '07:00', String selesai = '15:00', String status = 'confirmed', bool jenis = false, bool penugasan = false}) => {
      'id': id,
      'employeeId': 'K1',
      'date': '${tanggalSaja(jam(0, 0, geser))}T00:00:00.000Z',
      'startTime': mulai,
      'endTime': selesai,
      'breakDuration': '1',
      'status': status,
      'notes': null,
      'templateId': jenis ? 'T1' : null,
      'template': jenis ? {'id': 'T1', 'name': 'Pagi', 'code': 'P', 'color': 'amber'} : null,
      'assignmentId': penugasan ? 'A1' : null,
      'isOverride': false,
    };

Map<String, dynamic> jsonPresensiFleksibel(String id, DateTime masuk, {DateTime? pulang, int? menit}) => {
      'id': id,
      'status': 'present',
      'checkInTime': iso(masuk),
      'checkOutTime': pulang == null ? null : iso(pulang),
      'checkInMethod': 'gps',
      'lateMinutes': 0,
      'workedMinutes': menit,
      'overtimeHours': '0',
      'overtimeApproved': false,
      'faceVerified': false,
      'isFlexible': true,
      'workLocation': {'id': 'L1', 'name': 'Kantor Pusat'},
      'shiftSchedule': null,
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    await initializeDateFormatting('id_ID');
    await muatFontAsli();
  });
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  group('jadwal', () {
    test('baris yang dibatalkan dibuang sejak dari repo, juga dari salinan server lama', () async {
      final server = ServerAntrean()
        ..jawab = (_) => (200, {
              'data': [jsonShift('S0', 0), jsonShift('S1', 1, status: 'cancelled'), jsonShift('S2', 2, status: 'tentative')],
              'pagination': {'page': 1, 'limit': 100, 'total': 3, 'totalPages': 1},
              'flexibleHours': false,
            });
      final c = ProviderContainer(overrides: [klienTiruan(server)]);
      addTearDown(c.dispose);
      final daftar = await c.read(repoJadwalProvider).rentang(jam(0), jam(0, 0, 14));
      expect(daftar.map((s) => s.id), ['S0', 'S2']);
    });

    test('shift hari ini melewati baris yang dibatalkan', () async {
      final c = ProviderContainer(overrides: [
        jadwalProvider.overrideWith((ref) async => [
              Shift.dariJson(jsonShift('BATAL', 0, mulai: '06:00', selesai: '10:00', status: 'cancelled')),
              Shift.dariJson(jsonShift('SAH', 0, mulai: '13:00', selesai: '21:00')),
            ]),
      ]);
      addTearDown(c.dispose);
      expect((await c.listen(shiftHariIniProvider.future, (_, _) {}).read())?.id, 'SAH');
    });

    testWidgets('kartu menampilkan nama jenis shift dan ikon berulang; shift batal tidak tampil', (tester) async {
      ukuranPonsel(tester);
      await tester.pumpWidget(aplikasiUji(const LayarJadwal(), overrides: [
        penggunaProvider.overrideWithValue(pengguna),
        jadwalProvider.overrideWith((ref) async => [
              Shift.dariJson(jsonShift('S0', 0, jenis: true, penugasan: true)),
              Shift.dariJson(jsonShift('S1', 1, mulai: '22:00', selesai: '06:00', status: 'cancelled')),
              Shift.dariJson(jsonShift('S2', 2, mulai: '09:00', selesai: '17:00', status: 'tentative')),
            ]),
      ]));
      await tester.pumpAndSettle();

      expect(find.text('Pagi · 07:00–\u206015:00'), findsOneWidget);
      expect(find.byIcon(Icons.repeat_rounded), findsOneWidget, reason: 'hanya baris dari penugasan yang berulang');
      expect(find.text('09:00 – 17:00'), findsOneWidget);
      expect(find.text('Sementara'), findsOneWidget);
      expect(find.textContaining('22:00'), findsNothing);
      expect(find.textContaining('jam fleksibel'), findsNothing);
      await potret(tester, 'jadwal-jenis-shift');
    });

    testWidgets('jadwal kosong: rentang teksnya mengikuti rentang yang dimuat', (tester) async {
      ukuranPonsel(tester);
      await tester.pumpWidget(aplikasiUji(const LayarJadwal(), overrides: [
        penggunaProvider.overrideWithValue(pengguna),
        jadwalProvider.overrideWith((ref) async => <Shift>[]),
      ]));
      await tester.pumpAndSettle();
      expect(find.text('Belum ada jadwal'), findsOneWidget);
      expect(find.textContaining('Jadwal 2 minggu ke depan'), findsOneWidget);
    });

    testWidgets('karyawan fleksibel: keterangan jam fleksibel, bukan "belum ada jadwal"', (tester) async {
      ukuranPonsel(tester);
      await tester.pumpWidget(aplikasiUji(const LayarJadwal(), overrides: [
        penggunaProvider.overrideWithValue(penggunaFleksibel()),
        jadwalProvider.overrideWith((ref) async => <Shift>[]),
      ]));
      await tester.pumpAndSettle();
      expect(find.text('Anda memakai jam fleksibel — tidak ada roster shift'), findsOneWidget);
      expect(find.text('Belum ada jadwal'), findsNothing);
      await potret(tester, 'jadwal-fleksibel');
    });
  });

  group('presensi', () {
    testWidgets('riwayat: presensi fleksibel berlabel "Fleksibel"; setelah pulang bisa check-in lagi', (tester) async {
      ukuranPonsel(tester);
      final sesi1 = Presensi.dariJson(jsonPresensiFleksibel('P1', jam(8), pulang: jam(10), menit: 120));
      final sesi2 = Presensi.dariJson(jsonPresensiFleksibel('P2', jam(13), pulang: jam(14, 30), menit: 90));
      final biasa = Presensi.dariJson({
        ...jsonPresensiFleksibel('P0', jam(8, 20, -1), pulang: jam(16, 0, -1), menit: 400),
        'status': 'late',
        'lateMinutes': 20,
        'isFlexible': false,
      });
      await tester.pumpWidget(aplikasiUji(const LayarPresensi(), overrides: [
        penggunaProvider.overrideWithValue(penggunaFleksibel()),
        presensiHariIniProvider.overrideWith((ref) async => sesi2),
        riwayatPresensiProvider.overrideWith((ref) async => [sesi2, sesi1, biasa]),
      ]));
      await tester.pumpAndSettle();

      expect(find.text('Check-in Lagi'), findsOneWidget);
      expect(find.textContaining('Presensi hari ini lengkap'), findsNothing);
      expect(find.text('jam fleksibel'), findsOneWidget);
      expect(find.textContaining('Fleksibel'), findsNWidgets(2));
      // Presensi biasa kemarin tetap menampilkan keterlambatannya.
      expect(find.textContaining('telat 20 mnt'), findsOneWidget);
      await potret(tester, 'presensi-fleksibel');
    });

    testWidgets('karyawan biasa: satu sesi selesai = presensi lengkap, tanpa tombol check-in', (tester) async {
      ukuranPonsel(tester);
      final selesai = Presensi.dariJson({...jsonPresensiFleksibel('P1', jam(8), pulang: jam(16), menit: 420), 'isFlexible': false});
      await tester.pumpWidget(aplikasiUji(const LayarPresensi(), overrides: [
        penggunaProvider.overrideWithValue(pengguna),
        presensiHariIniProvider.overrideWith((ref) async => selesai),
        riwayatPresensiProvider.overrideWith((ref) async => [selesai]),
      ]));
      await tester.pumpAndSettle();
      expect(find.textContaining('Presensi hari ini lengkap'), findsOneWidget);
      expect(find.text('Check-in Lagi'), findsNothing);
      expect(find.textContaining('Fleksibel'), findsNothing);
    });
  });
}
