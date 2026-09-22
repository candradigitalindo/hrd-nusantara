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
   * Izin yang membuka menu ini — salah satu cukup. Kuncinya "<halaman>.<aksi>";
   * "lihat" untuk akses halamannya, dan bagi halaman yang punya bagian
   * pengelolaan (tim, pengaturan), kunci bagian itu juga membuka menunya.
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
  { id: "beranda", label: "Beranda", icon: LayoutDashboard, item: [{ href: "/", label: "Dashboard", icon: LayoutDashboard, izin: "dashboard.lihat", utama: true }] },
  {
    id: "komunikasi",
    label: "Komunikasi",
    icon: MessagesSquare,
    item: [
      { href: "/pengumuman", label: "Pengumuman", icon: Megaphone, izin: "pengumuman.lihat" },
      { href: "/chat", label: "Chat Tim", icon: MessagesSquare, izin: "chat.lihat" },
      { href: "/whatsapp-saya", label: "WhatsApp Saya", icon: Smartphone, izin: "whatsapp_saya.lihat" },
      { href: "/whatsapp", label: "Pemantauan WA", icon: MessageCircle, izin: ["whatsapp.lihat", "whatsapp.buat", "whatsapp.ubah", "whatsapp.hapus"] },
    ],
  },
  {
    id: "kepegawaian",
    label: "Kepegawaian",
    icon: Briefcase,
    item: [
      { href: "/karyawan", label: "Karyawan", icon: Users, izin: "karyawan.lihat", utama: true },
      { href: "/organisasi", label: "Organisasi", icon: Building2, izin: ["organisasi.lihat", "organisasi.buat", "organisasi.ubah", "organisasi.hapus"] },
      { href: "/rekrutmen", label: "Rekrutmen", icon: UserSearch, izin: ["rekrutmen.lihat", "rekrutmen.buat", "rekrutmen.ubah", "wawancara.lihat"] },
    ],
  },
  {
    id: "kehadiran",
    label: "Kehadiran & Cuti",
    icon: CalendarCheck,
    item: [
      { href: "/presensi", label: "Presensi", icon: CalendarCheck, izin: ["presensi.lihat", "presensi_tim.lihat"], utama: true },
      { href: "/cuti", label: "Cuti & Izin", icon: CalendarOff, izin: ["cuti.lihat", "cuti_tim.lihat", "cuti_tim.ubah", "pengaturan_cuti.lihat", "pengaturan_cuti.buat", "pengaturan_cuti.ubah"], utama: true },
    ],
  },
  {
    id: "penggajian",
    label: "Penggajian",
    icon: Wallet,
    item: [
      { href: "/gaji", label: "Slip Gaji", icon: Wallet, izin: "gaji.lihat" },
      { href: "/payroll", label: "Payroll", icon: Banknote, izin: ["payroll.lihat", "payroll.buat", "payroll.ubah", "payroll.hapus"] },
    ],
  },
  {
    id: "pengembangan",
    label: "Pengembangan",
    icon: GraduationCap,
    item: [
      { href: "/pelatihan", label: "Pelatihan", icon: GraduationCap, izin: ["pelatihan.lihat", "pelatihan.buat", "pelatihan.ubah"] },
      { href: "/kinerja", label: "Kinerja", icon: Target, izin: ["kinerja.lihat", "kinerja.buat", "kinerja.ubah"] },
      { href: "/kompetensi", label: "Kompetensi", icon: Award, izin: ["kompetensi.lihat", "kompetensi.buat", "kompetensi.ubah", "kompetensi.hapus"] },
    ],
  },
  {
    id: "kepatuhan",
    label: "Kepatuhan",
    icon: ShieldAlert,
    item: [
      { href: "/kasus", label: "Keluhan & Disiplin", icon: ShieldAlert, izin: ["kasus.lihat", "kasus.buat", "kasus.ubah"] },
      { href: "/audit", label: "Jejak Audit", icon: ScrollText, izin: "audit.lihat" },
    ],
  },
  { id: "analitik", label: "Analitik", icon: BarChart3, item: [{ href: "/laporan", label: "Laporan", icon: BarChart3, izin: ["laporan.lihat", "laporan_hr.lihat"] }] },
  {
    id: "aplikasi",
    label: "Aplikasi Mobile",
    icon: TabletSmartphone,
    item: [
      { href: "/aplikasi", label: "Rilis APK", icon: TabletSmartphone, izin: ["aplikasi.lihat", "aplikasi.buat", "aplikasi.ubah"] },
      { href: "/unduh", label: "Unduh Aplikasi", icon: Download, izin: "unduh.lihat" },
    ],
  },
  {
    id: "administrasi",
    label: "Administrasi",
    icon: KeyRound,
    item: [{ href: "/peran", label: "Peran & Hak Akses", icon: KeyRound, izin: ["peran.lihat", "peran.buat", "peran.ubah", "peran.hapus"] }],
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
