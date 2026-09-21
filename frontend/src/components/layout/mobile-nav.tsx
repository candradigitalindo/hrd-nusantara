"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { menuUntuk, aktifDi } from "./nav-config";
import type { PenggunaSesi } from "@/lib/types";

/**
 * Bar navigasi bawah di ponsel: empat tujuan yang paling sering dibuka,
 * dalam jangkauan jempol. Sisanya lewat drawer di header.
 */
export const MobileNav = ({ pengguna }: { pengguna: PenggunaSesi | undefined }) => {
  const pathname = usePathname();
  const menu = menuUntuk(pengguna?.role).filter((m) => m.utama).slice(0, 4);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur lg:hidden pb-safe"
      aria-label="Navigasi cepat"
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${menu.length}, 1fr)` }}>
        {menu.map(({ href, label, icon: Icon }) => {
          const aktif = aktifDi(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={aktif ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 py-2 text-[11px] font-medium",
                  aktif ? "relative text-primary after:absolute after:-top-1 after:left-1/2 after:h-1 after:w-6 after:-translate-x-1/2 after:rounded-full after:bg-secondary" : "text-muted"
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
