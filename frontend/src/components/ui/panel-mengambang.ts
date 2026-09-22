"use client";

import * as React from "react";

export interface PosisiPanel {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  tinggiMaks: number;
}

/**
 * Menempatkan panel yang dirender lewat portal ke <body> tepat di bawah
 * pemicunya — atau di atasnya bila ruang bawah tidak cukup — dan menutupnya
 * saat orang menekan di luar. Karena panelnya keluar dari alur dokumen,
 * posisinya harus dihitung sendiri terhadap viewport dan diikutkan saat
 * halaman digulir atau ukurannya berubah.
 *
 * `tutup` harus stabil (useCallback), kalau tidak pendengar event dipasang
 * ulang setiap render.
 */
export const usePanelMengambang = ({
  pemicuRef,
  panelRef,
  buka,
  tutup,
}: {
  pemicuRef: React.RefObject<HTMLElement | null>;
  panelRef: React.RefObject<HTMLElement | null>;
  buka: boolean;
  tutup: () => void;
}) => {
  const [posisi, setPosisi] = React.useState<PosisiPanel | null>(null);

  const hitungPosisi = React.useCallback(() => {
    const el = pemicuRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ruangBawah = window.innerHeight - r.bottom - 8;
    const ruangAtas = r.top - 8;
    const keAtas = ruangBawah < 220 && ruangAtas > ruangBawah;
    const ruang = keAtas ? ruangAtas : ruangBawah;
    setPosisi({
      left: r.left,
      width: r.width,
      top: keAtas ? undefined : r.bottom + 4,
      bottom: keAtas ? window.innerHeight - r.top + 4 : undefined,
      tinggiMaks: Math.max(160, Math.min(340, ruang)),
    });
  }, [pemicuRef]);

  React.useEffect(() => {
    if (!buka) return;
    const ulang = () => hitungPosisi();
    window.addEventListener("resize", ulang);
    // capture: ikut menangkap gulir di dalam modal, bukan hanya di dokumen.
    document.addEventListener("scroll", ulang, true);
    const luar = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || pemicuRef.current?.contains(t)) return;
      tutup();
    };
    document.addEventListener("pointerdown", luar);
    return () => {
      window.removeEventListener("resize", ulang);
      document.removeEventListener("scroll", ulang, true);
      document.removeEventListener("pointerdown", luar);
    };
  }, [buka, hitungPosisi, panelRef, pemicuRef, tutup]);

  return { posisi, hitungPosisi };
};

/** Kelas panel mengambang, supaya Select dan InputSaran tampil seragam. */
export const KELAS_PANEL =
  "z-[60] flex min-w-48 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-fade-up";

/** Kelas kontrol form, dipakai Input, Textarea, dan pemicu Select. */
export const KELAS_KONTROL =
  "w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground " +
  "transition-colors focus:border-ring disabled:opacity-60 aria-[invalid=true]:border-danger";

/** Menyamakan huruf besar-kecil dan tanda diakritik sebelum dicocokkan. */
export const normal = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
