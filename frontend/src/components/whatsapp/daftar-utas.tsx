"use client";

import * as React from "react";
import { ArrowLeft, ArrowUpRight, MessageCircle, Paperclip, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatAngka, formatNomorWa, tampakLid } from "@/lib/utils";
import { useArsipBertahap } from "./arsip-bertahap";
import {
  AvatarWa,
  LABEL_TIPE,
  LencanaKaryawan,
  LencanaLid,
  SEGAR_MS,
  judulUtas,
  namaNomor,
  nomorAsliUtas,
  tampilanStatus,
  utasBernama,
  waktuSingkat,
} from "./util-wa";
import type { DaftarUtasWa, JenisUtas, NomorWa, Utas } from "@/lib/types";

type SaringanJenis = "semua" | JenisUtas;

const waktuUtas = (u: Utas) => (u.pesanTerakhir ? new Date(u.pesanTerakhir.timestamp).getTime() : 0);

/**
 * Panel kedua: chat milik satu nomor. Komponen ini dipasang ulang (key) tiap
 * nomor berganti, jadi pencarian dan saringan selalu mulai bersih.
 */
export const DaftarUtas = ({
  nomor,
  accountId,
  seluruhIsi,
  aktif,
  onPilih,
  onSemuaNomor,
  onKelola,
  className,
}: {
  /** null selama daftar nomor belum tiba. */
  nomor: NomorWa | null;
  accountId: string;
  seluruhIsi: boolean;
  /** Kunci utas yang sedang dibuka. */
  aktif: string | null;
  onPilih: (u: Utas) => void;
  onSemuaNomor: () => void;
  onKelola: () => void;
  className?: string;
}) => {
  const [jenis, setJenis] = React.useState<SaringanJenis>("semua");
  const [cari, setCari] = React.useState("");
  const [cariTunda, setCariTunda] = React.useState("");

  React.useEffect(() => {
    const t = setTimeout(() => setCariTunda(cari.trim()), 400);
    return () => clearTimeout(t);
  }, [cari]);

  const q = cariTunda.length >= 2 ? cariTunda : "";
  // Grup hanya untuk Super Admin; server juga menyaringnya.
  const saringan: SaringanJenis = !seluruhIsi && jenis === "grup" ? "semua" : jenis;

  const utas = useArsipBertahap<Utas, DaftarUtasWa>({
    queryKey: ["wa", "utas", accountId, saringan, q],
    aktif: Boolean(nomor),
    segarMs: SEGAR_MS,
    ambil: async (page, pantau) => {
      const p = new URLSearchParams({ accountId, page: String(page), limit: "30" });
      if (saringan !== "semua") p.set("jenis", saringan);
      if (q) p.set("q", q);
      if (pantau) p.set("pantau", "1");
      return (await api.get<DaftarUtasWa>(`/whatsapp/threads?${p}`)).data;
    },
    kunci: (u) => u.kunci,
    waktu: waktuUtas,
  });

  const jumlah = utas.terbaru?.jumlah;
  const st = nomor ? tampilanStatus(nomor.status) : null;
  const pilihan: [SaringanJenis, string][] = [
    ["semua", "Semua"],
    ["pribadi", "Pribadi"],
    ...(seluruhIsi ? ([["grup", "Grup"]] as [SaringanJenis, string][]) : []),
  ];

  return (
    <section className={cn("min-h-0 flex-col", className)} aria-label="Daftar chat">
      <div className="shrink-0 space-y-2 border-b border-border p-3">
        <button
          type="button"
          onClick={onSemuaNomor}
          className="-ml-1 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs font-medium text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:hidden"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Semua nomor
        </button>

        {nomor && st ? (
          <div className="min-w-0">
            <p className="flex items-center gap-2">
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", st.titik)} aria-hidden />
              <span className="truncate text-sm font-semibold">{namaNomor(nomor)}</span>
              <span className={cn("ml-auto shrink-0 text-xs font-medium", st.teks)}>{st.label}</span>
            </p>
            <p className="truncate pl-[1.125rem] text-xs text-muted">
              <span className="tabular-nums">{nomor.phoneNumber ? formatNomorWa(nomor.phoneNumber) : "Belum dipindai"}</span>
              {" · "}
              {nomor.kind === "company" ? "Perusahaan" : "Pribadi"}
            </p>
          </div>
        ) : (
          <Skeleton className="h-9 w-2/3" />
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            className="h-9 pl-9 pr-9"
            placeholder="Cari nama, nomor, atau kata…"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            aria-label="Cari chat"
          />
          {cari && (
            <button type="button" onClick={() => setCari("")} className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-surface-2" aria-label="Hapus pencarian">
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>

        <div className="flex gap-1 rounded-xl bg-surface-2 p-1" role="group" aria-label="Jenis chat">
          {pilihan.map(([kode, label]) => (
            <button
              key={kode}
              type="button"
              aria-pressed={saringan === kode}
              onClick={() => setJenis(kode)}
              className={cn(
                "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-sm font-medium transition-colors",
                saringan === kode ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"
              )}
            >
              {label}
              {jumlah && <span className="rounded-full bg-surface-2 px-1.5 text-xs tabular-nums text-muted">{formatAngka(jumlah[kode])}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {utas.memuat ? (
          <div className="space-y-3 p-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : utas.galat ? (
          <div className="space-y-3 px-6 py-12 text-center">
            <p className="text-sm text-muted">Daftar chat gagal dimuat.</p>
            <Button size="sm" variant="outline" onClick={utas.ulangi}>Coba lagi</Button>
          </div>
        ) : utas.butir.length === 0 ? (
          <div className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", utas.sementara && "opacity-60")}>
            <span className="grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-muted"><MessageCircle className="h-5 w-5" aria-hidden /></span>
            {q ? (
              <>
                <p className="font-medium">Tidak ada yang cocok</p>
                <p className="text-sm text-muted">Nama dan nomor dicari sebagian; isi pesan dicari per kata utuh — &quot;keluhan&quot; ditemukan, &quot;keluh&quot; tidak.</p>
              </>
            ) : nomor && nomor.status !== "connected" ? (
              <>
                <p className="font-medium">Belum ada chat terarsip</p>
                <p className="text-sm text-muted">Nomor ini {tampilanStatus(nomor.status).label.toLowerCase()}. Pesan baru terarsip setelah tersambung.</p>
                <Button size="sm" variant="outline" onClick={onKelola}>Kelola nomor</Button>
              </>
            ) : (
              <>
                <p className="font-medium">Belum ada chat</p>
                <p className="text-sm text-muted">Pesan yang masuk dan keluar dari nomor ini akan muncul di sini.</p>
              </>
            )}
          </div>
        ) : (
          <ul className={cn("transition-opacity", utas.sementara && "opacity-60")} aria-busy={utas.sementara || undefined}>
            {utas.butir.map((u) => (
              <BarisUtas key={u.kunci} u={u} aktif={u.kunci === aktif} onPilih={() => onPilih(u)} />
            ))}
            {utas.adaLagi && (
              <li className="p-3">
                <Button variant="ghost" size="sm" className="w-full" onClick={() => void utas.muatLagi()} loading={utas.memuatLagi}>
                  Muat lebih banyak
                </Button>
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
};

const BarisUtas = ({ u, aktif, onPilih }: { u: Utas; aktif: boolean; onPilih: () => void }) => {
  const grup = u.jenis === "grup";
  const judul = judulUtas(u);
  const bernama = utasBernama(u);
  const nomorAsli = nomorAsliUtas(u);
  const pt = u.pesanTerakhir;
  // Cuplikan grup diawali nama pengirimnya, seperti di WhatsApp.
  const pengirim =
    grup && pt && !pt.keluar && pt.pengirim
      ? (pt.pengirim.nama ?? (pt.pengirim.nomor && !tampakLid(pt.pengirim.nomor) ? formatNomorWa(pt.pengirim.nomor) : null))
      : null;

  return (
    <li>
      <button
        type="button"
        onClick={onPilih}
        aria-current={aktif ? "true" : undefined}
        className={cn(
          "flex w-full items-start gap-3 border-b border-border/60 px-3 py-2.5 text-left transition-colors hover:bg-surface-2",
          aktif && "bg-primary-soft/60 hover:bg-primary-soft/60"
        )}
      >
        <AvatarWa nama={bernama ? judul : null} grup={grup} kunciWarna={u.kontak?.nomor ?? u.kontak?.lid ?? u.contactNumber} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn("truncate text-sm font-medium", !bernama && "text-muted")}>{judul}</span>
            {pt && <span className="shrink-0 text-[11px] tabular-nums text-muted">{waktuSingkat(pt.timestamp)}</span>}
          </span>
          {!grup && (
            <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
              {nomorAsli ? <span className="tabular-nums">{formatNomorWa(nomorAsli)}</span> : <LencanaLid />}
              {u.kontak?.karyawan && <LencanaKaryawan />}
            </span>
          )}
          <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
            {pt?.keluar && <ArrowUpRight className="h-3 w-3 shrink-0" aria-label="Dikirim" />}
            {pt?.adaBerkas && <Paperclip className="h-3 w-3 shrink-0" aria-label="Ada berkas" />}
            <span className="min-w-0 flex-1 truncate">
              {pengirim && <span className="font-medium text-foreground/80">{pengirim}: </span>}
              {pt ? pt.cuplikan || LABEL_TIPE[pt.messageType] || pt.messageType : "—"}
            </span>
            <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[11px] tabular-nums" title={`${formatAngka(u.jumlahPesan)} pesan`}>
              {formatAngka(u.jumlahPesan)}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
};

