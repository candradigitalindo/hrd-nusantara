import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/core/api/galat_api.dart';
import 'package:hrd_nusantara/core/api/status_jaringan.dart';
import 'package:hrd_nusantara/core/format.dart';
import 'package:hrd_nusantara/fitur/antrean/mesin_antrean.dart';
import 'package:hrd_nusantara/fitur/antrean/model_antrean.dart';
import 'package:hrd_nusantara/fitur/antrean/penyimpanan_antrean.dart';
import 'package:hrd_nusantara/fitur/auth/sesi_provider.dart';
import 'package:hrd_nusantara/fitur/chat/layar_chat.dart';
import 'package:hrd_nusantara/fitur/chat/model_chat.dart';
import 'package:hrd_nusantara/fitur/chat/repo_chat.dart';
import 'package:hrd_nusantara/fitur/cuti/layar_cuti.dart';
import 'package:hrd_nusantara/fitur/cuti/model_cuti.dart';
import 'package:hrd_nusantara/fitur/cuti/repo_cuti.dart';
import 'package:hrd_nusantara/fitur/kasus/repo_kasus.dart';
import 'package:hrd_nusantara/fitur/pengumuman/model_pengumuman.dart';
import 'package:hrd_nusantara/fitur/pengumuman/repo_pengumuman.dart';
import 'package:hrd_nusantara/fitur/survei/model_survei.dart';
import 'package:hrd_nusantara/fitur/survei/repo_survei.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'alat_uji.dart';
import 'data_uji.dart';

/// Antrean dengan isi tetap yang tidak mengirim apa pun: untuk menguji
/// tampilan dan data "tertunda" tanpa mesin sinkron ikut bekerja.
class AntreanTetap extends MesinAntrean {
  AntreanTetap(this.isi);
  final List<ItemAntrean> isi;
  @override
  StatusAntrean build() => StatusAntrean(item: isi);
}

ItemAntrean tertunda(String jenis, String judul, {Map<String, dynamic> info = const {}, StatusKiriman status = StatusKiriman.menunggu, String? galat, DateTime? dibuat}) => ItemAntrean(
      id: idAntreanBaru(),
      jenis: jenis,
      judul: judul,
      metode: 'POST',
      jalur: '/x',
      badan: const {},
      pemilik: pengguna.id,
      dibuat: dibuat ?? DateTime.now(),
      status: status,
      galat: galat,
      info: info,
    );

const cutiTahunan = JenisCuti(id: 'JT', kode: 'CT', nama: 'Cuti Tahunan', wajibLampiran: false, potongSaldo: true);
final cutiDisetujui = Cuti.dariJson({
  'id': 'C1',
  'leaveType': {'name': 'Cuti Tahunan'},
  'startDate': tanggalSaja(jam(0, 0, 12)),
  'endDate': tanggalSaja(jam(0, 0, 13)),
  'totalDays': 2,
  'status': 'approved',
  'reason': 'Acara keluarga',
  'createdAt': iso(jam(9, 0, -3)),
});
const pengumuman = Pengumuman(id: 'A1', judul: 'Jadwal libur Lebaran', isi: '…', prioritas: 'important', wajibKonfirmasi: true, sudahDibaca: false);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    await initializeDateFormatting('id_ID');
    await muatFontAsli();
  });
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  group('kiriman fitur saat offline', () {
    late ServerAntrean server;
    late AntreanMemori antrean;
    late ProviderContainer c;

    setUp(() async {
      server = ServerAntrean();
      antrean = AntreanMemori();
      c = ProviderContainer(overrides: [
        penggunaProvider.overrideWithValue(pengguna),
        penyimpananAntreanProvider.overrideWithValue(antrean),
        klienTiruan(server),
      ]);
      addTearDown(c.dispose);
      c.listen(antreanProvider, (_, _) {});
      await c.read(antreanProvider.notifier).proses();
      c.read(statusJaringanProvider.notifier).terputus();
    });

    ItemAntrean satuSaja() => antrean.isi.values.single;

    test('ajukan cuti: jalur, badan, dan judul yang dibaca pengguna', () async {
      final h = await c.read(repoCutiProvider).ajukan(jenis: cutiTahunan, mulai: DateTime(2026, 10, 2), selesai: DateTime(2026, 10, 3), alasan: 'Acara keluarga', lampiranUrl: '');
      expect(h.tertunda, isTrue);
      final i = satuSaja();
      expect((i.metode, i.jalur), ('POST', '/leaves'));
      expect(i.badan, {'leaveTypeId': 'JT', 'startDate': '2026-10-02', 'endDate': '2026-10-03', 'reason': 'Acara keluarga'});
      expect(i.judul, 'Cuti Tahunan 2 Okt – 3 Okt');
      expect(server.percobaan, isEmpty);
    });

    test('batalkan cuti: PATCH, dengan id cutinya untuk penanda di daftar', () async {
      await c.read(repoCutiProvider).batalkan(cutiDisetujui);
      final i = satuSaja();
      expect((i.metode, i.jalur, i.info['cutiId']), ('PATCH', '/leaves/C1/cancel', 'C1'));
    });

    test('keluhan, pesan chat, dan jawaban survei', () async {
      await c.read(repoKasusProvider).ajukanKeluhan(judul: 'Jadwal tidak adil', uraian: 'Shift malam beruntun', tanggalKejadian: '2026-09-20');
      const ruang = RuangChat(id: 'R1', nama: 'Tim Dapur', tipe: 'general', privat: false, jumlahAnggota: 8, peranSaya: 'member');
      await c.read(repoChatProvider).kirim(ruang, 'Stok bawang habis, saya belanja dulu');
      final survei = Survei(id: 'V1', judul: 'Kepuasan kerja', anonim: true, status: 'published', selesai: '2026-10-01', sudahIsi: false, pertanyaan: const []);
      await c.read(repoSurveiProvider).kirim(survei, [
        {'questionId': 'Q1', 'scaleValue': 4},
      ]);

      final [keluhan, pesan, jawaban] = antrean.isi.values.toList();
      expect((keluhan.jalur, keluhan.badan['incidentDate'], keluhan.judul), ('/complaints', '2026-09-20', 'Keluhan: Jadwal tidak adil'));
      expect((pesan.jalur, pesan.info['ruangId']), ('/chat/rooms/R1/messages', 'R1'));
      expect(pesan.badan, {'message': 'Stok bawang habis, saya belanja dulu'});
      expect((jawaban.jalur, jawaban.info['surveiId']), ('/surveys/V1/submit', 'V1'));
    });

    test('pengumuman: tanda baca tidak diantrekan dua kali; konfirmasi mencakup tanda baca', () async {
      final repo = c.read(repoPengumumanProvider);
      await repo.tandaiBaca(pengumuman);
      await repo.tandaiBaca(pengumuman); // dibuka lagi saat masih offline
      expect(antrean.isi, hasLength(1));

      await repo.tandaiBaca(pengumuman, konfirmasi: true);
      await repo.tandaiBaca(pengumuman);
      await repo.tandaiBaca(pengumuman, konfirmasi: true);
      expect(antrean.isi.values.map((i) => i.badan['acknowledge']), [false, true]);
    });

    test('online: dikirim langsung; ditolak server: galatnya tampil, tidak diantrekan', () async {
      c.read(statusJaringanProvider.notifier).berhasil();
      server.jawab = (_) => (201, {'id': 'K9', 'title': 'Jadwal tidak adil'});
      final h = await c.read(repoKasusProvider).ajukanKeluhan(judul: 'Jadwal tidak adil', uraian: 'Shift malam beruntun');
      expect(h.tertunda, isFalse);
      expect(h.jawaban['id'], 'K9');
      expect(server.percobaan.single.headers['Idempotency-Key'], isNotNull);

      server.jawab = (_) => (400, {'error': 'Saldo cuti tahunan tidak mencukupi'});
      await expectLater(
        c.read(repoCutiProvider).ajukan(jenis: cutiTahunan, mulai: DateTime(2026, 10, 2), selesai: DateTime(2026, 10, 3)),
        throwsA(isA<GalatApi>()),
      );
      expect(antrean.isi, isEmpty);
    });
  });

  group('status tertunda berlaku di data (beranda ikut benar)', () {
    test('survei yang jawabannya mengantre tidak bisa diisi lagi', () async {
      final server = ServerAntrean()
        ..jawab = (_) => (200, {
              'data': [
                {'id': 'V1', 'title': 'Kepuasan kerja', 'status': 'published', 'endDate': '2026-10-01', 'hasSubmitted': false, 'questions': []},
                {'id': 'V2', 'title': 'Menu kantin', 'status': 'published', 'endDate': '2026-10-01', 'hasSubmitted': false, 'questions': []},
              ],
            });
      final c = ProviderContainer(overrides: [
        penggunaProvider.overrideWithValue(pengguna),
        antreanProvider.overrideWith(() => AntreanTetap([
              tertunda('survei-kirim', 'Survei: Kepuasan kerja', info: {'surveiId': 'V1'}),
            ])),
        klienTiruan(server),
      ]);
      addTearDown(c.dispose);
      final daftar = await c.listen(surveiProvider.future, (_, _) {}).read();
      expect(daftar.map((s) => (s.id, s.jawabanTertunda, s.bisaDiisi)), [('V1', true, false), ('V2', false, true)]);
    });

    test('pengumuman yang tanda baca/konfirmasinya mengantre dianggap sudah dibaca/dikonfirmasi', () async {
      final server = ServerAntrean()
        ..jawab = (_) => (200, {
              'data': [
                {'id': 'A1', 'title': 'Libur Lebaran', 'content': '…', 'priority': 'important', 'requiresAcknowledgment': true, 'isRead': false},
                {'id': 'A2', 'title': 'Menu baru', 'content': '…', 'priority': 'normal', 'requiresAcknowledgment': true, 'isRead': false},
              ],
            });
      final c = ProviderContainer(overrides: [
        penggunaProvider.overrideWithValue(pengguna),
        antreanProvider.overrideWith(() => AntreanTetap([
              tertunda('pengumuman-baca', 'Konfirmasi: Libur Lebaran', info: {'pengumumanId': 'A1', 'konfirmasi': true}),
              tertunda('pengumuman-baca', 'Tandai dibaca: Menu baru', info: {'pengumumanId': 'A2', 'konfirmasi': false}),
            ])),
        klienTiruan(server),
      ]);
      addTearDown(c.dispose);
      final daftar = await c.listen(pengumumanProvider.future, (_, _) {}).read();
      expect(daftar.map((p) => (p.id, p.sudahDibaca, p.perluKonfirmasi)), [('A1', true, false), ('A2', true, true)]);
    });
  });

  testWidgets('layar cuti: pengajuan dan pembatalan yang belum terkirim', (tester) async {
    ukuranPonsel(tester, tinggi: 1100);
    await tester.pumpWidget(aplikasiUji(const LayarCuti(), overrides: [
      penggunaProvider.overrideWithValue(pengguna),
      antreanProvider.overrideWith(() => AntreanTetap([
            tertunda('cuti-ajukan', 'Cuti Tahunan 2 Okt – 3 Okt'),
            tertunda('cuti-batal', 'Batalkan Cuti Tahunan ${formatTanggal(jam(0, 0, 12), pola: 'd MMM')}', info: {'cutiId': 'C1'}),
            tertunda('cuti-ajukan', 'Cuti Sakit 26 Sep – 26 Sep', status: StatusKiriman.gagal, galat: 'Cuti Sakit membutuhkan lampiran pendukung'),
          ])),
      saldoCutiProvider.overrideWith((ref) async => [
            SaldoCuti.dariJson({'leaveType': {'id': 'JT', 'name': 'Cuti Tahunan'}, 'year': hariIni.year, 'entitledDays': 12, 'usedDays': 4, 'remainingDays': 8, 'collectiveLeaveDays': 0}),
          ]),
      riwayatCutiProvider.overrideWith((ref) async => [cutiDisetujui]),
    ]));
    await tester.pumpAndSettle();

    expect(find.text('BELUM TERKIRIM'), findsOneWidget);
    expect(find.text('Cuti Tahunan 2 Okt – 3 Okt'), findsOneWidget);
    expect(find.text('Ditolak: Cuti Sakit membutuhkan lampiran pendukung'), findsOneWidget);
    expect(find.text('Pembatalan belum terkirim'), findsOneWidget);
    expect(find.text('Batalkan'), findsNothing, reason: 'tidak bisa dibatalkan dua kali');
    await potret(tester, 'cuti-tertunda');
  });

  testWidgets('ruang chat: pesan yang ditulis offline tampil dengan tanda menunggu atau ditolak', (tester) async {
    ukuranPonsel(tester);
    const ruang = RuangChat(id: 'R1', nama: 'Tim Dapur', tipe: 'general', privat: false, jumlahAnggota: 8, peranSaya: 'member');
    await tester.pumpWidget(aplikasiUji(const LayarRuang(ruang), overrides: [
      penggunaProvider.overrideWithValue(pengguna),
      antreanProvider.overrideWith(() => AntreanTetap([
            tertunda('chat-kirim', 'Pesan', info: {'ruangId': 'R1', 'isi': 'Stok bawang habis, saya belanja dulu'}, dibuat: jam(9, 12)),
            tertunda('chat-kirim', 'Pesan', info: {'ruangId': 'R1', 'isi': 'Oke, saya yang pegang wajan'}, dibuat: jam(9, 14), status: StatusKiriman.gagal, galat: 'Anda bukan anggota ruang ini'),
            tertunda('chat-kirim', 'Pesan', info: {'ruangId': 'R2', 'isi': 'Ruang lain'}),
          ])),
      pesanChatProvider('R1').overrideWith((ref) async => [
            PesanChat(id: 'M2', pengirimId: 'K2', pengirim: 'Siti', isi: 'Siapa yang belanja pagi ini?', dihapus: false, waktu: jam(9, 5)),
            PesanChat(id: 'M1', pengirimId: pengguna.id, pengirim: pengguna.nama, isi: 'Selamat pagi tim', dihapus: false, waktu: jam(8, 1)),
          ]),
    ]));
    await tester.pumpAndSettle();

    expect(find.text('Stok bawang habis, saya belanja dulu'), findsOneWidget);
    expect(find.text('menunggu'), findsOneWidget);
    expect(find.text('ditolak'), findsOneWidget);
    expect(find.text('Ruang lain'), findsNothing);
    expect(find.text('Siapa yang belanja pagi ini?'), findsOneWidget);
    await potret(tester, 'chat-tertunda');

    // Layar ruang menyegarkan tiap 5 detik; buang pohon widget supaya timernya berhenti.
    await tester.pumpWidget(const SizedBox());
  });
}
