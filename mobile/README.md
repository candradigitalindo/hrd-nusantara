# HRD Nusantara — Aplikasi Mobile (Flutter)

Aplikasi karyawan untuk Android dan iOS: presensi (GPS, wajah, QR), cuti,
slip gaji, kinerja & KPI (penilaian diri, hasil, umpan balik), pelatihan
(daftar sesi, riwayat), keluhan & disiplin, jadwal shift, pengumuman, survei,
chat tim, pemeriksaan tautan WhatsApp (pemindaian QR dilakukan di web), dan
notifikasi push. Memakai API backend yang sama dengan web; menu dan bagian
beranda mengikuti izin `<halaman>.lihat` peran pengguna, sama dengan sidebar web.

## Menjalankan

```bash
cd mobile
flutter pub get

# Backend produksi (bawaan, tanpa --dart-define): https://hrd.nbp.co.id/api
flutter run

# Emulator Android dengan backend di mesin ini, port 3000
flutter run --dart-define=API_URL=http://10.0.2.2:3000/api

# Simulator iOS
flutter run --dart-define=API_URL=http://localhost:3000/api

# Ponsel sungguhan di Wi-Fi yang sama (ganti dengan IP komputer Anda)
flutter run --dart-define=API_URL=http://192.168.0.100:3000/api
```

Tanpa `--dart-define`, alamat bawaan adalah backend produksi `https://hrd.nbp.co.id/api`.

HTTP polos hanya diizinkan untuk `10.0.2.2`, `localhost`, dan `192.168.0.100`
(lihat `android/app/src/main/res/xml/network_security_config.xml`). Produksi
wajib HTTPS; hapus `domain-config` itu sebelum rilis.

## Struktur

```
lib/
  core/            konfigurasi, klien API (dio + token), penyimpanan aman, format, tema, widget umum
  fitur/
    auth/          login, sesi (Riverpod Notifier), model pengguna
    beranda/       beranda karyawan (shift & presensi hari ini, perlu tindakan, ringkasan kehadiran, jadwal, cuti & gaji, kinerja, pelatihan, akses cepat, pengumuman) + cangkang navigasi bawah
    kinerja/       nilai KPI terakhir, penilaian yang harus diisi (per kriteria, perkiraan nilai), rincian hasil + diskusi + konfirmasi, umpan balik
    pelatihan/     sesi terjadwal (daftar / daftar tunggu / batalkan), riwayat & hasil evaluasi
    kasus/         ajukan keluhan (hanya HR yang membaca), tindakan disiplin yang ditujukan ke pengguna
    presensi/      check-in/out GPS · wajah (kamera depan) · QR, riwayat
    cuti/          saldo, riwayat, ajukan, batalkan
    gaji/          daftar slip, rincian
    jadwal/        shift 3 minggu
    pengumuman/    daftar, baca, konfirmasi
    survei/        daftar, isi (skala / pilihan / teks)
    chat/          ruang, pesan (penyegaran 5 detik), hapus
    whatsapp/      status tautan (hanya memeriksa; QR dipindai lewat web), riwayat sesi
    profil/        data diri, ganti password, keluar
    notifikasi/    FCM + notifikasi lokal, rute saat diketuk
  router.dart      go_router: redirect berdasarkan sesi
  firebase_options.dart   PENGGANTI SEMENTARA — lihat "Push"
```

Login memakai **nomor HP/WhatsApp** yang terdaftar di HR (08xx, +62xx, atau
62xx); email tetap diterima untuk akun lama.

Alur data: layar → provider Riverpod → repo → `KlienApi` (dio). Token JWT
disimpan di Keychain/Keystore; 401 dari server otomatis mengeluarkan sesi.

## Foto absensi ke grup WhatsApp

Bila karyawan sudah memilih grup tujuan (di web, halaman WhatsApp Saya),
setiap check-in/out mengirim foto ber-stempel dari WhatsApp-nya sendiri.
Untuk metode wajah dipakai selfie verifikasi; untuk GPS/QR aplikasi
meminta selfie tambahan (`photo`). Pengiriman dilakukan server di latar;
beranda mengingatkan bila grup belum dipilih.

## Deteksi fake GPS

Sebelum check-in/out berbasis GPS atau wajah, aplikasi mengumpulkan sinyal
keaslian lokasi (`lib/fitur/presensi/integritas_lokasi.dart` + kode native
`MainActivity.kt` / `AppDelegate.swift`):

| Sinyal | Android | iOS | Akibat |
|---|---|---|---|
| Posisi ditandai mock oleh OS | `isMocked` | `isSimulatedBySoftware` (iOS 15+) | blokir |
| Aplikasi lokasi palsu terpasang | izin `ACCESS_MOCK_LOCATION` + daftar paket dikenal (`<queries>`) | — | blokir |
| Root / jailbreak | berkas su, Magisk, test-keys | Cydia, Sileo, tulis di luar sandbox | blokir |
| Emulator / simulator | Build.* | targetEnvironment | ditandai |
| Opsi pengembang aktif | Settings.Global | — | ditandai |
| GPS jauh (>1,5 km) dari lokasi jaringan seluler | NETWORK_PROVIDER | — | ditandai |
| Posisi GPS basi (>2 menit) | timestamp | timestamp | ditandai |
| Perpindahan mustahil (>250 km/jam) antar presensi | dihitung **server** | dihitung **server** | ditandai |

Yang memblokir ditolak di ponsel (dialog menjelaskan apa yang terdeteksi)
dan ditolak lagi di server (422). Laporan lengkap ikut dikirim di field
`integrity`; server menyimpan penanda di `integrityFlags` dan HR melihatnya
di halaman Presensi web sebagai "Dicurigai".

## Izin (permission)

Izin yang benar-benar masuk ke APK (hasil merge manifest) dan gunanya:

| Izin | Dipakai untuk | Diminta saat |
|---|---|---|
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | radius lokasi kerja saat presensi; pembanding lokasi jaringan untuk deteksi fake GPS | check-in/out pertama |
| `CAMERA` | selfie verifikasi wajah, pindai QR, foto stempel ke grup WhatsApp | kamera dibuka pertama kali |
| `POST_NOTIFICATIONS` (Android 13+) | push: presensi, cuti, sesi WhatsApp putus | setelah login (bila Firebase aktif) |
| `QUERY_ALL_PACKAGES` | mendeteksi aplikasi lokasi palsu yang terpasang (distribusi APK internal; bila ke Play Store harus dibenarkan atau dihapus) | tidak ada dialog |
| `INTERNET`, `ACCESS_NETWORK_STATE`, `VIBRATE`, `WAKE_LOCK`, `c2dm.RECEIVE` | jaringan dan notifikasi (ditambahkan plugin) | tidak ada dialog |

Tidak dipakai dan sengaja dicabut: `RECORD_AUDIO` (plugin kamera menyertakannya,
aplikasi tidak pernah merekam suara). Tidak ada izin lokasi latar belakang,
penyimpanan, atau kontak.

Perilaku bila izin kurang: lokasi hanya "perkiraan" (Android 12+/iOS 14+)
ditolak dengan petunjuk mengaktifkan lokasi akurat; izin ditolak permanen
atau kamera ditolak menampilkan tombol ke pengaturan aplikasi.

iOS: `NSCameraUsageDescription`, `NSLocationWhenInUseUsageDescription`,
`UIBackgroundModes: remote-notification`. Capability Push Notifications
(entitlement `aps-environment`) diaktifkan lewat Xcode saat Firebase dipasang.

## Push (Firebase Cloud Messaging)

Build ini berjalan penuh tanpa Firebase; push saja yang belum aktif.
Untuk mengaktifkan:

```bash
dart pub global activate flutterfire_cli
flutterfire configure --project=hrd-app-635cb   # pilih android, ios
```

Lalu di `lib/firebase_options.dart` yang dihasilkan, pastikan ada:

```dart
const bool firebaseTerkonfigurasi = true;
FirebaseOptions? opsiFirebase() => DefaultFirebaseOptions.currentPlatform;
```

Untuk iOS tambahkan kunci APNs di konsol Firebase dan aktifkan capability
Push Notifications + Background Modes (remote notifications) di Xcode.

Setelah login aplikasi mendaftarkan token ke `POST /devices`; saat keluar
token dilepas lewat `DELETE /devices`. Ketukan notifikasi membuka layar
sesuai `data.jenis` dari backend (`whatsapp_session` → WhatsApp, dst.).

## Tes

```bash
flutter analyze
flutter test
```

Tes mencakup pemformat, pemetaan galat API, haversine & pemilihan lokasi
terdekat, model dari JSON server, rute push, validasi layar login, serta tes
tampilan ukuran ponsel (390 dp) untuk beranda, kinerja, pelatihan, dan keluhan
dengan data contoh (`test/data_uji.dart`) — layout yang meluap (overflow)
langsung menggagalkan tes.

Tes tampilan bisa sekalian memotret layarnya dengan font asli (Roboto dari
SDK), berguna untuk memeriksa tampilan tanpa emulator:

```bash
flutter test --dart-define=POTRET_DIR=/tmp/potret   # menulis beranda.png, kinerja.png, …
```

Tanpa SDK Flutter lokal, semuanya bisa dijalankan lewat Docker:

```bash
docker run --rm -v "$PWD:/work" -w /work -v "$PWD/../potret:/potret" \
  ghcr.io/cirruslabs/flutter:latest sh -c \
  "flutter pub get && flutter analyze && flutter test --dart-define=POTRET_DIR=/potret"
```

## Build rilis dan distribusi

```bash
./rilis.sh                 # APK arm64 (ponsel 64-bit) — dipakai untuk rilis biasa
./rilis.sh --semua-abi     # satu APK semua ABI (±3x lebih besar) bila ada ponsel 32-bit
./rilis.sh --unggah        # bangun lalu langsung unggah (minta login HR)
```

Setiap build mendapat **versi unik ber-stempel waktu**: versionName
`<versi pubspec>+<YYYYMMDDHHMM>` (WIB) dan versionCode = menit sejak epoch
(selalu naik). Android menganggap dua APK dengan versionCode sama sebagai
aplikasi yang sama, sehingga build ulang tanpa menaikkan nomor tidak akan
terpasang di atas yang lama; dengan skrip ini setiap build selalu lebih baru
dari sebelumnya. Versi dasar (mis. `0.2.0`) tetap diubah di `pubspec.yaml`
saat ada fitur besar. Versi terpasang tampil di layar Profil.

Skrip menaruh hasilnya di `build/rilis/hrd-nusantara-<versi>-<abi>.apk`
beserta SHA-256, dan mencetak nama versi + versionCode untuk diisi di menu
**Aplikasi Mobile** web bila mengunggah manual. Tanpa Flutter di PATH, skrip
otomatis berjalan di image Docker `ghcr.io/cirruslabs/flutter`.

Karyawan mengunduh versi terbaru dari halaman publik `<web>/unduh` tanpa
login; HR bisa memajang QR tautannya di outlet. Setiap rilis menyimpan
sha256 dan jumlah unduhan; versi bermasalah bisa dinonaktifkan.

Build iOS: `flutter build ipa --release --build-name=… --build-number=… --dart-define=API_URL=https://hrd.nbp.co.id/api`.

Catatan: `flutter build ios --no-codesign` berhasil di mesin pengembang
(Xcode 27, target iOS 15); simulator iOS belum terpasang, jadi uji jalan di
iOS perlu perangkat sungguhan atau memasang runtime simulator lewat Xcode.
