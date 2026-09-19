"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";
import type { Paginasi } from "@/lib/types";

export const Pagination = ({
  pagination,
  onPage,
}: {
  pagination: Paginasi;
  onPage: (page: number) => void;
}) => {
  const { page, totalPages, total, limit } = pagination;
  if (total === 0) return null;
  const dari = (page - 1) * limit + 1;
  const sampai = Math.min(page * limit, total);

  return (
    <div className="flex flex-col gap-3 border-t border-border p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted tabular-nums">
        {dari}–{sampai} dari {total}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden /> Sebelumnya
        </Button>
        <span className="px-2 text-sm tabular-nums">
          {page} / {totalPages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Berikutnya <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
};
