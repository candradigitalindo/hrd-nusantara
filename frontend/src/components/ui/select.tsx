"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIdLabelField } from "./field-context";

/**
 * Select dengan kotak pencarian, pengganti <select> bawaan browser.
 *
 * Tetap menerima <option>/<optgroup> sebagai anak dan seluruh atribut
 * <select> (value, defaultValue, onChange, name, ref, disabled, ...), jadi
 * pemakaian lewat `register()` react-hook-form maupun `value`/`onChange`
 * biasa tidak perlu diubah. Caranya: <select> asli tetap dirender (tersembunyi
 * secara visual) sebagai pemegang nilai dan penerima ref; yang terlihat adalah
 * tombol pemicu + panel daftar yang dirender ke <body> lewat portal supaya
 * tidak terpotong oleh modal yang bisa digulir.
 */

interface Opsi {
  value: string;
  label: string;
  disabled: boolean;
  hidden: boolean;
  grup?: string;
}

const teksDari = (node: React.ReactNode): string => {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(teksDari).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return teksDari(node.props.children);
  return "";
};

const kumpulkanOpsi = (children: React.ReactNode, grup?: string, keluar: Opsi[] = []): Opsi[] => {
  React.Children.forEach(children, (anak) => {
    if (!React.isValidElement(anak)) return;
    const p = anak.props as React.OptionHTMLAttributes<HTMLOptionElement> & { children?: React.ReactNode };
    if (anak.type === "option") {
      const label = teksDari(p.children) || p.label || "";
      keluar.push({
        value: p.value !== undefined ? String(p.value) : label,
        label,
        disabled: Boolean(p.disabled),
        hidden: Boolean(p.hidden),
        grup,
      });
    } else if (anak.type === "optgroup") {
      kumpulkanOpsi(p.children, (p as React.OptgroupHTMLAttributes<HTMLOptGroupElement>).label, keluar);
    } else if (anak.type === React.Fragment) {
      kumpulkanOpsi(p.children, grup, keluar);
    }
  });
  return keluar;
};

const normal = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const KELAS_KONTROL =
  "w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground " +
  "transition-colors focus:border-ring disabled:opacity-60 aria-[invalid=true]:border-danger";

interface Posisi {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  tinggiMaks: number;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Placeholder kotak pencarian di dalam panel. */
  placeholderCari?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, value, defaultValue, disabled, placeholderCari = "Cari...", "aria-label": ariaLabel, "aria-invalid": ariaInvalid, onFocus, ...props },
  ref
) {
  const selectRef = React.useRef<HTMLSelectElement | null>(null);
  const pemicuRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const cariRef = React.useRef<HTMLInputElement>(null);
  const idPanel = React.useId();
  const idLabel = useIdLabelField();

  const [buka, setBuka] = React.useState(false);
  const [cari, setCari] = React.useState("");
  const [sorot, setSorot] = React.useState(0);
  const [posisi, setPosisi] = React.useState<Posisi | null>(null);

  const opsi = React.useMemo(() => kumpulkanOpsi(children), [children]);
  const terkontrol = value !== undefined;
  const [internal, setInternal] = React.useState<string>(() =>
    defaultValue !== undefined ? String(defaultValue) : (opsi.find((o) => !o.disabled && !o.hidden)?.value ?? "")
  );

  const gabungRef = React.useCallback(
    (el: HTMLSelectElement | null) => {
      selectRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref]
  );

  // Mode tak terkontrol (register RHF): <select> asli adalah sumber
  // kebenaran — reset()/defaultValues menulis langsung ke DOM-nya, jadi
  // tampilan disamakan setelah setiap render.
  // Sengaja tanpa daftar dependensi: nilai DOM bisa berubah tanpa props
  // berubah. Pembandingan di dalamnya mencegah render berulang.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (terkontrol) return;
    const v = selectRef.current?.value ?? "";
    if (v !== internal) setInternal(v);
  });

  const nilaiKini = terkontrol ? String(value) : internal;
  const terpilih = opsi.find((o) => o.value === nilaiKini) ?? opsi.find((o) => !o.hidden);

  const tersaring = React.useMemo(() => {
    const q = normal(cari.trim());
    const tampak = opsi.filter((o) => !o.hidden);
    if (!q) return tampak;
    return tampak.filter((o) => normal(o.label).includes(q) || normal(o.value).includes(q));
  }, [opsi, cari]);

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
  }, []);

  const bukaPanel = React.useCallback(() => {
    if (disabled) return;
    setCari("");
    hitungPosisi();
    setBuka(true);
  }, [disabled, hitungPosisi]);

  const tutupPanel = React.useCallback((kembalikanFokus = true) => {
    setBuka(false);
    if (kembalikanFokus) pemicuRef.current?.focus();
  }, []);

  // Saat panel terbuka: sorot nilai aktif, fokus ke kotak cari, ikuti gulir/ubah ukuran.
  React.useEffect(() => {
    if (!buka) return;
    const idx = tersaring.findIndex((o) => o.value === nilaiKini);
    setSorot(idx >= 0 ? idx : 0);
    cariRef.current?.focus();
    const ulang = () => hitungPosisi();
    window.addEventListener("resize", ulang);
    document.addEventListener("scroll", ulang, true);
    const luar = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || pemicuRef.current?.contains(t)) return;
      setBuka(false);
    };
    document.addEventListener("pointerdown", luar);
    return () => {
      window.removeEventListener("resize", ulang);
      document.removeEventListener("scroll", ulang, true);
      document.removeEventListener("pointerdown", luar);
    };
    // Hanya saat membuka; pencarian mengatur sorotnya sendiri.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buka]);

  React.useEffect(() => {
    if (!buka) return;
    panelRef.current?.querySelector<HTMLElement>(`[data-idx="${sorot}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sorot, buka]);

  const pilih = (o: Opsi) => {
    if (o.disabled) return;
    const el = selectRef.current;
    if (el) {
      el.value = o.value;
      // Event asli, bukan tiruan: onChange React maupun handler register()
      // react-hook-form sama-sama menerimanya lewat <select> yang sebenarnya.
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (!terkontrol) setInternal(o.value);
    tutupPanel();
  };

  const tombolPemicu = (e: React.KeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      bukaPanel();
    }
  };

  const tombolPanel = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSorot((s) => Math.min(tersaring.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSorot((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = tersaring[sorot];
      if (o) pilih(o);
    } else if (e.key === "Escape") {
      // Jangan sampai modal di belakangnya ikut tertutup.
      e.preventDefault();
      e.stopPropagation();
      tutupPanel();
    } else if (e.key === "Tab") {
      // Tutup dan kembalikan fokus ke pemicu; Tab bawaan lalu melanjutkan
      // ke kontrol berikutnya dari sana.
      tutupPanel();
    }
  };

  const blurPemicu = () => {
    // Menandai "tersentuh" untuk react-hook-form lewat <select> asli.
    if (buka) return;
    selectRef.current?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  };

  let grupTerakhir: string | undefined;

  return (
    <div className={cn("relative w-full", className)}>
      <button
        ref={pemicuRef}
        type="button"
        role="combobox"
        aria-expanded={buka}
        aria-haspopup="listbox"
        aria-controls={buka ? idPanel : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : idLabel}
        aria-invalid={ariaInvalid}
        disabled={disabled}
        onClick={() => (buka ? tutupPanel() : bukaPanel())}
        onKeyDown={tombolPemicu}
        onBlur={blurPemicu}
        className={cn(KELAS_KONTROL, "flex h-10 items-center gap-2 pr-9 text-left", buka && "border-ring")}
      >
        <span className={cn("min-w-0 flex-1 truncate", !terpilih && "text-muted")}>{terpilih?.label ?? " "}</span>
        <ChevronDown
          className={cn("pointer-events-none absolute right-3 h-4 w-4 shrink-0 text-muted transition-transform", buka && "rotate-180")}
          aria-hidden
        />
      </button>

      <select
        ref={gabungRef}
        value={value}
        defaultValue={defaultValue}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden
        onFocus={(e) => {
          onFocus?.(e);
          pemicuRef.current?.focus();
        }}
        className="pointer-events-none absolute h-px w-px opacity-0"
        {...props}
      >
        {children}
      </select>

      {buka &&
        posisi &&
        createPortal(
          <div
            ref={panelRef}
            id={idPanel}
            onKeyDown={tombolPanel}
            style={{ position: "fixed", left: posisi.left, width: posisi.width, top: posisi.top, bottom: posisi.bottom, maxHeight: posisi.tinggiMaks }}
            className="z-[60] flex min-w-48 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-fade-up"
          >
            <div className="relative shrink-0 border-b border-border">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <input
                ref={cariRef}
                value={cari}
                onChange={(e) => {
                  setCari(e.target.value);
                  setSorot(0);
                }}
                placeholder={placeholderCari}
                aria-label="Cari pilihan"
                autoComplete="off"
                className="h-10 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted"
              />
            </div>
            <ul role="listbox" aria-label={ariaLabel} className="min-h-0 flex-1 overflow-y-auto p-1">
              {tersaring.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Tidak ada yang cocok</li>}
              {tersaring.map((o, i) => {
                const judulGrup = o.grup && o.grup !== grupTerakhir ? o.grup : undefined;
                grupTerakhir = o.grup;
                const aktif = o.value === nilaiKini;
                return (
                  <React.Fragment key={`${o.value}-${i}`}>
                    {judulGrup && (
                      <li className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted" aria-hidden>
                        {judulGrup}
                      </li>
                    )}
                    <li
                      role="option"
                      aria-selected={aktif}
                      aria-disabled={o.disabled || undefined}
                      data-idx={i}
                      onMouseEnter={() => setSorot(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pilih(o)}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm",
                        i === sorot && "bg-primary-soft text-primary",
                        aktif && "font-medium",
                        o.disabled && "cursor-not-allowed opacity-50"
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{o.label || " "}</span>
                      {aktif && <Check className="h-4 w-4 shrink-0" aria-hidden />}
                    </li>
                  </React.Fragment>
                );
              })}
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
});
