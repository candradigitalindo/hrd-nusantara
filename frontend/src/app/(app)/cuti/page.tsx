"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarOff, Check, X } from "lucide-react";
import { api } from "@/lib/api";
import { useSesi, bolehManajer } from "@/hooks/use-sesi";
import { notifikasi } from "@/hooks/use-notifikasi";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea, Field } from "@/components/ui/input";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { ResponsiveTable, type Kolom } from "@/components/ui/responsive-table";
import { Pagination } from "@/components/ui/pagination";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { formatTanggal, labelStatus, formatRelatif } from "@/lib/utils";
import type { Halaman, Cuti } from "@/lib/types";

const TAB = ["pending", "approved", "rejected", "cancelled", ""] as const;

export default function HalamanCuti() {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const manajemen = bolehManajer(saya?.role);
  const [status, setStatus] = React.useState<(typeof TAB)[number]>("pending");
  const [page, setPage] = React.useState(1);
  const [keputusan, setKeputusan] = React.useState<{ cuti: Cuti; approved: boolean } | null>(null);
  const [catatan, setCatatan] = React.useState("");

  const params = new URLSearchParams({ page: String(page), limit: "20" });
  if (status) params.set("status", status);

  const { data, isLoading } = useQuery({
    queryKey: ["cuti", manajemen ? "semua" : "saya", params.toString()],
    queryFn: async () => (await api.get<Halaman<Cuti>>(`${manajemen ? "/leaves" : "/leaves/me"}?${params}`)).data,
    placeholderData: (prev) => prev,
  });

  const putuskan = useMutation({
    mutationFn: async ({ cuti, approved }: { cuti: Cuti; approved: boolean }) =>
      api.patch(`/leaves/${cuti.id}/decision`, { approved, ...(catatan ? { note: catatan } : {}) }),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["cuti"] });
      notifikasi.sukses(
        v.approved ? "Cuti disetujui" : "Cuti ditolak",
        `${v.cuti.employee.name} · ${v.cuti.leaveType.name}, ${v.cuti.totalDays} hari`
      );
      setKeputusan(null);
      setCatatan("");
    },
    onError: (e) => notifikasi.galat(e, "Keputusan gagal disimpan"),
  });

  const kolom: Kolom<Cuti>[] = [
    {
      key: "karyawan",
      header: manajemen ? "Karyawan" : "Jenis cuti",
      primary: true,
      cell: (c) => (
        <div>
          <p className="font-medium">{manajemen ? c.employee.name : c.leaveType.name}</p>
          <p className="text-xs text-muted">{manajemen ? c.leaveType.name : `Diajukan ${formatRelatif(c.createdAt)}`}</p>
        </div>
      ),
    },
    {
      key: "tanggal",
      header: "Tanggal",
      cell: (c) => (
        <span className="tabular-nums">
          {formatTanggal(c.startDate, "d MMM")} – {formatTanggal(c.endDate, "d MMM yyyy")}
        </span>
      ),
    },
    { key: "hari", header: "Lama", cell: (c) => `${c.totalDays} hari` },
    { key: "alasan", header: "Alasan", cell: (c) => <span className="line-clamp-2 text-muted">{c.reason ?? "—"}</span> },
    {
      key: "status",
      header: "Status",
      cell: (c) => (
        <div>
          <Badge tone={nadaStatus(c.status)} dot>{labelStatus(c.status)}</Badge>
          {c.decisionNote && <p className="mt-1 text-xs text-muted line-clamp-2">{c.decisionNote}</p>}
        </div>
      ),
    },
    ...(manajemen
      ? [
          {
            key: "aksi",
            header: "",
            className: "text-right",
            cell: (c: Cuti) =>
              c.status === "pending" ? (
                <div className="flex justify-end gap-1">
                  <Button size="sm" onClick={() => setKeputusan({ cuti: c, approved: true })}><Check className="h-4 w-4" aria-hidden /> Setujui</Button>
                  <Button size="sm" variant="outline" className="text-danger" onClick={() => setKeputusan({ cuti: c, approved: false })}><X className="h-4 w-4" aria-hidden /> Tolak</Button>
                </div>
              ) : null,
          } satisfies Kolom<Cuti>,
        ]
      : []),
  ];

  return (
    <>
      <PageHeader title="Cuti & Izin" description={manajemen ? "Pengajuan cuti yang perlu diputuskan" : "Pengajuan cuti Anda"} />

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1 w-fit max-w-full" role="tablist">
        {TAB.map((t) => (
          <button
            key={t || "semua"}
            role="tab"
            aria-selected={status === t}
            onClick={() => { setStatus(t); setPage(1); }}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${status === t ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"}`}
          >
            {t ? labelStatus(t) : "Semua"}
          </button>
        ))}
      </div>

      <Card>
        {isLoading ? (
          <SkeletonBaris />
        ) : !data?.data.length ? (
          <EmptyState icon={CalendarOff} title={status === "pending" ? "Tidak ada yang menunggu" : "Tidak ada pengajuan"} description={status === "pending" ? "Semua pengajuan sudah diputuskan." : undefined} />
        ) : (
          <>
            <ResponsiveTable columns={kolom} rows={data.data} rowKey={(c) => c.id} />
            <Pagination pagination={data.pagination} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal
        open={Boolean(keputusan)}
        onClose={() => setKeputusan(null)}
        title={keputusan?.approved ? "Setujui pengajuan cuti?" : "Tolak pengajuan cuti?"}
        description={keputusan ? `${keputusan.cuti.employee.name} · ${keputusan.cuti.leaveType.name} · ${keputusan.cuti.totalDays} hari` : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => setKeputusan(null)}>Batal</Button>
            <Button variant={keputusan?.approved ? "primary" : "danger"} loading={putuskan.isPending} onClick={() => keputusan && putuskan.mutate(keputusan)}>
              {keputusan?.approved ? "Setujui" : "Tolak"}
            </Button>
          </>
        }
      >
        <Field label="Catatan untuk karyawan" hint={keputusan?.approved ? "Opsional" : "Sebutkan alasannya agar karyawan tahu apa yang bisa diperbaiki"}>
          <Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={3} />
        </Field>
      </Modal>
    </>
  );
}
