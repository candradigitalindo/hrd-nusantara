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

const HR: Role[] = ["SUPER_ADMIN", "HR_ADMIN"];
const MANAJEMEN: Role[] = ["SUPER_ADMIN", "HR_ADMIN", "MANAGER"];

export const MENU: MenuNav[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, utama: true },
  { href: "/pengumuman", label: "Pengumuman", icon: Megaphone },
  { href: "/chat", label: "Chat", icon: MessagesSquare },
  { href: "/karyawan", label: "Karyawan", icon: Users, roles: MANAJEMEN, utama: true },
  { href: "/organisasi", label: "Organisasi", icon: Building2, roles: HR },
  { href: "/presensi", label: "Presensi", icon: CalendarCheck, utama: true },
  { href: "/cuti", label: "Cuti", icon: CalendarOff, utama: true },
  { href: "/gaji", label: "Gaji", icon: Wallet },
  { href: "/pelatihan", label: "Pelatihan", icon: GraduationCap },
  { href: "/kinerja", label: "Kinerja", icon: Target },
  { href: "/kompetensi", label: "Kompetensi", icon: Award },
  { href: "/payroll", label: "Payroll", icon: Banknote, roles: HR },
  { href: "/rekrutmen", label: "Rekrutmen", icon: UserSearch, roles: MANAJEMEN },
  { href: "/kasus", label: "Keluhan & Disiplin", icon: ShieldAlert },
  { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle, roles: HR },
  { href: "/laporan", label: "Laporan", icon: BarChart3, roles: MANAJEMEN },
  { href: "/audit", label: "Jejak Audit", icon: ScrollText, roles: ["SUPER_ADMIN"] },
];

export const menuUntuk = (role: Role | undefined) =>
  MENU.filter((m) => !m.roles || (role && m.roles.includes(role)));
