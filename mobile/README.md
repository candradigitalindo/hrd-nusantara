# HRD Nusantara — Aplikasi Mobile (Flutter)

Aplikasi karyawan untuk Android dan iOS: presensi (GPS, wajah, QR), cuti,
slip gaji, jadwal shift, pengumuman, survei, chat tim, pemeriksaan tautan
WhatsApp (pemindaian QR dilakukan di web), dan notifikasi push. Memakai API backend yang sama dengan web.

## Menjalankan

```bash
cd mobile
flutter pub get

# Emulator Android (backend di mesin ini, port 3000)
flutter run --dart-define=API_URL=http://10.0.2.2:3000/api

# Simulator iOS
flutter run --dart-define=API_URL=http://localhost:3000/api

# Ponsel sungguhan di Wi-Fi yang sama (ganti dengan IP komputer Anda)
flutter run --dart-define=API_URL=http://192.168.0.100:3000/api
```

Tanpa `--dart-define`, alamat bawaan adalah `http://10.0.2.2:3000/api`.

HTTP polos hanya diizinkan untuk `10.0.2.2`, `localhost`, dan `192.168.0.100`
(lihat `android/app/src/main/res/xml/network_security_config.xml`). Produksi
wajib HTTPS; hapus `domain-config` itu sebelum rilis.

## Struktur

```
lib/
  core/            konfigurasi, klien API (dio + token), penyimpanan aman, format, tema, widget umum
  fitur/
    auth/          login, sesi (Riverpod Notifier), model pengguna
    beranda/       beranda + cangkang navigasi bawah
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
terdekat, model dari JSON server, rute push, dan validasi layar login.

## Build rilis

```bash
flutter build apk --release --dart-define=API_URL=https://api.domain-anda.id/api
flutter build ipa --release --dart-define=API_URL=https://api.domain-anda.id/api
```

Catatan: `flutter build ios --no-codesign` berhasil di mesin pengembang
(Xcode 27, target iOS 15); simulator iOS belum terpasang, jadi uji jalan di
iOS perlu perangkat sungguhan atau memasang runtime simulator lewat Xcode.
