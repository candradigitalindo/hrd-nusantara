import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Nada = "info" | "success" | "warning" | "danger";

const GAYA: Record<Nada, { kelas: string; Icon: typeof Info }> = {
  info: { kelas: "bg-info-soft text-info border-info/30", Icon: Info },
  success: { kelas: "bg-success-soft text-success border-success/30", Icon: CheckCircle2 },
  warning: { kelas: "bg-warning-soft text-warning border-warning/30", Icon: AlertTriangle },
  danger: { kelas: "bg-danger-soft text-danger border-danger/30", Icon: XCircle },
};

/** Peringatan yang menetap di halaman, untuk keadaan yang perlu ditindaklanjuti. */
export const Alert = ({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: Nada;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) => {
  const { kelas, Icon } = GAYA[tone];
  return (
    <div role="status" className={cn("flex gap-3 rounded-xl border p-4", kelas, className)}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {children && <div className="mt-1 text-sm opacity-90">{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
};
