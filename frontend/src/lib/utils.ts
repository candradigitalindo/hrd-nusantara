import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow } from "date-fns";
import { id as localeId } from "date-fns/locale";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const formatTanggal = (nilai: string | Date | null | undefined, pola = "d MMM yyyy") =>
  nilai ? format(new Date(nilai), pola, { locale: localeId }) : "—";

export const formatWaktu = (nilai: string | Date | null | undefined) =>
  nilai ? format(new Date(nilai), "HH:mm", { locale: localeId }) : "—";

export const formatRelatif = (nilai: string | Date | null | undefined) =>
  nilai ? formatDistanceToNow(new Date(nilai), { addSuffix: true, locale: localeId }) : "—";

export const formatRupiah = (nilai: number | string | null | undefined) =>
  nilai === null || nilai === undefined
    ? "—"
    : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(
        Number(nilai)
      );

/**
 * Rupiah ringkas untuk tempat sempit seperti sumbu grafik: "Rp 12,5 jt".
 * Angka penuhnya tetap muncul di tooltip dan tampilan tabel, jadi pembulatan
 * di sini tidak pernah menjadi satu-satunya angka yang dilihat orang.
 */
export const formatRupiahRingkas = (nilai: number | null | undefined): string => {
  if (nilai === null || nilai === undefined) return "—";
  const angka = Number(nilai);
  const tanda = angka < 0 ? "−" : "";
  const n = Math.abs(angka);
  const bulat = (v: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(v);
  if (n >= 1_000_000_000) return `${tanda}Rp ${bulat(n / 1_000_000_000)} M`;
  if (n >= 1_000_000) return `${tanda}Rp ${bulat(n / 1_000_000)} jt`;
  if (n >= 1_000) return `${tanda}Rp ${bulat(n / 1_000)} rb`;
  return `${tanda}Rp ${bulat(n)}`;
};

export const formatAngka = (nilai: number | null | undefined) =>
  nilai === null || nilai === undefined ? "—" : new Intl.NumberFormat("id-ID").format(nilai);

/** Label berbahasa Indonesia untuk kode status yang dipakai backend. */
export const LABEL_STATUS: Record<string, string> = {
  active: "Aktif",
  probation: "Probation",
  contract: "Kontrak",
  internship: "Magang",
  on_leave: "Cuti",
  inactive: "Non-Aktif",
  resign: "Resign",
  terminated: "Dihentikan",
  present: "Hadir",
  late: "Terlambat",
  absent: "Absen",
  no_checkout: "Lupa Check-out",
  pending: "Menunggu",
  approved: "Disetujui",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
  connected: "Tersambung",
  disconnected: "Terputus",
  pending_scan: "Menunggu Scan",
  scan_required: "Perlu Scan Ulang",
  draft: "Draft",
  calculated: "Terhitung",
  paid: "Dibayar",
  open: "Terbuka",
  under_review: "Ditinjau",
  closed: "Ditutup",
  filled: "Terisi",
  scheduled: "Terjadwal",
  confirmed: "Terjadwal",
  tentative: "Sementara",
  completed: "Selesai",
  no_show: "Tidak Hadir",
  published: "Tayang",
  archived: "Diarsipkan",
  ongoing: "Berlangsung",
  registered: "Terdaftar",
  waitlisted: "Daftar Tunggu",
  attended: "Hadir",
  failed: "Tidak Lulus",
  compliant: "Terpenuhi",
  expiring_soon: "Segera Kedaluwarsa",
  expired: "Kedaluwarsa",
  never_completed: "Belum Pernah",
  submitted: "Terkirim",
  acknowledged: "Dikonfirmasi",
  finalized: "Final",
  resolved: "Selesai",
  dismissed: "Ditolak",
  valid: "Berlaku",
  revoked: "Dicabut",
  not_assessed: "Belum Dinilai",
  never_linked: "Belum Ditautkan",
  connecting: "Menyiapkan",
};

export const LABEL_SP: Record<string, string> = {
  teguran_lisan: "Teguran Lisan",
  sp1: "SP 1",
  sp2: "SP 2",
  sp3: "SP 3",
};

export const labelStatus = (kode: string | null | undefined) =>
  kode ? (LABEL_STATUS[kode] ?? kode) : "—";

/** Status penugasan CBT — dipakai di daftar tes peserta maupun berkas pelamar. */
export const LABEL_STATUS_TES: Record<string, string> = {
  assigned: "Belum dikerjakan",
  in_progress: "Sedang dikerjakan",
  submitted: "Menunggu penilaian",
  graded: "Selesai dinilai",
  expired: "Kedaluwarsa",
};

export const LABEL_ROLE: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  HR_ADMIN: "HR Admin",
  MANAGER: "Manajer",
  EMPLOYEE: "Karyawan",
};

/** Lingkup data sebuah peran: seberapa luas data yang terlihat pemegangnya. */
export const LABEL_LINGKUP: Record<string, string> = {
  SUPER_ADMIN: "Pemilik sistem",
  HR_ADMIN: "Seluruh perusahaan",
  MANAGER: "Departemen sendiri",
  EMPLOYEE: "Diri sendiri",
};

export const inisial = (nama: string) =>
  nama
    .split(/\s+/)
    .slice(0, 2)
    .map((k) => k[0]?.toUpperCase() ?? "")
    .join("");

export const LABEL_DOKUMEN: Record<string, string> = {
  cv: "CV",
  surat_lamaran: "Surat Lamaran",
  ktp: "KTP",
  skck: "SKCK",
  ijazah: "Ijazah",
  sertifikat: "Sertifikat",
  kontrak_kerja: "Kontrak Kerja",
  npwp: "NPWP",
  bpjs_kesehatan: "BPJS Kesehatan",
  bpjs_ketenagakerjaan: "BPJS Ketenagakerjaan",
  lainnya: "Lainnya",
};

export const formatUkuran = (byte: number) =>
  byte < 1024 ? `${byte} B` : byte < 1024 * 1024 ? `${(byte / 1024).toFixed(0)} KB` : `${(byte / 1024 / 1024).toFixed(1)} MB`;

/** Hari menuju kedaluwarsa: negatif berarti sudah lewat, null bila tidak ada masa berlaku. */
export const sisaHari = (tanggal: string | null | undefined) =>
  tanggal ? Math.ceil((new Date(tanggal).getTime() - Date.now()) / 86_400_000) : null;

export const LABEL_SALARY_TYPE: Record<string, string> = {
  monthly: "Bulanan",
  daily: "Harian",
  hourly: "Per jam",
};

/** Nama periode gaji: "September 2026" bila satu bulan penuh, rentang tanggal bila tidak. */
export const namaPeriode = (mulai: string, selesai: string) => {
  const a = new Date(mulai);
  const b = new Date(selesai);
  if (a.getDate() === 1 && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return formatTanggal(mulai, "MMMM yyyy");
  }
  return `${formatTanggal(mulai, "d MMM")} – ${formatTanggal(selesai, "d MMM yyyy")}`;
};

export const LABEL_TAHAP: Record<string, string> = {
  applied: "Melamar",
  screening: "Seleksi Berkas",
  interview: "Wawancara",
  offer: "Penawaran",
  hired: "Diterima",
  rejected: "Ditolak",
  withdrawn: "Mengundurkan Diri",
};

export const LABEL_EMPLOYMENT: Record<string, string> = {
  fulltime: "Penuh waktu",
  contract: "Kontrak",
  parttime: "Paruh waktu",
  internship: "Magang",
  daily: "Harian",
};

export const LABEL_HASIL_WAWANCARA: Record<string, string> = {
  pass: "Lolos",
  fail: "Tidak lolos",
  hold: "Ditahan",
};

export const LABEL_PRIORITAS: Record<string, string> = {
  normal: "Biasa",
  important: "Penting",
  urgent: "Mendesak",
};

export const LABEL_PERIODE: Record<string, string> = { quarterly: "Triwulan", semester: "Semester", annual: "Tahunan" };
export const LABEL_PENILAI: Record<string, string> = { self: "Diri sendiri", manager: "Atasan", peer: "Rekan kerja", subordinate: "Bawahan" };
export const LABEL_UMPAN: Record<string, string> = { praise: "Apresiasi", improvement: "Perbaikan", note: "Catatan" };

/** Nama tingkat kompetensi: pakai label kustom bila ada, kalau tidak "Tingkat N". */
export const labelTingkat = (tingkat: number, labels?: Record<string, string> | null) =>
  labels?.[String(tingkat)] ?? (tingkat === 0 ? "Belum ada" : `Tingkat ${tingkat}`);

export const LABEL_RUANG: Record<string, string> = { general: "Umum", department: "Departemen", team: "Tim" };
export const LABEL_DATASET: Record<string, string> = { employees: "Karyawan", attendance: "Presensi", leaves: "Cuti", payrolls: "Penggajian", trainings: "Pelatihan" };
export const LABEL_EXIT: Record<string, string> = { voluntary: "Mengundurkan diri", involuntary: "Diberhentikan", "tidak dicatat": "Tidak dicatat" };

/** Penanda kecurangan lokasi pada presensi, sejalan dengan backend locationIntegrity.ts. */
export const LABEL_INTEGRITAS: Record<string, string> = {
  mock_location: "Lokasi ditandai palsu oleh OS",
  mock_app_installed: "Aplikasi lokasi palsu terpasang",
  rooted_device: "Perangkat di-root / jailbreak",
  emulator: "Berjalan di emulator",
  developer_options: "Opsi pengembang aktif",
  network_mismatch: "GPS jauh dari lokasi jaringan seluler",
  stale_position: "Posisi GPS basi",
  impossible_speed: "Perpindahan terlalu cepat dari presensi sebelumnya",
  integrity_missing: "Aplikasi tidak mengirim laporan integritas",
  clock_mismatch: "Jam ponsel tidak sesuai saat presensi offline",
  clock_unverified: "Presensi offline tanpa pembanding jam",
};
export const BLOKIR_INTEGRITAS = new Set(["mock_location", "mock_app_installed", "rooted_device"]);

/**
 * Presensi offline dari antrean mobile: waktu tercatat = saat diambil di
 * ponsel, `tersinkron` = saat server menerimanya. "Terkirim 2 jam 15 mnt
 * kemudian" membantu HR menilai wajar tidaknya (mis. lokasi tanpa sinyal).
 */
export const jedaTerkirim = (waktu: string | null | undefined, tersinkron: string | null | undefined): string | null => {
  if (!waktu || !tersinkron) return null;
  const menit = Math.max(0, Math.round((new Date(tersinkron).getTime() - new Date(waktu).getTime()) / 60_000));
  if (menit < 1) return "terkirim segera";
  const jam = Math.floor(menit / 60);
  const hari = Math.floor(jam / 24);
  if (hari > 0) return `terkirim ${hari} hari ${jam % 24} jam kemudian`;
  if (jam > 0) return `terkirim ${jam} jam${menit % 60 ? ` ${menit % 60} mnt` : ""} kemudian`;
  return `terkirim ${menit} mnt kemudian`;
};
