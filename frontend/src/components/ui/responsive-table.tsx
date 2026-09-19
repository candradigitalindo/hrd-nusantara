import * as React from "react";
import { cn } from "@/lib/utils";

export interface Kolom<T> {
  key: string;
  header: string;
  /** Sel di tabel (desktop). */
  cell: (row: T) => React.ReactNode;
  /** Dipakai di kartu (mobile). Bawaannya sama dengan cell. */
  mobile?: (row: T) => React.ReactNode;
  /** Kolom yang jadi judul kartu di mobile. */
  primary?: boolean;
  /** Sembunyikan di kartu mobile (misalnya kolom aksi yang sudah ada di judul). */
  hideOnMobile?: boolean;
  className?: string;
}

/**
 * Satu sumber data, dua bentuk: tabel di layar lebar, kartu bertumpuk di
 * ponsel. Tabel yang dipaksa menyempit ke 360px tidak bisa dibaca, dan
 * manajer outlet membuka ini dari ponsel jauh lebih sering daripada dari
 * laptop.
 */
export function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  className,
}: {
  columns: Kolom<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  className?: string;
}) {
  const utama = columns.find((c) => c.primary) ?? columns[0];
  const lainnya = columns.filter((c) => c !== utama && !c.hideOnMobile);

  return (
    <div className={className}>
      {/* Desktop */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              {columns.map((c) => (
                <th key={c.key} className={cn("px-4 py-3 font-medium", c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "border-b border-border last:border-0 transition-colors",
                  onRowClick && "cursor-pointer hover:bg-surface-2"
                )}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-4 py-3 align-middle", c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <ul className="md:hidden divide-y divide-border">
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn("p-4 space-y-2 animate-fade-up", onRowClick && "active:bg-surface-2")}
          >
            <div className="font-medium">{(utama.mobile ?? utama.cell)(row)}</div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              {lainnya.map((c) => (
                <React.Fragment key={c.key}>
                  <dt className="text-muted">{c.header}</dt>
                  <dd className="text-right">{(c.mobile ?? c.cell)(row)}</dd>
                </React.Fragment>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
