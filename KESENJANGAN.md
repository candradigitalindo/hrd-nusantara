# Pemetaan Dokumen ↔ Kode

Pembandingan `hrd_features_doc.md` dan `step_development.md` terhadap kode
yang ada, per 20 September 2026. Backend punya 181 endpoint dan 794 test;
frontend Next.js baru dimulai pada tanggal ini.

Keterangan: ✅ selesai · 🟡 sebagian · ❌ belum ada · ➖ di luar cakupan sekarang

## Backend per modul

| # | Modul (dokumen fitur) | Status | Catatan |
|---|---|---|---|
| 1 | Data karyawan — profil, status, struktur | ✅ | **Departemen & jabatan sebelumnya tidak punya endpoint sama sekali** — tidak ada cara membuatnya selain menulis ke database. Ditambahkan hari ini. |
| 1 | Data karyawan — dokumen digital (CV, ijazah, kontrak, BPJS) | ✅ | Unggah (HR), lihat/unduh (HR dan pemilik), masa berlaku, pelacakan kedaluwarsa. Berkas di luar direktori publik, jenis dikenali dari isi, soft delete, tiap unduhan tercatat di audit. |
| 2 | Presensi — GPS, wajah, QR, shift, validasi, lembur, laporan | ✅ | Pengenalan wajah dan anti-spoofing berjalan di server sendiri. Deteksi fake GPS berlapis: ponsel (penanda mock OS, aplikasi lokasi palsu terpasang, root/jailbreak, emulator, opsi pengembang, pembanding lokasi jaringan, posisi basi) + server (perpindahan mustahil antar presensi). Mock/aplikasi palsu/root memblokir; sisanya ditandai "Dicurigai" untuk HR. |
| 3 | Cuti — tipe, pengajuan, saldo, kalender | ✅ | Cuti bersama memotong kuota tahunan otomatis — hanya karyawan pola kerja tetap yang libur; staf shift outlet/hotel tidak dipotong. Dipulihkan bila hari liburnya dibatalkan; saldo yang dibuat belakangan ikut menanggung. |
| 4 | Payroll — hitung otomatis, BPJS, PPh 21, slip digital | ✅ | PPh 21 opsional, tidak aktif secara bawaan. |
| 5 | Rekrutmen — lowongan, pelamar, wawancara, hire | ✅ | |
| 5 | Rekrutmen — psikotes | ✅ | Hasil per kandidat dengan skor/maksimal, interpretasi naratif, penilai. Hanya HR. |
| 5 | Rekrutmen — onboarding digital | 🟡 | Hire membuat karyawan; orientasi/pelatihan dasar lewat modul pelatihan. Tidak ada alur onboarding tersendiri. |
| 6 | Kinerja — form kustom, berkala, 360°, diskusi, umpan balik | ✅ | |
| 7 | Pelatihan — program, jadwal, pendaftaran, evaluasi, riwayat | ✅ | |
| 8 | Kompetensi & sertifikasi | ✅ | |
| 8 | Tes CBT — uji kemampuan karyawan & seleksi pelamar | ✅ | Bank soal bersama (pilihan ganda, banyak jawaban, benar/salah, isian, esai) dengan kunci yang tidak pernah dikirim ke peserta; paket tes berisi durasi, ambang lulus, pengacakan soal & pilihan, dan aturan pengawasan. Soal objektif dinilai otomatis (jawaban ganda penuh-atau-nol), esai dinilai penguji lewat halaman hasil, nilai akhir dan kelulusan ditahan sampai seluruh esai dinilai. Batas waktu dihitung server dan dikirim otomatis saat habis; jawaban tersimpan berkala sehingga pengerjaan yang terputus bisa dilanjutkan dengan urutan soal yang sama. Karyawan mengerjakan lewat akunnya, pelamar lewat tautan bertoken tanpa akun (yang tersimpan hanya sidik SHA-256-nya, bisa dibuat ulang). Pengawasan: catatan pindah tab/salin/tempel dan foto wajah berkala yang disimpan terenkripsi, ditampilkan sebagai bukti di halaman hasil beserta rincian nilai per kategori. |
| 9 | Komunikasi — pengumuman, chat, survei | ✅ | |
| 10 | WhatsApp — setiap karyawan terdaftar menautkan nomor pribadinya lewat login web (halaman WhatsApp Saya, QR), seluruh pesan teksnya tersinkron; arsip sentral & pencarian (HR); notifikasi putus sesi ke ponsel; wajib scan ulang; laporan kepatuhan & pengingat (HR); nomor perusahaan tetap didukung; foto absensi ber-stempel (nama, jam, lokasi, metode) dikirim otomatis dari WhatsApp karyawan ke grup pilihannya | ✅ | Baileys, bukan Belly's. Keputusan 21 September 2026: menyesuaikan ke dokumen — sebelumnya hanya nomor perusahaan. Dasar hukum persetujuan karyawan (UU PDP) adalah urusan perusahaan. |
| 11 | Analisis — dashboard, turnover, biaya, produktivitas, data mentah | ✅ | |
| 12 | Integrasi POS / PMS / akuntansi | ➖ | Tidak ada sistem luar yang ditentukan untuk diintegrasikan. |
| 13 | Enkripsi — percakapan | ✅ | AES-256-GCM + indeks buta. |
| 13 | Enkripsi — wajah, lokasi | ✅ | Embedding wajah AES-256-GCM sebagai biner bertanda; koordinat presensi sebagai JSON terenkripsi, kolom terbuka dihapus. Kunci enkripsi kini wajib. |
| 13 | Akses berjenjang — peran dinamis | ✅ | Peran dibuat admin lewat matriks izin: setiap halaman sidebar (dan sub-bagiannya, mis. dokumen karyawan, cuti tim, pengaturan cuti) punya kotak lihat/buat/ubah/hapus sendiri — 32 baris, 80 kunci `halaman.aksi` di `backend/src/utils/permissions.ts`; kunci generasi lama (`karyawan.kelola`, `cuti.setujui`, …) dimigrasi otomatis saat server mulai, dan klien mobile lama tetap menerima alias `halaman.*`; tiap peran punya lingkup data (diri sendiri / departemen / seluruh perusahaan / pemilik). Empat peran sistem dibuat otomatis dan izinnya bisa disunting (kecuali Super Admin yang terkunci). Semua penjaga rute memakai izin (`requirePermission`), bukan lagi enum peran. Anti-eskalasi: pengelola peran non-Super Admin hanya bisa memberikan izin yang ia pegang sendiri dan tidak bisa membuat peran berlingkup HR/Super Admin; peran yang sedang dipegang tidak bisa diubah sendiri; peran sistem tidak bisa dihapus, peran yang masih dipegang karyawan juga tidak; peran yang lebih kuat dari pengelolanya (berlingkup HR/Super Admin, atau memuat izin di luar miliknya) tidak bisa ia sunting maupun hapus — mengganti namanya pun tidak. Akun berlingkup lebih tinggi terlindungi dari bawah: hanya Super Admin yang bisa menyunting, mengganti sandi, menurunkan peran, atau menonaktifkan akun Super Admin, dan peran berlingkup tinggi tidak ditawarkan di formulir bagi yang bukan pemilik sistem. |
| 13 | Audit trail | ✅ | Append-only, ditegakkan trigger database. |
| 13 | Keluhan & disiplin | ✅ | Keluhan (siapa pun; subjeknya tidak melihat), tindakan disiplin bertingkat SP1–SP3 (UU 13/2003 ps. 161; subjek berhak melihat), alur status, peringatan SP3 tanpa SP1/SP2, pembacaan tercatat di audit. |
| 13 | Perencanaan suksesi | ❌ | |
| 13 | Dokumen legal | ✅ | Sama dengan dokumen digital karyawan (jenis kontrak_kerja, dengan masa berlaku). |
| 13 | UI responsif | 🟡 | Lihat bagian frontend. |
| 13 | Fitur khusus hotel (task housekeeping, interaksi tamu) | ➖ | Bergantung pada PMS. |

## Frontend (step_development.md bagian 3)

| Halaman | Status |
|---|---|
| Layout, navigasi per peran, tema gelap/terang | ✅ |
| Login | ✅ |
| Dashboard dengan grafik | ✅ |
| Karyawan — daftar, cari, saring, tambah, sunting, nonaktifkan | ✅ |
| Karyawan — halaman detail dengan dokumen (unggah seret-lepas, unduh, masa berlaku) | ✅ |
| Organisasi — departemen & jabatan | ✅ |
| Presensi — daftar, saring, setujui lembur | ✅ |
| Cuti — saldo per jenis, ajukan (dengan sisa saldo & syarat lampiran), batalkan, antrean persetujuan, tab Saldo Karyawan untuk HR (tetapkan/ubah per karyawan, terapkan jatah bawaan massal) dan panel saldo di detail karyawan | ✅ |
| Slip gaji karyawan — daftar periode, rincian tunjangan/potongan, cetak | ✅ |
| Payroll HR — batch (buat, hitung, setujui/kembalikan), rincian slip per batch, yang dilewati beserta alasannya | ✅ |
| Struktur gaji per karyawan (HR) — gaji pokok & riwayat, komponen tunjangan/potongan | ✅ |
| Rekrutmen — lowongan (buat/sunting/tayangkan/tutup), pelamar (tahap, penolakan beralasan, jadwal wawancara, psikotes, terima → karyawan), wawancara & umpan balik pewawancara, corong seleksi | ✅ |
| Komunikasi — pengumuman (prioritas, sasaran departemen, konfirmasi wajib, laporan siapa belum membaca), survei (pembuat pertanyaan skala/pilihan/teks, anonim, pengisian, hasil agregat) | ✅ |
| Komunikasi — chat tim: ruang per tim/departemen, tertutup atau terbuka, moderator menambah anggota, pesan dengan penanda hapus (jejak audit tetap), daftar ruang dengan pesan terakhir | ✅ | Penyegaran berkala 5 detik, bukan WebSocket. |
| Pelatihan — program (wajib/opsional, masa berlaku, nilai lulus), jadwal sesi & kuota/daftar tunggu, pendaftaran & pembatalan, kehadiran, evaluasi & sertifikat, riwayat karyawan, laporan kepatuhan (siapa yang belum/kedaluwarsa) | ✅ |
| Kinerja — siklus (triwulan/semester/tahunan), form KPI per jabatan dengan bobot, penugasan penilai 360° (diri/atasan/rekan/bawahan), pengisian skor per kriteria, akui hasil, catatan diskusi, ringkasan per jenis penilai, umpan balik berkelanjutan | ✅ |
| Kompetensi & sertifikasi — kamus kompetensi berskala tingkat, standar per jabatan, penilaian tingkat karyawan, kesenjangan (kesiapan %) per karyawan & laporan lintas departemen, jenis sertifikasi (wajib, masa berlaku, tautan pelatihan), catatan sertifikat dengan status berlaku/segera/kedaluwarsa/dicabut | ✅ |
| WhatsApp — kepatuhan per karyawan & pengingat, nomor perusahaan, QR, arsip & pencarian; web: WhatsApp Saya (tautkan, QR, pindai ulang) + peringatan di dashboard; mobile: hanya memeriksa tautan + peringatan "Tautan WhatsApp terputus" di beranda | ✅ |
| Jejak audit | ✅ |
| Jadwal Shift — halaman web menyusun jadwal per departemen dalam tampilan minggu (Senin–Minggu): tambah lewat sel, ubah/hapus lewat chip, shift malam lintas tengah malam, split shift (beberapa shift per hari), status Terjadwal/Sementara, salin jadwal minggu sebelumnya (aman ditekan berulang), ringkasan jumlah shift & jam terjadwal; manajer terkunci ke departemennya sendiri, HR memilih departemen | ✅ | Server menolak jadwal yang bertabrakan (409) dan penjadwalan lintas departemen oleh manajer (403). Karyawan melihat jadwalnya di aplikasi Android. |
| Atur ulang kata sandi — HR (izin `karyawan.ubah`) mengatur ulang dari daftar/detail karyawan: sandi sementara dibuat server dan tampil sekali (atau ditentukan HR), sandi lama langsung mati, karyawan wajib membuat sandi baru saat login berikutnya (web dipaksa ke `/ganti-sandi`, aplikasi Android ke layar Buat Password Baru); pagar eskalasi (tidak untuk akun berlingkup lebih tinggi / diri sendiri / manajer lintas departemen); jejak audit tanpa sandi; sandi awal saat membuat karyawan juga sementara | ✅ | Sesi (JWT) yang sudah ada tidak dicabut saat reset; kedaluwarsa alami. |
| Peran & Hak Akses — daftar peran (sistem & kustom, jumlah pemegang, lingkup), buat/sunting lewat matriks lihat/buat/ubah/hapus per halaman sidebar (tombol per baris dan "pilih semua" per kelompok, tooltip menjelaskan tiap kotak), hapus; formulir karyawan memilih peran dari daftar ini; menu sidebar dan tombol aksi disaring berdasarkan izin | ✅ |
| Distribusi aplikasi mobile — `mobile/rilis.sh` membangun APK arm64 dengan versi unik ber-stempel waktu (versionCode = menit sejak epoch, selalu naik; versionName `x.y.z+YYYYMMDDHHMM`) dan bisa langsung mengunggah; HR juga bisa mengunggah APK lewat web (dengan persentase unggah), riwayat versi + sha256 + jumlah unduhan, nonaktifkan versi bermasalah; halaman publik `/unduh` (tanpa login) menawarkan versi terbaru + langkah pasang; QR tautan untuk dipajang di outlet | ✅ | Berkas disimpan di `UPLOAD_DIR/apk` (volume Docker yang sama dengan dokumen). Jalur unggah `/api/backend/mobile/` dilonggarkan ke 150 MB di `nginx/hrd.conf`; proxy depan (`radius-server/nginx-proxy/nginx.conf`, blok `hrd.nbp.co.id`) masih 25 MB dan harus dinaikkan agar HR bisa mengunggah APK sungguhan lewat web. |
| Mobile Flutter (`mobile/`) — beranda karyawan (shift & presensi hari ini dengan check-in/out, daftar perlu tindakan termasuk penilaian KPI yang harus diisi/dikonfirmasi, kehadiran 30 hari + strip 7 hari, jadwal 7 hari, sisa cuti & slip terakhir, nilai kinerja terakhir, pelatihan mendatang, akses cepat, pengumuman; tiap bagian mengikuti izin `<halaman>.lihat`), login & profil, presensi GPS/wajah/QR + riwayat, cuti (saldo, ajukan, batalkan), slip gaji, **Kinerja & KPI** (nilai terakhir, isi penilaian diri/rekan per kriteria dengan perkiraan nilai, rincian per kriteria + diskusi, konfirmasi hasil, umpan balik), **Pelatihan** (sesi terjadwal: daftar/daftar tunggu/batalkan; riwayat + hasil evaluasi), **Keluhan & Disiplin** (ajukan keluhan, lihat SP yang ditujukan + catatan penyelesaian), jadwal shift, pengumuman & konfirmasi, survei, chat tim, status sesi WhatsApp + QR scan ulang, push FCM | 🟡 | Analyzer bersih, 48 tes lulus (termasuk tes tampilan ukuran ponsel dengan potret layar via `--dart-define=POTRET_DIR`). Push butuh `flutterfire configure` (proyek hrd-app-635cb). Build iOS (tanpa codesign) berhasil; uji jalan iOS butuh perangkat/simulator. |
| Keluhan & disiplin — ajukan, catat SP, tindak lanjuti | ✅ |
| Analisis & laporan — perputaran (alasan, departemen, masa kerja saat keluar), biaya SDM (komposisi, biaya per rekrutan), produktivitas (terhadap shift terjadwal; manajer dibatasi departemennya), data mentah 5 kumpulan dengan unduh CSV untuk laporan kustom | ✅ | CSV maksimal 5.000 baris per unduhan. |

Peran mencakup seluruh sidebar (22 September 2026): setiap item menu punya
izin — halaman pengelolaan memakai izin fungsinya (mis. `karyawan.lihat`),
halaman layanan mandiri memakai kunci `halaman.*` (Dashboard, Pengumuman,
Chat, WhatsApp Saya, Presensi, Cuti, Slip Gaji, Pelatihan, Kinerja,
Kompetensi, Keluhan & Disiplin, Unduh Aplikasi). Kunci ini bawaan semua
peran (migrasi menambahkannya ke peran yang sudah ada), jadi tidak ada yang
kehilangan akses; admin bisa mencabutnya per peran. API di balik menu ikut
ditutup (`/leaves/me`, `/payrolls/me`, `/chat/*`, `/whatsapp/me`, dst.),
kecuali lowongan internal dan wawancara yang datanya sudah terbatas ke
pewawancara sendiri, serta halaman unduh yang memang publik. Web menolak
merender halaman yang menunya tidak termasuk peran; mobile menyembunyikan
tab, pintasan, dan kartu beranda yang bersangkutan.

Peran dinamis (21 September 2026): kolom `Employee.role` tetap ada sebagai
**lingkup data** (controller memakainya untuk membatasi departemen sendiri,
dsb.) dan disinkronkan otomatis dari lingkup peran yang diberikan. Izin
efektif dibaca ulang setiap permintaan — suntingan pada peran langsung
berlaku tanpa login ulang. Akun lama tanpa peran eksplisit memakai peran
sistem sesuai lingkupnya (migrasi mengisi `customRoleId` untuk semua yang
sudah ada). `/auth/me` dan respons login menyertakan `permissions` dan
`customRole`; web dan mobile memakainya hanya untuk menyembunyikan menu.

Login (21 September 2026): username adalah **nomor HP/WhatsApp** karyawan
(08xx, +62xx, 62xx — dibakukan ke 62xx dan unik); email tetap diterima sebagai
cadangan untuk akun admin awal. Nomor WhatsApp yang ditautkan otomatis mengisi
nomor karyawan yang masih kosong.

Warna brand (21 September 2026): hijau sage `#4a7c62` mengikuti pos.nbp.co.id,
sekunder kuning emas `#d9a627`; keduanya dipakai web (token `--primary`,
`--secondary`) dan mobile (`lib/core/tema.dart`). Grafik memakai hijau/kuning
satu rumpun yang lebih jenuh dan tervalidasi (`--chart-1`, `--chart-2`).

Dashboard (21 September 2026): tampilan manajemen dua kolom tetap (grafik
di kiri, presensi hari ini / cuti menunggu / dokumen kedaluwarsa di kanan)
sehingga tinggi kartu yang berbeda tidak menyisakan lubang; tampilan karyawan
diisi ringkasan pribadi (presensi hari ini, sisa cuti, pengumuman belum dibaca,
slip terakhir, riwayat 7 hari, pengumuman & cuti terakhir). Label kartu
statistik boleh dua baris; label sumbu grafik dijarangkan otomatis di layar
sempit.

Sidebar (21 September 2026): menu dikelompokkan per kategori (Beranda,
Komunikasi, Kepegawaian, Kehadiran & Cuti, Penggajian, Pengembangan, Kepatuhan,
Analitik, Aplikasi Mobile) dengan sub-menu yang bisa dilipat; kategori halaman
aktif selalu terbuka, lipatan lain diingat di browser. Item aktif dicocokkan per
segmen jalur (`/whatsapp` tidak lagi menyala saat membuka `/whatsapp-saya`).

Yang dijamin di seluruh halaman yang ada: tiga pola navigasi menurut lebar
layar, tabel menjadi kartu di bawah 768px, dialog menjadi lembar-bawah di
ponsel, area aman perangkat ber-notch, fokus keyboard terlihat, notifikasi
berwarna sesuai jenis dengan penjelasan (bukan sekadar "Berhasil").

## Ketidakcocokan antar dokumen

- `arsitektur_aplikasi.md` menyebut jalur webhook `/api/whatsapp/webhook`;
  `step_development.md` menyebut `/api/webhook/bellys`. Kode mengikuti yang
  kedua.
- Seluruh dokumen menyebut Belly's; yang diimplementasikan Baileys (keputusan
  pengguna, 17 September 2026). Dokumen belum diperbarui.

## Urutan yang disarankan berikutnya

1. Mobile: hubungkan Firebase, uji di ponsel sungguhan (wajah & QR), verifikasi iOS
2. Suksesi dan onboarding — menunggu keputusan
