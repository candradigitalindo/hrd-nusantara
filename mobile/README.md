# HRD Nusantara — Aplikasi Mobile (Flutter)

Aplikasi karyawan untuk Android dan iOS: presensi (GPS, wajah, QR), cuti,
slip gaji, kinerja & KPI (penilaian diri, hasil, umpan balik), pelatihan
(daftar sesi, riwayat), keluhan & disiplin, jadwal shift, pengumuman, survei,
chat tim, pemeriksaan tautan WhatsApp (pemindaian QR dilakukan di web), dan
notifikasi push. Memakai API backend yang sama dengan web; menu dan bagian
beranda mengikuti izin `<halaman>.lihat` peran pengguna, sama dengan sidebar web.

## Ikon aplikasi

Ikon peluncur (Android `mipmap-*` + ikon adaptif, iOS `AppIcon.appiconset`)
dan favicon web berasal dari satu sumber bentuk: kalender dengan centang —
ikon Presensi. Semuanya dibuat ulang dengan:

```bash
node merek/buat-ikon.mjs   # dari akar repo
```

Hasilnya ikut di-commit, jadi build tidak memerlukan skrip ini. Warna latar
ikon adaptif ada di `android/app/src/main/res/values/colors.xml`.

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

## Mode offline

**Tahap 1 (baca):** setiap data yang pernah dibuka tetap bisa dilihat saat
internet mati. Mengirim (presensi, cuti, chat, …) masih butuh koneksi;
antrean kirim menyusul di tahap berikutnya.

- Repo memberi kunci `cache:` pada `getDaftar`/`getObjek`. Jawaban yang
  berhasil disimpan di `core/penyimpanan/cache_lokal.dart`; bila server tak
  terjangkau (tanpa jaringan, timeout, atau 502–504 dari proxy), salinan
  terakhir yang dipakai. Jawaban 4xx tidak pernah diganti salinan.
- Kunci cache harus **tetap** untuk layar yang sama walau query-nya berubah
  (rentang tanggal bergeser tiap hari). Karena itu presensi & shift "hari
  ini" disaring dari riwayat/jadwal, bukan permintaan bertanggal tersendiri
  — salinan kemarin tidak tampil sebagai data hari ini.
- Salinan dienkripsi AES-GCM; kuncinya di Keychain/Keystore. Keluar akun
  (dan masuk akun) menghapus berkas beserta kuncinya.
- `core/api/status_jaringan.dart` mencatat keadaan sambungan dan jam data
  tersimpan tertua yang tampil; `BingkaiJaringan` (MaterialApp.builder)
  menampilkan pita **Offline** di atas semua layar. Selama offline, `/health`
  diperiksa berkala (5 → 30 detik) dan saat aplikasi dibuka lagi. Begitu
  tersambung, provider data yang mengawasi `sambunganProvider` mengambil
  ulang dengan sendirinya.

**Tahap 2 (server siap menerima kiriman tertunda):**

- **Sesi perangkat.** Login mobile mengirim `device`, dan server memberi
  refresh token (`MOBILE_SESSION_DAYS`, bawaan 30 hari sejak pemakaian
  terakhir). Kalau server menjawab 401, `KlienApi` menukarnya lewat `/auth/refresh`
  (satu pertukaran bersama untuk semua permintaan) lalu mengulang
  permintaannya. Kalau pertukaran gagal karena jaringan, sesi tidak dihapus.
  Refresh token berputar; token lama yang dipakai lagi lebih dari 2 menit
  kemudian dianggap dicuri, dan sesinya dicabut. Sesi juga dicabut saat
  logout, ganti sandi (kecuali perangkat yang mengganti), reset sandi oleh
  HR, atau karyawan dinonaktifkan.
- **`Idempotency-Key`** di presensi masuk/pulang, ajukan & batalkan cuti,
  keluhan, pesan chat, jawaban survei, dan tandai-baca pengumuman. Kiriman
  ulang dengan kunci yang sama menerima jawaban pertama (header
  `Idempotent-Replayed`), tanpa data kedua.
- **Presensi `offline: { capturedAt, serverTimeEstimate?, gpsTime? }`.**
  Waktu yang dicatat adalah waktu saat presensi diambil, bukan saat tiba.
  `serverTimeEstimate` (jam server terakhir + jam monotonik perangkat)
  diutamakan daripada jam ponsel. Selisih lebih dari 5 menit ditandai
  `clock_mismatch`; tanpa pembanding ditandai `clock_unverified`. Kiriman
  yang lebih tua dari `ATTENDANCE_OFFLINE_MAX_HOURS` (72 jam) atau
  bertanggal masa depan ditolak (422). `checkInSyncedAt`/`checkOutSyncedAt`
  mencatat kapan server menerimanya.

**Tahap 3 (antrean kirim, `lib/fitur/antrean/`):**

- Fitur menambahkan kiriman lewat `antreanProvider.notifier.tambah(...)`
  (jenis, judul untuk pengguna, metode, jalur, badan, opsional
  `bergantungPada`). Tiap kiriman adalah satu berkas terenkripsi dengan
  kunci sendiri (`hrd_kunci_antrean`) yang **tidak** dibuang saat keluar.
  Kiriman hanya dikirim kalau akun yang masuk adalah pemiliknya.
- `MesinAntrean` mengirim berurutan dengan `Idempotency-Key` = id kiriman,
  selama aplikasi terbuka. Pemicunya: aplikasi dibuka atau kembali ke depan,
  sambungan pulih, kiriman baru, dan jeda percobaan ulang (5 detik → 5 menit).
  Jawaban server menentukan nasibnya:
  - berhasil → dihapus;
  - tak terjangkau, 5xx, 401, 408, 429, atau `idempotency_in_progress` →
    tetap menunggu, dan putaran berhenti supaya urutan terjaga;
  - 4xx lain → ditolak beserta alasannya. Kiriman yang bergantung padanya
    ikut ditolak tanpa dikirim.
- Tampilan: halaman **Antrean kirim** (`/antrean`: kirim sekarang, coba
  lagi, buang), jumlah di pita dan di Profil, pita merah selama ada
  kiriman ditolak, SnackBar hasil pengiriman (`PendengarAntrean`), dan
  peringatan saat keluar kalau masih ada kiriman tertunda.
- Belum ada: pengiriman saat aplikasi tertutup (WorkManager/BGTask) dan
  notifikasi sistem. Keduanya butuh plugin native yang harus diuji di ponsel
  sungguhan.

**Tahap 4 (presensi offline):**

- `PengirimPresensi` (`fitur/presensi/pengirim_presensi.dart`) selalu
  mengirim dengan `Idempotency-Key`. Kalau server tak terjangkau, atau ponsel
  sudah diketahui offline, presensi masuk antrean dengan kunci yang **sama**
  plus bukti waktu. Jadi permintaan yang sebenarnya sudah sampai (hanya
  jawabannya yang hilang) tidak tercatat dua kali. Penolakan server (di luar
  radius, wajah tak cocok) tetap ditampilkan langsung dan tidak diantrekan.
- Check-out saat check-in masih mengantre ikut masuk antrean dengan
  `bergantungPada` check-in itu. Tanpa itu, server akan menjawab "tidak ada
  presensi terbuka".
- Bukti waktu (`core/api/jam_server.dart`): setiap jawaban server (header
  `Date`) dicatat bersama jam monotonik perangkat, lewat kanal
  `id.nusantara.hrd/integritas` metode `jamMonotonik` (Android
  `elapsedRealtime` + `BOOT_COUNT`, iOS `mach_continuous_time`).
  `serverTimeEstimate` = jam tercatat + selisih monotonik. Perkiraan ditahan
  (server lalu menandai `clock_unverified`) kalau ponsel sempat dinyalakan
  ulang. Di iOS, yang tidak punya hitungan boot, perkiraan juga ditahan kalau
  jam ponsel diputar. `gpsTime` diambil dari pembacaan GPS.
- `presensiHariIniProvider` menggabungkan data server dengan antrean
  (`gabungTertunda`). Check-in yang belum terkirim tetap tampil dengan
  keterangan "belum terkirim", dan tombol Check-out muncul. Setelah
  terkirim, riwayat dimuat ulang dari server (`antrean.terkirim`).
- Lokasi kerja dimuat sejak beranda dibuka, supaya radius tetap bisa dicek
  di lokasi tanpa sinyal. Wajah dan QR diverifikasi server saat kiriman
  sampai; kalau ditolak, kirimannya muncul sebagai "Ditolak" di Antrean kirim.

**Tahap 5 (fitur lain lewat antrean):**

- Semua tulis-offline lewat `PengirimAntrean.kirim(...)`
  (`fitur/antrean/pengirim_antrean.dart`) yang mengembalikan `HasilKirim`:
  `terkirim` berisi jawaban server, `tertunda` berisi kiriman di antrean.
  Presensi pun memakai jalur ini.
- Yang bisa offline: ajukan cuti (`cuti-ajukan`), batalkan cuti
  (`cuti-batal`, PATCH), keluhan (`keluhan-ajukan`), pesan chat
  (`chat-kirim`), jawaban survei (`survei-kirim`), dan tandai
  baca/konfirmasi pengumuman (`pengumuman-baca`). Tanda baca yang sudah
  mengantre tidak diantrekan lagi; konfirmasi mencakup tanda baca.
- Tampilan tertunda:
  - `DaftarTertunda` ("Belum terkirim") di layar Cuti dan Keluhan;
  - cuti yang pembatalannya mengantre tidak bisa dibatalkan lagi;
  - pesan chat tampil di percakapan dengan tanda "menunggu", atau merah
    "ditolak";
  - survei yang jawabannya mengantre tidak bisa diisi lagi;
  - pengumuman dianggap sudah dibaca/dikonfirmasi.

  Dua yang terakhir berlaku di tingkat provider, jadi beranda ikut benar.
  Data fitur dimuat ulang setelah kiriman antrean terkirim
  (`antrean.terkirim`).
- Tetap harus online: login, ganti sandi, hapus pesan chat,
  daftar/batal pelatihan (kuota kursi), dan pengisian penilaian kinerja.

**Tahap 6 (web HR, halaman Presensi):**

- Jam masuk/pulang yang diambil offline diberi label "Offline · terkirim
  2 jam 15 mnt kemudian" (dari `checkInSyncedAt`/`checkOutSyncedAt`).
- Ada kartu ringkasan "Diambil offline" dan saringan yang sama
  (`GET /attendance?offlineOnly=true`).
- `clock_mismatch` dianggap tanda berat (merah). Server menyimpan bukti jam
  ponsel di `integrityReport.offline` / `checkOutIntegrityReport.offline`,
  lalu web menampilkan "Jam ponsel saat masuk/pulang: …" di samping jam yang
  dicatat.
- Kebijakan (terima otomatis + tanda, batas 72 jam, sesi 30 hari) masih
  diatur lewat env backend, belum dari halaman pengaturan web.

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

**Kunci rilis.** Android hanya memasang pembaruan di atas aplikasi lama bila
APK-nya ditandatangani kunci yang sama. Kunci rilis ada di
`android/key.properties` + `android/app/upload-keystore.jks` (di luar git;
repo ini publik, jadi jangan pernah di-commit). Hilang = semua karyawan harus
menghapus aplikasi lalu memasang ulang, jadi **simpan cadangan kedua berkas
itu di luar server**. `rilis.sh` menolak build tanpa kunci ini dan memeriksa
sidik sertifikat tiap APK (`SIDIK_KUNCI_RILIS`). Rilis sebelum 24 Sep 2026
bertanda tangan kunci debug acak per build, jadi peralihan ke kunci ini
butuh hapus-pasang ulang satu kali.

Karyawan mengunduh versi terbaru dari halaman publik `<web>/unduh` tanpa
login; HR bisa memajang QR tautannya di outlet. Setiap rilis menyimpan
sha256 dan jumlah unduhan; versi bermasalah bisa dinonaktifkan.

## Rilis iOS (App Store privat / Custom App)

iOS tidak bisa dibangun di server (butuh macOS), dan iPhone tidak memasang
berkas unduhan seperti APK. Build berjalan di GitHub Actions
(`.github/workflows/rilis-ios.yml`, runner macOS), lalu dibagikan sebagai
**Custom App** lewat Apple Business Manager: hanya bisa dipasang oleh
organisasi ini dan tidak tampil di App Store publik.

- Push ke `main` yang menyentuh `mobile/` → build tanpa tanda tangan (cek kompilasi).
- Actions → **Rilis iOS** → *Run workflow*, centang **unggah** → archive
  bertanda tangan langsung diunggah ke App Store Connect.

Nama versi iOS hanya boleh `x.y.z`, jadi dipakai versi dasar pubspec (`0.2.0`)
tanpa stempel waktu. Nomor build = menit sejak epoch, skema yang sama dengan
versionCode Android, jadi selalu naik. Versi yang sudah dirilis di App Store
tidak bisa menerima build baru: **naikkan `version` di `pubspec.yaml`
sebelum setiap rilis iOS berikutnya.**

Persiapan sekali (butuh akun Apple):

1. Daftar **Apple Developer Program sebagai organisasi** (US$99/tahun, perlu
   nomor D-U-N-S perusahaan), dan daftarkan perusahaan di **Apple Business
   Manager** (gratis). Catat *Organization ID* di ABM.
2. App Store Connect → Apps → aplikasi baru dengan bundle ID
   `id.nusantara.hrd.hrdNusantara` (tidak bisa diganti setelah rilis pertama).
3. Users and Access → Integrations → App Store Connect API → buat kunci
   berperan **Admin** (dibutuhkan untuk membuat sertifikat distribusi otomatis).
   Berkas `.p8` hanya bisa diunduh sekali.
4. GitHub → Settings → Secrets and variables → Actions, isi `APPLE_TEAM_ID`
   (Membership details), `ASC_KEY_ID`, `ASC_ISSUER_ID`, dan `ASC_KEY_P8`
   (isi berkas `.p8` utuh).
5. Jalankan workflow dengan **unggah**. Build muncul di App Store Connect
   setelah status *Processing* selesai.
6. Di halaman aplikasi: Pricing and Availability → **Private distribution**,
   masukkan Organization ID ABM. Isi label privasi (lokasi, foto wajah,
   nama & nomor HP: untuk fungsi aplikasi, bukan pelacakan), lalu kirim ke
   review dengan **akun demo karyawan** yang bisa login.
7. Setelah disetujui, aplikasi muncul di ABM → Apps and Books; bagikan ke
   karyawan lewat kode tukar (redemption code) atau MDM.

Rilis berikutnya: naikkan versi di pubspec, ulangi langkah 5, lalu kirim
versi baru ke review. Aplikasi hanya untuk iPhone (`TARGETED_DEVICE_FAMILY = 1`;
tetap bisa dipasang di iPad dalam mode kompatibel), jadi review tidak meminta
tangkapan layar iPad. Push notifikasi iOS baru aktif setelah Firebase dan
kunci APNs dikonfigurasi (lihat `lib/firebase_options.dart`).

Catatan: `flutter build ios --no-codesign` berhasil di mesin pengembang
(Xcode 27, target iOS 15); simulator iOS belum terpasang, jadi uji jalan di
iOS perlu perangkat sungguhan atau memasang runtime simulator lewat Xcode.
