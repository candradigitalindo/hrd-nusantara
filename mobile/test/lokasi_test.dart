import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/fitur/presensi/layanan_lokasi.dart';
import 'package:hrd_nusantara/fitur/presensi/model_presensi.dart';

const monas = LokasiKerja(id: 'a', nama: 'Kantor Pusat', latitude: -6.1753924, longitude: 106.8271528, radiusMeter: 100);
const bundaranHi = LokasiKerja(id: 'b', nama: 'Outlet HI', latitude: -6.1950, longitude: 106.8230, radiusMeter: 50);

void main() {
  test('jarak haversine mendekati jarak sebenarnya', () {
    // Monas ke Bundaran HI ≈ 2,2 km.
    final d = jarakMeter(monas.latitude, monas.longitude, bundaranHi.latitude, bundaranHi.longitude);
    expect(d, closeTo(2230, 120));
    expect(jarakMeter(-6.2, 106.8, -6.2, 106.8), 0);
  });

  test('memilih lokasi terdekat dan menilai radius', () {
    // 30 m di utara Monas.
    final dekat = lokasiTerdekat([bundaranHi, monas], monas.latitude + 0.00027, monas.longitude)!;
    expect(dekat.lokasi.id, 'a');
    expect(dekat.jarak, closeTo(30, 3));
    expect(dekat.diDalamRadius, isTrue);

    // 300 m dari Monas: terdekat tetap Monas, tapi di luar radius 100 m.
    final jauh = lokasiTerdekat([bundaranHi, monas], monas.latitude + 0.0027, monas.longitude)!;
    expect(jauh.lokasi.id, 'a');
    expect(jauh.diDalamRadius, isFalse);
  });

  test('daftar kosong menghasilkan null, bukan galat', () {
    expect(lokasiTerdekat([], 0, 0), isNull);
  });

  test('permintaan absen hanya mengirim field yang relevan', () {
    final gps = PermintaanAbsen(metode: MetodeAbsen.gps, latitude: -6.1, longitude: 106.8, lokasiId: 'a', catatan: '');
    expect(gps.keJson(), {'method': 'gps', 'latitude': -6.1, 'longitude': 106.8, 'workLocationId': 'a'});
    // Check-out: lokasi diambil dari record yang terbuka, jadi tidak dikirim ulang.
    expect(gps.keJson(sertakanLokasiId: false).containsKey('workLocationId'), isFalse);
    final qr = PermintaanAbsen(metode: MetodeAbsen.qr, qrToken: 'tok', catatan: 'ganti shift');
    expect(qr.keJson(), {'method': 'qr', 'qrToken': 'tok', 'notes': 'ganti shift'});
    // Foto stempel untuk grup WhatsApp dikirim sebagai 'photo', terpisah dari faceImage.
    final stempel = PermintaanAbsen(metode: MetodeAbsen.gps, latitude: -6.1, longitude: 106.8, lokasiId: 'a', fotoStempelBase64: 'data:image/jpeg;base64,AAAA');
    expect(stempel.keJson()['photo'], 'data:image/jpeg;base64,AAAA');
    expect(stempel.keJson().containsKey('faceImage'), isFalse);
  });
}
