# Step Development Aplikasi HRD

Dokumen ini menyediakan panduan langkah-demi-langjang untuk mengembangkan sistem HRD, mulai dari persiapan lingkungan hingga integrasi komponen utama, mencakup semua modul fitur.

## Prasyarat
*   Instalasi Node.js (v18+) dan npm/yarn.
*   Instalasi Docker dan Docker Compose.
*   Instalasi Git.
*   Instalasi IDE (disarankan VSCode).
*   Setup akun Cloud Provider (AWS/GCP/Azure) opsional untuk deployment.

## 1. Setup Proyek dan Repository

1.  Buat repository Git baru (`hrd-nusantara`).
2.  Inisialisasi struktur folder dasar:
    ```
    hrd-nusantara/
    ├── backend/
    ├── frontend/
    ├── mobile/
    └── docs/
    ```
3.  Tambahkan `.gitignore` untuk masing-masing komponen.

## 2. Pengembangan Backend (Node.js, Express, TypeScript)

### 2.1. Setup Lingkungan
1.  Masuk ke direktori `backend`.
2.  Inisialisasi proyek Node.js: `npm init -y`.
3.  Install dependensi utama: `npm install express cors helmet morgan dotenv`.
4.  Install dependensi TypeScript: `npm install -D typescript @types/node @types/express ts-node nodemon`.
5.  Buat file konfigurasi `tsconfig.json`.
6.  Buat file `nodemon.json` untuk development.

### 2.2. Setup Database (PostgreSQL & Redis)
1.  Buat file `docker-compose.yml` di root proyek untuk menjalankan PostgreSQL dan Redis secara lokal.
2.  Install ORM/library query builder seperti `typeorm` atau `prisma`.
3.  Definisikan entity/model untuk semua modul utama:
    *   `Employee` (dengan ULID)
    *   `Attendance` (dengan ULID)
    *   `Leave` (dengan ULID)
    *   `Payroll` (dengan ULID)
    *   `Candidate` (Rekrutmen) (dengan ULID)
    *   `JobPosting` (Rekrutmen) (dengan ULID)
    *   `PerformanceReview` (dengan ULID)
    *   `TrainingSession` (dengan ULID)
    *   `TrainingRegistration` (dengan ULID)
    *   `CompetencyStandard` (dengan ULID)
    *   `CertificationRecord` (dengan ULID)
    *   `Announcement` (dengan ULID)
    *   `ChatMessage` (Forum) (dengan ULID)
    *   `Survey` (dengan ULID)
    *   `SurveyResponse` (dengan ULID)
    *   `WhatsAppConversation` (dengan ULID)
    *   `ComplaintOrDisciplinaryAction` (Opsional) (dengan ULID)
    *   [Tambahkan entity lain sesuai kebutuhan]
4.  Buat migrasi awal untuk membuat skema database dengan ULID.

### 2.3. Implementasi Core API & Authentication
1.  Buat route dan controller untuk manajemen data dasar (Employee CRUD, dll.).
2.  Implementasikan middleware autentikasi (JWT).
3.  Tambahkan logging dan error handling.

### 2.4. Implementasi Modul-Modul API

#### 2.4.1. Modul Presensi
1.  Endpoint untuk `POST /api/attendance/check-in` (menerima data dari mobile).
2.  Validasi lokasi (GPS), verifikasi wajah (opsional, bisa eksternal).
3.  Endpoint untuk `GET /api/attendance/reports`.
4.  Endpoint untuk manajemen jadwal shift dan lembur.

#### 2.4.2. Modul Cuti & Izin
1.  Endpoint untuk `POST /api/leaves/request`.
2.  Endpoint untuk approval/rejection (`PUT /api/leaves/:id/status`).
3.  Endpoint untuk melihat saldo cuti dan kalender.

#### 2.4.3. Modul Gaji & Tunjangan
1.  Endpoint untuk perhitungan gaji otomatis (terintegrasi presensi).
2.  Endpoint untuk manajemen tunjangan/potongan.
3.  Endpoint untuk akses slip gaji.

#### 2.4.4. Modul Rekrutmen
1.  Endpoint untuk publikasi lowongan (`POST /api/recruitment/job-postings`).
2.  Endpoint untuk pelacakan pelamar (`POST /api/recruitment/candidates`).
3.  Endpoint untuk workflow wawancara.
4.  (Opsional) Endpoint untuk integrasi psikotes eksternal.

#### 2.4.5. Modul Penilaian Kinerja
1.  Endpoint untuk membuat formulir penilaian.
2.  Endpoint untuk pengisian penilaian (`POST /api/performance/evaluations`).
3.  Endpoint untuk 360-degree feedback.
4.  Endpoint untuk catatan diskusi.

#### 2.4.6. Modul Pelatihan & Pengembangan
1.  Endpoint untuk manajemen program pelatihan (`POST /api/training/sessions`).
2.  Endpoint untuk pendaftaran pelatihan.
3.  Endpoint untuk evaluasi pasca-pelatihan.

#### 2.4.7. Modul Kompetensi & Sertifikasi
1.  Endpoint untuk definisi kompetensi.
2.  Endpoint untuk pelacakan sertifikasi karyawan.

#### 2.4.8. Modul Komunikasi Internal
1.  Endpoint untuk announcement (`POST /api/announcements`).
2.  (Opsional) Endpoint untuk forum diskusi dasar.

#### 2.4.9. Modul Pemantauan WhatsApp (Integrasi Belly's)
1.  Setup Belly's lokal.
2.  Konfigurasi Belly's webhook ke `/api/webhook/bellys`.
3.  Handler untuk webhook Belly's.
4.  Simpan percakapan ke `whatsapp_conversations` (dengan ULID).
5.  Endpoint untuk notifikasi disconnect Belly's ke mobile.

#### 2.4.10. Modul Analisis & Laporan
1.  Endpoint untuk data mentah (`GET /api/reports/raw-data`).
2.  Endpoint untuk data agregat (`GET /api/reports/aggregate`).
3.  Endpoint untuk laporan kustom (jika diperlukan).

### 2.5. Testing Backend
1.  Tulis unit test untuk fungsi-fungsi penting (menggunakan Jest).
2.  Lakukan testing integrasi antar endpoint dan database.

## 3. Pengembangan Frontend Web (Next.js)

### 3.1. Setup Lingkungan
1.  Masuk ke direktori `frontend`.
2.  Inisialisasi proyek Next.js: `npx create-next-app@latest --typescript`.
3.  Install dependensi tambahan (misalnya `axios` untuk request API, `react-hook-form` untuk form).

### 3.2. Implementasi Layout dan Navigasi
1.  Buat layout utama (header, sidebar, footer).
2.  Implementasikan navigasi berdasarkan role (admin, manager) untuk semua modul.

### 3.3. Implementasi Halaman dan Fitur per Modul
1.  **Employee Management:** Halaman list, detail, CRUD.
2.  **Attendance Management:** Halaman absensi, laporan, jadwal shift.
3.  **Leave & Permission:** Halaman pengajuan, approval queue, kalender.
4.  **Payroll Management:** Halaman perhitungan, slip gaji, manajemen tunjangan.
5.  **Recruitment Management:** Halaman lowongan, pelamar, workflow wawancara, onboarding.
6.  **Performance & Evaluation:** Halaman formulir, daftar penilaian, detail evaluasi.
7.  **Training & Development:** Halaman daftar pelatihan, pendaftaran, laporan.
8.  **Competency & Certification:** Halaman standar, pelacakan.
9.  **Internal Communication:** Halaman announcement, forum (basic).
10. **WhatsApp Monitoring:** Halaman arsip percakapan, pelacakan isu.
11. **Analytics & Reporting:** Halaman dashboard, laporan kustom.
12. Tambahkan fitur filtering, searching, dan pagination di semua halaman yang relevan.

### 3.4. Implementasi Dashboard dan Laporan
1.  Gunakan charting library (misalnya `recharts`) untuk menampilkan grafik (turnover rate, jam kerja, kinerja, dll.).
2.  Hubungkan ke endpoint API dari backend.

## 4. Pengembangan Mobile Application (Flutter)

### 4.1. Setup Lingkungan
1.  Instalasi Flutter SDK.
2.  Setup emulator/device untuk testing Android dan iOS.

### 4.2. Setup Proyek
1.  Buat proyek Flutter baru.
2.  Tambahkan dependensi (misalnya `http` untuk API, `geolocator` untuk GPS, `camera` untuk face rec, `qr_flutter` dan `qr_code_scanner` untuk QR, `firebase_messaging` untuk notifikasi).

### 4.3. Implementasi Fitur Login dan Autentikasi
1.  Buat layar login.
2.  Implementasikan penyimpanan token JWT secara lokal.

### 4.4. Implementasi Fitur per Modul (Karyawan)
1.  **Attendance:** Layar absensi (GPS, Wajah, QR).
2.  **Leave & Permission:** Layar pengajuan cuti.
3.  **Payroll:** Layar untuk melihat slip gaji.
4.  **Schedule:** Layar untuk melihat jadwal shift.
5.  **Communication:** (Basic) Layar untuk melihat announcement.
6.  **Notifications:** Implementasi push notification (FCM) untuk event-event penting (absen berhasil, cuti disetujui, Belly's disconnect, dll.).

### 4.5. Testing Mobile
1.  Testing unit dan widget.
2.  Testing integrasi API.

## 5. Integrasi dan Testing Keseluruhan

### 5.1. Testing Integrasi
1.  Pastikan frontend dan mobile dapat berkomunikasi dengan backend.
2.  Uji alur bisnis end-to-end untuk setiap modul.

### 5.2. Testing End-to-End (E2E)
1.  Gunakan alat seperti Cypress (untuk web) atau Detox (untuk mobile) untuk testing E2E.

## 6. Deployment

### 6.1. Build Artifact
1.  Build aplikasi Next.js (`npm run build`).
2.  Build aplikasi Flutter untuk Android dan iOS.

### 6.2. Dockerize
1.  Buat `Dockerfile` untuk backend dan frontend.
2.  Gunakan `docker-compose` untuk menjalankan keseluruhan stack (backend, frontend, db, redis, bellys) secara lokal dalam mode produksi.

### 6.3. Deploy ke Cloud
1.  Upload image Docker ke registry (ECR, GCR, dll.).
2.  Deploy ke ECS/EKS (AWS), GKE (GCP), atau layanan Kubernetes lainnya.
3.  Konfigurasi load balancer, domain, dan SSL.