// src/utils/permissions.ts
//
// Katalog hak akses (permission) yang dikenal sistem.
//
// Bentuknya matriks: tiap item sidebar adalah satu baris, dan tiap baris
// punya aksi lihat / buat / ubah / hapus yang memang ada di halaman itu.
// Kuncinya "<halaman>.<aksi>", misalnya "karyawan.ubah". Halaman yang punya
// bagian dengan hak berbeda (Presensi tim, Lembur, Dokumen karyawan, …)
// diberi sub-baris sendiri, bukan dirangkum ke induknya — kalau dirangkum,
// "boleh melihat presensi tim" akan otomatis berarti "boleh menyetujui
// lembur", dan itu bukan keputusan yang boleh diambil diam-diam oleh kode.
//
// Kunci disimpan di basis data (CustomRole.permissions), jadi JANGAN mengganti
// nama kunci yang sudah ada. Kunci generasi sebelumnya ("karyawan.kelola",
// "halaman.cuti", …) dipetakan otomatis lewat PETA_IZIN_LAMA saat server
// mulai, dan tetap dikirim sebagai alias ke klien lama (aplikasi mobile).
import { Role } from '@prisma/client';

export const AKSI = ['lihat', 'buat', 'ubah', 'hapus'] as const;
export type Aksi = (typeof AKSI)[number];

export interface DefinisiHalaman {
  /** Bagian kiri kunci, mis. "karyawan". */
  halaman: string;
  /** Nama seperti yang tampil di sidebar (atau nama bagiannya). */
  label: string;
  /** Kelompok sidebar. */
  kelompok: string;
  /** Halaman induk untuk sub-baris; tampil menjorok di bawahnya. */
  induk?: string;
  /** Aksi yang tersedia di halaman ini, beserta keterangan apa yang dibuka. */
  aksi: Partial<Record<Aksi, string>>;
}

export const MATRIKS_IZIN: readonly DefinisiHalaman[] = [
  // --- Beranda ---
  { halaman: 'dashboard', label: 'Dashboard', kelompok: 'Beranda', aksi: { lihat: 'Buka dashboard' } },

  // --- Komunikasi ---
  {
    halaman: 'pengumuman', label: 'Pengumuman', kelompok: 'Komunikasi',
    aksi: {
      lihat: 'Baca pengumuman, konfirmasi "sudah membaca", isi survei',
      buat: 'Buat pengumuman',
      ubah: 'Sunting, tayangkan, arsipkan, dan lihat laporan pembaca',
    },
  },
  {
    halaman: 'survei', label: 'Survei', kelompok: 'Komunikasi', induk: 'pengumuman',
    aksi: { buat: 'Buat survei', ubah: 'Tayangkan/tutup survei dan lihat hasilnya' },
  },
  {
    halaman: 'chat', label: 'Chat Tim', kelompok: 'Komunikasi',
    aksi: {
      lihat: 'Baca dan kirim pesan di ruang yang diikuti',
      buat: 'Buat ruang dan tambah anggota',
      hapus: 'Hapus pesan (moderator ruang tetap diperiksa)',
    },
  },
  {
    halaman: 'whatsapp_saya', label: 'WhatsApp Saya', kelompok: 'Komunikasi',
    aksi: { lihat: 'Lihat status dan riwayat tautan sendiri', ubah: 'Tautkan / pindai ulang nomor sendiri, atur grup absensi' },
  },
  {
    halaman: 'whatsapp', label: 'Pemantauan WA', kelompok: 'Komunikasi',
    aksi: {
      lihat: 'Lihat kepatuhan, daftar nomor, dan arsip percakapan',
      buat: 'Daftarkan nomor perusahaan',
      ubah: 'Ubah nomor, sambungkan / putuskan sesi, kirim pengingat',
      hapus: 'Hapus arsip percakapan yang lewat masa simpan',
    },
  },

  // --- Kepegawaian ---
  {
    halaman: 'karyawan', label: 'Karyawan', kelompok: 'Kepegawaian',
    aksi: { lihat: 'Lihat daftar dan detail karyawan', buat: 'Tambah karyawan', ubah: 'Ubah data, peran, dan kata sandi karyawan', hapus: 'Nonaktifkan karyawan' },
  },
  {
    halaman: 'dokumen', label: 'Dokumen karyawan', kelompok: 'Kepegawaian', induk: 'karyawan',
    aksi: { lihat: 'Lihat dokumen yang segera kedaluwarsa', buat: 'Unggah dokumen', ubah: 'Perbarui data dokumen', hapus: 'Hapus dokumen' },
  },
  {
    halaman: 'wajah', label: 'Pendaftaran wajah', kelompok: 'Kepegawaian', induk: 'karyawan',
    aksi: { lihat: 'Lihat pendaftaran wajah', buat: 'Daftarkan wajah', hapus: 'Hapus pendaftaran wajah' },
  },
  {
    halaman: 'organisasi', label: 'Organisasi', kelompok: 'Kepegawaian',
    aksi: { lihat: 'Buka struktur organisasi', buat: 'Tambah departemen dan jabatan', ubah: 'Ubah departemen dan jabatan', hapus: 'Hapus departemen dan jabatan' },
  },
  {
    halaman: 'rekrutmen', label: 'Rekrutmen', kelompok: 'Kepegawaian',
    aksi: {
      lihat: 'Lihat lowongan, pelamar, psikotes, dan corong seleksi',
      buat: 'Buat lowongan, catat pelamar, jadwalkan wawancara, catat psikotes',
      ubah: 'Sunting lowongan, ubah status dan tahap, terima kandidat',
    },
  },
  {
    halaman: 'wawancara', label: 'Wawancara yang ditugaskan', kelompok: 'Kepegawaian', induk: 'rekrutmen',
    aksi: { lihat: 'Buka menu Rekrutmen untuk jadwal dan umpan balik wawancara yang ditugaskan ke dirinya' },
  },

  // --- Kehadiran & Cuti ---
  {
    halaman: 'presensi', label: 'Presensi', kelompok: 'Kehadiran & Cuti',
    aksi: { lihat: 'Check-in/out, riwayat, jadwal shift, dan lokasi kerja sendiri' },
  },
  {
    halaman: 'presensi_tim', label: 'Presensi tim', kelompok: 'Kehadiran & Cuti', induk: 'presensi',
    aksi: { lihat: 'Lihat daftar dan ringkasan presensi sesuai lingkup data' },
  },
  {
    halaman: 'lembur', label: 'Lembur', kelompok: 'Kehadiran & Cuti', induk: 'presensi',
    aksi: { ubah: 'Setujui atau tolak lembur' },
  },
  {
    halaman: 'shift', label: 'Jadwal shift', kelompok: 'Kehadiran & Cuti', induk: 'presensi',
    aksi: { lihat: 'Lihat jadwal shift tim', buat: 'Buat jadwal shift', ubah: 'Ubah jadwal shift', hapus: 'Hapus jadwal shift' },
  },
  {
    halaman: 'lokasi', label: 'Lokasi kerja & QR absensi', kelompok: 'Kehadiran & Cuti', induk: 'presensi',
    aksi: { lihat: 'Lihat daftar lokasi kerja', buat: 'Tambah lokasi kerja', ubah: 'Ubah lokasi dan putar ulang QR' },
  },
  {
    halaman: 'cuti', label: 'Cuti & Izin', kelompok: 'Kehadiran & Cuti',
    aksi: { lihat: 'Lihat saldo, ajukan, dan batalkan cuti sendiri' },
  },
  {
    halaman: 'cuti_tim', label: 'Cuti tim', kelompok: 'Kehadiran & Cuti', induk: 'cuti',
    aksi: { lihat: 'Lihat antrean dan kalender cuti sesuai lingkup data', ubah: 'Setujui atau tolak pengajuan' },
  },
  {
    halaman: 'pengaturan_cuti', label: 'Pengaturan cuti', kelompok: 'Kehadiran & Cuti', induk: 'cuti',
    aksi: {
      lihat: 'Lihat saldo cuti semua karyawan',
      buat: 'Tetapkan saldo, jenis cuti, pola kerja, dan hari libur',
      ubah: 'Ubah saldo, jenis cuti, pola kerja, dan hari libur',
      hapus: 'Hapus jenis cuti dan hari libur',
    },
  },

  // --- Penggajian ---
  { halaman: 'gaji', label: 'Slip Gaji', kelompok: 'Penggajian', aksi: { lihat: 'Lihat slip gaji sendiri' } },
  {
    halaman: 'payroll', label: 'Payroll', kelompok: 'Penggajian',
    aksi: {
      lihat: 'Lihat batch, slip semua karyawan, komponen, dan struktur gaji',
      buat: 'Buat batch, komponen gaji, dan tetapkan gaji karyawan',
      ubah: 'Hitung, setujui / kembalikan batch, ubah komponen gaji',
      hapus: 'Lepas komponen gaji dari karyawan',
    },
  },

  // --- Pengembangan ---
  {
    halaman: 'pelatihan', label: 'Pelatihan', kelompok: 'Pengembangan',
    aksi: {
      lihat: 'Lihat jadwal, daftar / batalkan sesi, dan riwayat sendiri',
      buat: 'Buat program dan jadwalkan sesi',
      ubah: 'Sunting program, ubah status sesi, catat kehadiran, evaluasi, lihat kepatuhan',
    },
  },
  {
    halaman: 'kinerja', label: 'Kinerja', kelompok: 'Pengembangan',
    aksi: {
      lihat: 'Isi penilaian yang ditugaskan, baca hasil sendiri, beri umpan balik',
      buat: 'Buat siklus, form KPI, dan tugaskan penilai',
      ubah: 'Buka / tutup siklus dan lihat ringkasan 360° semua karyawan',
    },
  },
  {
    halaman: 'kompetensi', label: 'Kompetensi', kelompok: 'Pengembangan',
    aksi: {
      lihat: 'Lihat kompetensi dan sertifikat sendiri',
      buat: 'Tambah kompetensi, jenis sertifikasi, standar jabatan, catat sertifikat',
      ubah: 'Nilai kompetensi karyawan dan lihat laporan kesiapan',
      hapus: 'Hapus standar jabatan dan cabut sertifikat',
    },
  },

  // --- Kepatuhan ---
  {
    halaman: 'kasus', label: 'Keluhan & Disiplin', kelompok: 'Kepatuhan',
    aksi: { lihat: 'Lihat kasus sendiri dan ajukan keluhan', buat: 'Catat tindakan disiplin (SP)', ubah: 'Tindak lanjuti status kasus' },
  },
  { halaman: 'audit', label: 'Jejak Audit', kelompok: 'Kepatuhan', aksi: { lihat: 'Lihat jejak audit' } },

  // --- Analitik ---
  { halaman: 'laporan', label: 'Laporan', kelompok: 'Analitik', aksi: { lihat: 'Dashboard manajemen dan produktivitas sesuai lingkup data' } },
  {
    halaman: 'laporan_hr', label: 'Laporan SDM', kelompok: 'Analitik', induk: 'laporan',
    aksi: { lihat: 'Perputaran karyawan, biaya SDM, dan data mentah CSV' },
  },

  // --- Aplikasi Mobile ---
  {
    halaman: 'aplikasi', label: 'Rilis APK', kelompok: 'Aplikasi Mobile',
    aksi: { lihat: 'Lihat riwayat rilis dan QR unduh', buat: 'Unggah rilis baru', ubah: 'Aktifkan / nonaktifkan rilis' },
  },
  { halaman: 'unduh', label: 'Unduh Aplikasi', kelompok: 'Aplikasi Mobile', aksi: { lihat: 'Buka halaman unduh' } },

  // --- Administrasi ---
  {
    halaman: 'peran', label: 'Peran & Hak Akses', kelompok: 'Administrasi',
    aksi: { lihat: 'Lihat peran dan katalog izin', buat: 'Buat peran', ubah: 'Ubah peran', hapus: 'Hapus peran' },
  },
];

export interface DefinisiIzin {
  key: string;
  label: string;
  /** Kelompok tampilan (kelompok sidebar). */
  modul: string;
  halaman: string;
  aksi: Aksi;
}

/** Daftar rata seluruh kunci, urut sesuai matriks. */
export const IZIN: readonly DefinisiIzin[] = MATRIKS_IZIN.flatMap((h) =>
  AKSI.filter((a) => h.aksi[a] !== undefined).map((a) => ({
    key: `${h.halaman}.${a}`,
    label: `${h.label}: ${h.aksi[a]}`,
    modul: h.kelompok,
    halaman: h.halaman,
    aksi: a,
  }))
);

export const KUNCI_IZIN: readonly string[] = IZIN.map((i) => i.key);
const HIMPUNAN_IZIN: ReadonlySet<string> = new Set(KUNCI_IZIN);

export const izinDikenal = (key: string): boolean => HIMPUNAN_IZIN.has(key);

/** Kunci buat/ubah/hapus sebuah halaman — yang ada saja. */
export const kelola = (halaman: string): string[] =>
  (['buat', 'ubah', 'hapus'] as const).map((a) => `${halaman}.${a}`).filter(izinDikenal);

/**
 * Untuk rute baca tingkat pengelola: siapa pun yang boleh mengubah sesuatu di
 * halaman itu tentu boleh melihatnya. Dipakai bersama kunci layanan mandiri
 * ("<halaman>.lihat") bila rute yang sama juga dipakai karyawan biasa.
 */
export const lihatAtauKelola = (halaman: string): string[] => [`${halaman}.lihat`, ...kelola(halaman)];

/**
 * Akses layanan mandiri: satu set kunci per menu yang dulunya terbuka untuk
 * semua karyawan. Menjadi bawaan semua peran, termasuk Karyawan.
 */
export const IZIN_MENU: readonly string[] = [
  'dashboard.lihat',
  'pengumuman.lihat',
  'chat.lihat', 'chat.buat', 'chat.hapus',
  'whatsapp_saya.lihat', 'whatsapp_saya.ubah',
  'presensi.lihat',
  'cuti.lihat',
  'gaji.lihat',
  'pelatihan.lihat',
  'kinerja.lihat',
  'kompetensi.lihat',
  'kasus.lihat',
  'unduh.lihat',
];

/**
 * Kunci generasi sebelumnya → kunci sekarang. Dipakai untuk memigrasi peran
 * yang tersimpan di basis data, sekali saat server mulai (idempoten).
 * Pemetaannya meniru persis apa yang dibuka kunci lama itu, bukan lebih.
 */
export const PETA_IZIN_LAMA: Readonly<Record<string, readonly string[]>> = {
  'halaman.dashboard': ['dashboard.lihat'],
  'laporan.dashboard': ['laporan.lihat'],
  'laporan.hr': ['laporan_hr.lihat'],
  'halaman.pengumuman': ['pengumuman.lihat'],
  'pengumuman.kelola': ['pengumuman.lihat', 'pengumuman.buat', 'pengumuman.ubah'],
  'survei.kelola': ['pengumuman.lihat', 'survei.buat', 'survei.ubah'],
  'halaman.chat': ['chat.lihat', 'chat.buat', 'chat.hapus'],
  'halaman.whatsapp_saya': ['whatsapp_saya.lihat', 'whatsapp_saya.ubah'],
  'whatsapp.pantau': ['whatsapp.lihat', 'whatsapp.buat', 'whatsapp.ubah', 'whatsapp.hapus', 'whatsapp_saya.lihat', 'whatsapp_saya.ubah'],
  'karyawan.lihat': ['karyawan.lihat'],
  'karyawan.kelola': ['karyawan.buat', 'karyawan.ubah', 'karyawan.hapus'],
  'organisasi.kelola': ['organisasi.lihat', 'organisasi.buat', 'organisasi.ubah', 'organisasi.hapus'],
  'dokumen.kelola': ['dokumen.lihat', 'dokumen.buat', 'dokumen.ubah', 'dokumen.hapus'],
  'wajah.kelola': ['wajah.lihat', 'wajah.buat', 'wajah.hapus'],
  'halaman.presensi': ['presensi.lihat'],
  'presensi.lihat_tim': ['presensi_tim.lihat'],
  'presensi.lembur': ['lembur.ubah'],
  'shift.kelola': ['shift.lihat', 'shift.buat', 'shift.ubah', 'shift.hapus'],
  'lokasi.kelola': ['lokasi.lihat', 'lokasi.buat', 'lokasi.ubah'],
  'halaman.cuti': ['cuti.lihat'],
  'cuti.setujui': ['cuti_tim.lihat', 'cuti_tim.ubah'],
  'cuti.kelola': ['pengaturan_cuti.lihat', 'pengaturan_cuti.buat', 'pengaturan_cuti.ubah', 'pengaturan_cuti.hapus'],
  'halaman.gaji': ['gaji.lihat'],
  'payroll.kelola': ['payroll.lihat', 'payroll.buat', 'payroll.ubah', 'payroll.hapus'],
  'rekrutmen.kelola': ['rekrutmen.lihat', 'rekrutmen.buat', 'rekrutmen.ubah', 'wawancara.lihat'],
  'rekrutmen.wawancara': ['wawancara.lihat'],
  'halaman.pelatihan': ['pelatihan.lihat'],
  'pelatihan.kelola': ['pelatihan.lihat', 'pelatihan.buat', 'pelatihan.ubah'],
  'halaman.kinerja': ['kinerja.lihat'],
  'kinerja.kelola': ['kinerja.lihat', 'kinerja.buat', 'kinerja.ubah'],
  'halaman.kompetensi': ['kompetensi.lihat'],
  'kompetensi.kelola': ['kompetensi.lihat', 'kompetensi.buat', 'kompetensi.ubah', 'kompetensi.hapus'],
  'halaman.kasus': ['kasus.lihat'],
  'disiplin.kelola': ['kasus.lihat', 'kasus.buat', 'kasus.ubah'],
  'audit.lihat': ['audit.lihat'],
  'aplikasi.rilis': ['aplikasi.lihat', 'aplikasi.buat', 'aplikasi.ubah'],
  'halaman.unduh': ['unduh.lihat'],
  'peran.kelola': ['peran.lihat', 'peran.buat', 'peran.ubah', 'peran.hapus'],
};

/** Apakah daftar izin ini masih memuat kunci generasi sebelumnya. */
export const adaIzinLama = (izin: readonly string[]): boolean => izin.some((k) => !izinDikenal(k) && k in PETA_IZIN_LAMA);

/**
 * Menerjemahkan daftar izin ke kunci sekarang: kunci lama dipetakan, kunci
 * yang sudah benar dipertahankan, kunci yang tidak dikenal dibuang. Hasilnya
 * tanpa duplikat dan urut sesuai katalog supaya stabil dibandingkan.
 */
export const migrasiIzin = (izin: readonly string[]): string[] => {
  const hasil = new Set<string>();
  for (const k of izin) {
    if (izinDikenal(k)) hasil.add(k);
    else for (const baru of PETA_IZIN_LAMA[k] ?? []) hasil.add(baru);
  }
  return KUNCI_IZIN.filter((k) => hasil.has(k));
};

/**
 * Alias kunci lama yang masih dibaca APK mobile sebelum versi 0.2.0 (yang
 * lebih baru membaca kunci `halaman.lihat` langsung). Hanya ditambahkan pada
 * izin yang dikirim ke klien; penjaga rute memakai kunci sekarang.
 */
const ALIAS_KLIEN_LAMA: Readonly<Record<string, string>> = {
  'presensi.lihat': 'halaman.presensi',
  'cuti.lihat': 'halaman.cuti',
  'gaji.lihat': 'halaman.gaji',
  'pengumuman.lihat': 'halaman.pengumuman',
  'chat.lihat': 'halaman.chat',
  'whatsapp_saya.lihat': 'halaman.whatsapp_saya',
  'pelatihan.lihat': 'halaman.pelatihan',
};

export const denganAliasKlienLama = (izin: readonly string[]): string[] => {
  const hasil = [...izin];
  for (const k of izin) {
    const alias = ALIAS_KLIEN_LAMA[k];
    if (alias && !hasil.includes(alias)) hasil.push(alias);
  }
  return hasil;
};

const SEMUA = [...KUNCI_IZIN];
const IZIN_MANAJER = migrasiIzin([
  'karyawan.lihat',
  'presensi.lihat_tim',
  'presensi.lembur',
  'shift.kelola',
  'cuti.setujui',
  'disiplin.kelola',
  'laporan.dashboard',
  'rekrutmen.wawancara',
  ...IZIN_MENU,
]);
const HANYA_PEMILIK = new Set(['audit.lihat', ...lihatAtauKelola('peran')]);

/**
 * Izin bawaan tiap lingkup data (Role enum). Meniru penjaga rute sebelum
 * peran dinamis ada, jadi perilaku lama tidak berubah untuk akun yang belum
 * diberi peran kustom.
 *
 * Jejak audit dan pengelolaan peran sengaja hanya untuk SUPER_ADMIN: kalau
 * HR bisa mengubah hak aksesnya sendiri atau membaca jejak perbuatannya
 * sendiri, pengawasan atas HR hilang.
 */
export const DEFAULT_PERMISSIONS: Record<Role, readonly string[]> = {
  [Role.SUPER_ADMIN]: SEMUA,
  [Role.HR_ADMIN]: SEMUA.filter((k) => !HANYA_PEMILIK.has(k)),
  [Role.MANAGER]: IZIN_MANAJER,
  [Role.EMPLOYEE]: [...IZIN_MENU],
};

/** Label lingkup data yang dipakai peran, untuk UI dan pesan error. */
export const LABEL_LINGKUP: Record<Role, string> = {
  [Role.SUPER_ADMIN]: 'Pemilik sistem (semua data, tidak bisa dibatasi)',
  [Role.HR_ADMIN]: 'Seluruh perusahaan',
  [Role.MANAGER]: 'Departemen sendiri',
  [Role.EMPLOYEE]: 'Diri sendiri',
};
