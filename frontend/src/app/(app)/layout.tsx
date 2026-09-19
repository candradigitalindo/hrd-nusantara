"use client";

import * as React from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { MobileNav } from "@/components/layout/mobile-nav";
import { useSesi } from "@/hooks/use-sesi";

/**
 * Kerangka aplikasi. Tiga lebar layar, tiga pola navigasi:
 *   - ≥1024px : sidebar tetap di kiri
 *   - <1024px : header dengan tombol menu -> drawer
 *   - ponsel  : ditambah bar bawah untuk empat tujuan utama
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: pengguna } = useSesi();

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface lg:block">
        <div className="sticky top-0 h-dvh">
          <Sidebar pengguna={pengguna} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Header pengguna={pengguna} />
        <main className="flex-1 px-4 py-5 pb-24 sm:px-6 lg:pb-8">
          <div className="mx-auto w-full max-w-7xl space-y-5">{children}</div>
        </main>
        <MobileNav pengguna={pengguna} />
      </div>
    </div>
  );
}
