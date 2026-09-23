import 'package:hrd_nusantara/fitur/auth/model_pengguna.dart';
import 'package:hrd_nusantara/fitur/kasus/model_kasus.dart';
import 'package:hrd_nusantara/fitur/kinerja/model_kinerja.dart';
import 'package:hrd_nusantara/fitur/pelatihan/model_pelatihan.dart';
import 'package:intl/intl.dart';

/// Data contoh yang bentuknya persis balasan server, dipakai tes model dan
/// tes tampilan. Budi (K1) adalah pengguna; Siti (K2) atasannya.
const pengguna = Pengguna(
  id: 'K1',
  nik: 'EMP-0001',
  nama: 'Budi Santoso Putra',
  email: 'budi@contoh.id',
  peran: 'EMPLOYEE',
  status: 'active',
  departemen: 'Kitchen',
  jabatan: 'Chef de Partie',
  izin: [
    'dashboard.lihat',
    'presensi.lihat',
    'cuti.lihat',
    'gaji.lihat',
    'pengumuman.lihat',
    'chat.lihat',
    'whatsapp_saya.lihat',
    'pelatihan.lihat',
    'kinerja.lihat',
    'kasus.lihat',
  ],
);

String tanggalSaja(DateTime d) => DateFormat('yyyy-MM-dd').format(d);
String iso(DateTime d) => d.toUtc().toIso8601String();

final hariIni = DateTime.now();
DateTime jam(int h, [int m = 0, int geserHari = 0]) => DateTime(hariIni.year, hariIni.month, hariIni.day + geserHari, h, m);

const _kriteria = [
  {'id': 'C1', 'code': 'KEC', 'name': 'Kecepatan pelayanan', 'category': 'Pelayanan', 'description': 'Waktu tunggu tamu dari pesan sampai tersaji', 'weight': '40', 'maxScore': 5, 'sortOrder': 1},
  {'id': 'C2', 'code': 'RAPI', 'name': 'Kerapian & kebersihan', 'category': 'Standar', 'weight': '35', 'maxScore': 5, 'sortOrder': 2},
  {'id': 'C3', 'code': 'TIM', 'name': 'Kerja sama tim', 'category': 'Sikap', 'weight': '25', 'maxScore': 5, 'sortOrder': 3},
];

Map<String, dynamic> jsonPenilaianAtasan({String status = 'submitted'}) => {
      'id': 'R1',
      'cycleId': 'S1',
      'revieweeId': 'K1',
      'reviewerId': 'K2',
      'reviewerType': 'manager',
      'period': '2026-Q3',
      'formTemplateId': 'T1',
      'totalScore': '82.5',
      'rating': 4.13,
      'feedback': 'Konsisten cepat di jam sibuk. Tingkatkan kerapian station di akhir shift.',
      'status': status,
      'submittedAt': iso(jam(9, 30, -2)),
      'createdAt': iso(jam(9, 0, -20)),
      'reviewee': {'id': 'K1', 'nik': 'EMP-0001', 'name': 'Budi Santoso Putra'},
      'reviewer': {'id': 'K2', 'nik': 'EMP-0002', 'name': 'Siti Rahma'},
      'scores': [
        {'criterionId': 'C1', 'score': '4.5', 'comment': 'Rata-rata 6 menit', 'criterion': {'code': 'KEC', 'name': 'Kecepatan pelayanan', 'weight': '40', 'maxScore': 5}},
        {'criterionId': 'C2', 'score': '3.5', 'comment': null, 'criterion': {'code': 'RAPI', 'name': 'Kerapian & kebersihan', 'weight': '35', 'maxScore': 5}},
        {'criterionId': 'C3', 'score': '4.5', 'comment': 'Sering membantu station lain', 'criterion': {'code': 'TIM', 'name': 'Kerja sama tim', 'weight': '25', 'maxScore': 5}},
      ],
      'discussions': [
        {'id': 'D1', 'authorId': 'K2', 'note': 'Kita bahas target kerapian di one-on-one minggu depan ya.', 'createdAt': iso(jam(10, 0, -1))},
      ],
      'criteria': _kriteria,
    };

Map<String, dynamic> jsonPenilaianDiri() => {
      'id': 'R2',
      'cycleId': 'S1',
      'revieweeId': 'K1',
      'reviewerId': 'K1',
      'reviewerType': 'self',
      'period': '2026-Q3',
      'formTemplateId': 'T1',
      'totalScore': null,
      'rating': null,
      'feedback': null,
      'status': 'draft',
      'submittedAt': null,
      'createdAt': iso(jam(9, 0, -20)),
      'reviewee': {'id': 'K1', 'nik': 'EMP-0001', 'name': 'Budi Santoso Putra'},
      'reviewer': {'id': 'K1', 'nik': 'EMP-0001', 'name': 'Budi Santoso Putra'},
      'scores': [],
      'discussions': [],
      'criteria': _kriteria,
    };

/// Penilaian periode lalu yang sudah dikonfirmasi.
Map<String, dynamic> jsonPenilaianLalu() => {
      ...jsonPenilaianAtasan(status: 'acknowledged'),
      'id': 'R0',
      'cycleId': 'S0',
      'period': '2026-Q2',
      'totalScore': '76',
      'rating': 3.8,
      'submittedAt': iso(jam(9, 0, -95)),
      'createdAt': iso(jam(9, 0, -110)),
      'discussions': [],
    };

List<Penilaian> daftarPenilaian() => [jsonPenilaianAtasan(), jsonPenilaianDiri(), jsonPenilaianLalu()].map(Penilaian.dariJson).toList();

List<UmpanBalik> daftarUmpan() => [
      UmpanBalik.dariJson({'id': 'F1', 'type': 'praise', 'message': 'Handling komplain meja 4 tadi malam rapi sekali. Tamunya sampai memuji ke saya.', 'isPrivate': false, 'createdAt': iso(jam(22, 15, -1)), 'author': {'id': 'K2', 'name': 'Siti Rahma'}}),
      UmpanBalik.dariJson({'id': 'F2', 'type': 'improvement', 'message': 'Checklist closing station belum lengkap dua kali minggu ini.', 'isPrivate': true, 'createdAt': iso(jam(23, 0, -4)), 'author': {'id': 'K2', 'name': 'Siti Rahma'}}),
    ];

List<SesiPelatihan> daftarSesi() => [
      SesiPelatihan.dariJson({
        'id': 'TS1',
        'title': 'Food Safety & Hygiene Level 1',
        'description': 'Wajib bagi semua kru dapur: HACCP dasar, suhu penyimpanan, alergen.',
        'trainer': 'Chef Andi',
        'startDateTime': iso(jam(9, 0, 5)),
        'endDateTime': iso(jam(12, 0, 5)),
        'location': 'Ruang Training Lt. 2',
        'maxParticipants': 12,
        'registrationDeadline': iso(jam(17, 0, 3)),
        'cost': null,
        'status': 'scheduled',
        'program': {'id': 'P1', 'code': 'FSH1', 'name': 'Keamanan Pangan', 'isMandatory': true, 'passingScore': '70'},
        'registrationCount': 7,
      }),
      SesiPelatihan.dariJson({
        'id': 'TS2',
        'title': 'Latte Art Dasar',
        'trainer': 'Barista Rio',
        'startDateTime': iso(jam(14, 0, 9)),
        'endDateTime': iso(jam(16, 0, 9)),
        'location': 'Outlet Sudirman',
        'maxParticipants': 6,
        'registrationDeadline': null,
        'cost': '150000',
        'status': 'scheduled',
        'program': {'id': 'P2', 'code': 'LA', 'name': 'Barista', 'isMandatory': false, 'passingScore': null},
        'registrationCount': 6,
      }),
    ];

List<PendaftaranPelatihan> daftarPendaftaran() => [
      PendaftaranPelatihan.dariJson({
        'id': 'TR1',
        'employeeId': 'K1',
        'trainingSessionId': 'TS1',
        'registrationDate': iso(jam(8, 0, -1)),
        'status': 'registered',
        'trainingSession': {'id': 'TS1', 'title': 'Food Safety & Hygiene Level 1', 'startDateTime': iso(jam(9, 0, 5)), 'status': 'scheduled', 'program': {'id': 'P1', 'code': 'FSH1', 'name': 'Keamanan Pangan'}},
      }),
      PendaftaranPelatihan.dariJson({
        'id': 'TR0',
        'employeeId': 'K1',
        'trainingSessionId': 'TS0',
        'registrationDate': iso(jam(8, 0, -60)),
        'status': 'completed',
        'evaluationScore': '88',
        'passed': true,
        'completedAt': iso(jam(12, 0, -45)),
        'certificateUrl': 'https://contoh.id/sertifikat/TR0.pdf',
        'expiresAt': iso(jam(0, 0, 320)),
        'trainingSession': {'id': 'TS0', 'title': 'Service Excellence', 'startDateTime': iso(jam(9, 0, -45)), 'status': 'completed', 'program': {'id': 'P3', 'code': 'SE', 'name': 'Pelayanan'}},
      }),
    ];

List<Kasus> daftarKasus() => [
      Kasus.dariJson({
        'id': 'CS2',
        'employeeId': 'K1',
        'type': 'complaint',
        'title': 'Jadwal shift berubah mendadak tanpa pemberitahuan',
        'description': 'Shift Sabtu 20 Sep diganti dari pagi ke malam pada Jumat jam 22:00, padahal sudah ada janji keluarga.',
        'status': 'under_review',
        'severity': null,
        'incidentDate': iso(jam(0, 0, -4)),
        'resolvedAt': null,
        'resolutionNotes': null,
        'reportedById': 'K1',
        'handledById': 'K9',
        'createdAt': iso(jam(9, 10, -3)),
        'employee': {'id': 'K1', 'nik': 'EMP-0001', 'name': 'Budi Santoso Putra'},
        'reportedBy': {'id': 'K1', 'nik': 'EMP-0001', 'name': 'Budi Santoso Putra'},
        'handledBy': {'id': 'K9', 'nik': 'ADMIN-001', 'name': 'Administrator'},
      }),
      Kasus.dariJson({
        'id': 'CS1',
        'employeeId': 'K1',
        'type': 'disciplinary_action',
        'title': 'Terlambat 3 kali dalam seminggu',
        'description': 'Terlambat 15–25 menit pada 1, 3, dan 5 September tanpa pemberitahuan ke supervisor.',
        'status': 'resolved',
        'severity': 'sp1',
        'incidentDate': iso(jam(0, 0, -18)),
        'resolvedAt': iso(jam(15, 0, -10)),
        'resolutionNotes': 'Sudah dibicarakan; karyawan berkomitmen berangkat lebih awal. SP 1 berlaku 6 bulan.',
        'reportedById': 'K2',
        'handledById': 'K9',
        'createdAt': iso(jam(9, 0, -17)),
        'employee': {'id': 'K1', 'nik': 'EMP-0001', 'name': 'Budi Santoso Putra'},
        'reportedBy': {'id': 'K2', 'nik': 'EMP-0002', 'name': 'Siti Rahma'},
        'handledBy': {'id': 'K9', 'nik': 'ADMIN-001', 'name': 'Administrator'},
      }),
    ];
