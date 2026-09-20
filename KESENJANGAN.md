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
| 2 | Presensi — GPS, wajah, QR, shift, validasi, lembur, laporan | ✅ | Pengenalan wajah dan anti-spoofing berjalan di server sendiri. |
| 3 | Cuti — tipe, pengajuan, saldo, kalender | ✅ | Cuti bersama memotong kuota tahunan otomatis — hanya karyawan pola kerja tetap yang libur; staf shift outlet/hotel tidak dipotong. Dipulihkan bila hari liburnya dibatalkan; saldo yang dibuat belakangan ikut menanggung. |
| 4 | Payroll — hitung otomatis, BPJS, PPh 21, slip digital | ✅ | PPh 21 opsional, tidak aktif secara bawaan. |
| 5 | Rekrutmen — lowongan, pelamar, wawancara, hire | ✅ | |
| 5 | Rekrutmen — psikotes | ✅ | Hasil per kandidat dengan skor/maksimal, interpretasi naratif, penilai. Hanya HR. |
| 5 | Rekrutmen — onboarding digital | 🟡 | Hire membuat karyawan; orientasi/pelatihan dasar lewat modul pelatihan. Tidak ada alur onboarding tersendiri. |
| 6 | Kinerja — form kustom, berkala, 360°, diskusi, umpan balik | ✅ | |
| 7 | Pelatihan — program, jadwal, pendaftaran, evaluasi, riwayat | ✅ | |
| 8 | Kompetensi & sertifikasi | ✅ | |
| 9 | Komunikasi — pengumuman, chat, survei | ✅ | |
| 10 | WhatsApp — sinkron, arsip, pelacakan isu, notifikasi putus sesi, scan ulang | ✅ | Memakai **Baileys**, bukan Belly's. Jalur webhook lama tetap ada. |
| 11 | Analisis — dashboard, turnover, biaya, produktivitas, data mentah | ✅ | |
| 12 | Integrasi POS / PMS / akuntansi | ➖ | Tidak ada sistem luar yang ditentukan untuk diintegrasikan. |
| 13 | Enkripsi — percakapan | ✅ | AES-256-GCM + indeks buta. |
| 13 | Enkripsi — wajah, lokasi | ✅ | Embedding wajah AES-256-GCM sebagai biner bertanda; koordinat presensi sebagai JSON terenkripsi, kolom terbuka dihapus. Kunci enkripsi kini wajib. |
| 13 | Akses berjenjang | ✅ | |
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
| Cuti — saldo per jenis, ajukan (dengan sisa saldo & syarat lampiran), batalkan, antrean persetujuan | ✅ |
| Slip gaji karyawan — daftar periode, rincian tunjangan/potongan, cetak | ✅ |
| Payroll HR — batch (buat, hitung, setujui/kembalikan), rincian slip per batch, yang dilewati beserta alasannya | ✅ |
| Struktur gaji per karyawan (HR) — gaji pokok & riwayat, komponen tunjangan/potongan | ✅ |
| Rekrutmen — lowongan (buat/sunting/tayangkan/tutup), pelamar (tahap, penolakan beralasan, jadwal wawancara, psikotes, terima → karyawan), wawancara & umpan balik pewawancara, corong seleksi | ✅ |
| Komunikasi — pengumuman (prioritas, sasaran departemen, konfirmasi wajib, laporan siapa belum membaca), survei (pembuat pertanyaan skala/pilihan/teks, anonim, pengisian, hasil agregat) | ✅ |
| Komunikasi — chat tim: ruang per tim/departemen, tertutup atau terbuka, moderator menambah anggota, pesan dengan penanda hapus (jejak audit tetap), daftar ruang dengan pesan terakhir | ✅ | Penyegaran berkala 5 detik, bukan WebSocket. |
| Pelatihan — program (wajib/opsional, masa berlaku, nilai lulus), jadwal sesi & kuota/daftar tunggu, pendaftaran & pembatalan, kehadiran, evaluasi & sertifikat, riwayat karyawan, laporan kepatuhan (siapa yang belum/kedaluwarsa) | ✅ |
| Kinerja — siklus (triwulan/semester/tahunan), form KPI per jabatan dengan bobot, penugasan penilai 360° (diri/atasan/rekan/bawahan), pengisian skor per kriteria, akui hasil, catatan diskusi, ringkasan per jenis penilai, umpan balik berkelanjutan | ✅ |
| Kompetensi & sertifikasi — kamus kompetensi berskala tingkat, standar per jabatan, penilaian tingkat karyawan, kesenjangan (kesiapan %) per karyawan & laporan lintas departemen, jenis sertifikasi (wajib, masa berlaku, tautan pelatihan), catatan sertifikat dengan status berlaku/segera/kedaluwarsa/dicabut | ✅ |
| WhatsApp — nomor, QR, arsip & pencarian | ✅ |
| Jejak audit | ✅ |
| Mobile Flutter (`mobile/`) — login & profil, presensi GPS/wajah/QR + riwayat, cuti (saldo, ajukan, batalkan), slip gaji, jadwal shift, pengumuman & konfirmasi, survei, chat tim, status sesi WhatsApp + QR scan ulang, push FCM | 🟡 | Analyzer bersih, 23 tes lulus. Push butuh `flutterfire configure` (proyek hrd-app-635cb). iOS belum diverifikasi: simulator belum terpasang di mesin ini. |
| Keluhan & disiplin — ajukan, catat SP, tindak lanjuti | ✅ |
| Analisis & laporan — perputaran (alasan, departemen, masa kerja saat keluar), biaya SDM (komposisi, biaya per rekrutan), produktivitas (terhadap shift terjadwal; manajer dibatasi departemennya), data mentah 5 kumpulan dengan unduh CSV untuk laporan kustom | ✅ | CSV maksimal 5.000 baris per unduhan. |

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
