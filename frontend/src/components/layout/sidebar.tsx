"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, inisial, LABEL_ROLE } from "@/lib/utils";
import { menuUntuk } from "./nav-config";
import type { PenggunaSesi } from "@/lib/types";

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
  const menu = menuUntuk(pengguna?.role);

  return (
    <nav className={cn("flex h-full flex-col", className)} aria-label="Navigasi utama">
      <div className="flex items-center gap-3 px-5 py-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-on-primary font-bold">
          H
        </span>
        <div className="leading-tight">
          <p className="font-semibold">HRD Nusantara</p>
          <p className="text-xs text-muted">F&B · Resto · Hotel</p>
        </div>
      </div>

      <ul className="flex-1 space-y-1 px-3">
        {menu.map(({ href, label, icon: Icon }) => {
          const aktif = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={aktif ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  aktif ? "border-l-[3px] border-secondary bg-primary-soft text-primary" : "border-l-[3px] border-transparent text-muted hover:bg-surface-2 hover:text-foreground"
                )}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>

      {pengguna && (
        <div className="border-t border-border p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-semibold">
              {inisial(pengguna.name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{pengguna.name}</p>
              <p className="truncate text-xs text-muted">{LABEL_ROLE[pengguna.role]}</p>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};
