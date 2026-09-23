"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, LogOut, Moon, Sun, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sidebar } from "./sidebar";
import { useLogout } from "@/hooks/use-sesi";
import { useTema } from "@/hooks/use-tema";
import type { PenggunaSesi } from "@/lib/types";

export const Header = ({ pengguna }: { pengguna: PenggunaSesi | undefined }) => {
  const [buka, setBuka] = React.useState(false);
  const logout = useLogout();
  const { gelap, ganti } = useTema();

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface/90 px-3 backdrop-blur sm:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={() => setBuka(true)}
          aria-label="Buka menu"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </Button>
        <span className="font-semibold lg:hidden">HRD Nusantara</span>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" onClick={ganti} aria-label={gelap ? "Mode terang" : "Mode gelap"}>
          {gelap ? <Sun className="h-5 w-5" aria-hidden /> : <Moon className="h-5 w-5" aria-hidden />}
        </Button>
        <Link href="/ganti-sandi" aria-label="Ganti kata sandi" title="Ganti kata sandi" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground">
          <KeyRound className="h-5 w-5" aria-hidden />
        </Link>
        <Button variant="ghost" size="sm" onClick={logout} aria-label="Keluar">
          <LogOut className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Keluar</span>
        </Button>
      </header>

      {/* Drawer ponsel */}
      {buka && (
        <div className="fixed inset-0 z-40 lg:hidden" role="presentation">
          <div className="absolute inset-0 bg-black/50" onClick={() => setBuka(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-surface shadow-xl animate-fade-up">
            <Sidebar pengguna={pengguna} onNavigate={() => setBuka(false)} />
          </div>
        </div>
      )}
    </>
  );
};
