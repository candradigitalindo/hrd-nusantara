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
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/types";

export interface MenuNav {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Kosong = semua peran. */
  roles?: Role[];
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

const HR: Role[] = ["SUPER_ADMIN", "HR_ADMIN"];
const MANAJEMEN: Role[] = ["SUPER_ADMIN", "HR_ADMIN", "MANAGER"];

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
      { href: "/whatsapp", label: "Pemantauan WA", icon: MessageCircle, roles: HR },
    ],
  },
  {
    id: "kepegawaian",
    label: "Kepegawaian",
    icon: Briefcase,
    item: [
      { href: "/karyawan", label: "Karyawan", icon: Users, roles: MANAJEMEN, utama: true },
      { href: "/organisasi", label: "Organisasi", icon: Building2, roles: HR },
      { href: "/rekrutmen", label: "Rekrutmen", icon: UserSearch, roles: MANAJEMEN },
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
      { href: "/payroll", label: "Payroll", icon: Banknote, roles: HR },
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
      { href: "/audit", label: "Jejak Audit", icon: ScrollText, roles: ["SUPER_ADMIN"] },
    ],
  },
  { id: "analitik", label: "Analitik", icon: BarChart3, item: [{ href: "/laporan", label: "Laporan", icon: BarChart3, roles: MANAJEMEN }] },
  {
    id: "aplikasi",
    label: "Aplikasi Mobile",
    icon: TabletSmartphone,
    item: [
      { href: "/aplikasi", label: "Rilis APK", icon: TabletSmartphone, roles: HR },
      { href: "/unduh", label: "Unduh Aplikasi", icon: Download },
    ],
  },
];

/** Daftar rata, untuk bar bawah ponsel dan pencarian judul halaman. */
export const MENU: MenuNav[] = KELOMPOK.flatMap((k) => k.item);

const bolehLihat = (m: MenuNav, role: Role | undefined) => !m.roles || (role !== undefined && m.roles.includes(role));

export const menuUntuk = (role: Role | undefined) => MENU.filter((m) => bolehLihat(m, role));

/** Kategori beserta itemnya yang boleh dilihat peran ini; kategori kosong dibuang. */
export const kelompokUntuk = (role: Role | undefined): KelompokMenu[] =>
  KELOMPOK.map((k) => ({ ...k, item: k.item.filter((m) => bolehLihat(m, role)) })).filter((k) => k.item.length > 0);

/**
 * Apakah tautan menu mewakili halaman yang sedang dibuka.
 *
 * Dicocokkan per segmen: "/whatsapp" aktif untuk "/whatsapp" dan
 * "/whatsapp/…", tetapi TIDAK untuk "/whatsapp-saya" — pencocokan awalan
 * mentah membuat dua item menyala sekaligus.
 */
export const aktifDi = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
