"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, LogIn, Menu, UserRound, X } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

const TAUTAN = [
  { href: "/", label: "Beranda" },
  { href: "/lowongan", label: "Lowongan" },
  { href: "/#fitur", label: "Fitur" },
  { href: "/#proses", label: "Proses Rekrutmen" },
  { href: "/unduh", label: "Aplikasi" },
];

/** Kepala halaman publik: ringkas di ponsel, penuh di layar lebar. */
export const KepalaPublik = () => {
  const pathname = usePathname();
  // Menu ponsel ditutup saat pindah halaman. Dikunci ke pathname lewat state
  // turunan, bukan effect: effect yang memanggil setState menimbulkan render
  // beruntun dan menyalakan peringatan compiler React.
  const [buka, setBuka] = React.useState<string | null>(null);
  const terbuka = buka === pathname;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2.5" aria-label="HRD Nusantara — beranda">
          <Logo className="h-9 w-9 shrink-0" />
          <span className="text-base font-bold leading-tight">
            HRD Nusantara
            <span className="block text-[11px] font-normal text-muted">F&B · Resto · Hotel</span>
          </span>
        </Link>

        <nav className="ml-6 hidden items-center gap-1 lg:flex" aria-label="Navigasi utama">
          {TAUTAN.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname === t.href ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2 hover:text-foreground"
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 sm:flex">
          <Link
            href="/karier/masuk"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2"
          >
            <UserRound className="h-4 w-4" aria-hidden /> Portal Pelamar
          </Link>
          <Link
            href="/login"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-on-primary shadow-sm hover:bg-primary-hover"
          >
            <LogIn className="h-4 w-4" aria-hidden /> Masuk Karyawan
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setBuka(terbuka ? null : pathname)}
          aria-expanded={terbuka}
          aria-label={terbuka ? "Tutup menu" : "Buka menu"}
          className="ml-auto grid h-10 w-10 place-items-center rounded-lg text-muted hover:bg-surface-2 lg:hidden"
        >
          {terbuka ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
        </button>
      </div>

      {terbuka && (
        <div className="border-t border-border bg-surface lg:hidden">
          <nav className="mx-auto grid max-w-6xl gap-1 px-4 py-3" aria-label="Navigasi ponsel">
            {TAUTAN.map((t) => (
              <Link key={t.href} href={t.href} className="rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-surface-2">
                {t.label}
              </Link>
            ))}
            <div className="mt-2 grid gap-2 border-t border-border pt-3">
              <Link href="/karier/masuk" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium">
                <Briefcase className="h-4 w-4" aria-hidden /> Portal Pelamar
              </Link>
              <Link href="/login" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-on-primary">
                <LogIn className="h-4 w-4" aria-hidden /> Masuk Karyawan
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
};
