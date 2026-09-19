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
