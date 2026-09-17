# Pemantauan WhatsApp

Modul ini mengarsipkan percakapan **nomor WhatsApp perusahaan** — nomor CS
outlet, nomor reservasi hotel, nomor operasional. Bukan nomor pribadi
karyawan.

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

## Menyambungkan sebuah nomor

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

3. **Pemegang nomor memindai QR.** QR baru muncul beberapa detik setelah
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

Pesan yang tidak melibatkan nomor perusahaan terdaftar **tidak pernah
disimpan**, bahkan kalau dikirim ke webhook dengan tanda tangan sah.

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
