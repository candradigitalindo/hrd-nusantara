/// Konfigurasi bawaan aplikasi: backend produksi (HTTPS). Nilai bisa
/// ditimpa saat pengembangan:
///   flutter run --dart-define=API_URL=http://10.0.2.2:3000/api   (emulator Android)
///   flutter run --dart-define=API_URL=http://localhost:3000/api  (simulator iOS)
///   flutter run --dart-define=API_URL=http://192.168.0.100:3000/api (ponsel di LAN)
///
/// 10.0.2.2 adalah alamat mesin pengembang dilihat dari emulator Android.
/// HTTP polos hanya diizinkan untuk alamat pengembangan tersebut
/// (android/app/src/main/res/xml/network_security_config.xml).
const String apiUrl = String.fromEnvironment(
  'API_URL',
  defaultValue: 'https://hrd.nbp.co.id/api',
);

/// Batas waktu permintaan HTTP. Presensi wajah mengunggah foto, jadi lebih
/// longgar daripada permintaan biasa.
const Duration batasWaktuHttp = Duration(seconds: 20);
const Duration batasWaktuUnggah = Duration(seconds: 60);

const String namaAplikasi = 'HRD Nusantara';
