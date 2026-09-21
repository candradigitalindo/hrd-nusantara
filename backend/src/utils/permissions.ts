// src/utils/permissions.ts
//
// Katalog hak akses (permission) yang dikenal sistem.
//
// Peran tidak lagi dikodekan mati sebagai empat enum: admin bisa membuat
// peran sendiri (misalnya "Supervisor Outlet" atau "Staf Payroll") dengan
// mencentang izin dari katalog ini. Setiap rute yang dulunya dijaga
// requireRole(...) kini dijaga requirePermission('kunci').
//
// Kunci bersifat stabil dan disimpan di basis data (CustomRole.permissions),
// jadi JANGAN mengganti nama kunci yang sudah ada — tambahkan kunci baru
// bila perlu, dan peran yang sudah ada tinggal diperbarui lewat UI.
import { Role } from '@prisma/client';

export interface DefinisiIzin {
  key: string;
  label: string;
  /** Kelompok tampilan di UI pengelola peran. */
  modul: string;
}

export const IZIN: readonly DefinisiIzin[] = [
  // Kepegawaian
  { key: 'karyawan.lihat', label: 'Lihat daftar karyawan', modul: 'Kepegawaian' },
  { key: 'karyawan.kelola', label: 'Tambah, ubah, dan nonaktifkan karyawan', modul: 'Kepegawaian' },
  { key: 'organisasi.kelola', label: 'Kelola departemen dan jabatan', modul: 'Kepegawaian' },
  { key: 'dokumen.kelola', label: 'Kelola dokumen karyawan', modul: 'Kepegawaian' },
  { key: 'wajah.kelola', label: 'Kelola pendaftaran wajah', modul: 'Kepegawaian' },

  // Kehadiran
  { key: 'presensi.lihat_tim', label: 'Lihat presensi dan ringkasan tim', modul: 'Kehadiran' },
  { key: 'presensi.lembur', label: 'Setujui atau tolak lembur', modul: 'Kehadiran' },
  { key: 'shift.kelola', label: 'Kelola jadwal shift', modul: 'Kehadiran' },
  { key: 'lokasi.kelola', label: 'Kelola lokasi kerja dan QR absensi', modul: 'Kehadiran' },

  // Cuti
  { key: 'cuti.setujui', label: 'Lihat pengajuan cuti tim dan memutuskannya', modul: 'Cuti' },
  { key: 'cuti.kelola', label: 'Kelola jenis cuti, pola kerja, hari libur, dan saldo', modul: 'Cuti' },

  // Penggajian
  { key: 'payroll.kelola', label: 'Kelola komponen gaji dan proses payroll', modul: 'Penggajian' },

  // Rekrutmen
  { key: 'rekrutmen.kelola', label: 'Kelola lowongan, kandidat, wawancara, dan psikotes', modul: 'Rekrutmen' },

  // Pengembangan
  { key: 'kinerja.kelola', label: 'Kelola template, siklus, dan review kinerja', modul: 'Pengembangan' },
  { key: 'pelatihan.kelola', label: 'Kelola program dan sesi pelatihan', modul: 'Pengembangan' },
  { key: 'kompetensi.kelola', label: 'Kelola kompetensi dan sertifikasi', modul: 'Pengembangan' },

  // Kepatuhan
  { key: 'disiplin.kelola', label: 'Beri tindakan disiplin dan ubah status kasus', modul: 'Kepatuhan' },
  { key: 'audit.lihat', label: 'Lihat jejak audit', modul: 'Kepatuhan' },

  // Komunikasi
  { key: 'pengumuman.kelola', label: 'Kelola pengumuman', modul: 'Komunikasi' },
  { key: 'survei.kelola', label: 'Kelola survei', modul: 'Komunikasi' },
  { key: 'whatsapp.pantau', label: 'Pantau akun dan pesan WhatsApp', modul: 'Komunikasi' },

  // Analitik
  { key: 'laporan.dashboard', label: 'Lihat dashboard dan laporan produktivitas', modul: 'Analitik' },
  { key: 'laporan.hr', label: 'Lihat laporan turnover, biaya, dan data mentah', modul: 'Analitik' },

  // Administrasi
  { key: 'aplikasi.rilis', label: 'Unggah rilis aplikasi mobile', modul: 'Administrasi' },
  { key: 'peran.kelola', label: 'Kelola peran dan hak akses', modul: 'Administrasi' },
];

export const KUNCI_IZIN: readonly string[] = IZIN.map((i) => i.key);
const HIMPUNAN_IZIN: ReadonlySet<string> = new Set(KUNCI_IZIN);

export const izinDikenal = (key: string): boolean => HIMPUNAN_IZIN.has(key);

const SEMUA = [...KUNCI_IZIN];
const IZIN_MANAJER = [
  'karyawan.lihat',
  'presensi.lihat_tim',
  'presensi.lembur',
  'shift.kelola',
  'cuti.setujui',
  'disiplin.kelola',
  'laporan.dashboard',
];
const HANYA_PEMILIK = new Set(['audit.lihat', 'peran.kelola']);

/**
 * Izin bawaan tiap lingkup data (Role enum). Ini persis meniru penjaga rute
 * sebelum peran dinamis ada, jadi perilaku lama tidak berubah untuk akun
 * yang belum diberi peran kustom.
 *
 * Jejak audit dan pengelolaan peran sengaja hanya untuk SUPER_ADMIN: kalau
 * HR bisa mengubah hak aksesnya sendiri atau membaca jejak perbuatannya
 * sendiri, pengawasan atas HR hilang.
 */
export const DEFAULT_PERMISSIONS: Record<Role, readonly string[]> = {
  [Role.SUPER_ADMIN]: SEMUA,
  [Role.HR_ADMIN]: SEMUA.filter((k) => !HANYA_PEMILIK.has(k)),
  [Role.MANAGER]: IZIN_MANAJER,
  [Role.EMPLOYEE]: [],
};

/** Label lingkup data yang dipakai peran, untuk UI dan pesan error. */
export const LABEL_LINGKUP: Record<Role, string> = {
  [Role.SUPER_ADMIN]: 'Pemilik sistem (semua data, tidak bisa dibatasi)',
  [Role.HR_ADMIN]: 'Seluruh perusahaan',
  [Role.MANAGER]: 'Departemen sendiri',
  [Role.EMPLOYEE]: 'Diri sendiri',
};
