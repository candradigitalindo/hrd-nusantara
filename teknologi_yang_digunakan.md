# Teknologi yang Digunakan untuk Sistem HRD

Dokumen ini merinci berbagai teknologi yang digunakan dalam pengembangan sistem Human Resource Department (HRD) untuk perusahaan F&B, Restoran, dan Hotel. Teknologi dipilih berdasarkan skalabilitas, keamanan, kemudahan integrasi, dan kebutuhan fungsional sistem.

## 1. Backend (Server-Side Logic)

*   **Runtime Environment:** Node.js
    *   **Alasan:** Platform yang memungkinkan eksekusi JavaScript di sisi server, diperlukan untuk menjalankan Belly's dan komponen backend lainnya.
*   **Framework Web:** Express.js
    *   **Alasan:** Framework minimal dan fleksibel untuk Node.js, digunakan untuk membangun API dan mengatur routing.
*   **Bahasa Pemrograman:** TypeScript
    *   **Alasan:** Superset dari JavaScript yang menambahkan tipedata statis, meningkatkan kualitas dan keterbacaan kode untuk proyek berskala besar.
*   **Integrasi Platform Internal:**
    *   **Pemantauan Pesan WhatsApp:** Platform Belly's diinstal dan dijalankan secara lokal sebagai bagian integral dari backend. Backend dirancang untuk berinteraksi secara langsung dengan Belly's.

## 2. Frontend (Client-Side Interface & SSR)

*   **Framework:** Next.js
    *   **Alasan:** Framework React yang powerful, mendukung Server-Side Rendering (SSR) dan Static Site Generation (SSG), menjadikannya sangat SEO-friendly. Sangat cocok untuk aplikasi web yang informatif dan interaktif, serta menyediakan pengalaman pengguna yang cepat dan lancar.

## 3. Mobile Application (Android & iOS)

*   **Platform:** Flutter
    *   **Alasan:** Memungkinkan pembuatan aplikasi native untuk Android dan iOS dengan satu basis kode, menghemat waktu dan sumber daya pengembangan. Cocok untuk fitur presensi mobile, notifikasi, dan akses data karyawan.

## 4. Database

*   **Database Relasional:** PostgreSQL
    *   **Alasan:** Database SQL yang kuat, andal, dan open-source, sangat cocok untuk menyimpan data struktural seperti data karyawan, presensi, gaji, dan pelatihan.
*   **Database Cache:** Redis
    *   **Alasan:** Digunakan untuk caching data yang sering diakses (misalnya sesi login, konfigurasi umum) untuk meningkatkan kecepatan respons sistem.

## 5. Infrastruktur & Deployment

*   **Containerization:** Docker
    *   **Alasan:** Memudahkan packaging aplikasi Node.js dan dependensinya, memastikan konsistensi antara lingkungan development, testing, dan production.
*   **Orchestration:** Kubernetes (Opsional untuk skala besar)
    *   **Alasan:** Mengotomatiskan deployment, scaling, dan pengelolaan aplikasi Node.js containerized.
*   **Cloud Provider:** AWS, Google Cloud Platform (GCP), atau Azure
    *   **Alasan:** Menyediakan layanan hosting yang skalabel, aman, dan dapat diandalkan.

## 6. Layanan Pihak Ketiga & Integrasi

*   **Platform WhatsApp Business (Pemantauan Pesan):** Belly's
    *   **Deskripsi:** Platform yang diinstal secara lokal dan diintegrasikan langsung ke dalam backend Node.js/Express. Backend bertanggung jawab untuk mengelola dan berinteraksi dengan Belly's.
*   **WhatsApp Business API Integration (Absensi via WA):** Billays
    *   **Deskripsi:** Platform eksternal lain yang menyediakan akses ke WhatsApp Business API. Sistem HRD mengintegrasikan fitur absensi dengan mengirim/menerima pesan dari Billays sesuai dengan skenario absensi yang ditentukan. *(Catatan: Fitur ini sebelumnya dihapus dari dokumen utama, tetapi teknologinya tetap disebutkan jika diperlukan.)*
*   **Email Service:** SMTP Server (SendGrid, Mailgun, dll.)
    *   **Alasan:** Digunakan untuk notifikasi email otomatis (aktivasi akun, reset password, laporan, dll.).
*   **Push Notification Service:** Firebase Cloud Messaging (FCM) atau Apple Push Notification Service (APNs)
    *   **Alasan:** Digunakan untuk mengirim notifikasi instan ke aplikasi mobile karyawan (misalnya, notifikasi putus sesi Belly's, panggilan shift, dll.).

## 7. Alat Bantu Pengembangan & Testing

*   **Version Control:** Git
*   **IDE:** Visual Studio Code
*   **API Client:** Postman
*   **Testing Framework:** Jest
*   **Package Manager:** npm atau yarn

## 8. Keamanan

*   **SSL/TLS:** Untuk enkripsi komunikasi antara client dan server.
*   **JWT (JSON Web Tokens):** Untuk autentikasi dan autorisasi stateless.
*   **Praktik Secure Coding:** Input validation, sanitasi output, dan mitigasi terhadap kerentanan umum seperti SQL Injection dan XSS.