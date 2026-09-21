import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/klien_api.dart';
import '../../core/format.dart';

/// Pendaftaran pelatihan milik pengguna, dengan ringkasan sesinya.
class PendaftaranPelatihan {
  const PendaftaranPelatihan({
    required this.id,
    required this.status,
    required this.judul,
    required this.mulai,
    this.selesai,
    this.lokasi,
    this.pelatih,
    this.program,
  });

  final String id;
  final String status; // registered, waitlisted, cancelled, ...
  final String judul;
  final DateTime? mulai;
  final DateTime? selesai;
  final String? lokasi;
  final String? pelatih;
  final String? program;

  bool get mendatang =>
      mulai != null && mulai!.isAfter(DateTime.now()) && status != 'cancelled';

  factory PendaftaranPelatihan.dariJson(Map<String, dynamic> j) {
    final sesi = (j['trainingSession'] as Map?) ?? const {};
    return PendaftaranPelatihan(
      id: j['id'] as String,
      status: (j['status'] ?? 'registered') as String,
      judul: (sesi['title'] ?? '-') as String,
      mulai: parseTanggal(sesi['startDateTime']),
      selesai: parseTanggal(sesi['endDateTime']),
      lokasi: sesi['location'] as String?,
      pelatih: sesi['trainer'] as String?,
      program: (sesi['program'] as Map?)?['name'] as String?,
    );
  }
}

class RepoPelatihan {
  RepoPelatihan(this._api);
  final KlienApi _api;

  Future<List<PendaftaranPelatihan>> pendaftaranSaya() async =>
      (await _api.getDaftar(
        '/training/registrations',
        query: {'limit': 50},
      )).map(PendaftaranPelatihan.dariJson).toList();
}

final repoPelatihanProvider = Provider<RepoPelatihan>(
  (ref) => RepoPelatihan(ref.watch(klienApiProvider)),
);

/// Sesi yang belum dimulai, terdekat lebih dulu.
final pelatihanMendatangProvider =
    FutureProvider.autoDispose<List<PendaftaranPelatihan>>((ref) async {
      final semua = await ref.watch(repoPelatihanProvider).pendaftaranSaya();
      final mendatang = semua.where((p) => p.mendatang).toList()
        ..sort((a, b) => a.mulai!.compareTo(b.mulai!));
      return mendatang;
    });
