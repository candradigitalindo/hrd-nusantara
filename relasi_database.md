# Relasi Database Aplikasi HRD

Dokumen ini menjelaskan struktur dan hubungan antar tabel dalam database PostgreSQL untuk sistem HRD, sesuai dengan semua modul fitur yang telah didefinisikan. Primary key untuk semua tabel adalah ULID.

## Entitas dan Relasi

### 1. Employee (Karyawan)
*   **Fields:** `id (ULID PK)`, `nik`, `name`, `email`, `phone_number`, `address`, `date_of_birth`, `status`, `department_id`, `position_id`, `created_at`, `updated_at`
*   **Relasi:**
    *   `department_id` -> `Department.id`
    *   `position_id` -> `Position.id`
    *   `Employee` 1 -----> * `Attendance` (employee_id)
    *   `Employee` 1 -----> * `Leave` (employee_id)
    *   `Employee` 1 -----> * `Payroll` (employee_id)
    *   `Employee` 1 -----> * `PerformanceReview` (reviewee_id)
    *   `Employee` 1 -----> * `PerformanceReview` (reviewer_id)
    *   `Employee` 1 -----> * `TrainingRegistration` (employee_id)
    *   `Employee` 1 -----> * `CertificationRecord` (employee_id)
    *   `Employee` 1 -----> * `WhatsAppConversation` (employee_whatsapp_number / atau employee_id jika disimpan)
    *   `Employee` 1 -----> * `ComplaintOrDisciplinaryAction` (employee_id)

### 2. Department (Departemen)
*   **Fields:** `id (ULID PK)`, `name`, `description`, `created_at`, `updated_at`
*   **Relasi:**
    *   `Department` * <-----> 1 `Employee` (department_id)
    *   `Department` 1 -----> * `Position` (department_id)

### 3. Position (Posisi/Jabatan)
*   **Fields:** `id (ULID PK)`, `name`, `department_id`, `description`, `created_at`, `updated_at`
*   **Relasi:**
    *   `Position` * <-----> 1 `Employee` (position_id)
    *   `Position` 1 -----> * `CompetencyStandard` (position_id)
    *   `Position` 1 -----> * `JobPosting` (position_id)

### 4. Attendance (Presensi)
*   **Fields:** `id (ULID PK)`, `employee_id`, `check_in_time`, `check_out_time`, `location_gps`, `face_image_url`, `qr_code_scanned`, `shift_schedule_id`, `overtime_hours`, `status`, `created_at`, `updated_at`
*   **Relasi:**
    *   `Attendance` * <-----> 1 `Employee` (employee_id)
    *   `Attendance` * <-----> 1 `ShiftSchedule` (shift_schedule_id)

### 5. Leave (Cuti & Izin)
*   **Fields:** `id (ULID PK)`, `employee_id`, `leave_type`, `start_date`, `end_date`, `reason`, `status`, `approved_by`, `created_at`, `updated_at`
*   **Relasi:**
    *   `Leave` * <-----> 1 `Employee` (employee_id)
    *   `Leave` * <-----> 1 `Employee` (approved_by) (Self-referencing untuk atasan yang menyetujui)

### 6. Payroll (Gaji & Tunjangan)
*   **Fields:** `id (ULID PK)`, `employee_id`, `pay_period_start`, `pay_period_end`, `basic_salary`, `allowances_json`, `deductions_json`, `overtime_pay`, `net_salary`, `status`, `created_at`, `updated_at`
*   **Relasi:**
    *   `Payroll` * <-----> 1 `Employee` (employee_id)
    *   (Bisa terkait dengan `Attendance` dan `Leave` untuk perhitungan)

### 7. Candidate (Kandidat Rekrutmen)
*   **Fields:** `id (ULID PK)`, `name`, `email`, `phone_number`, `status`, `applied_position_id`, `application_date`, `cv_url`, `cover_letter_url`, `created_at`, `updated_at`
*   **Relasi:**
    *   `Candidate` * <-----> 1 `JobPosting` (applied_position_id)
    *   `Candidate` 1 -----> * `Interview` (candidate_id) *(Entity tambahan untuk wawancara)*
    *   `Candidate` 1 -----> * `PsychometricTestResult` (candidate_id) *(Entity tambahan untuk psikotes)*

### 8. JobPosting (Lowongan Pekerjaan)
*   **Fields:** `id (ULID PK)`, `title`, `description`, `requirements`, `position_id`, `posted_date`, `deadline`, `status`, `created_by`, `created_at`, `updated_at`
*   **Relasi:**
    *   `JobPosting` 1 -----> * `Candidate` (applied_position_id)
    *   `JobPosting` * <-----> 1 `Position` (position_id)
    *   `JobPosting` * <-----> 1 `Employee` (created_by)

### 9. PerformanceReview (Penilaian Kinerja)
*   **Fields:** `id (ULID PK)`, `reviewee_id`, `reviewer_id`, `period`, `form_template_id`, `answers_json`, `rating`, `feedback`, `status`, `created_at`, `updated_at`
*   **Relasi:**
    *   `PerformanceReview` * <-----> 1 `Employee` (reviewee_id)
    *   `PerformanceReview` * <-----> 1 `Employee` (reviewer_id)
    *   `PerformanceReview` * <-----> 1 `PerformanceFormTemplate` (form_template_id) *(Entity untuk template formulir)*

### 10. TrainingSession (Sesi Pelatihan)
*   **Fields:** `id (ULID PK)`, `title`, `description`, `trainer`, `start_datetime`, `end_datetime`, `location`, `max_participants`, `status`, `created_at`, `updated_at`
*   **Relasi:**
    *   `TrainingSession` 1 -----> * `TrainingRegistration` (training_session_id)

### 11. TrainingRegistration (Pendaftaran Pelatihan)
*   **Fields:** `id (ULID PK)`, `employee_id`, `training_session_id`, `registration_date`, `status`, `attendance_status`, `evaluation_score`, `created_at`, `updated_at`
*   **Relasi:**
    *   `TrainingRegistration` * <-----> 1 `Employee` (employee_id)
    *   `TrainingRegistration` * <-----> 1 `TrainingSession` (training_session_id)

### 12. CompetencyStandard (Standar Kompetensi)
*   **Fields:** `id (ULID PK)`, `position_id`, `competency_name`, `description`, `required_level`, `created_at`, `updated_at`
*   **Relasi:**
    *   `CompetencyStandard` * <-----> 1 `Position` (position_id)

### 13. CertificationRecord (Rekam Sertifikasi)
*   **Fields:** `id (ULID PK)`, `employee_id`, `certification_name`, `issuing_organization`, `issue_date`, `expiry_date`, `certificate_url`, `status`, `created_at`, `updated_at`
*   **Relasi:**
    *   `CertificationRecord` * <-----> 1 `Employee` (employee_id)

### 14. Announcement (Pengumuman)
*   **Fields:** `id (ULID PK)`, `title`, `content`, `author_employee_id`, `publish_date`, `target_department_id`, `created_at`, `updated_at`
*   **Relasi:**
    *   `Announcement` * <-----> 1 `Employee` (author_employee_id)
    *   `Announcement` * <-----> 1 `Department` (target_department_id) (opsional, jika pengumuman untuk dept. tertentu)

### 15. ChatMessage (Pesan Forum - Contoh relasi Many-to-Many)
*   **Fields:** `id (ULID PK)`, `sender_employee_id`, `room_id`, `message`, `timestamp`, `created_at`
*   **Relasi:**
    *   `ChatMessage` * <-----> 1 `Employee` (sender_employee_id)
    *   `ChatMessage` * <-----> 1 `ChatRoom` (room_id) *(Entity tambahan untuk ruang obrolan)*

### 16. Survey (Survei Kepuasan Karyawan)
*   **Fields:** `id (ULID PK)`, `title`, `description`, `questions_json`, `target_audience`, `start_date`, `end_date`, `status`, `created_by`, `created_at`, `updated_at`
*   **Relasi:**
    *   `Survey` * <-----> 1 `Employee` (created_by)
    *   `Survey` 1 -----> * `SurveyResponse` (survey_id)

### 17. SurveyResponse (Jawaban Survei)
*   **Fields:** `id (ULID PK)`, `survey_id`, `respondent_employee_id`, `answers_json`, `submitted_at`, `created_at`
*   **Relasi:**
    *   `SurveyResponse` * <-----> 1 `Survey` (survey_id)
    *   `SurveyResponse` * <-----> 1 `Employee` (respondent_employee_id)

### 18. WhatsAppConversation (Arsip Percakapan Belly's)
*   **Fields:** `id (ULID PK)`, `sender_whatsapp_number`, `receiver_whatsapp_number`, `message_body`, `timestamp`, `direction`, `employee_whatsapp_number` (jika terkait karyawan), `conversation_topic`, `created_at`
*   **Relasi:**
    *   `WhatsAppConversation` * <-----> 1 `Employee` (employee_whatsapp_number) (opsional, jika nomor terkait karyawan)

### 19. ComplaintOrDisciplinaryAction (Keluhan/Disiplin - Opsional)
*   **Fields:** `id (ULID PK)`, `employee_id`, `type`, `description`, `status`, `reported_by`, `handled_by`, `resolution_notes`, `created_at`, `updated_at`
*   **Relasi:**
    *   `ComplaintOrDisciplinaryAction` * <-----> 1 `Employee` (employee_id)
    *   `ComplaintOrDisciplinaryAction` * <-----> 1 `Employee` (reported_by) (Self-referencing)
    *   `ComplaintOrDisciplinaryAction` * <-----> 1 `Employee` (handled_by) (Self-referencing)

### 20. ShiftSchedule (Jadwal Shift)
*   **Fields:** `id (ULID PK)`, `employee_id`, `date`, `start_time`, `end_time`, `break_duration`, `status`, `created_at`, `updated_at`
*   **Relasi:**
    *   `ShiftSchedule` * <-----> 1 `Employee` (employee_id)
    *   `ShiftSchedule` 1 -----> * `Attendance` (shift_schedule_id)

*(Catatan: Beberapa entitas seperti `PerformanceFormTemplate`, `ChatRoom`, `Interview`, `PsychometricTestResult` adalah entitas tambahan yang mungkin diperlukan untuk mendukung fitur-fitur tertentu dan disambungkan ke entitas utama melalui relasi.)*