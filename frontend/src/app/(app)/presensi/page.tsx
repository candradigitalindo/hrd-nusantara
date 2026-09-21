"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarCheck, Clock, ShieldCheck, ShieldOff } from "lucide-react";
import { api } from "@/lib/api";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { notifikasi } from "@/hooks/use-notifikasi";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { ResponsiveTable, type Kolom } from "@/components/ui/responsive-table";
import { Pagination } from "@/components/ui/pagination";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTanggal, formatWaktu, labelStatus, LABEL_INTEGRITAS, BLOKIR_INTEGRITAS } from "@/lib/utils";
import type { Halaman, Presensi } from "@/lib/types";

const menit = (n: number | null | undefined) => (n ? `${n} mnt` : "—");

export default function HalamanPresensi() {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const manajemen = punyaIzin(saya, "presensi.lihat_tim");
  const hariIni = format(new Date(), "yyyy-MM-dd");

  const [mulai, setMulai] = React.useState(hariIni);
  const [sampai, setSampai] = React.useState(hariIni);
  const [status, setStatus] = React.useState("");
  const [lemburSaja, setLemburSaja] = React.useState(false);
  const [dicurigaiSaja, setDicurigaiSaja] = React.useState(false);
  const [page, setPage] = React.useState(1);

  const params = new URLSearchParams({ page: String(page), limit: "25", startDate: mulai, endDate: sampai });
  if (status) params.set("status", status);
  if (lemburSaja) params.set("onlyPendingOvertime", "true");
  if (dicurigaiSaja) params.set("flaggedOnly", "true");

  const { data, isLoading } = useQuery({
    queryKey: ["presensi", manajemen ? "semua" : "saya", params.toString()],
    queryFn: async () => (await api.get<Halaman<Presensi>>(`${manajemen ? "/attendance" : "/attendance/me"}?${params}`)).data,
    placeholderData: (prev) => prev,
  });

  const setujuiLembur = useMutation({
    mutationFn: async ({ id, approved }: { id: string; approved: boolean }) =>
      api.patch(`/attendance/${id}/overtime`, { approved }),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["presensi"] });
      notifikasi.sukses(v.approved ? "Lembur disetujui" : "Lembur ditolak", "Perhitungan gaji akan mengikuti keputusan ini.");
    },
    onError: (e) => notifikasi.galat(e),
  });

  const ringkas = React.useMemo(() => {
    const rows = data?.data ?? [];
    return {
      hadir: rows.filter((r) => r.status === "present").length,
      terlambat: rows.filter((r) => r.status === "late").length,
      lupa: rows.filter((r) => r.status === "no_checkout").length,
      dicurigai: rows.filter((r) => (r.integrityFlags ?? []).length > 0).length,
    };
  }, [data]);

  const kolom: Kolom<Presensi>[] = [
    {
      key: "karyawan",
      header: "Karyawan",
      primary: true,
      cell: (p) => (
        <div>
          <p className="font-medium">{p.employee.name}</p>
          <p className="text-xs text-muted">{p.employee.nik} · {formatTanggal(p.date, "EEE, d MMM")}</p>
        </div>
      ),
    },
    { key: "masuk", header: "Masuk", cell: (p) => <span className="tabular-nums">{formatWaktu(p.checkInTime)}</span> },
    { key: "pulang", header: "Pulang", cell: (p) => <span className="tabular-nums">{formatWaktu(p.checkOutTime)}</span> },
    {
      key: "status",
      header: "Status",
      cell: (p) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={nadaStatus(p.status)} dot>{labelStatus(p.status)}</Badge>
          {p.lateMinutes ? <span className="text-xs text-muted">+{menit(p.lateMinutes)}</span> : null}
        </div>
      ),
    },
    {
      key: "verifikasi",
      header: "Wajah",
      cell: (p) =>
        <span className="inline-flex flex-col gap-0.5">
          {p.faceVerified ? (
            <span className="inline-flex items-center gap-1 text-xs text-success"><ShieldCheck className="h-4 w-4" aria-hidden /> Terverifikasi</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-muted"><ShieldOff className="h-4 w-4" aria-hidden /> {p.checkInMethod ?? "—"}</span>
          )}
          {p.stampStatus && <span className={`text-[11px] ${p.stampStatus === "sent" ? "text-success" : p.stampStatus === "failed" ? "text-danger" : "text-muted"}`} title={p.stampNote ?? undefined}>{p.stampStatus === "sent" ? "Foto ke grup WA ✓" : p.stampStatus === "failed" ? "Foto ke grup WA gagal" : "Foto ke grup WA dilewati"}</span>}
        </span>,
    },
    {
      key: "keaslian",
      header: "Keaslian lokasi",
      cell: (p) => {
        const flags = p.integrityFlags ?? [];
        if (flags.length === 0) return <span className="text-xs text-muted">Wajar</span>;
        const berat = flags.some((f) => BLOKIR_INTEGRITAS.has(f) || f === "impossible_speed");
        return (
          <span className="inline-flex flex-col gap-0.5">
            <Badge tone={berat ? "danger" : "warning"} dot>Dicurigai</Badge>
            <span className="text-[11px] leading-tight text-muted">{flags.map((f) => LABEL_INTEGRITAS[f] ?? f).join(" · ")}</span>
          </span>
        );
      },
    },
    {
      key: "lembur",
      header: "Lembur",
      cell: (p) => {
        const jam = Number(p.overtimeHours ?? 0);
        if (!jam) return <span className="text-muted">—</span>;
        if (p.overtimeApproved) return <Badge tone="success">{jam} jam ✓</Badge>;
        return manajemen ? (
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <span className="mr-1 tabular-nums">{jam} jam</span>
            <Button size="sm" variant="outline" onClick={() => setujuiLembur.mutate({ id: p.id, approved: true })}>Setujui</Button>
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => setujuiLembur.mutate({ id: p.id, approved: false })}>Tolak</Button>
          </div>
        ) : (
          <Badge tone="warning">{jam} jam · menunggu</Badge>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader title="Presensi" description={manajemen ? "Kehadiran seluruh karyawan" : "Riwayat kehadiran Anda"} />

      {manajemen && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Hadir", nilai: ringkas.hadir, nada: "success" as const },
            { label: "Terlambat", nilai: ringkas.terlambat, nada: "warning" as const },
            { label: "Lupa check-out", nilai: ringkas.lupa, nada: "info" as const },
            { label: "Lokasi dicurigai", nilai: ringkas.dicurigai, nada: "danger" as const },
          ].map((s) => (
            <Card key={s.label} className="p-3 sm:p-4">
              <p className="text-xs text-muted sm:text-sm">{s.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">{s.nilai}</p>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <div className="grid gap-2 border-b border-border p-3 sm:grid-cols-[auto_auto_1fr_auto_auto] sm:items-center">
          <Input type="date" value={mulai} max={sampai} onChange={(e) => { setMulai(e.target.value); setPage(1); }} aria-label="Dari tanggal" />
          <Input type="date" value={sampai} min={mulai} onChange={(e) => { setSampai(e.target.value); setPage(1); }} aria-label="Sampai tanggal" />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status" className="sm:w-44">
            <option value="">Semua status</option>
            {["present", "late", "absent", "no_checkout"].map((s) => <option key={s} value={s}>{labelStatus(s)}</option>)}
          </Select>
          {manajemen && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={lemburSaja} onChange={(e) => { setLemburSaja(e.target.checked); setPage(1); }} className="h-4 w-4 accent-[var(--primary)]" />
              <Clock className="h-4 w-4 text-muted" aria-hidden /> Lembur menunggu
            </label>
          )}
          {manajemen && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={dicurigaiSaja} onChange={(e) => { setDicurigaiSaja(e.target.checked); setPage(1); }} className="h-4 w-4 accent-[var(--primary)]" />
              <ShieldOff className="h-4 w-4 text-muted" aria-hidden /> Lokasi dicurigai
            </label>
          )}
        </div>

        {isLoading ? (
          <SkeletonBaris />
        ) : !data?.data.length ? (
          <EmptyState icon={CalendarCheck} title="Tidak ada catatan" description="Tidak ada presensi pada rentang dan saringan ini." />
        ) : (
          <>
            <ResponsiveTable columns={kolom} rows={data.data} rowKey={(p) => p.id} />
            <Pagination pagination={data.pagination} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
