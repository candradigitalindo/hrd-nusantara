import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/core/penyimpanan/penyimpanan_sesi.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('persetujuan absensi lama tidak otomatis menjadi persetujuan lokasi di latar', () async {
    const lama = '2026-10-01T01:00:00.000Z';
    FlutterSecureStorage.setMockInitialValues({'hrd_setuju_pantau_K1': lama});
    const storage = FlutterSecureStorage();
    final simpanan = PenyimpananSesi(storage);

    expect(await simpanan.bacaSetujuPantau('K1'), isFalse);
    await simpanan.simpanSetujuPantau('K1', true);
    expect(await simpanan.bacaSetujuPantau('K1'), isTrue);
    expect(await storage.read(key: 'hrd_setuju_pantau_K1'), lama, reason: 'rekaman lama tetap disimpan');
  });

  test('persetujuan lokasi di latar berlaku per akun dan bertahan setelah keluar', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final simpanan = PenyimpananSesi();

    await simpanan.simpanSetujuPantau('K1', true);
    expect(await simpanan.bacaSetujuPantau('K1'), isTrue);
    expect(await simpanan.bacaSetujuPantau('K2'), isFalse);
    await simpanan.hapusSemua();
    expect(await simpanan.bacaSetujuPantau('K1'), isTrue);
    expect(await simpanan.bacaSetujuPantau('K2'), isFalse);

    await simpanan.simpanSetujuPantau('K2', true);
    await simpanan.simpanSetujuPantau('K1', false);
    expect(await simpanan.bacaSetujuPantau('K1'), isFalse);
    expect(await simpanan.bacaSetujuPantau('K2'), isTrue);
  });

  test('pengingat penyiapan lama tidak menunda penyiapan pengungkapan baru dan penundaan baru tetap per akun', () async {
    final waktuLama = DateTime.utc(2026, 10, 13, 1);
    FlutterSecureStorage.setMockInitialValues({'hrd_penyiapan_pantau_K1': waktuLama.toIso8601String()});
    const storage = FlutterSecureStorage();
    final simpanan = PenyimpananSesi(storage);

    expect(await simpanan.bacaPenyiapanTerakhir('K1'), isNull);
    await simpanan.simpanSetujuPantau('K1', true);
    expect(await simpanan.bacaPenyiapanTerakhir('K1'), isNull, reason: 'menyetujui pengungkapan belum berarti penyiapan sudah diperlihatkan');

    final waktuBaru = waktuLama.add(const Duration(hours: 1));
    await simpanan.simpanPenyiapanTerakhir('K1', waktuBaru);
    await simpanan.hapusSemua();
    expect(await simpanan.bacaPenyiapanTerakhir('K1'), waktuBaru);
    expect(await simpanan.bacaPenyiapanTerakhir('K2'), isNull);
    expect(await storage.read(key: 'hrd_penyiapan_pantau_K1'), waktuLama.toIso8601String(), reason: 'migrasi tidak menghapus rekaman sebelumnya');
  });
}
