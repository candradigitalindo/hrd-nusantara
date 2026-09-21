import {
  LayoutDashboard,
  Users,
  Building2,
  CalendarCheck,
  CalendarOff,
  MessageCircle,
  ScrollText,
  ShieldAlert,
  Wallet,
  Banknote,
  UserSearch,
  Megaphone,
  GraduationCap,
  Target,
  Award,
  BarChart3,
  MessagesSquare,
  Smartphone,
  TabletSmartphone,
  Download,
  Briefcase,
  KeyRound,
  type LucideIcon,
} from "lucide-react";
import type { PenggunaSesi, Role } from "@/lib/types";

export interface MenuNav {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Izin yang dibutuhkan; kosong = semua pengguna. */
  izin?: string;
  /** Lingkup data yang juga boleh melihat walau tanpa izin di atas. */
  lingkup?: Role[];
  /** Tampil di bar bawah ponsel (maksimal 4). */
  utama?: boolean;
}

/** Kategori di sidebar; kategori beranggota satu ditampilkan sebagai tautan biasa. */
export interface KelompokMenu {
  id: string;
  label: string;
  icon: LucideIcon;
  item: MenuNav[];
}

export const KELOMPOK: KelompokMenu[] = [
  { id: "beranda", label: "Beranda", icon: LayoutDashboard, item: [{ href: "/", label: "Dashboard", icon: LayoutDashboard, utama: true }] },
  {
    id: "komunikasi",
    label: "Komunikasi",
    icon: MessagesSquare,
    item: [
      { href: "/pengumuman", label: "Pengumuman", icon: Megaphone },
      { href: "/chat", label: "Chat Tim", icon: MessagesSquare },
      { href: "/whatsapp-saya", label: "WhatsApp Saya", icon: Smartphone },
      { href: "/whatsapp", label: "Pemantauan WA", icon: MessageCircle, izin: "whatsapp.pantau" },
    ],
  },
  {
    id: "kepegawaian",
    label: "Kepegawaian",
    icon: Briefcase,
    item: [
      { href: "/karyawan", label: "Karyawan", icon: Users, izin: "karyawan.lihat", utama: true },
      { href: "/organisasi", label: "Organisasi", icon: Building2, izin: "organisasi.kelola" },
      { href: "/rekrutmen", label: "Rekrutmen", icon: UserSearch, izin: "rekrutmen.kelola", lingkup: ["MANAGER"] },
    ],
  },
  {
    id: "kehadiran",
    label: "Kehadiran & Cuti",
    icon: CalendarCheck,
    item: [
      { href: "/presensi", label: "Presensi", icon: CalendarCheck, utama: true },
      { href: "/cuti", label: "Cuti & Izin", icon: CalendarOff, utama: true },
    ],
  },
  {
    id: "penggajian",
    label: "Penggajian",
    icon: Wallet,
    item: [
      { href: "/gaji", label: "Slip Gaji", icon: Wallet },
      { href: "/payroll", label: "Payroll", icon: Banknote, izin: "payroll.kelola" },
    ],
  },
  {
    id: "pengembangan",
    label: "Pengembangan",
    icon: GraduationCap,
    item: [
      { href: "/pelatihan", label: "Pelatihan", icon: GraduationCap },
      { href: "/kinerja", label: "Kinerja", icon: Target },
      { href: "/kompetensi", label: "Kompetensi", icon: Award },
    ],
  },
  {
    id: "kepatuhan",
    label: "Kepatuhan",
    icon: ShieldAlert,
    item: [
      { href: "/kasus", label: "Keluhan & Disiplin", icon: ShieldAlert },
      { href: "/audit", label: "Jejak Audit", icon: ScrollText, izin: "audit.lihat" },
    ],
  },
  { id: "analitik", label: "Analitik", icon: BarChart3, item: [{ href: "/laporan", label: "Laporan", icon: BarChart3, izin: "laporan.dashboard" }] },
  {
    id: "aplikasi",
    label: "Aplikasi Mobile",
    icon: TabletSmartphone,
    item: [
      { href: "/aplikasi", label: "Rilis APK", icon: TabletSmartphone, izin: "aplikasi.rilis" },
      { href: "/unduh", label: "Unduh Aplikasi", icon: Download },
    ],
  },
  {
    id: "administrasi",
    label: "Administrasi",
    icon: KeyRound,
    item: [{ href: "/peran", label: "Peran & Hak Akses", icon: KeyRound, izin: "peran.kelola" }],
  },
];

/** Daftar rata, untuk bar bawah ponsel dan pencarian judul halaman. */
export const MENU: MenuNav[] = KELOMPOK.flatMap((k) => k.item);

const bolehLihat = (m: MenuNav, saya: PenggunaSesi | undefined) => {
  if (!m.izin) return true;
  if (!saya) return false;
  return saya.permissions.includes(m.izin) || (m.lingkup?.includes(saya.role) ?? false);
};

export const menuUntuk = (saya: PenggunaSesi | undefined) => MENU.filter((m) => bolehLihat(m, saya));

/** Kategori beserta itemnya yang boleh dilihat pengguna ini; kategori kosong dibuang. */
export const kelompokUntuk = (saya: PenggunaSesi | undefined): KelompokMenu[] =>
  KELOMPOK.map((k) => ({ ...k, item: k.item.filter((m) => bolehLihat(m, saya)) })).filter((k) => k.item.length > 0);

/**
 * Apakah tautan menu mewakili halaman yang sedang dibuka.
 *
 * Dicocokkan per segmen: "/whatsapp" aktif untuk "/whatsapp" dan
 * "/whatsapp/…", tetapi TIDAK untuk "/whatsapp-saya" — pencocokan awalan
 * mentah membuat dua item menyala sekaligus.
 */
export const aktifDi = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
