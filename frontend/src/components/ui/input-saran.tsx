"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { usePanelMengambang, KELAS_PANEL, KELAS_KONTROL, normal } from "./panel-mengambang";
import { useIdLabelField } from "./field-context";

/**
 * Input teks bebas dengan saran nilai yang sudah pernah dipakai — pengganti
 * `<input list>` + `<datalist>` bawaan browser, yang tampilannya tidak
 * mengikuti tema aplikasi (mencolok di mode gelap) dan tidak muncul sama
 * sekali di sebagian browser ponsel.
 *
 * Bedanya dengan Select: nilai baru boleh diketik, jadi ini tetap sebuah
 * `<input>` biasa dan bekerja apa adanya dengan `register()` react-hook-form.
 */
export const InputSaran = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { saran: string[] }>(
  function InputSaran({ className, saran, onChange, onKeyDown, onFocus, "aria-label": ariaLabel, ...props }, ref) {
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const panelRef = React.useRef<HTMLDivElement>(null);
    const idPanel = React.useId();
    const idLabel = useIdLabelField();

    const [buka, setBuka] = React.useState(false);
    const [teks, setTeks] = React.useState("");
    const [sorot, setSorot] = React.useState(-1);

    const gabungRef = React.useCallback(
      (el: HTMLInputElement | null) => {
        inputRef.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      },
      [ref]
    );

    const tutup = React.useCallback(() => setBuka(false), []);
    const { posisi, hitungPosisi } = usePanelMengambang({ pemicuRef: inputRef, panelRef, buka, tutup });

    const tersaring = React.useMemo(() => {
      const unik = [...new Set(saran.filter(Boolean))];
      const q = normal(teks.trim());
      if (!q) return unik;
      // Nilai yang persis sama tidak perlu disarankan: tidak ada yang berubah bila dipilih.
      return unik.filter((s) => normal(s).includes(q) && normal(s) !== q);
    }, [saran, teks]);

    React.useEffect(() => {
      if (buka && tersaring.length === 0) setBuka(false);
    }, [buka, tersaring.length]);

    React.useEffect(() => {
      if (!buka) return;
      panelRef.current?.querySelector<HTMLElement>(`[data-idx="${sorot}"]`)?.scrollIntoView({ block: "nearest" });
    }, [sorot, buka]);

    const bukaPanel = () => {
      if (props.disabled) return;
      hitungPosisi();
      setSorot(-1);
      setBuka(true);
    };

    const pakai = (nilai: string) => {
      const el = inputRef.current;
      if (el) {
        // Setter asli React, supaya nilainya tidak ditimpa lagi saat render
        // berikutnya pada input yang dikendalikan React.
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        if (setter) setter.call(el, nilai);
        else el.value = nilai;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      setTeks(nilai);
      setBuka(false);
      inputRef.current?.focus();
    };

    const tombol = (e: React.KeyboardEvent<HTMLInputElement>) => {
      onKeyDown?.(e);
      if (e.defaultPrevented) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!buka) return bukaPanel();
        setSorot((s) => Math.min(tersaring.length - 1, s + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSorot((s) => Math.max(-1, s - 1));
      } else if (e.key === "Enter" && buka && sorot >= 0) {
        // Hanya menelan Enter saat sebuah saran sedang disorot; selain itu
        // biarkan formulir tersubmit seperti biasa.
        e.preventDefault();
        pakai(tersaring[sorot]);
      } else if (e.key === "Escape" && buka) {
        e.preventDefault();
        e.stopPropagation();
        setBuka(false);
      }
    };

    return (
      <div className={cn("relative w-full", className)}>
        <input
          ref={gabungRef}
          role="combobox"
          aria-expanded={buka}
          aria-autocomplete="list"
          aria-controls={buka ? idPanel : undefined}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabel ? undefined : idLabel}
          autoComplete="off"
          className={cn(KELAS_KONTROL, "h-10")}
          onFocus={(e) => {
            onFocus?.(e);
            setTeks(e.currentTarget.value);
            bukaPanel();
          }}
          onChange={(e) => {
            onChange?.(e);
            setTeks(e.currentTarget.value);
            setSorot(-1);
            if (!buka) bukaPanel();
            else hitungPosisi();
          }}
          onKeyDown={tombol}
          {...props}
        />

        {buka &&
          posisi &&
          tersaring.length > 0 &&
          createPortal(
            <div
              ref={panelRef}
              id={idPanel}
              style={{ position: "fixed", left: posisi.left, width: posisi.width, top: posisi.top, bottom: posisi.bottom, maxHeight: posisi.tinggiMaks }}
              className={KELAS_PANEL}
            >
              <ul role="listbox" aria-label={ariaLabel} className="min-h-0 flex-1 overflow-y-auto p-1">
                {tersaring.map((s, i) => (
                  <li
                    key={s}
                    role="option"
                    aria-selected={i === sorot}
                    data-idx={i}
                    onMouseEnter={() => setSorot(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pakai(s)}
                    className={cn("cursor-pointer truncate rounded-lg px-2.5 py-2 text-sm", i === sorot && "bg-primary-soft text-primary")}
                  >
                    {s}
                  </li>
                ))}
              </ul>
              <p className="shrink-0 border-t border-border px-2.5 py-1.5 text-[11px] text-muted">Pilih saran, atau ketik nilai baru</p>
            </div>,
            document.body
          )}
      </div>
    );
  }
);
