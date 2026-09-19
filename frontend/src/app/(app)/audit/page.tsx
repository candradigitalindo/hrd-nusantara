"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText, ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/alert";
import { formatTanggal, LABEL_ROLE } from "@/lib/utils";
import type { Halaman, JejakAudit } from "@/lib/types";

const nadaKode = (kode: number) => (kode >= 500 ? "danger" : kode >= 400 ? "warning" : "success");

export default function HalamanAudit() {
  const [aksi, setAksi] = React.useState("");
  const [aksiTunda, setAksiTunda] = React.useState("");
  const [gagalSaja, setGagalSaja] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [buka, setBuka] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => { setAksiTunda(aksi.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [aksi]);

  const params = new URLSearchParams({ page: String(page), limit: "30" });
  if (aksiTunda.length >= 2) params.set("action", aksiTunda);
  if (gagalSaja) params.set("onlyFailed", "true");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["audit", params.toString()],
    queryFn: async () => (await api.get<Halaman<JejakAudit>>(`/audit-logs?${params}`)).data,
    placeholderData: (prev) => prev,
  });

  return (
    <>
      <PageHeader title="Jejak Audit" description="Siapa melakukan apa, kapan — append-only, tidak bisa disunting maupun dihapus" />

      {isError && <Alert tone="danger" title="Tidak bisa memuat jejak">{(error as Error).message}</Alert>}

      <Card>
        <div className="grid gap-2 border-b border-border p-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <Input placeholder="Saring aksi, mis. payroll, login, purge" value={aksi} onChange={(e) => setAksi(e.target.value)} aria-label="Saring aksi" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={gagalSaja} onChange={(e) => { setGagalSaja(e.target.checked); setPage(1); }} className="h-4 w-4 accent-[var(--primary)]" />
            Hanya yang ditolak / gagal
          </label>
        </div>

        {isLoading ? <SkeletonBaris jumlah={8} /> : !data?.data.length ? (
          <EmptyState icon={ScrollText} title="Belum ada jejak" description="Setiap perubahan akan tercatat di sini secara otomatis." />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {data.data.map((j) => {
                const terbuka = buka === j.id;
                return (
                  <li key={j.id} className="animate-fade-up">
                    <button type="button" onClick={() => setBuka(terbuka ? null : j.id)} aria-expanded={terbuka}
                      className="flex w-full items-start gap-3 p-4 text-left hover:bg-surface-2 transition-colors">
                      <Badge tone={nadaKode(j.statusCode)} className="mt-0.5 shrink-0 font-mono">{j.statusCode}</Badge>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium break-words">{j.summary ?? j.action}</p>
                        <p className="mt-0.5 text-xs text-muted break-all">
                          {j.actorEmail ?? "sistem"}{j.actorRole ? ` (${LABEL_ROLE[j.actorRole] ?? j.actorRole})` : ""} · <span className="font-mono">{j.method} {j.path}</span>
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <time className="text-xs text-muted tabular-nums">{formatTanggal(j.createdAt, "d MMM HH:mm:ss")}</time>
                        <ChevronDown className={`h-4 w-4 text-muted transition-transform ${terbuka ? "rotate-180" : ""}`} aria-hidden />
                      </div>
                    </button>
                    {terbuka && (
                      <dl className="grid gap-x-4 gap-y-1 bg-surface-2 px-4 py-3 text-xs sm:grid-cols-[auto_1fr]">
                        <dt className="text-muted">Aksi</dt><dd className="font-mono break-all">{j.action}</dd>
                        {j.entity && <><dt className="text-muted">Entitas</dt><dd className="font-mono break-all">{j.entity} {j.entityId ?? ""}</dd></>}
                        <dt className="text-muted">IP</dt><dd className="font-mono">{j.ipAddress ?? "—"}</dd>
                        {j.metadata && <><dt className="text-muted">Rincian</dt><dd><pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono">{JSON.stringify(j.metadata, null, 2)}</pre></dd></>}
                      </dl>
                    )}
                  </li>
                );
              })}
            </ul>
            <Pagination pagination={data.pagination} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
