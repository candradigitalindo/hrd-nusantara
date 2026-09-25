import 'package:dio/dio.dart';

/// Galat dari backend dalam bahasa yang bisa langsung ditampilkan ke pengguna.
///
/// Backend selalu membalas `{ error: "..." }`, dan untuk validasi menambah
/// `details: [{ field, message }]`. Kelas ini merapikan keduanya jadi satu
/// kalimat, supaya layar tidak perlu tahu bentuk JSON-nya.
class GalatApi implements Exception {
  GalatApi(this.pesan, {this.kodeHttp, this.rincian = const [], this.kode});

  final String pesan;
  final int? kodeHttp;
  final List<String> rincian;

  /// Kode galat untuk mesin (`code` di jawaban server), mis.
  /// `idempotency_in_progress`.
  final String? kode;

  bool get tidakTerautentikasi => kodeHttp == 401;
  bool get tidakBerhak => kodeHttp == 403;
  bool get tidakDitemukan => kodeHttp == 404;
  bool get konflik => kodeHttp == 409;
  bool get jaringan => kodeHttp == null;

  /// Tidak ada jaringan, atau proxy menjawab bahwa backend sedang mati.
  /// Saat ini layar boleh memakai data tersimpan.
  bool get serverTakTerjangkau => jaringan || kodeHttp == 502 || kodeHttp == 503 || kodeHttp == 504;

  /// Pesan utama plus rincian validasi bila ada.
  String get pesanLengkap =>
      rincian.isEmpty ? pesan : '$pesan\n${rincian.map((r) => '• $r').join('\n')}';

  factory GalatApi.dari(Object e) {
    if (e is GalatApi) return e;
    if (e is DioException) {
      final res = e.response;
      if (res == null) {
        return GalatApi(
          switch (e.type) {
            DioExceptionType.connectionTimeout ||
            DioExceptionType.receiveTimeout ||
            DioExceptionType.sendTimeout =>
              'Server tidak merespons. Periksa koneksi internet Anda.',
            DioExceptionType.connectionError =>
              'Tidak bisa terhubung ke server. Periksa koneksi internet Anda.',
            _ => 'Permintaan gagal. Coba lagi.',
          },
        );
      }
      final data = res.data;
      String pesan = switch (res.statusCode) {
        502 || 503 || 504 => 'Server sedang tidak bisa dihubungi. Coba lagi sebentar lagi.',
        _ => 'Terjadi kesalahan (${res.statusCode})',
      };
      final rincian = <String>[];
      String? kode;
      if (data is Map) {
        if (data['code'] is String) kode = data['code'] as String;
        final err = data['error'];
        if (err is String && err.isNotEmpty) pesan = err;
        final details = data['details'];
        if (details is List) {
          for (final d in details) {
            if (d is Map && d['message'] is String) {
              final field = d['field'];
              rincian.add(field is String && field.isNotEmpty ? '$field: ${d['message']}' : d['message'] as String);
            }
          }
        }
      }
      return GalatApi(pesan, kodeHttp: res.statusCode, rincian: rincian, kode: kode);
    }
    return GalatApi('Terjadi kesalahan tak terduga.');
  }

  @override
  String toString() => 'GalatApi($kodeHttp): $pesan';
}
