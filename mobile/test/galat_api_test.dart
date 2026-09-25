import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/core/api/galat_api.dart';

DioException _respons(int kode, Object? data) => DioException(
      requestOptions: RequestOptions(path: '/uji'),
      response: Response(requestOptions: RequestOptions(path: '/uji'), statusCode: kode, data: data),
      type: DioExceptionType.badResponse,
    );

void main() {
  test('pesan error backend diteruskan apa adanya', () {
    final g = GalatApi.dari(_respons(409, {'error': 'Sudah check-in hari ini'}));
    expect(g.pesan, 'Sudah check-in hari ini');
    expect(g.kodeHttp, 409);
    expect(g.konflik, isTrue);
    expect(g.pesanLengkap, 'Sudah check-in hari ini');
  });

  test('rincian validasi zod ikut ditampilkan per field', () {
    final g = GalatApi.dari(_respons(400, {
      'error': 'Validasi gagal',
      'details': [
        {'field': 'latitude', 'message': 'Metode "gps" membutuhkan latitude dan longitude'},
        {'field': '', 'message': 'Ada yang salah'},
      ],
    }));
    expect(g.rincian, ['latitude: Metode "gps" membutuhkan latitude dan longitude', 'Ada yang salah']);
    expect(g.pesanLengkap, contains('• latitude:'));
  });

  test('tanpa koneksi memberi pesan jaringan, bukan kode', () {
    final g = GalatApi.dari(DioException(requestOptions: RequestOptions(path: '/uji'), type: DioExceptionType.connectionError));
    expect(g.jaringan, isTrue);
    expect(g.pesan, contains('koneksi internet'));
  });

  test('badan bukan JSON tetap menghasilkan pesan yang bisa dibaca', () {
    expect(GalatApi.dari(_respons(500, '<html>Internal Server Error</html>')).pesan, 'Terjadi kesalahan (500)');

    // 502–504 dari proxy: backend mati; layar boleh memakai data tersimpan.
    final g = GalatApi.dari(_respons(502, '<html>Bad Gateway</html>'));
    expect(g.pesan, 'Server sedang tidak bisa dihubungi. Coba lagi sebentar lagi.');
    expect(g.serverTakTerjangkau, isTrue);
    expect(GalatApi.dari(_respons(500, {'error': 'x'})).serverTakTerjangkau, isFalse);
  });

  test('401 dikenali sebagai sesi habis', () {
    expect(GalatApi.dari(_respons(401, {'error': 'Token tidak sah'})).tidakTerautentikasi, isTrue);
  });
}
