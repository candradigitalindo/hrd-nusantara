// src/config/env.ts
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Konfigurasi divalidasi sekali saat boot. Kalau ada yang salah, proses
 * langsung berhenti dengan pesan jelas — jauh lebih mudah didiagnosa
 * daripada JWT_SECRET kosong yang baru ketahuan sebagai 401 misterius
 * di tengah produksi.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL wajib diisi'),
  REDIS_URL: z.string().optional(),

  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET minimal 32 karakter. Generate dengan: openssl rand -base64 48'),
  JWT_EXPIRES_IN: z.string().default('8h'),

  CORS_ORIGINS: z.string().default('http://localhost:3001'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  // Zona waktu operasional. Jadwal shift disimpan sebagai tanggal + "HH:mm"
  // lokal, jadi perlu zona acuan untuk diubah menjadi waktu absolut.
  APP_TIMEZONE: z.string().default('Asia/Jakarta'),

  // Toleransi keterlambatan. Datang dalam rentang ini dianggap tepat waktu.
  ATTENDANCE_LATE_TOLERANCE_MINUTES: z.coerce.number().int().min(0).max(120).default(5),

  // Kerja lewat jam pulang baru dihitung lembur setelah melewati ambang ini,
  // supaya kelebihan beberapa menit tidak jadi tagihan lembur.
  ATTENDANCE_MIN_OVERTIME_MINUTES: z.coerce.number().int().min(0).max(240).default(30),

  // Presensi terbuka yang lebih tua dari ini dianggap lupa check-out.
  ATTENDANCE_MAX_SHIFT_HOURS: z.coerce.number().int().min(4).max(48).default(16),

  // --- Pengenalan wajah ---
  // Bobot model disimpan sendiri; tidak ada layanan luar yang dihubungi.
  FACE_MODEL_DIR: z.string().default('./models/buffalo_s'),
  FACE_MODEL_NAME: z.string().default('buffalo_s'),
  FACE_ONNX_THREADS: z.coerce.number().int().min(1).max(16).default(2),

  // Ambang kemiripan kosinus untuk memutuskan "orang yang sama".
  // Nilai ini menentukan keseimbangan antara orang lain yang lolos absen
  // dan karyawan asli yang ditolak — ubah hanya setelah diukur ulang.
  FACE_MATCH_THRESHOLD: z.coerce.number().min(0.1).max(0.95).default(0.45),
  FACE_DETECTION_THRESHOLD: z.coerce.number().min(0.1).max(0.95).default(0.5),

  // Wajah yang terlalu kecil di frame menghasilkan embedding yang buruk.
  FACE_MIN_BOX_PX: z.coerce.number().int().min(24).max(400).default(60),
  FACE_MAX_IMAGE_BYTES: z.coerce.number().int().min(100_000).default(8_000_000),

  // Kalau dimatikan, presensi metode "face" ditolak alih-alih diam-diam
  // diterima tanpa verifikasi.
  FACE_RECOGNITION_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // --- Deteksi wajah hidup (anti-spoofing) ---
  FACE_ANTISPOOF_MODEL: z.string().default('./models/antispoof/minifasnet_v2.onnx'),

  // Presensi ditolak bila peluang "wajah hidup" di bawah ambang ini.
  FACE_LIVENESS_THRESHOLD: z.coerce.number().min(0.1).max(0.99).default(0.6),

  // Bisa dimatikan sementara kalau ternyata terlalu banyak karyawan asli
  // yang tertolak di kondisi cahaya tertentu — lebih baik dimatikan sadar
  // daripada HR menonaktifkan verifikasi wajah seluruhnya.
  FACE_LIVENESS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // --- Penggajian ---
  // Upah lembur mengikuti Kepmenaker 102/2004: upah sejam adalah 1/173 upah
  // sebulan, jam pertama dibayar 1,5 kali, jam berikutnya 2 kali.
  // Dibuat dapat dikonfigurasi karena perusahaan boleh memberi lebih baik
  // daripada ketentuan minimum, dan regulasinya bisa berubah.
  OVERTIME_HOURS_DIVISOR: z.coerce.number().min(1).max(400).default(173),
  OVERTIME_FIRST_HOUR_MULTIPLIER: z.coerce.number().min(1).max(5).default(1.5),
  OVERTIME_NEXT_HOURS_MULTIPLIER: z.coerce.number().min(1).max(5).default(2),

  /// Pembulatan rupiah pada hasil akhir tiap komponen.
  PAYROLL_ROUNDING: z.coerce.number().int().min(0).max(1000).default(1),

  // --- Integrasi WhatsApp (Belly's) ---
  // Kunci bersama untuk memverifikasi tanda tangan webhook. Endpoint webhook
  // dipanggil mesin, bukan pengguna, jadi tidak bisa memakai token JWT.
  BELLYS_WEBHOOK_SECRET: z
    .string()
    .min(32, 'BELLYS_WEBHOOK_SECRET minimal 32 karakter. Generate: openssl rand -base64 48')
    .optional(),

  // Kalau dimatikan, webhook menolak semua kiriman alih-alih diam-diam
  // menerimanya tanpa verifikasi.
  WHATSAPP_MONITORING_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Menyalakan driver Baileys: backend membuka koneksi WhatsApp sendiri,
  // tanpa layanan pihak ketiga. Terpisah dari WHATSAPP_MONITORING_ENABLED
  // supaya arsip dan webhook tetap bisa dipakai tanpa membuka koneksi —
  // berguna saat backend dijalankan lebih dari satu instance, karena satu
  // nomor WhatsApp hanya boleh dipegang oleh satu proses.
  WHATSAPP_BAILEYS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Kredensial sesi WhatsApp disimpan di sini. Isinya setara dengan akses
  // penuh ke akun WhatsApp itu, jadi harus di luar direktori yang disajikan
  // ke publik dan tidak boleh ikut masuk git.
  WHATSAPP_SESSION_DIR: z.string().default('./whatsapp-sessions'),

  // Berapa lama arsip percakapan disimpan sebelum boleh dihapus. 0 berarti
  // tanpa batas — sengaja dijadikan bawaan, karena menghapus arsip secara
  // diam-diam adalah kerusakan yang tidak bisa dibatalkan. Berapa lamanya
  // adalah keputusan hukum dan bisnis, bukan keputusan kode.
  WHATSAPP_RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).default(0),

  // --- Notifikasi push ke ponsel karyawan ---
  // Dipakai untuk memberi tahu pemegang nomor bahwa sesi WhatsApp-nya
  // terputus atau perlu discan ulang.
  PUSH_NOTIFICATIONS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Berkas JSON service account Firebase. Isinya kunci privat: simpan di luar
  // repo dan jangan disajikan lewat HTTP.
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),

  // --- Enkripsi kolom ---
  // Kunci induk untuk data pribadi yang tersimpan di database: isi pesan
  // WhatsApp, embedding wajah (biometrik), dan koordinat presensi. WAJIB —
  // presensi dengan GPS dan wajah adalah fitur inti, jadi tidak ada mode
  // "tanpa enkripsi" yang masuk akal. Sekali diisi JANGAN diganti tanpa
  // npm run sensitive:reencrypt: baris lama tidak akan terbaca lagi.
  FIELD_ENCRYPTION_KEY: z
    .string({ error: 'FIELD_ENCRYPTION_KEY wajib diisi. Generate: openssl rand -base64 32' })
    .refine((v) => Buffer.from(v, 'base64').length === 32, {
      message: 'FIELD_ENCRYPTION_KEY harus 32 byte dalam base64. Generate: openssl rand -base64 32',
    }),

  UPLOAD_DIR: z.string().default('./uploads'),

  // Batas ukuran dokumen karyawan (CV, ijazah, kontrak). Dikirim sebagai
  // base64 di body JSON yang dibatasi 10 MB, jadi batas ini harus muat di
  // bawah 7,5 MB setelah dikembangkan 4/3.
  DOCUMENT_MAX_BYTES: z.coerce.number().int().min(100_000).max(7_000_000).default(5_000_000),

  // Foto selfie tiap check-in TIDAK disimpan secara bawaan.
  // Menyimpannya berarti menumpuk data biometrik harian seluruh karyawan —
  // beban kepatuhan UU PDP yang besar demi manfaat yang kecil, karena skor
  // kemiripan sudah cukup untuk audit. Nyalakan hanya kalau memang diperlukan
  // sebagai bukti sengketa, dan sertai kebijakan retensi.
  FACE_STORE_CHECKIN_IMAGES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

/**
 * Pemantauan WhatsApp menyimpan isi percakapan orang, termasuk pelanggan dan
 * tamu yang tidak pernah menjadi bagian dari perusahaan. Menyalakannya tanpa
 * kunci enkripsi berarti menumpuk data pribadi dalam bentuk terbuka, jadi
 * kombinasi itu ditolak sejak boot — bukan dibiarkan jalan dan baru ketahuan
 * saat audit.
 */
const konfigurasi = envSchema.superRefine((cfg, ctx) => {
  // Push yang dinyalakan tanpa kredensial akan gagal diam-diam pada setiap
  // notifikasi, dan gejalanya baru terasa saat ada nomor yang sesinya putus
  // berhari-hari tanpa ada yang diberi tahu.
  if (cfg.PUSH_NOTIFICATIONS_ENABLED && !cfg.FIREBASE_SERVICE_ACCOUNT_PATH) {
    ctx.addIssue({
      code: 'custom',
      path: ['FIREBASE_SERVICE_ACCOUNT_PATH'],
      message: 'wajib diisi kalau PUSH_NOTIFICATIONS_ENABLED=true.',
    });
  }

  if (cfg.WHATSAPP_MONITORING_ENABLED && !cfg.FIELD_ENCRYPTION_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['FIELD_ENCRYPTION_KEY'],
      message:
        'wajib diisi kalau WHATSAPP_MONITORING_ENABLED=true, karena isi pesan tidak boleh ' +
        'tersimpan terbuka. Generate: openssl rand -base64 32',
    });
  }
});

const parsed = konfigurasi.safeParse(process.env);

if (!parsed.success) {
  console.error('\nKonfigurasi environment tidak valid:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\nLihat .env.example untuk daftar variabel yang dibutuhkan.\n');
  process.exit(1);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  isProduction: parsed.data.NODE_ENV === 'production',
};
