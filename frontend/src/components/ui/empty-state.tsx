import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";

/**
 * Keadaan kosong yang menjelaskan, bukan sekadar "tidak ada data": apa yang
 * seharusnya ada di sini, dan apa langkah berikutnya.
 */
export const EmptyState = ({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) => (
  <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
    <span className="rounded-2xl bg-surface-2 p-4 text-muted">
      <Icon className="h-7 w-7" aria-hidden />
    </span>
    <p className="font-medium">{title}</p>
    {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
    {action && <div className="mt-2">{action}</div>}
  </div>
);
