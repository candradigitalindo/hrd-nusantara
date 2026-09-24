"use client";

import * as React from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { isToday, isYesterday } from "date-fns";
import { ArrowLeft, ArrowUpRight, MessageCircle, Paperclip, Search, UsersRound, X } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatTanggal, formatWaktu } from "@/lib/utils";
import { MediaPesan } from "./media-pesan";
import type { AkunWhatsApp, Halaman, Percakapan, UtasWa } from "@/lib/types";

const SEGAR_MS = 15_000;

const LABEL_TIPE: Record<string, string> = {
  image: "Foto",
  video: "Video",
  audio: "Pesan suara",
  document: "Dokumen",
  text: "Pesan",
};

/** Waktu singkat ala aplikasi chat: jam untuk hari ini, "Kemarin", lalu tanggal. */
const waktuSingkat = (nilai: string) => {
  const d = new Date(nilai);
  if (isToday(d)) return formatWaktu(d);
  if (isYesterday(d)) return "Kemarin";
  return formatTanggal(d, "d MMM");
};

const namaUtas = (u: Pick<UtasWa, "groupJid" | "groupName" | "contactNumber">) =>
  u.groupJid ? (u.groupName ?? "Grup tanpa nama") : `+${u.contactNumber}`;

const Avatar = ({ grup, nama, kecil }: { grup: boolean; nama: string; kecil?: boolean }) => (
  <span
    className={cn(
      "grid shrink-0 place-items-center rounded-full font-semibold",
      kecil ? "h-9 w-9 text-xs" : "h-10 w-10 text-sm",
      grup ? "bg-info-soft text-info" : "bg-primary-soft text-primary"
    )}
    aria-hidden
  >
    {grup ? <UsersRound className="h-4 w-4" /> : nama.replace(/\D/g, "").slice(-2)}
  </span>
);

/**
 * Arsip percakapan dalam bentuk yang dikenal semua orang dari WhatsApp:
 * daftar utas di kiri, isi percakapan di kanan. Di ponsel keduanya bergantian.
 */
export const PanelPercakapan = ({
  akun,
  accountId,
  onAccountId,
  seluruhIsi,
  nomorTersambung,
  nomorTotal,
  onLihatNomor,
}: {
  akun: AkunWhatsApp[];
  accountId: string;
  onAccountId: (id: string) => void;
  seluruhIsi: boolean;
  nomorTersambung: number;
  nomorTotal: number;
  onLihatNomor: () => void;
}) => {
  const [cari, setCari] = React.useState("");
  const [cariTunda, setCariTunda] = React.useState("");
  const [dipilih, setDipilih] = React.useState<UtasWa | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setCariTunda(cari.trim()), 400);
    return () => clearTimeout(t);
  }, [cari]);

  const utas = useInfiniteQuery({
    queryKey: ["wa", "utas", accountId, cariTunda],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const p = new URLSearchParams({ page: String(pageParam), limit: "30" });
      if (accountId) p.set("accountId", accountId);
      if (cariTunda.length >= 2) p.set("q", cariTunda);
      return (await api.get<Halaman<UtasWa>>(`/whatsapp/threads?${p}`)).data;
    },
    getNextPageParam: (h) => (h.pagination.page < h.pagination.totalPages ? h.pagination.page + 1 : undefined),
    refetchInterval: SEGAR_MS,
  });

  const daftar = React.useMemo(() => utas.data?.pages.flatMap((h) => h.data) ?? [], [utas.data]);
  const total = utas.data?.pages[0]?.pagination.total ?? 0;
  // Utas terpilih diambil dari daftar yang terbaru supaya cuplikan dan
  // jumlah pesannya ikut segar; kalau sudah tergeser keluar daftar (misalnya
  // karena pencarian berubah), yang terakhir dipilih tetap dipakai.
  const aktif = dipilih ? (daftar.find((u) => u.kunci === dipilih.kunci) ?? dipilih) : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-2xl border border-border bg-surface md:h-[calc(100vh-17rem)] md:min-h-[32rem] md:grid-cols-[22rem_minmax(0,1fr)]">
      {/* Daftar utas */}
      <div className={cn("flex min-h-0 flex-col border-border md:border-r", aktif && "hidden md:flex")}>
        <div className="space-y-2 border-b border-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input className="pl-9 pr-9" placeholder="Cari nomor atau kata…" value={cari} onChange={(e) => setCari(e.target.value)} aria-label="Cari percakapan" />
            {cari && (
              <button type="button" onClick={() => setCari("")} className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-surface-2" aria-label="Hapus pencarian">
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
          <Select value={accountId} onChange={(e) => onAccountId(e.target.value)} aria-label="Nomor yang dipantau">
            <option value="">Semua nomor</option>
            {akun.map((a) => (
              <option key={a.id} value={a.id}>{a.label}{a.phoneNumber ? ` · +${a.phoneNumber}` : ""}</option>
            ))}
          </Select>
          <p className="text-[11px] text-muted">
            {utas.isLoading ? "Memuat…" : `${total} percakapan`} · angka mencari nomor, kata mencari isi pesan
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {utas.isLoading ? (
            <div className="space-y-3 p-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : daftar.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-muted"><MessageCircle className="h-5 w-5" aria-hidden /></span>
              {cariTunda ? (
                <>
                  <p className="font-medium">Tidak ada yang cocok</p>
                  <p className="text-sm text-muted">Pencarian isi memakai kata utuh — &quot;keluhan&quot; ditemukan, &quot;keluh&quot; tidak.</p>
                </>
              ) : (
                <>
                  <p className="font-medium">Belum ada percakapan</p>
                  <p className="text-sm text-muted">
                    Pesan terarsip begitu nomor tersambung. Saat ini <span className="font-medium text-foreground">{nomorTersambung} dari {nomorTotal}</span> nomor tersambung.
                  </p>
                  <Button size="sm" variant="outline" onClick={onLihatNomor}>Lihat nomor</Button>
                </>
              )}
            </div>
          ) : (
            <ul>
              {daftar.map((u) => {
                const nama = namaUtas(u);
                const pt = u.pesanTerakhir;
                return (
                  <li key={u.kunci}>
                    <button
                      type="button"
                      onClick={() => setDipilih(u)}
                      aria-current={aktif?.kunci === u.kunci}
                      className={cn(
                        "flex w-full items-start gap-3 border-b border-border/60 px-3 py-3 text-left transition-colors hover:bg-surface-2",
                        aktif?.kunci === u.kunci && "bg-primary-soft/60 hover:bg-primary-soft/60"
                      )}
                    >
                      <Avatar grup={Boolean(u.groupJid)} nama={nama} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium">{nama}</span>
                          {pt && <span className="shrink-0 text-[11px] tabular-nums text-muted">{waktuSingkat(pt.timestamp)}</span>}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                          {pt?.direction === "outgoing" && <ArrowUpRight className="h-3 w-3 shrink-0" aria-label="Terkirim" />}
                          {pt?.adaBerkas && <Paperclip className="h-3 w-3 shrink-0" aria-label="Ada berkas" />}
                          <span className="truncate">{pt ? (pt.cuplikan || LABEL_TIPE[pt.messageType] || pt.messageType) : "—"}</span>
                        </span>
                        <span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted">
                          <span className="truncate">via {u.relatedEmployee?.name ?? u.account?.label ?? "—"}</span>
                          <span className="shrink-0 rounded-full bg-surface-2 px-1.5 tabular-nums">{u.jumlahPesan}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {utas.hasNextPage && (
                <li className="p-3">
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => utas.fetchNextPage()} loading={utas.isFetchingNextPage}>Muat lebih banyak</Button>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      {/* Isi percakapan */}
      <div className={cn("min-h-0 flex-col", aktif ? "flex" : "hidden md:flex")}>
        {aktif ? (
          <IsiUtas key={aktif.kunci} utas={aktif} seluruhIsi={seluruhIsi} onKembali={() => setDipilih(null)} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted">
            <MessageCircle className="h-8 w-8 opacity-40" aria-hidden />
            <p className="text-sm">Pilih percakapan untuk membaca isinya.</p>
            <p className="text-xs">Membaca di sini tidak menandai pesan terbaca di ponsel pemegang nomor.</p>
          </div>
        )}
      </div>
    </div>
  );
};

/** Isi satu utas, dengan pemisah tanggal dan pesan lama yang bisa dimuat. */
const IsiUtas = ({ utas, seluruhIsi, onKembali }: { utas: UtasWa; seluruhIsi: boolean; onKembali: () => void }) => {
  const grup = Boolean(utas.groupJid);
  const nama = namaUtas(utas);
  const gulir = React.useRef<HTMLDivElement>(null);

  const pesan = useInfiniteQuery({
    queryKey: ["wa", "utas-pesan", utas.kunci],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const p = new URLSearchParams({ page: String(pageParam), limit: "40", accountId: utas.accountId, contactNumber: utas.contactNumber });
      if (utas.groupJid) p.set("groupJid", utas.groupJid);
      return (await api.get<Halaman<Percakapan>>(`/whatsapp/conversations?${p}`)).data;
    },
    getNextPageParam: (h) => (h.pagination.page < h.pagination.totalPages ? h.pagination.page + 1 : undefined),
    refetchInterval: SEGAR_MS,
  });

  // Server mengirim yang terbaru lebih dulu; percakapan dibaca dari atas ke bawah.
  const urut = React.useMemo(
    () => (pesan.data?.pages.flatMap((h) => h.data) ?? []).slice().reverse(),
    [pesan.data]
  );
  const terbaru = urut.at(-1)?.id;

  // Turun ke pesan terbaru saat utas dibuka dan saat ada pesan baru masuk —
  // tidak saat pesan lama dimuat, supaya posisi baca tidak melompat.
  React.useEffect(() => {
    const el = gulir.current;
    if (el && terbaru) el.scrollTop = el.scrollHeight;
  }, [terbaru]);

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border px-3 py-2.5">
        <button type="button" onClick={onKembali} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 md:hidden" aria-label="Kembali ke daftar">
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <Avatar grup={grup} nama={nama} kecil />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{nama}</p>
          <p className="truncate text-xs text-muted">
            {utas.jumlahPesan} pesan · via {utas.account?.label ?? "—"}
            {utas.account?.phoneNumber ? ` (+${utas.account.phoneNumber})` : ""}
          </p>
        </div>
      </div>

      <div ref={gulir} className="max-h-[70vh] min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-surface-2/50 px-3 py-4 sm:px-6 md:max-h-none">
        {pesan.hasNextPage && (
          <div className="pb-2 text-center">
            <Button variant="ghost" size="sm" onClick={() => pesan.fetchNextPage()} loading={pesan.isFetchingNextPage}>Muat pesan lebih lama</Button>
          </div>
        )}
        {pesan.isLoading ? (
          <div className="space-y-3">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className={cn("h-12 w-2/3", i % 2 && "ml-auto")} />)}</div>
        ) : (
          urut.map((p, i) => {
            const keluar = p.direction === "outgoing";
            const hari = formatTanggal(p.timestamp, "yyyy-MM-dd");
            const hariBaru = i === 0 || formatTanggal(urut[i - 1].timestamp, "yyyy-MM-dd") !== hari;
            return (
              <React.Fragment key={p.id}>
                {hariBaru && (
                  <div className="py-2 text-center">
                    <span className="rounded-full bg-surface px-3 py-1 text-[11px] font-medium text-muted shadow-sm">
                      {isToday(new Date(p.timestamp)) ? "Hari ini" : isYesterday(new Date(p.timestamp)) ? "Kemarin" : formatTanggal(p.timestamp, "EEEE, d MMMM yyyy")}
                    </span>
                  </div>
                )}
                <div className={cn("flex", keluar ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[70%]", keluar ? "rounded-br-md bg-primary-soft" : "rounded-bl-md bg-surface")}>
                    {grup && !keluar && p.participantNumber && <p className="mb-0.5 text-xs font-medium text-info">+{p.participantNumber}</p>}
                    {p.messageBody ? (
                      <p className="whitespace-pre-wrap break-words">{p.messageBody}</p>
                    ) : (
                      !p.mediaTersedia && <p className="italic text-muted">{LABEL_TIPE[p.messageType] ?? p.messageType}</p>
                    )}
                    <MediaPesan pesan={p} bolehBuka={seluruhIsi} />
                    <p className="mt-0.5 text-right text-[10px] tabular-nums text-muted">{formatWaktu(p.timestamp)}</p>
                  </div>
                </div>
              </React.Fragment>
            );
          })
        )}
      </div>
    </>
  );
};
