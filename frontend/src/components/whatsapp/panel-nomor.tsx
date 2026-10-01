"use client";

import * as React from "react";
import { Building2, Search, Settings2, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatAngka, formatNomorWa } from "@/lib/utils";
import { namaNomor, tampilanStatus, waktuSingkat } from "./util-wa";
import type { NomorWa } from "@/lib/types";

const SEHARI_MS = 24 * 60 * 60 * 1000;
/** Kotak cari baru muncul bila daftar sudah tidak terbaca sekilas. */
const CARI_MULAI = 7;

/**
 * Panel pertama tab Percakapan: setiap nomor yang dipantau, dipilih dulu
 * sebelum melihat chat-nya, seperti membuka WhatsApp milik orang itu.
 */
export const PanelPilihNomor = ({
  nomor,
  memuat,
  galat,
  diperbarui,
  terpilih,
  seluruhIsi,
  onPilih,
  onUlangi,
  onKelola,
  className,
}: {
  nomor: NomorWa[];
  memuat: boolean;
  galat: boolean;
  /** Waktu daftar diambil (ms): pembanding "sepi", supaya render tetap murni. */
  diperbarui: number;
  terpilih: string;
  seluruhIsi: boolean;
  onPilih: (id: string) => void;
  onUlangi: () => void;
  onKelola: () => void;
  className?: string;
}) => {
  const [cari, setCari] = React.useState("");
  const q = cari.trim().toLowerCase();
  const qDigit = q.replace(/\D/g, "").replace(/^(0|62)/, "");
  const tampil = q
    ? nomor.filter(
        (n) =>
          `${namaNomor(n)} ${n.label} ${n.employee?.department?.name ?? ""}`.toLowerCase().includes(q) ||
          (qDigit.length >= 3 && (n.phoneNumber ?? "").includes(qDigit))
      )
    : nomor;

  return (
    <section className={cn("min-h-0 flex-col", className)} aria-label="Nomor yang dipantau">
      <div className="shrink-0 space-y-2 border-b border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate whitespace-nowrap text-sm font-semibold">
            Nomor dipantau{nomor.length > 0 && <span className="ml-1.5 font-normal tabular-nums text-muted">{nomor.length}</span>}
          </h2>
          <button
            type="button"
            onClick={onKelola}
            className="-mr-1 inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Settings2 className="h-3.5 w-3.5" aria-hidden /> Kelola nomor
          </button>
        </div>
        {nomor.length >= CARI_MULAI && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input className="h-9 pl-9 pr-9" placeholder="Cari nama atau nomor…" value={cari} onChange={(e) => setCari(e.target.value)} aria-label="Cari nomor" />
            {cari && (
              <button type="button" onClick={() => setCari("")} className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-surface-2" aria-label="Hapus pencarian">
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {memuat ? (
          <div className="space-y-3 p-3">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : galat ? (
          <div className="space-y-3 px-4 py-10 text-center">
            <p className="text-sm text-muted">Daftar nomor gagal dimuat.</p>
            <Button size="sm" variant="outline" onClick={onUlangi}>Coba lagi</Button>
          </div>
        ) : nomor.length === 0 ? (
          <div className="space-y-3 px-4 py-10 text-center">
            <p className="font-medium">Belum ada nomor yang dipantau</p>
            <p className="text-sm text-muted">Daftarkan nomor perusahaan atau minta karyawan menautkan WhatsApp-nya.</p>
            <Button size="sm" variant="outline" onClick={onKelola}>Kelola nomor</Button>
          </div>
        ) : tampil.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">Tidak ada nomor yang cocok.</p>
        ) : (
          <ul>
            {tampil.map((n) => {
              const st = tampilanStatus(n.status);
              const tersambung = n.status === "connected";
              const pt = n.pesanTerakhir;
              const sepi = tersambung && pt !== null && diperbarui - new Date(pt.timestamp).getTime() > SEHARI_MS;
              const dipilih = n.id === terpilih;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onPilih(n.id)}
                    aria-current={dipilih ? "true" : undefined}
                    title={pt?.cuplikan ? `Pesan terakhir: ${pt.cuplikan}` : undefined}
                    className={cn(
                      "flex w-full items-start gap-3 border-b border-border/60 px-3 py-2.5 text-left transition-colors hover:bg-surface-2",
                      dipilih && "bg-primary-soft/60 hover:bg-primary-soft/60"
                    )}
                  >
                    <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden>
                      {n.kind === "company" ? <Building2 className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
                      <span className={cn("absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-surface", st.titik)} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">{namaNomor(n)}</span>
                        {pt && <span className="shrink-0 text-[11px] tabular-nums text-muted">{waktuSingkat(pt.timestamp)}</span>}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted">
                        {n.kind === "company" ? "Perusahaan" : "Pribadi"}
                        {" · "}
                        <span className="tabular-nums">{n.phoneNumber ? formatNomorWa(n.phoneNumber) : "belum dipindai"}</span>
                      </span>
                      {/* Boleh melipat: angka "pesan hari ini" justru yang paling dicari, jangan terpotong. */}
                      <span className="mt-0.5 block text-xs leading-snug text-muted">
                        {tersambung ? <span className="sr-only">{st.label} · </span> : <span className={cn("font-medium", st.teks)}>{st.label} · </span>}
                        {sepi && <span className="font-medium text-danger">Sepi &gt;24 jam · </span>}
                        <span className="tabular-nums">
                          {formatAngka(n.jumlah.chatPribadi)} chat
                          {seluruhIsi && ` · ${formatAngka(n.jumlah.grup)} grup`}
                          {" · "}
                          <span className="whitespace-nowrap">{formatAngka(n.jumlah.pesanHariIni)} pesan hari ini</span>
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
};
