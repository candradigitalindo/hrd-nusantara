import * as React from "react";
import { cn } from "@/lib/utils";

type Nada = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

const NADA: Record<Nada, string> = {
  neutral: "bg-surface-2 text-muted",
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

/** Nada warna untuk kode status backend, supaya arti statusnya terbaca sekilas. */
export const nadaStatus = (kode: string | null | undefined): Nada => {
  switch (kode) {
    case "active":
    case "present":
    case "approved":
    case "resolved":
    case "connected":
    case "hired":
    case "pass":
    case "filled":
    case "completed":
    case "published":
    case "paid":
      return "success";
    case "late":
    case "pending":
    case "probation":
    case "pending_scan":
    case "calculated":
    case "on_leave":
    case "under_review":
    case "sp1":
    case "screening":
    case "offer":
    case "hold":
    case "withdrawn":
    case "important":
      return "warning";
    case "absent":
    case "rejected":
    case "terminated":
    case "disconnected":
    case "scan_required":
    case "sp2":
    case "sp3":
    case "fail":
    case "cancelled":
    case "no_show":
    case "urgent":
      return "danger";
    case "contract":
    case "internship":
    case "no_checkout":
    case "open":
    case "teguran_lisan":
    case "interview":
    case "scheduled":
      return "info";
    default:
      return "neutral";
  }
};

export const Badge = ({
  tone = "neutral",
  className,
  dot,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Nada; dot?: boolean }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
      NADA[tone],
      className
    )}
    {...props}
  >
    {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
    {props.children}
  </span>
);
