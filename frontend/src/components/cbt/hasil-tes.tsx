"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Camera, ClipboardCheck, Eye } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ResponsiveTable, type Kolom } from "@/components/ui/responsive-table";
import { Pagination } from "@/components/ui/pagination";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTanggal } from "@/lib/utils";
import type { Halaman, PaketCbt, PenugasanCbt } from "@/lib/types";

/** Hasil semua peserta, pintu masuk ke penilaian esai dan bukti pengawasan. */
export const HasilTes = () => {
  const [page, setPage] = React.useState(1);
  const [testId, setTestId] = React.useState("");
  const [status, setStatus] = React.useState("");

  const paket = useQuery({
    queryKey: ["cbt", "paket"],
    queryFn: async () => (await api.get<{ data: PaketCbt[] }>("/cbt/tes")).data.data,
  });

  const params = new URLSearchParams({ page: String(page), limit: "20" });
  if (testId) params.set("testId", testId);
  if (status) params.set("status", status);

  const hasil = useQuery({
    queryKey: ["cbt", "hasil", params.toString()],
    queryFn: async () => (await api.get<Halaman<PenugasanCbt>>(`/cbt/hasil?${params}`)).data,
    placeholderData: (p) => p,
  });

  const kolom: Kolom<PenugasanCbt>[] = [
    {
      key: "peserta",
      header: "Peserta",
      primary: true,
      cell: (a) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{a.employee?.name ?? a.candidate?.name ?? "—"}</p>
          <p className="truncate text-xs text-muted">
            {a.employee ? `Karyawan · ${a.employee.nik}` : `Pelamar · ${a.candidate?.email ?? ""}`}
          </p>
        </div>
      ),
    },
    { key: "tes", header: "Paket", cell: (a) => a.test.title },
    {
      key: "nilai",
      header: "Nilai",
      cell: (a) =>
        a.status === "graded" && a.attempt?.percent !== null && a.attempt ? (
          <span className="font-medium tabular-nums">
            {a.attempt.percent}% <span className="text-xs font-normal text-muted">({a.attempt.scoreTotal}/{a.attempt.maxScore})</span>
          </span>
        ) : (
          <span className="text-xs text-muted">Menunggu penilaian</span>
        ),
    },
    {
      key: "lulus",
      header: "Hasil",
      cell: (a) =>
        a.attempt?.passed === null || a.attempt?.passed === undefined ? (
          <span className="text-muted">—</span>
        ) : (
          <Badge tone={a.attempt.passed ? "success" : "danger"} dot>{a.attempt.passed ? "Lulus" : "Belum lulus"}</Badge>
        ),
    },
    {
      key: "catatan",
      header: "Catatan",
      cell: (a) => (
        <div className="flex items-center gap-2 text-xs text-muted">
          {a.attempt?.autoSubmitted && (
            <span className="inline-flex items-center gap-1" title="Dikirim otomatis karena waktu habis">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> waktu habis
            </span>
          )}
          {(a.attempt?._count.events ?? 0) > 0 && <span title="Kejadian pengawasan tercatat">{a.attempt?._count.events} kejadian</span>}
          {(a.attempt?._count.photos ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1" title="Foto pengawasan tersimpan">
              <Camera className="h-3.5 w-3.5" aria-hidden /> {a.attempt?._count.photos}
            </span>
          )}
        </div>
      ),
    },
    { key: "waktu", header: "Dikirim", cell: (a) => formatTanggal(a.attempt?.submittedAt, "d MMM yyyy HH:mm") },
    {
      key: "aksi",
      header: "",
      className: "text-right",
      cell: (a) =>
        a.attempt ? (
          <Link href={`/cbt/hasil/${a.attempt.id}`}>
            <Button size="sm" variant="outline">
              {a.status === "submitted" ? <ClipboardCheck className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
              {a.status === "submitted" ? "Nilai" : "Lihat"}
            </Button>
          </Link>
        ) : null,
    },
  ];

  return (
    <Card>
      <div className="grid gap-2 border-b border-border p-3 sm:grid-cols-2">
        <Select value={testId} onChange={(e) => { setTestId(e.target.value); setPage(1); }} aria-label="Saring paket tes">
          <option value="">Semua paket tes</option>
          {(paket.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </Select>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Saring status">
          <option value="">Sudah dikerjakan</option>
          <option value="submitted">Menunggu penilaian</option>
          <option value="graded">Selesai dinilai</option>
        </Select>
      </div>

      {hasil.isLoading ? (
        <SkeletonBaris />
      ) : !hasil.data?.data.length ? (
        <EmptyState icon={ClipboardCheck} title="Belum ada hasil" description="Hasil muncul setelah peserta mengirimkan jawabannya." />
      ) : (
        <>
          <ResponsiveTable columns={kolom} rows={hasil.data.data} rowKey={(a) => a.id} />
          <Pagination pagination={hasil.data.pagination} onPage={setPage} />
        </>
      )}
    </Card>
  );
};
