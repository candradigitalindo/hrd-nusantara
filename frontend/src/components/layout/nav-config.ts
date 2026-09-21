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
import type { PenggunaSesi } from "@/lib/types";

export interface MenuNav {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * Izin yang membuka menu ini — salah satu cukup. Halaman layanan mandiri
   * memakai kunci "halaman.*", halaman pengelolaan memakai izin fungsinya;
   * keduanya dicantumkan supaya pemegang izin fungsi ikut melihat menunya.
   */
  izin: string | string[];
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
  { id: "beranda", label: "Beranda", icon: LayoutDashboard, item: [{ href: "/", label: "Dashboard", icon: LayoutDashboard, izin: ["halaman.dashboard", "laporan.dashboard"], utama: true }] },
  {
    id: "komunikasi",
    label: "Komunikasi",
    icon: MessagesSquare,
    item: [
      { href: "/pengumuman", label: "Pengumuman", icon: Megaphone, izin: ["halaman.pengumuman", "pengumuman.kelola", "survei.kelola"] },
      { href: "/chat", label: "Chat Tim", icon: MessagesSquare, izin: "halaman.chat" },
      { href: "/whatsapp-saya", label: "WhatsApp Saya", icon: Smartphone, izin: "halaman.whatsapp_saya" },
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
      { href: "/rekrutmen", label: "Rekrutmen", icon: UserSearch, izin: ["rekrutmen.kelola", "rekrutmen.wawancara"] },
    ],
  },
  {
    id: "kehadiran",
    label: "Kehadiran & Cuti",
    icon: CalendarCheck,
    item: [
      { href: "/presensi", label: "Presensi", icon: CalendarCheck, izin: ["halaman.presensi", "presensi.lihat_tim"], utama: true },
      { href: "/cuti", label: "Cuti & Izin", icon: CalendarOff, izin: ["halaman.cuti", "cuti.setujui"], utama: true },
    ],
  },
  {
    id: "penggajian",
    label: "Penggajian",
    icon: Wallet,
    item: [
      { href: "/gaji", label: "Slip Gaji", icon: Wallet, izin: "halaman.gaji" },
      { href: "/payroll", label: "Payroll", icon: Banknote, izin: "payroll.kelola" },
    ],
  },
  {
    id: "pengembangan",
    label: "Pengembangan",
    icon: GraduationCap,
    item: [
      { href: "/pelatihan", label: "Pelatihan", icon: GraduationCap, izin: ["halaman.pelatihan", "pelatihan.kelola"] },
      { href: "/kinerja", label: "Kinerja", icon: Target, izin: ["halaman.kinerja", "kinerja.kelola"] },
      { href: "/kompetensi", label: "Kompetensi", icon: Award, izin: ["halaman.kompetensi", "kompetensi.kelola"] },
    ],
  },
  {
    id: "kepatuhan",
    label: "Kepatuhan",
    icon: ShieldAlert,
    item: [
      { href: "/kasus", label: "Keluhan & Disiplin", icon: ShieldAlert, izin: ["halaman.kasus", "disiplin.kelola"] },
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
      { href: "/unduh", label: "Unduh Aplikasi", icon: Download, izin: "halaman.unduh" },
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

/** Apakah pengguna memegang salah satu izin yang membuka menu ini. */
export const bolehBukaMenu = (m: MenuNav, saya: PenggunaSesi | undefined) => {
  if (!saya) return false;
  const daftar = Array.isArray(m.izin) ? m.izin : [m.izin];
  return daftar.some((k) => saya.permissions.includes(k));
};

export const menuUntuk = (saya: PenggunaSesi | undefined) => MENU.filter((m) => bolehBukaMenu(m, saya));

/** Kategori beserta itemnya yang boleh dilihat pengguna ini; kategori kosong dibuang. */
export const kelompokUntuk = (saya: PenggunaSesi | undefined): KelompokMenu[] =>
  KELOMPOK.map((k) => ({ ...k, item: k.item.filter((m) => bolehBukaMenu(m, saya)) })).filter((k) => k.item.length > 0);

/** Item menu yang mewakili jalur ini (termasuk sub-halamannya), bila ada. */
export const menuUntukJalur = (pathname: string) => MENU.find((m) => aktifDi(pathname, m.href));

/**
 * Apakah tautan menu mewakili halaman yang sedang dibuka.
 *
 * Dicocokkan per segmen: "/whatsapp" aktif untuk "/whatsapp" dan
 * "/whatsapp/…", tetapi TIDAK untuk "/whatsapp-saya" — pencocokan awalan
 * mentah membuat dua item menyala sekaligus.
 */
export const aktifDi = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
