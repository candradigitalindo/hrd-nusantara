# Integrasi rekrutmen JobStreet dan LinkedIn

Menu **Rekrutmen → Integrasi Job Fair** menyiapkan pengiriman lowongan terbuka ke JobStreet by SEEK dan LinkedIn, pemeriksaan status, serta penutupan iklan. Belum ada akun atau kredensial bawaan. Integrasi baru bisa dipakai setelah onboarding partner dan izin API disetujui masing-masing platform.

## Aktivasi

1. JobStreet: ajukan akses partner melalui [SEEK Developer](https://developer.seek.com/). Aktifkan hubungan `JobPosting` dengan perusahaan. Alur ini menggunakan portal karier perusahaan sebagai formulir lamaran; perusahaan harus memiliki kemampuan `ApplicationUri`. Dapatkan ID lokasi, kategori, dan produk iklan yang sesuai dari akun partner SEEK. Produk iklan dapat dikenai biaya oleh SEEK.
2. LinkedIn: ajukan [Job Posting API melalui LinkedIn Talent Solutions](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview). Akun employer atau aplikasi OAuth umum saja tidak memberikan akses ini. Gunakan kredensial aplikasi perusahaan yang sudah diaktifkan untuk autentikasi client credentials dan Job Posting.
3. Lengkapi environment backend; contoh tersedia di `backend/.env.example`, `.env.docker.example`, dan `.env.prod.example`. `RECRUITMENT_PUBLIC_URL` adalah origin HTTPS portal, misalnya `https://hrd.perusahaan.co.id`, tanpa path. Jangan menaruh kredensial di variabel `NEXT_PUBLIC_*`, browser, atau repository.
4. Jalankan migrasi melalui prosedur rilis yang berlaku (`prisma migrate deploy`), bangun ulang aplikasi, lalu gunakan **Uji koneksi**. Tombol ini memeriksa autentikasi; keberhasilannya belum membuktikan semua izin publikasi sudah diberikan.
5. Pilih lowongan terbuka yang belum melewati tenggat. Isi lokasi dan jenis pekerjaan. Untuk JobStreet, isi rentang gaji **bulanan IDR**, judul maksimal 80 karakter, ID lokasi/kategori/produk iklan resmi, dan ringkasan maksimal 150 karakter. Kirim lalu periksa status hingga platform mengonfirmasi hasil.

| Environment | Kegunaan |
| --- | --- |
| `RECRUITMENT_PUBLIC_URL` | Origin HTTPS portal lowongan dan lamaran |
| `SEEK_CLIENT_ID`, `SEEK_CLIENT_SECRET` | Kredensial partner SEEK |
| `SEEK_HIRER_ID` | Identifier perusahaan SEEK yang memiliki hubungan JobPosting |
| `SEEK_CONTACT_NAME`, `SEEK_CONTACT_EMAIL` | Kontak rekrutmen dalam position opening |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | Kredensial aplikasi perusahaan yang diizinkan memakai Job Posting API |
| `LINKEDIN_COMPANY_ID` | ID numerik perusahaan LinkedIn |
| `LINKEDIN_API_VERSION` | Versi REST API; bawaan `202604`, dapat diganti mengikuti kontrak partner |

## Perilaku

- API penerbitan bersifat asinkron. `pending` berarti kiriman diterima; hanya hasil pemeriksaan yang mengonfirmasi iklan aktif menghasilkan `published`. Status LinkedIn `PROCESSED` ditampilkan terpisah dan tidak dihitung sebagai iklan tayang.
- OAuth client credentials berjalan di backend. Token disimpan sementara dalam memori mengikuti `expires_in`, dengan satu pertukaran token untuk panggilan bersamaan pada proses yang sama. Endpoint provider ditetapkan dalam kode dan redirect ditolak. Respons mentah provider dan kredensial tidak masuk respons aplikasi atau audit.
- Satu lowongan hanya memiliki satu publikasi per platform. Dua kiriman bersamaan dikunci melalui transaksi database, sebelum panggilan jaringan. Jika proses berhenti di tengah pengiriman, lease kedaluwarsa ditampilkan sebagai `uncertain` saat daftar publikasi dibaca.
- Jika hasil kiriman SEEK tidak pasti, retry menggunakan snapshot input dan `idempotencyId` yang sama. Konflik idempotensi SEEK diperlakukan sebagai kiriman yang sudah diterima. Jika LinkedIn tidak mengembalikan ID tugas karena koneksi terputus, pengiriman ulang ditahan; administrator perlu merekonsiliasi publikasi di akun partner sebelum memperbaiki status melalui prosedur operasional. Tidak tersedia tombol reset yang berisiko menggandakan iklan.
- Penolakan yang pasti dapat dicoba kembali setelah data diperbaiki. Kegagalan saat memeriksa status tidak mengubah publikasi menjadi gagal dan tidak memicu kiriman baru.
- Status lowongan lokal dan iklan eksternal dikelola terpisah. **Menutup lowongan lokal tidak otomatis menutup iklan eksternal**: gunakan **Tutup di platform**, lalu periksa konfirmasi penutupannya. Penyuntingan iklan yang sudah tayang dilakukan di platform pada versi awal integrasi ini. Tidak ada pengiriman otomatis, pembaruan otomatis, webhook, atau impor profil pelamar dari platform.
- Tautan iklan menuju `/lowongan/:id?source=jobstreet|linkedin`. Sumber diteruskan melalui pendaftaran/masuk ke lamaran, lalu masuk `Candidate.source` dan laporan/saringan sumber rekrutmen. Sumber adalah atribusi tautan yang dilaporkan browser, bukan bukti identitas dari platform. CV dan data pelamar dikirim melalui portal karier perusahaan.
- Iklan JobStreet menggunakan pengaturan `OnSite` dan gaji bulanan dalam rupiah. JobStreet memilih masa tayang bawaan platform (maksimal 30 hari); tenggat portal tetap membatasi penerimaan lamaran lokal. LinkedIn memakai listing `BASIC`; publikasi berbayar LinkedIn belum didukung.

## API aplikasi

Semua endpoint membutuhkan sesi karyawan. Pembacaan memerlukan izin rekrutmen; pengujian koneksi dan perubahan publikasi memerlukan `rekrutmen.ubah`.

| Metode dan rute | Fungsi |
| --- | --- |
| `GET /api/recruitment/integrations` | Daftar platform dan nama environment yang belum diisi; tanpa nilai rahasia |
| `POST /api/recruitment/integrations/:platform/test` | Uji autentikasi resmi |
| `GET /api/job-postings/:id/publications` | Status publikasi lowongan |
| `POST /api/job-postings/:id/publications/:platform` | Body `action`: `publish`, `refresh`, atau `close` |

`platform` hanya `jobstreet` atau `linkedin`. Untuk publikasi awal JobStreet, sertakan `seek: { locationId, categoryId, advertisementProductId, summary }`. Jangan mengirim endpoint atau token melalui body.

Referensi kontrak: [token SEEK](https://developer.seek.com/auth/partner-tokens), [publikasi SEEK dan idempotensi](https://developer.seek.com/use-cases/job-posting/managing-job-ads/posting-a-job-ad), [formulir lamaran eksternal SEEK](https://developer.seek.com/schema/named-type/ApplicationMethodInput), [penerbitan LinkedIn](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/create-jobs), dan [pemeriksaan tugas LinkedIn](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/check-job-taskstatus).

## Validasi

`tests/recruitmentIntegrations.test.ts` menjalankan alur HTTP aplikasi dengan database test dan respons provider yang dimock. Ini menguji hak akses, konfigurasi, kontrak payload, status asinkron, penutupan, kiriman bersamaan, retry SEEK, kegagalan ambigu, dan atribusi sumber. Uji end-to-end terhadap akun partner asli tetap diperlukan setelah kredensial tersedia.
