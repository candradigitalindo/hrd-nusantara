# Jejak Audit

Sistem ini menyimpan gaji, data biometrik, dan arsip percakapan pelanggan.
UU PDP 27/2022 menuntut pengendali data bisa menunjukkan pertanggungjawaban
atas pemrosesan itu — tanpa jejak audit, pertanyaan "siapa yang menghapus
arsip itu" atau "siapa yang membaca percakapan tamu bulan lalu" tidak punya
jawaban.

## Append-only, ditegakkan database

Tabel `AuditLog` menolak `UPDATE` dan `DELETE` lewat trigger PostgreSQL,
bukan lewat kesepakatan di kode:

```
ERROR: AuditLog bersifat append-only: operasi DELETE ditolak
```

Alasannya sederhana. Siapa pun yang memegang kredensial database — termasuk
orang yang sedang diaudit — bisa melewati lapisan aplikasi. Jejak audit yang
bisa disunting oleh orang yang diauditnya tidak ada gunanya justru pada saat
ia dibutuhkan.

Tidak ada endpoint tulis atau hapus, dan itu disengaja.

`TRUNCATE` tetap bisa jalan karena trigger tingkat baris tidak terpicu
olehnya — itulah yang dipakai untuk mengosongkan database test.

## Apa yang dicatat

| Dicatat | Tidak dicatat |
|---|---|
| Semua POST, PUT, PATCH, DELETE ke `/api` | Pembacaan biasa (GET) |
| Percobaan yang DITOLAK (403, 404, 409, 500) | Webhook Baileys/Belly's |
| Login berhasil dan gagal | |
| Pembacaan arsip WhatsApp, berikut penyaringnya | |

GET tidak dicatat secara umum: mencatat setiap pembacaan akan membuat tabel
audit tumbuh lebih cepat daripada data yang diauditnya, dan menenggelamkan
yang penting. Controller yang menyentuh data pribadi mengaktifkannya sendiri —
pembacaan arsip WhatsApp adalah contohnya.

Percobaan yang gagal justru sinyal yang paling ingin dilihat saat menelusuri
insiden, jadi status 4xx dan 5xx ikut tercatat.

## Yang TIDAK pernah masuk ke jejak

Isi permintaan tidak disalin apa adanya. Body memuat kata sandi, isi
percakapan WhatsApp, dan foto wajah — menyalin semuanya ke tabel audit
berarti membuat salinan kedua dari data yang justru paling dijaga, di tabel
yang tidak terenkripsi dan barisnya tidak bisa dihapus.

Untuk perubahan data karyawan yang dicatat adalah **nama field** yang berubah,
bukan nilainya. Alamat dan nomor telepon tidak ikut.

Pengecualiannya adalah yang menyangkut hak akses: perubahan `role` dan
`status` menyimpan nilai sebelum dan sesudah, karena "role diubah" tanpa nilai
lamanya tidak menjawab pertanyaan yang justru ditanyakan saat audit.

Sebagai lapis kedua, kunci metadata yang mengandung `password`, `token`,
`secret`, `messageBody`, `embedding`, `foto`, dan sejenisnya otomatis diganti
`[dirahasiakan]`, dan objek yang lebih dalam dari 4 tingkat dipotong.

## Membaca jejak

```
GET /api/audit-logs?actorId=...&action=...&entity=...&entityId=...
GET /api/audit-logs?onlyFailed=true
GET /api/audit-logs?startDate=2026-09-01&endDate=2026-09-30
```

**Hanya SUPER_ADMIN.** Jejak ini memperlihatkan perbuatan semua orang,
termasuk HR — kalau HR bisa membacanya sendiri, pengawasan atas HR ikut
hilang.

## Menambah rincian di controller

Middleware sudah mencatat setiap perubahan tanpa perlu diminta. Controller
yang ingin menjelaskan lebih tinggal mengisi `res.locals.audit` sebelum
mengirim respons:

```ts
res.locals.audit = {
  action: 'whatsapp.retention.purge',
  entity: 'WhatsAppConversation',
  entityId: akun.id,
  summary: `MENGHAPUS PERMANEN ${jumlah} percakapan`,
  metadata: { retentionDays, cutoff },
};
```

Isi `metadata` sendiri yang dipilih — jangan menempelkan `req.body`.

## Aksi yang sudah diberi nama

| Action | Kapan |
|---|---|
| `auth.login.berhasil` / `auth.login.gagal` | Setiap percobaan login |
| `employee.ubah` / `employee.ubah.role` | Perubahan data karyawan |
| `payroll.run.setujui` / `payroll.run.kembalikan` | Keputusan batch penggajian |
| `whatsapp.conversations.read` | Pembacaan arsip percakapan |
| `whatsapp.retention.purge` | Penghapusan arsip, termasuk simulasinya |
| `whatsapp.session.connect` / `.disconnect` | Membuka dan menutup sesi WhatsApp |

Selain ini, aksi dicatat memakai pola rutenya, misalnya
`POST /api/leaves/:id/approve`. Pola dipakai — bukan path mentah — supaya aksi
yang sama bisa dikelompokkan walau id-nya berbeda; path sebenarnya tetap
tersimpan di kolom tersendiri.
