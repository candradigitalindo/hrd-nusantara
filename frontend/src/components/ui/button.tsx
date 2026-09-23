"use client";

import * as React from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Varian = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Ukuran = "sm" | "md" | "lg" | "icon";

const VARIAN: Record<Varian, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover shadow-sm",
  secondary: "bg-secondary text-on-secondary hover:bg-secondary-hover shadow-sm",
  outline: "border border-border bg-surface text-foreground hover:bg-surface-2",
  ghost: "text-foreground hover:bg-surface-2",
  danger: "bg-danger text-white hover:opacity-90 shadow-sm",
};

const UKURAN: Record<Ukuran, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
  icon: "h-10 w-10",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Varian;
  size?: Ukuran;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading, disabled, children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-medium transition-colors",
        "disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]",
        VARIAN[variant],
        UKURAN[size],
        className
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

/**
 * Tombol aksi pada baris daftar atau kartu: ikon saja, berlatar supaya
 * terbaca sebagai tombol tanpa label teks yang memakan lebar kolom. Labelnya
 * tetap wajib — dipakai pembaca layar sekaligus muncul sebagai tooltip.
 */
export const TombolAksi = ({
  icon: Ikon,
  label,
  tone = "netral",
  className,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: LucideIcon;
  label: string;
  tone?: "netral" | "bahaya";
}) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    className={cn(
      "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
      "disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]",
      tone === "bahaya"
        ? "bg-danger-soft text-danger hover:bg-danger hover:text-white"
        : "bg-surface-2 text-muted hover:bg-primary-soft hover:text-primary",
      className
    )}
    {...props}
  >
    <Ikon className="h-4 w-4" aria-hidden />
  </button>
);

/** Penanda non-interaktif dengan bentuk yang sama, untuk baris yang aksinya tidak tersedia. */
export const PenandaAksi = ({ icon: Ikon, label }: { icon: LucideIcon; label: string }) => (
  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted" title={label}>
    <Ikon className="h-4 w-4" aria-hidden />
    <span className="sr-only">{label}</span>
  </span>
);
