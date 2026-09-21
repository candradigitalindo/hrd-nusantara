"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";
import { menuUntukJalur, menuUntuk, bolehBukaMenu, type MenuNav } from "@/components/layout/nav-config";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { LABEL_ROLE } from "@/lib/utils";
import type { PenggunaSesi } from "@/lib/types";
import { Header } from "@/components/layout/header";
import { MobileNav } from "@/components/layout/mobile-nav";
import { useSesi } from "@/hooks/use-sesi";

/**
 * Kerangka aplikasi. Tiga lebar layar, tiga pola navigasi:
 *   - ≥1024px : sidebar tetap di kiri
 *   - <1024px : header dengan tombol menu -> drawer
 *   - ponsel  : ditambah bar bawah untuk empat tujuan utama
 */
/**
 * Halaman yang menunya tidak termasuk peran pengguna tidak dirender sama
 * sekali. Server tetap menolak API-nya; ini supaya orang tidak melihat
 * kerangka halaman yang penuh galat 403.
 */
const AksesDibatasi = ({ item, pengguna }: { item: MenuNav; pengguna: PenggunaSesi }) => {
  const tujuan = menuUntuk(pengguna)[0];
  return (
    <Card>
      <EmptyState
        icon={Lock}
        title="Menu ini tidak termasuk peran Anda"
        description={`"${item.label}" tidak tersedia untuk peran ${pengguna.customRole?.name ?? LABEL_ROLE[pengguna.role]}. Hubungi HR bila Anda memerlukannya.`}
        action={tujuan ? <Link href={tujuan.href}><Button variant="outline">Ke {tujuan.label}</Button></Link> : undefined}
      />
    </Card>
  );
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: pengguna } = useSesi();
  const pathname = usePathname();
  const item = menuUntukJalur(pathname);
  const ditolak = pengguna !== undefined && item !== undefined && !bolehBukaMenu(item, pengguna);

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
          <div className="mx-auto w-full max-w-7xl space-y-5">{ditolak ? <AksesDibatasi item={item} pengguna={pengguna} /> : children}</div>
        </main>
        <MobileNav pengguna={pengguna} />
      </div>
    </div>
  );
}
