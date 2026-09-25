import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/galat_api.dart';
import '../../core/api/klien_api.dart';
import '../../core/api/status_jaringan.dart';
import '../../core/konfigurasi.dart';
import '../auth/sesi_provider.dart';
import 'model_antrean.dart';
import 'penyimpanan_antrean.dart';

/// Hasil satu putaran pengiriman, untuk pesan di layar.
class LaporanKirim {
  const LaporanKirim(this.nomor, {this.terkirim = const [], this.gagal = const []});
  final int nomor;
  final List<ItemAntrean> terkirim;
  final List<ItemAntrean> gagal;
}

class StatusAntrean {
  const StatusAntrean({this.item = const [], this.milikAkunLain = 0, this.sedangDikirim, this.terkirim = 0, this.laporan});

  /// Kiriman milik akun yang sedang masuk, urut kiriman.
  final List<ItemAntrean> item;

  /// Kiriman akun lain di ponsel ini; menunggu akun itu masuk lagi.
  final int milikAkunLain;
  final String? sedangDikirim;

  /// Jumlah yang berhasil terkirim sejak aplikasi dibuka. Provider data yang
  /// isinya bergantung pada kiriman tertunda bisa mengawasinya.
  final int terkirim;
  final LaporanKirim? laporan;

  int get menunggu => item.where((i) => !i.gagal).length;
  int get gagal => item.where((i) => i.gagal).length;

  StatusAntrean salin({List<ItemAntrean>? item, int? milikAkunLain, String? sedangDikirim, bool selesaiKirim = false, int? terkirim, LaporanKirim? laporan}) =>
      StatusAntrean(
        item: item ?? this.item,
        milikAkunLain: milikAkunLain ?? this.milikAkunLain,
        sedangDikirim: selesaiKirim ? null : (sedangDikirim ?? this.sedangDikirim),
        terkirim: terkirim ?? this.terkirim,
        laporan: laporan ?? this.laporan,
      );
}

/// Mengirim antrean ke server, berurutan, selama aplikasi terbuka.
///
/// Dipicu saat aplikasi dibuka atau kembali ke depan, saat sambungan pulih,
/// setelah kiriman baru ditambahkan, dan oleh jeda percobaan ulang.
///
/// Jawaban server menentukan nasib kiriman:
/// - berhasil → dihapus dari antrean;
/// - tak terjangkau, 5xx, 408/429, sesi habis, atau "masih diproses" →
///   tetap menunggu; putaran berhenti di situ (urutan dijaga) dan dicoba
///   lagi dengan jeda makin panjang;
/// - ditolak (4xx lain) → gagal, perlu tindakan pengguna; kiriman berikutnya
///   tetap jalan, kecuali yang bergantung padanya.
class MesinAntrean extends Notifier<StatusAntrean> {
  static const jedaUlang = [Duration(seconds: 5), Duration(seconds: 15), Duration(seconds: 30), Duration(minutes: 1), Duration(minutes: 2), Duration(minutes: 5)];

  late PenyimpananAntrean _simpanan;
  Future<void>? _putaran;
  bool _ulangi = false;
  bool _dibuang = false;
  Timer? _timer;

  /// Jeda percobaan ulang per kiriman. Sengaja hanya di memori: begitu
  /// sambungan pulih atau aplikasi dibuka lagi, semuanya langsung dicoba.
  final _tundaSampai = <String, DateTime>{};

  @override
  StatusAntrean build() {
    _simpanan = ref.watch(penyimpananAntreanProvider);
    ref.listen(sambunganProvider, (_, _) {
      _tundaSampai.clear();
      proses();
    });
    ref.listen(penggunaProvider.select((p) => p?.id), (_, _) => proses());
    final siklus = AppLifecycleListener(onResume: () {
      _tundaSampai.clear();
      proses();
    });
    ref.onDispose(() {
      _dibuang = true;
      _timer?.cancel();
      siklus.dispose();
    });
    Future.microtask(proses);
    return const StatusAntrean();
  }

  /// Menambahkan kiriman lalu langsung mencoba mengirimnya.
  ///
  /// [id] diisi bila kiriman ini sudah pernah dicoba langsung dengan kunci
  /// itu: kalau ternyata sudah sampai ke server, kiriman ulangnya menerima
  /// jawaban yang sama, bukan tercatat dua kali.
  Future<ItemAntrean> tambah({
    required String jenis,
    required String judul,
    required String metode,
    required String jalur,
    required Map<String, dynamic> badan,
    String? bergantungPada,
    String? id,
    Map<String, dynamic> info = const {},
  }) async {
    final pemilik = ref.read(penggunaProvider)?.id;
    if (pemilik == null) throw StateError('Antrean hanya untuk pengguna yang sudah masuk');
    final item = ItemAntrean(
      id: id ?? idAntreanBaru(),
      jenis: jenis,
      judul: judul,
      metode: metode,
      jalur: jalur,
      badan: badan,
      pemilik: pemilik,
      dibuat: DateTime.now(),
      bergantungPada: bergantungPada,
      info: info,
    );
    await _simpanan.simpan(item);
    await _muat();
    unawaited(proses());
    return item;
  }

  /// Membuang kiriman (menunggu maupun gagal); tidak akan dikirim.
  Future<void> hapus(String id) async {
    await _simpanan.hapus(id);
    _tundaSampai.remove(id);
    await _muat();
  }

  /// Kiriman yang ditolak dicoba lagi, mis. setelah HR membetulkan datanya.
  Future<void> cobaLagi(String id) async {
    final item = state.item.where((i) => i.id == id).firstOrNull;
    if (item == null) return;
    await _simpanan.simpan(item.salin(status: StatusKiriman.menunggu, percobaan: 0, hapusGalat: true));
    _tundaSampai.remove(id);
    await _muat();
    await proses();
  }

  /// Kirim sekarang, tanpa menunggu jeda percobaan ulang.
  Future<void> kirimSekarang() {
    _tundaSampai.clear();
    return proses();
  }

  /// Pemanggil yang datang saat putaran berjalan menunggu putaran itu —
  /// yang diulang sekali lagi supaya kiriman barunya ikut terkirim. Hasilnya
  /// dilaporkan sekali di akhir, bukan per ulangan.
  Future<void> proses() {
    if (_putaran != null) {
      _ulangi = true;
      return _putaran!;
    }
    return _putaran = () async {
      final terkirim = <ItemAntrean>[];
      final gagal = <ItemAntrean>[];
      try {
        do {
          _ulangi = false;
          await _satuPutaran(terkirim, gagal);
        } while (_ulangi && !_dibuang);
      } finally {
        _putaran = null;
        if (!_dibuang && (terkirim.isNotEmpty || gagal.isNotEmpty)) {
          state = state.salin(laporan: LaporanKirim((state.laporan?.nomor ?? 0) + 1, terkirim: terkirim, gagal: gagal));
        }
      }
    }();
  }

  Future<void> _muat([String? pemilik]) async {
    pemilik ??= ref.read(penggunaProvider)?.id;
    final List<ItemAntrean> semua;
    try {
      semua = await _simpanan.semua();
    } catch (e) {
      // Folder aplikasi tak terbaca: layar tetap jalan dengan antrean terakhir.
      debugPrint('Antrean tidak bisa dibaca: $e');
      return;
    }
    if (_dibuang) return;
    state = state.salin(
      item: semua.where((i) => i.pemilik == pemilik).toList(),
      milikAkunLain: semua.where((i) => i.pemilik != pemilik).length,
    );
  }

  Future<void> _satuPutaran(List<ItemAntrean> terkirim, List<ItemAntrean> gagal) async {
    // Pemilik dibaca sekali lalu dipegang: daftar yang dimuat dan yang
    // dikirim harus milik akun yang sama walau akun berganti di tengah jalan.
    final pemilik = ref.read(penggunaProvider)?.id;
    await _muat(pemilik);
    if (pemilik == null || _dibuang || !ref.read(statusJaringanProvider).terhubung) return;

    final daftar = state.item.where((i) => i.pemilik == pemilik).toList();
    final idGagal = daftar.where((i) => i.gagal).map((i) => i.id).toSet();

    for (final item in daftar) {
      // Keluar atau berganti akun: sisanya menunggu pemiliknya masuk lagi.
      if (_dibuang || ref.read(penggunaProvider)?.id != pemilik) break;
      if (item.gagal) continue;
      if (item.bergantungPada != null && idGagal.contains(item.bergantungPada)) {
        final induk = daftar.where((i) => i.id == item.bergantungPada).firstOrNull;
        final ditolak = item.salin(status: StatusKiriman.gagal, galat: 'Tidak dikirim karena "${induk?.judul ?? 'kiriman sebelumnya'}" ditolak.');
        await _simpanan.simpan(ditolak);
        gagal.add(ditolak);
        idGagal.add(item.id);
        continue;
      }
      final tunda = _tundaSampai[item.id];
      if (tunda != null && tunda.isAfter(DateTime.now())) {
        _jadwalkan(tunda);
        break;
      }

      if (!_dibuang) state = state.salin(sedangDikirim: item.id);
      try {
        await ref.read(klienApiProvider).kirimAntrean(
              item.metode,
              item.jalur,
              item.badan,
              kunci: item.id,
              // Kiriman berfoto (presensi wajah) butuh waktu unggah lebih lama.
              batasWaktu: jsonEncode(item.badan).length > 50000 ? batasWaktuUnggah : null,
            );
        await _simpanan.hapus(item.id);
        _tundaSampai.remove(item.id);
        terkirim.add(item);
        // Langsung, bukan di akhir putaran: data yang bergantung pada kiriman
        // ini (mis. riwayat presensi) dimuat ulang dari server sekarang juga.
        if (!_dibuang) state = state.salin(terkirim: state.terkirim + 1);
      } on GalatApi catch (g) {
        if (_sementara(g)) {
          final percobaan = item.percobaan + 1;
          await _simpanan.simpan(item.salin(percobaan: percobaan, galat: g.pesan));
          final jeda = jedaUlang[min(percobaan, jedaUlang.length) - 1];
          _tundaSampai[item.id] = DateTime.now().add(jeda);
          _jadwalkan(_tundaSampai[item.id]!);
          break;
        }
        final ditolak = item.salin(status: StatusKiriman.gagal, galat: g.pesanLengkap);
        await _simpanan.simpan(ditolak);
        gagal.add(ditolak);
        idGagal.add(item.id);
      } catch (e) {
        // Bukan jawaban server (bug klien): jangan buang kirimannya.
        debugPrint('Kiriman ${item.id} gagal diproses: $e');
        _tundaSampai[item.id] = DateTime.now().add(jedaUlang.last);
        _jadwalkan(_tundaSampai[item.id]!);
        break;
      } finally {
        if (!_dibuang) state = state.salin(selesaiKirim: true);
      }
    }

    await _muat();
  }

  static bool _sementara(GalatApi g) =>
      g.serverTakTerjangkau ||
      g.kodeHttp == 401 ||
      g.kodeHttp == 408 ||
      g.kodeHttp == 429 ||
      (g.kodeHttp == 409 && g.kode == 'idempotency_in_progress');

  void _jadwalkan(DateTime kapan) {
    _timer?.cancel();
    _timer = Timer(kapan.difference(DateTime.now()) + const Duration(milliseconds: 50), proses);
  }
}

final antreanProvider = NotifierProvider<MesinAntrean, StatusAntrean>(MesinAntrean.new);
