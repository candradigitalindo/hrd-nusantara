"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn, inisial, LABEL_ROLE } from "@/lib/utils";
import { Logo } from "@/components/ui/logo";
import { kelompokUntuk, aktifDi, type MenuNav, type KelompokMenu } from "./nav-config";
import { berlanggananSidebar, snapshotSidebar, snapshotSidebarServer, kategoriTerbuka, ubahLipatan } from "./sidebar-store";
import type { PenggunaSesi } from "@/lib/types";

const Tautan = ({ item, aktif, sub, onNavigate }: { item: MenuNav; aktif: boolean; sub?: boolean; onNavigate?: () => void }) => {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={aktif ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg border-l-[3px] text-sm font-medium transition-colors",
        sub ? "py-2 pl-3 pr-3" : "px-3 py-2.5",
        aktif ? "border-secondary bg-primary-soft text-primary" : "border-transparent text-muted hover:bg-surface-2 hover:text-foreground"
      )}
    >
      <Icon className={cn("shrink-0", sub ? "h-4 w-4" : "h-5 w-5")} aria-hidden />
      <span className="truncate">{item.label}</span>
    </Link>
  );
};

/** Kategori dengan sub-menu yang bisa dilipat. Kategori halaman aktif selalu terbuka. */
const Kategori = ({ kelompok, pathname, terbuka, onNavigate }: { kelompok: KelompokMenu; pathname: string; terbuka: boolean; onNavigate?: () => void }) => {
  const Icon = kelompok.icon;
  const adaAktif = kelompok.item.some((m) => aktifDi(pathname, m.href));
  const buka = terbuka || adaAktif;
  const idPanel = `sidebar-${kelompok.id}`;
  return (
    <li>
      <button
        type="button"
        onClick={() => ubahLipatan(kelompok.id, !buka)}
        aria-expanded={buka}
        aria-controls={idPanel}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors",
          adaAktif ? "text-primary" : "text-foreground hover:bg-surface-2"
        )}
      >
        <Icon className="h-5 w-5 shrink-0" aria-hidden />
        <span className="flex-1 truncate text-left">{kelompok.label}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted transition-transform", buka && "rotate-180")} aria-hidden />
      </button>
      {buka && (
        <ul id={idPanel} className="ml-5 mt-0.5 space-y-0.5 border-l border-border pl-2">
          {kelompok.item.map((m) => (
            <li key={m.href}>
              <Tautan item={m} aktif={aktifDi(pathname, m.href)} sub onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
};

export const Sidebar = ({
  pengguna,
  onNavigate,
  className,
}: {
  pengguna: PenggunaSesi | undefined;
  onNavigate?: () => void;
  className?: string;
}) => {
  const pathname = usePathname();
  const kelompok = kelompokUntuk(pengguna);
  const terbuka = kategoriTerbuka(React.useSyncExternalStore(berlanggananSidebar, snapshotSidebar, snapshotSidebarServer));

  return (
    <nav className={cn("flex h-full flex-col", className)} aria-label="Navigasi utama">
      <div className="flex items-center gap-3 px-5 py-5">
        <Logo className="h-9 w-9 shrink-0" />
        <div className="leading-tight">
          <p className="font-semibold">HRD Nusantara</p>
          <p className="text-xs text-muted">F&B · Resto · Hotel</p>
        </div>
      </div>

      <ul className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {kelompok.map((k) =>
          k.item.length === 1 ? (
            <li key={k.id}>
              <Tautan item={k.item[0]} aktif={aktifDi(pathname, k.item[0].href)} onNavigate={onNavigate} />
            </li>
          ) : (
            <Kategori key={k.id} kelompok={k} pathname={pathname} terbuka={terbuka.has(k.id)} onNavigate={onNavigate} />
          )
        )}
      </ul>

      {pengguna && (
        <div className="border-t border-border p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-semibold">{inisial(pengguna.name)}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{pengguna.name}</p>
              <p className="truncate text-xs text-muted">{pengguna.customRole?.name ?? LABEL_ROLE[pengguna.role]}</p>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};
