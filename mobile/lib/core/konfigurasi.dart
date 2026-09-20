/// Konfigurasi bawaan aplikasi. Nilai bisa ditimpa saat build:
///   flutter run --dart-define=API_URL=http://192.168.0.100:3000/api
///
/// 10.0.2.2 adalah alamat mesin pengembang dilihat dari emulator Android.
/// Untuk simulator iOS pakai http://localhost:3000/api; untuk ponsel sungguhan
/// pakai alamat LAN komputer atau domain produksi (wajib HTTPS).
const String apiUrl = String.fromEnvironment(
  'API_URL',
  defaultValue: 'http://10.0.2.2:3000/api',
);

/// Batas waktu permintaan HTTP. Presensi wajah mengunggah foto, jadi lebih
/// longgar daripada permintaan biasa.
const Duration batasWaktuHttp = Duration(seconds: 20);
const Duration batasWaktuUnggah = Duration(seconds: 60);

const String namaAplikasi = 'HRD Nusantara';
