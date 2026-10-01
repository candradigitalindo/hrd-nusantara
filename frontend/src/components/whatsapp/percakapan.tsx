"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, Smartphone } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PanelPilihNomor } from "./panel-nomor";
import { DaftarUtas } from "./daftar-utas";
import { IsiUtas } from "./isi-utas";
import { namaNomor } from "./util-wa";
import { pilihNomorWa, useNomorTerpilih } from "./nomor-terpilih";
import type { NomorWa, Utas } from "@/lib/types";

const diPonsel = () => typeof window !== "undefined" && window.matchMedia("(max-width: 767.98px)").matches;

const Kosong = ({ ikon: Ikon, judul, keterangan }: { ikon: typeof MessageCircle; judul: string; keterangan?: string }) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted">
    <Ikon className="h-8 w-8 opacity-40" aria-hidden />
    <p className="text-sm">{judul}</p>
    {keterangan && <p className="text-xs">{keterangan}</p>}
  </div>
);

/**
 * Tab Percakapan: pilih nomor dulu, lalu chat milik nomor itu, lalu isinya —
 * seperti membuka WhatsApp milik pemegang nomor.
 *
 * Lebar layar menentukan berapa panel yang tampil bersamaan:
 *   - xl     : tiga panel [nomor | chat | isi]
 *   - md–lg  : dua panel; panel kiri bergantian nomor ↔ chat ("← Semua nomor")
 *   - ponsel : satu panel, bertingkat nomor → chat → isi dengan tombol kembali
 * Di md ke atas tinggi panel mengikuti layar (dvh) dan tiap panel bergulir
 * sendiri. Di ponsel daftar nomor dan chat ikut bergulir bersama halaman;
 * hanya isi chat yang setinggi layar, supaya tidak ada guliran bersarang.
 */
export const PanelPercakapan = ({ seluruhIsi, onKelolaNomor }: { seluruhIsi: boolean; onKelolaNomor: () => void }) => {
  const accountId = useNomorTerpilih();
  // Di bawah xl panel nomor dan daftar chat berbagi tempat: ini menandai
  // bahwa panel nomor sedang dibuka lagi lewat "← Semua nomor".
  const [lihatNomor, setLihatNomor] = React.useState(false);
  const [utas, setUtas] = React.useState<Utas | null>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const posisiDaftar = React.useRef(0);
  const nomorDimuat = React.useRef(false);

  const nomor = useQuery({
    queryKey: ["wa", "nomor"],
    // Sama seperti daftar chat: membuka tab tercatat di audit, penyegaran
    // berkala sesudahnya (pantau=1) tidak.
    queryFn: async () => {
      const pantau = nomorDimuat.current;
      nomorDimuat.current = true;
      return (await api.get<{ data: NomorWa[] }>(`/whatsapp/nomor${pantau ? "?pantau=1" : ""}`)).data.data;
    },
    refetchInterval: 30_000,
  });

  const nomorAktif = nomor.data?.find((n) => n.id === accountId) ?? null;
  // Selama daftar nomor belum tiba, nomor yang diingat peramban dianggap masih ada.
  const adaNomor = nomor.data ? Boolean(nomorAktif) : !nomor.isError && Boolean(accountId);
  const utasAktif = adaNomor && utas?.accountId === accountId ? utas : null;
  const tingkat: "nomor" | "chat" | "isi" = !adaNomor || lihatNomor ? "nomor" : utasAktif ? "isi" : "chat";

  const pilihNomor = (id: string) => {
    // Utas nomor lama tidak boleh tertinggal di panel isi.
    if (id !== accountId) setUtas(null);
    pilihNomorWa(id);
    setLihatNomor(false);
  };

  const pilihUtas = (u: Utas) => {
    setUtas(u);
    if (diPonsel()) {
      posisiDaftar.current = window.scrollY;
      requestAnimationFrame(() => panel.current?.scrollIntoView({ block: "start" }));
    }
  };

  const kembaliKeDaftar = () => {
    setUtas(null);
    requestAnimationFrame(() => window.scrollTo({ top: posisiDaftar.current }));
  };

  return (
    <div
      ref={panel}
      className={cn(
        "grid scroll-mt-16 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-2xl border border-border bg-surface",
        "md:h-[calc(100dvh-23.75rem)] md:min-h-[30rem] md:grid-cols-[20rem_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]",
        "lg:h-[calc(100dvh-19.75rem)] xl:grid-cols-[17rem_22rem_minmax(0,1fr)]",
        tingkat === "isi" && "h-[calc(100dvh-9rem)] min-h-[24rem] grid-rows-[minmax(0,1fr)]"
      )}
    >
      <PanelPilihNomor
        className={cn("border-border md:border-r", tingkat === "nomor" ? "flex" : "hidden xl:flex")}
        nomor={nomor.data ?? []}
        memuat={nomor.isLoading}
        galat={nomor.isError && !nomor.data}
        diperbarui={nomor.dataUpdatedAt}
        terpilih={adaNomor ? accountId : ""}
        seluruhIsi={seluruhIsi}
        onPilih={pilihNomor}
        onUlangi={() => void nomor.refetch()}
        onKelola={onKelolaNomor}
      />

      {adaNomor ? (
        <DaftarUtas
          key={accountId}
          className={cn("border-border md:border-r", tingkat === "chat" ? "flex" : tingkat === "isi" ? "hidden md:flex" : "hidden xl:flex")}
          nomor={nomorAktif}
          accountId={accountId}
          seluruhIsi={seluruhIsi}
          aktif={utasAktif?.kunci ?? null}
          onPilih={pilihUtas}
          onSemuaNomor={() => setLihatNomor(true)}
          onKelola={onKelolaNomor}
        />
      ) : (
        <div className="hidden min-h-0 flex-col border-r border-border xl:flex">
          <Kosong ikon={Smartphone} judul="Pilih nomor di kiri untuk melihat chat-nya." />
        </div>
      )}

      <div className={cn("min-h-0 flex-col", tingkat === "isi" ? "flex" : "hidden md:flex")}>
        {utasAktif ? (
          <IsiUtas
            key={utasAktif.kunci}
            utas={utasAktif}
            pemegang={nomorAktif ? namaNomor(nomorAktif) : "pemegang nomor"}
            seluruhIsi={seluruhIsi}
            onKembali={kembaliKeDaftar}
          />
        ) : (
          <Kosong
            ikon={MessageCircle}
            judul={adaNomor ? "Pilih chat untuk membaca isinya." : "Pilih nomor, lalu pilih chat untuk membaca isinya."}
            keterangan="Membaca di sini tidak menandai pesan terbaca di ponsel pemegang nomor."
          />
        )}
      </div>
    </div>
  );
};
