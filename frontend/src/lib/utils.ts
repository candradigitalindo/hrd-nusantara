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
  completed: "Selesai",
  no_show: "Tidak Hadir",
  resolved: "Selesai",
  dismissed: "Ditolak",
};

export const LABEL_SP: Record<string, string> = {
  teguran_lisan: "Teguran Lisan",
  sp1: "SP 1",
  sp2: "SP 2",
  sp3: "SP 3",
};

export const labelStatus = (kode: string | null | undefined) =>
  kode ? (LABEL_STATUS[kode] ?? kode) : "—";

export const LABEL_ROLE: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  HR_ADMIN: "HR Admin",
  MANAGER: "Manajer",
  EMPLOYEE: "Karyawan",
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
