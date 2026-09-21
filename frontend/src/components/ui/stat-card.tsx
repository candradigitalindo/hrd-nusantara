import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "./card";

type Nada = "primary" | "secondary" | "success" | "warning" | "danger" | "info";

const IKON: Record<Nada, string> = {
  primary: "bg-primary-soft text-primary",
  secondary: "bg-secondary-soft text-on-secondary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

/**
 * Angka ringkas di dashboard. Judul, angka besar, dan keterangan pendek —
 * cukup untuk dibaca sekilas di layar ponsel saat manajer sedang di outlet.
 */
export const StatCard = ({
  label,
  value,
  hint,
  icon: Icon,
  tone = "primary",
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: LucideIcon;
  tone?: Nada;
  className?: string;
}) => (
  <Card className={cn("p-4 sm:p-5 animate-fade-up", className)}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm leading-snug text-muted line-clamp-2">{label}</p>
        <p className="mt-1 text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      </div>
      <span className={cn("shrink-0 rounded-xl p-2.5", IKON[tone])}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
    </div>
  </Card>
);
