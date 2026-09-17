# Arsitektur Aplikasi HRD

Dokumen ini menjelaskan struktur dan komponen-komponen utama dari sistem Human Resource Department (HRD) untuk perusahaan F&B, Restoran, dan Hotel, beserta cara komponen-komponen tersebut saling berinteraksi.

## Gambaran Umum

Arsitektur sistem mengikuti pola **microservices** yang longgar (loosely coupled) dengan **backend Node.js/Express** sebagai inti logika bisnis dan integrasi. Frontend berupa aplikasi web **Next.js** yang informatif dan SEO-friendly. Aplikasi mobile **Flutter** menyediakan akses dan fungsionalitas penting secara langsung di tangan karyawan. Platform **Belly's** diintegrasikan secara erat sebagai komponen backend untuk manajemen pesan WhatsApp.

## Komponen Utama

### 1. Backend (Node.js, Express, TypeScript)
*   **Fungsi:** Inti dari sistem, menangani logika bisnis utama untuk semua modul (Manajemen Data Karyawan, Presensi, Cuti, Gaji, Rekrutmen, Penilaian Kinerja, Pelatihan, Kompetensi, Komunikasi Internal, Pemantauan WhatsApp, Analisis & Laporan), autentikasi, dan menyediakan API untuk frontend dan mobile.
*   **Integrasi:** Berinteraksi erat dengan Belly's untuk sinkronisasi dan manajemen percakapan WhatsApp. Dapat berintegrasi dengan layanan eksternal lainnya (POS, PMS, Akuntansi) melalui API.
*   **Database:** Terhubung ke PostgreSQL untuk menyimpan data utama. Gunakan cache Redis untuk data sementara yang sering diakses.
*   **Primary Key:** Gunakan **ULID** untuk semua primary key tabel di database PostgreSQL demi skalabilitas dan unik global.

#### Sub-Modul Backend:
*   **Employee Management:** API untuk CRUD data karyawan, dokumen, dan status.
*   **Attendance Management:** API untuk menerima data absensi dari mobile, validasi (GPS, Face Rec, QR), jadwal shift, laporan, dan manajemen lembur.
*   **Leave & Permission Management:** API untuk pengajuan, approval, pelacakan saldo cuti, dan integrasi kalender.
*   **Payroll Management:** API untuk perhitungan gaji otomatis (terintegrasi dengan presensi & lembur), manajemen tunjangan/potongan, dan generasi slip gaji.
*   **Recruitment Management:** API untuk publikasi lowongan, pelacakan pelamar, workflow wawancara, onboarding, dan integrasi psikotes (via layanan eksternal).
*   **Performance & Evaluation:** API untuk formulir penilaian kustom, penilaian berkala, 360-degree feedback, dan catatan diskusi.
*   **Training & Development:** API untuk manajemen program pelatihan, jadwal, pendaftaran, evaluasi pasca-pelatihan, dan riwayat.
*   **Competency & Certification:** API untuk manajemen standar kompetensi dan pelacakan sertifikasi.
*   **Internal Communication:** API untuk announcement, forum diskusi, dan survei karyawan.
*   **WhatsApp Monitoring (Belly's):** API untuk sinkronisasi percakapan, arsip sentral, pelacakan isu, dan notifikasi putus sesi ke mobile.
*   **Analytics & Reporting:** API untuk menyediakan data mentah dan agregat untuk dashboard dan laporan kustom.
*   **Additional Features:** API untuk audit trail, manajemen keluhan/disiplin, dan perencanaan suksesi (jika diperlukan).

### 2. Frontend Web (Next.js)
*   **Fungsi:** Dashboard dan antarmuka utama untuk administrator HRD dan manajer. Menyediakan visualisasi data, laporan, dan alur kerja administratif untuk semua modul.
*   **Interaksi:** Berkomunikasi dengan backend melalui RESTful API atau GraphQL yang disediakan oleh Express.
*   **Rendering:** Menggunakan Server-Side Rendering (SSR) dan Static Site Generation (SSG) untuk performa dan SEO yang optimal.

#### Fitur Frontend:
*   Dashboard HR (ringkasan data, KPI).
*   Modul-modul sesuai daftar di backend (Employee, Attendance, Leave, Payroll, Recruitment, Performance, Training, dsb.).
*   Forum/Komunikasi Internal.
*   Laporan & Analisis (dengan visualisasi).
*   Manajemen Pengguna & Hak Akses.

### 3. Mobile Application (Flutter)
*   **Fungsi:** Aplikasi untuk karyawan, menyediakan fitur absensi (GPS, Face Rec, QR), notifikasi, akses ke slip gaji, pengajuan cuti/izin, melihat jadwal, dan akses ke arsip percakapan (dengan otorisasi). Juga bisa untuk mengisi survei atau memberikan umpan balik.
*   **Interaksi:** Berkomunikasi dengan backend melalui API yang sama yang digunakan oleh frontend web.
*   **Platform:** Dikompilasi menjadi aplikasi native untuk Android dan iOS.

#### Fitur Mobile:
*   Login & Profil.
*   Absensi (GPS, Wajah, QR).
*   Pengajuan Cuti/Izin.
*   Melihat Slip Gaji & Jadwal Kerja.
*   Notifikasi (Presensi, Cuti, Belly's disconnect, dll.).
*   Akses ke forum/komunikasi internal (basic).
*   Pengisian Survei/Feedback.

### 4. Platform WhatsApp (Belly's)
*   **Fungsi:** Platform WhatsApp Business API yang diinstal dan diintegrasikan secara langsung ke backend.
*   **Integrasi:** Backend bertugas untuk menginisialisasi, mengelola, dan menyinkronkan percakapan dari Belly's ke database utama. Belly's menyediakan WebSocket atau webhook endpoint yang ditangani oleh backend Express.
*   **Data Flow:** Percakapan masuk dari WhatsApp -> Belly's -> Backend Express (melalui webhook/WebSocket) -> Data diproses dan disimpan ke tabel `whatsapp_conversations` di PostgreSQL (menggunakan ULID).

### 5. Database (PostgreSQL & Redis)
*   **PostgreSQL:**
    *   **Fungsi:** Database utama untuk menyimpan semua data struktural dari semua modul (employees, attendance, leaves, payroll, candidates, performance_reviews, training_records, conversations, announcements, dll.).
    *   **Skema:** Dirancang dengan primary key menggunakan **ULID** untuk semua tabel.
*   **Redis:**
    *   **Fungsi:** Cache untuk meningkatkan performa, menyimpan sesi, dan data sementara lainnya.

## Alur Data Utama

1.  **Absensi Karyawan (Mobile):** Aplikasi Flutter mengumpulkan data (lokasi, wajah, QR) -> Kirim ke API `/api/attendance/check-in` di Backend Node.js -> Data divalidasi dan disimpan ke tabel `attendance` di PostgreSQL (dengan ULID).
2.  **Pemantauan Percakapan (WhatsApp via Belly's):** Pesan masuk di WhatsApp -> Diterima oleh Belly's -> Belly's kirim webhook ke endpoint `/api/whatsapp/webhook` di Backend Node.js -> Backend proses dan simpan percakapan ke tabel `whatsapp_conversations` di PostgreSQL (dengan ULID).
3.  **Perekrutan (Frontend/Admin):** Admin membuat lowongan di dashboard Next.js -> Data dikirim ke API `/api/recruitment/job-postings` di Backend -> Data disimpan ke tabel `job_postings` di PostgreSQL (dengan ULID).
4.  **Akses Data (Admin/Manager):** Browser mengakses aplikasi Next.js -> Next.js mengambil data dari Backend Node.js melalui API (misalnya `/api/employees`, `/api/reports/turnover`) -> Backend mengambil data dari PostgreSQL -> Data ditampilkan di dashboard Next.js.
5.  **Penilaian Kinerja (Frontend):** Atasan mengisi formulir penilaian di Next.js -> Data dikirim ke API `/api/performance/evaluations` di Backend -> Data disimpan ke tabel `performance_evaluations` di PostgreSQL (dengan ULID).

## Infrastruktur
*   Semua komponen (Backend, Frontend, Mobile build artifacts) dideploy menggunakan **Docker**.
*   **Kubernetes** (opsional) digunakan untuk manajemen deployment, scaling, dan load balancing di cloud.
*   Hosted di **Cloud Provider** (AWS/GCP/Azure).