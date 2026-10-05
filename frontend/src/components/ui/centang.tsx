"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Kotak centang berjudul dan berketerangan, untuk formulir pengaturan yang
 * tiap pilihannya perlu dijelaskan. Ref diteruskan supaya register()
 * react-hook-form membaca nilainya seperti <input> biasa.
 */
export const Centang = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }>(
  function Centang({ label, hint, className, ...props }, ref) {
    return (
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:bg-surface-2">
        <input ref={ref} type="checkbox" className={cn("mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]", className)} {...props} />
        <span className="min-w-0">
          <span className="font-medium">{label}</span>
          {hint && <span className="block text-xs text-muted">{hint}</span>}
        </span>
      </label>
    );
  }
);
