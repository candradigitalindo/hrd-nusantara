"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ButirFaq {
  tanya: string;
  jawab: string;
}

/** Daftar tanya-jawab yang bisa dibuka-tutup; satu terbuka pada saat yang sama. */
export const Faq = ({ butir }: { butir: ButirFaq[] }) => {
  const [terbuka, setTerbuka] = React.useState<number | null>(0);

  return (
    <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
      {butir.map((b, i) => {
        const buka = terbuka === i;
        return (
          <div key={b.tanya}>
            <h3>
              <button
                type="button"
                onClick={() => setTerbuka(buka ? null : i)}
                aria-expanded={buka}
                aria-controls={`faq-${i}`}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-medium hover:bg-surface-2"
              >
                {b.tanya}
                <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted transition-transform", buka && "rotate-180")} aria-hidden />
              </button>
            </h3>
            {buka && (
              <div id={`faq-${i}`} className="px-5 pb-4 text-sm leading-relaxed text-muted">
                {b.jawab}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
