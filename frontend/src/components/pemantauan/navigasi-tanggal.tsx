"use client";

import * as React from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { geserTanggal, labelTanggal } from "@/lib/linimasa";

/** "Sab 3 Okt". */
export const tanpaTahun = (tanggal: string) => labelTanggal(tanggal, "pendek");

/** Label navigasi: "Hari ini, Sab 3 Okt" · "Kemarin, …" · panjang di layar lebar, tanpa tahun berjalan di ponsel. */
export const labelNavigasi = (tanggal: string, hariIni: string, bentuk: "panjang" | "ringkas") => {
  if (tanggal === hariIni) return `Hari ini, ${tanpaTahun(tanggal)}`;
  if (tanggal === geserTanggal(hariIni, -1)) return `Kemarin, ${tanpaTahun(tanggal)}`;
  if (bentuk === "ringkas" && tanggal.slice(0, 4) === hariIni.slice(0, 4)) return labelTanggal(tanggal, "ringkas").replace(/\s+\d{4}$/, "");
  return labelTanggal(tanggal, bentuk);
};

const TOMBOL_NAV =
  "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-foreground transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-35";

/**
 * ‹ [tanggal] › + "Hari ini" — dipakai halaman Pemantauan Lokasi dan modal Riwayat supaya
 * keduanya sama. Label membuka pemilih tanggal bawaan peramban (showPicker); bila peramban
 * menolaknya, input tanggal ditampilkan di bawah label. Semua tanggal "YYYY-MM-DD" WIB.
 */
export function NavigasiTanggal({
  tanggal,
  hariIni,
  min,
  onGanti,
  labelInput,
  judulMin,
  idLabel,
  className,
}: {
  tanggal: string;
  hariIni: string;
  /** Tanggal paling awal yang masih tersimpan (hari ini − masa simpan). */
  min: string;
  onGanti: (tanggal: string) => void;
  /** aria-label input tanggal. */
  labelInput: string;
  /** Penjelasan saat ‹ nonaktif di batas bawah. */
  judulMin?: string;
  /** id label tanggal, untuk aria-describedby milik pemanggil. */
  idLabel?: string;
  className?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [inputTerlihat, setInputTerlihat] = React.useState(false);
  const labelPanjang = labelNavigasi(tanggal, hariIni, "panjang");
  const labelRingkas = labelNavigasi(tanggal, hariIni, "ringkas");
  const ganti = (t: string) => {
    setInputTerlihat(false);
    onGanti(t < min ? min : t > hariIni ? hariIni : t);
  };

  const bukaPemilih = () => {
    const el = inputRef.current;
    if (!el) return;
    try {
      if (typeof el.showPicker === "function") {
        el.showPicker();
        return;
      }
    } catch {
      /* peramban menolak showPicker: tampilkan input biasa */
    }
    setInputTerlihat(true);
    window.requestAnimationFrame(() => el.focus());
  };

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <div className="relative flex min-w-0 flex-1 items-center gap-0.5 rounded-xl border border-border bg-surface p-1 md:flex-none">
        <button
          type="button"
          className={TOMBOL_NAV}
          onClick={() => ganti(geserTanggal(tanggal, -1))}
          disabled={tanggal <= min}
          aria-label="Hari sebelumnya"
          title={tanggal <= min ? (judulMin ?? "Tidak ada data yang lebih lama") : "Hari sebelumnya (←)"}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={bukaPemilih}
          className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold transition-colors hover:bg-surface-2 md:w-[272px] md:flex-none"
          aria-label={`${labelPanjang} — pilih tanggal`}
        >
          <CalendarDays className="hidden h-4 w-4 shrink-0 text-muted sm:block" aria-hidden />
          <span id={idLabel} className="truncate">
            <span className="md:hidden">{labelRingkas}</span>
            <span className="hidden md:inline">{labelPanjang}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
        </button>
        <button
          type="button"
          className={TOMBOL_NAV}
          onClick={() => ganti(geserTanggal(tanggal, 1))}
          disabled={tanggal >= hariIni}
          aria-label="Hari berikutnya"
          title="Hari berikutnya (→)"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
        <input
          ref={inputRef}
          type="date"
          value={tanggal}
          min={min}
          max={hariIni}
          onChange={(e) => e.target.value && ganti(e.target.value)}
          onBlur={() => setInputTerlihat(false)}
          tabIndex={inputTerlihat ? 0 : -1}
          aria-label={labelInput}
          className={cn(
            inputTerlihat
              ? "absolute top-full left-0 z-30 mt-1 h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm shadow-lg"
              : "pointer-events-none absolute bottom-0 left-1/2 h-px w-px opacity-0",
          )}
        />
      </div>
      {tanggal !== hariIni && (
        <Button variant="outline" size="sm" className="h-10 shrink-0 rounded-xl" onClick={() => ganti(hariIni)}>
          Hari ini
        </Button>
      )}
    </div>
  );
}
