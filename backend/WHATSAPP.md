# Pemantauan WhatsApp

Modul ini mengarsipkan percakapan WhatsApp dua jenis nomor:

| Jenis (`kind`) | Siapa yang menautkan | Contoh |
|---|---|---|
| `personal` | **Setiap karyawan terdaftar**, sendiri, lewat halaman *WhatsApp Saya* di web | nomor pribadi Budi, Siti, … |
| `company` | HR mendaftarkan, pemegang nomornya memindai QR | CS Outlet Kemang, Reservasi Hotel |

Sesuai dokumen fitur (§10): *semua pesan teks WhatsApp dari karyawan yang
terdaftar disinkronkan ke sistem pusat*; bila sesinya putus, karyawan
menerima notifikasi di ponsel dan **wajib memindai ulang** agar sinkronisasi
aktif kembali. HR melihat siapa yang belum/putus lewat laporan kepatuhan.

> Ini pemrosesan data pribadi berskala luas. Aplikasi menampilkan pernyataan
> persetujuan sebelum karyawan menautkan nomornya; dasar hukum (persetujuan
> atau kebijakan internal yang ditandatangani) adalah urusan perusahaan,
> bukan kode. Isi pesan terenkripsi, hanya HR yang bisa membaca arsip, tiap
> pembacaan tercatat di jejak audit, dan masa simpannya bisa dibatasi.

Koneksi ke WhatsApp dibuka oleh backend sendiri memakai
[Baileys](https://github.com/WhiskeySockets/Baileys), tanpa layanan pihak
ketiga dan tanpa biaya lisensi.

> **Catatan terhadap dokumen perancangan.** `arsitektur_aplikasi.md` dan
> `teknologi_yang_digunakan.md` menyebut platform **Belly's**. Yang
> diimplementasikan adalah Baileys. Jalur webhook lama
> (`POST /api/webhook/bellys`) tetap ada dan tetap berfungsi, jadi gateway
> luar apa pun — termasuk Belly's — masih bisa mengirim pesan ke sistem ini.

## Menyalakan

Empat variabel di `.env`:

```dotenv
WHATSAPP_MONITORING_ENABLED=true
WHATSAPP_BAILEYS_ENABLED=true
FIELD_ENCRYPTION_KEY="<openssl rand -base64 32>"
WHATSAPP_SESSION_DIR=./whatsapp-sessions
```

`FIELD_ENCRYPTION_KEY` **wajib** kalau pemantauan dinyalakan: backend menolak
boot tanpa itu, karena isi pesan tidak boleh tersimpan terbuka. Sekali diisi,
jangan diganti tanpa menjalankan `npm run whatsapp:reencrypt` — baris lama
tidak akan terbaca lagi.

> **Satu nomor WhatsApp hanya boleh dipegang satu proses.** Kalau backend
> dijalankan lebih dari satu replika, nyalakan `WHATSAPP_BAILEYS_ENABLED`
> hanya di salah satunya. Dua proses yang memegang nomor sama akan saling
> menendang sesi tanpa henti.

## Nomor pribadi karyawan (wajib)

Pemindaian QR dilakukan **lewat login di web** (menu *WhatsApp Saya*), bukan
di aplikasi mobile: ponsel yang sama tidak bisa memindai QR yang tampil di
layarnya sendiri. Aplikasi mobile hanya **memeriksa** apakah tautan masih
hidup dan menampilkan peringatan "Tautan WhatsApp terputus" di beranda bila
tidak; dashboard web menampilkan peringatan yang sama.

```
GET  /api/whatsapp/me            -> { status: "never_linked" | "connecting" | "pending_scan"
                                     | "connected" | "disconnected" | "inactive",
                                     account, session, qr, catatan, driverAktif }
POST /api/whatsapp/me/connect    -> 202, akun personal dibuat bila belum ada
```

Nomornya **tidak diminta di awal**: akun dibuat tanpa nomor, dan nomor diisi
dari laporan WhatsApp saat QR tertaut (`sock.user.id`). Kalau nomor itu
ternyata sudah terdaftar sebagai akun lain (mis. nomor perusahaan), tautan
dibatalkan dengan logout dan tercatat sebagai `scan_required` beserta
alasannya. Karyawan yang ganti nomor cukup memindai ulang; akunnya sama,
nomornya diperbarui.

Dua karyawan yang saling berkirim pesan masing-masing punya salinan di
arsipnya sendiri (`externalMessageId` unik **per akun**).

Nomor WhatsApp yang tertaut juga **username login** karyawan: bila kolom
nomor HP karyawan masih kosong di HR, nomor hasil pemindaian itu mengisinya
(kecuali sudah dipakai karyawan lain). Nomor yang sudah diisi HR tidak
ditimpa.

### Foto absensi ber-stempel ke grup

Setelah tersambung, karyawan memilih **satu grup** dari daftar grup yang
diikuti nomornya (halaman *WhatsApp Saya* di web):

```
GET /api/whatsapp/me/groups            -> { data: [{ jid, nama, jumlahAnggota }], terpilih }
PUT /api/whatsapp/me/attendance-group  -> { jid: "1203…@g.us" | null }
```

Grup diverifikasi benar-benar diikuti nomor itu (JID bebas ditolak 404).
Setiap check-in/out, WhatsApp karyawan sendiri mengirim foto (selfie
verifikasi wajah, atau foto khusus `photo` untuk metode GPS/QR; tanpa foto
dibuat latar polos) dengan **pita stempel** — nama, NIK, jam zona aplikasi,
lokasi + koordinat, metode, status — plus keterangan yang sama. Pengiriman
berjalan di latar setelah presensi dijawab; hasilnya di
`Attendance.stampStatus` (`sent` / `failed` / `skipped`) dan terlihat HR di
halaman Presensi. Teks stempel dirender sharp lewat SVG; Dockerfile memasang
`fonts-dejavu-core` supaya hurufnya tidak jadi kotak.

### Kepatuhan (HR)

```
GET  /api/whatsapp/compliance?departmentId=   -> per karyawan aktif: status
                                                 connected | disconnected | pending_scan | never_linked
POST /api/whatsapp/compliance/remind          -> { employeeIds?: [] }  push pengingat
                                                 ke yang belum tersambung
```

## Nomor perusahaan

1. **HR mendaftarkan nomor**

   ```
   POST /api/whatsapp/accounts
   { "phoneNumber": "0811...", "label": "CS Outlet Kemang",
     "assignedEmployeeId": "<ulid karyawan pemegang nomor>" }
   ```

2. **HR membuka sesi**

   ```
   POST /api/whatsapp/accounts/:id/connect     -> 202
   ```

3. **Pemegang nomor memindai QR.** Ponsel yang memindai harus bernomor sama
   dengan yang didaftarkan; kalau berbeda, tautan dibatalkan (logout) dan
   tercatat sebagai `scan_required`. QR baru muncul beberapa detik setelah
   langkah 2, jadi endpoint ini di-poll sampai `qr` terisi:

   ```
   GET /api/whatsapp/accounts/:id/session
   -> { "status": "pending_scan", "qr": "data:image/png;base64,..." }
   ```

   Karyawan pemegang nomor boleh melihat QR miliknya sendiri; karyawan lain
   ditolak 403. QR ini setara akses penuh untuk menautkan perangkat ke akun
   WhatsApp itu.

4. Setelah dipindai, `status` menjadi `connected` dan pesan mulai masuk.

Kredensialnya tersimpan di `WHATSAPP_SESSION_DIR`, jadi **deploy ulang tidak
menuntut scan ulang** — backend menyambungkan kembali sendiri saat mulai.

## Memutus

```
POST /api/whatsapp/accounts/:id/disconnect
{ "logout": false }   # bawaan: putus sementara, bisa disambung lagi
{ "logout": true }    # hapus pairing, pemegang nomor harus scan QR ulang
```

## Yang diarsipkan dan yang tidak

| Diarsipkan | Tidak diarsipkan |
|---|---|
| Pesan 1-ke-1 dengan nomor perusahaan | Percakapan grup |
| Teks, dan keterangan pada media | Berkas medianya sendiri |
| Nama berkas dokumen | Status, siaran, stiker, reaksi |
| Pesan suara (sebagai kejadian, tanpa teks) | Riwayat lama saat perangkat ditautkan |

Pesan yang tidak melibatkan nomor terdaftar (perusahaan maupun pribadi)
**tidak pernah disimpan**, bahkan kalau dikirim ke webhook dengan tanda
tangan sah. Pada jalur Baileys, pesan dikaitkan ke akun sesi yang
menerimanya, bukan ditebak dari nomornya.

Berkas media sengaja tidak diunduh: menumpuk foto dan dokumen kiriman
pelanggan adalah beban UU PDP 27/2022 yang jauh lebih berat daripada
manfaatnya untuk pelacakan isu.

## Mencari arsip

```
GET /api/whatsapp/conversations?search=keluhan
```

Isi pesan tersimpan terenkripsi (AES-256-GCM), jadi pencarian berjalan lewat
**indeks buta**: tiap kata disimpan sebagai HMAC berkunci. Konsekuensinya
pencarian bersifat **per kata utuh** — `keluhan` menemukan "Keluhan: pesanan
lama", `keluh` tidak. Beberapa kata berarti DAN.

Hanya HR yang boleh membaca arsip: isinya memuat data pribadi pelanggan dan
tamu yang tidak pernah menjadi bagian dari perusahaan.

## Masa simpan

```dotenv
WHATSAPP_RETENTION_DAYS=0   # 0 = tanpa batas (bawaan)
```

Penghapusan tidak berjalan otomatis. Panggil dari cron di luar aplikasi:

```
POST /api/whatsapp/retention/purge
{ "dryRun": true }    # bawaan: hanya menghitung
{ "dryRun": false }   # benar-benar menghapus
```

Berapa lama arsip disimpan adalah keputusan hukum dan bisnis, bukan keputusan
kode — karena itu bawaannya tidak menghapus apa pun.

## Pemberitahuan putus sesi

Ada dua jalur, dan keduanya perlu: **push** mendorong pemberitahuan ke ponsel
saat kejadian terjadi, **antrean tarik** menjadi jaring pengaman untuk push
yang gagal.

### Push (Firebase Cloud Messaging)

```dotenv
PUSH_NOTIFICATIONS_ENABLED=true
FIREBASE_SERVICE_ACCOUNT_PATH=./secrets/firebase-service-account.json
```

Berkas itu diunduh dari Firebase Console → Project Settings → Service
accounts → *Generate new private key*, lalu ditaruh di `backend/secrets/`.
Seluruh isi direktori itu diabaikan git; lihat `backend/secrets/README.md`.

```bash
chmod 600 secrets/firebase-service-account.json
```

Untuk memastikan kredensialnya diterima tanpa mengganggu siapa pun:

```bash
npm run push:test
```

Skrip itu mengirim ke token yang sengaja palsu. Kalau jawabannya
`tokenTidakSah` berisi satu token, berarti Firebase menerima permintaannya
dan menolak TOKEN-nya — kredensialnya sah. Kalau yang muncul galat kredensial,
berarti berkasnya yang bermasalah.

Jangan pernah menempelkan isi berkas ini ke chat, issue, atau log. Kalau
terlanjur, cabut kuncinya di Firebase Console dan buat yang baru.

Aplikasi mobile mendaftarkan perangkatnya setelah login:

```
POST   /api/devices   { "token": "<token FCM>", "platform": "android" }
GET    /api/devices
DELETE /api/devices   { "token": "<token FCM>" }   # saat logout
```

Token adalah kuncinya, bukan pasangan (karyawan, perangkat). Kalau ponsel
berpindah tangan dan orang baru login, token yang sama **berpindah pemilik** —
kalau tidak, notifikasi pemilik lama akan terus muncul di layar orang lain.

Yang diberitahukan hanya `disconnected` dan `scan_required`. Sesi yang
berhasil tersambung tidak menuntut tindakan apa pun, dan notifikasi yang tidak
bisa ditindaklanjuti melatih orang mengabaikan notifikasi berikutnya.

**Isi percakapan tidak pernah masuk ke notifikasi.** Muatan push melewati
server Google dan tampil di layar terkunci.

### Antrean tarik

```
GET  /api/whatsapp/session-events?unnotifiedOnly=true
POST /api/whatsapp/session-events/notified   { "eventIds": [...] }
```

Kejadian ditandai sudah diberitahukan **hanya setelah push benar-benar
terkirim**. Kalau Firebase sedang bermasalah atau karyawan belum memasang
aplikasi, kejadiannya tetap menunggu di antrean ini.

## Versi Baileys

Terpasang `baileys@7.0.0-rc14`. Ini *release candidate*, dipilih karena jalur
stabil `6.7.24` menarik `libsignal` lewat git dan tidak bisa dipasang di mesin
yang gitnya terkunci. Kalau ingin pindah ke jalur stabil:

```bash
npm install baileys@6.7.24
```

Seluruh kode yang menyentuh pustaka ini terkumpul di
`src/services/whatsapp/baileysDriver.ts`; sisanya hanya mengenal antarmuka
`SoketWhatsApp`.

Jangan memakai `baileys@6.17.16` walau nomornya lebih tinggi: versi itu
ditarik karena kerentanan zero-day yang memungkinkan pemalsuan pesan.
