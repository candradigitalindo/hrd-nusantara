import 'dart:async';
import 'dart:math';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'klien_api.dart';

class StatusJaringan {
  const StatusJaringan({this.terhubung = true, this.dataPer, this.sambungan = 0});

  /// false sejak permintaan gagal karena tidak ada jaringan atau server tak
  /// terjangkau, sampai ada permintaan yang berhasil lagi.
  final bool terhubung;

  /// Jam pengambilan data tersimpan tertua yang tampil selama offline; null
  /// bila belum ada layar yang memakai data tersimpan.
  final DateTime? dataPer;

  /// Bertambah setiap kali sambungan pulih. Provider data mengawasinya
  /// (lewat [sambunganProvider]) supaya data tersimpan yang sedang tampil
  /// langsung diganti data segar.
  final int sambungan;
}

/// Dilapori klien API setiap permintaan berhasil atau gagal karena jaringan.
/// Selama offline dan aplikasi di depan, server diperiksa ulang berkala
/// (5 s, 10 s, 20 s, lalu tiap 30 s); di latar pemeriksaan berhenti dan
/// langsung dijalankan lagi begitu aplikasi dibuka.
class PemantauJaringan extends Notifier<StatusJaringan> {
  static const _jeda = [5, 10, 20, 30];
  Timer? _timer;
  int _percobaan = 0;

  @override
  StatusJaringan build() {
    final siklus = AppLifecycleListener(
      onHide: () => _timer?.cancel(),
      onResume: () {
        if (!state.terhubung) periksaSekarang();
      },
    );
    ref.onDispose(() {
      _timer?.cancel();
      siklus.dispose();
    });
    return const StatusJaringan();
  }

  void berhasil() {
    if (state.terhubung) return;
    _timer?.cancel();
    _percobaan = 0;
    state = StatusJaringan(sambungan: state.sambungan + 1);
  }

  void terputus() {
    if (state.terhubung) state = StatusJaringan(terhubung: false, sambungan: state.sambungan);
    _jadwalkan();
  }

  /// Sebuah layar menampilkan data tersimpan yang diambil pada [diambilPada].
  void tampilkanSimpanan(DateTime diambilPada) {
    final lama = state.dataPer;
    state = StatusJaringan(
      terhubung: false,
      dataPer: lama == null || diambilPada.isBefore(lama) ? diambilPada : lama,
      sambungan: state.sambungan,
    );
    _jadwalkan();
  }

  /// Hasil pemeriksaan dilaporkan interceptor klien API seperti permintaan lain.
  Future<void> periksaSekarang() => ref.read(klienApiProvider).cekServer();

  void _jadwalkan() {
    if (_timer?.isActive ?? false) return;
    _timer = Timer(Duration(seconds: _jeda[min(_percobaan, _jeda.length - 1)]), () async {
      _percobaan++;
      await periksaSekarang();
      if (!state.terhubung) _jadwalkan();
    });
  }
}

final statusJaringanProvider = NotifierProvider<PemantauJaringan, StatusJaringan>(PemantauJaringan.new);

/// Diawasi setiap provider data: nilainya naik saat sambungan pulih, sehingga
/// provider itu mengambil ulang dari server.
final sambunganProvider = Provider<int>((ref) => ref.watch(statusJaringanProvider.select((s) => s.sambungan)));
