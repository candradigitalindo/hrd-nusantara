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

Catatan: simulator iOS belum terpasang di mesin pengembang ini
(`flutter doctor`), jadi verifikasi iOS harus dilakukan di mesin lain.
