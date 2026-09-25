"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarCheck, Clock, CloudOff, ShieldCheck, ShieldOff, Check, X } from "lucide-react";
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
import { formatTanggal, formatWaktu, labelStatus, jedaTerkirim, LABEL_INTEGRITAS, BLOKIR_INTEGRITAS } from "@/lib/utils";
import type { Halaman, Presensi } from "@/lib/types";

const menit = (n: number | null | undefined) => (n ? `${n} mnt` : "—");

/** Jam presensi; bila diambil offline, beserta kapan sampai ke server. */
function JamPresensi({ waktu, tersinkron }: { waktu: string | null; tersinkron: string | null }) {
  const jeda = jedaTerkirim(waktu, tersinkron);
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="tabular-nums">{formatWaktu(waktu)}</span>
      {jeda && (
        <span className="inline-flex items-center gap-1 text-[11px] leading-tight text-muted" title={`Diambil saat ponsel offline, diterima server ${formatTanggal(tersinkron, "d MMM HH:mm")}`}>
          <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden /> Offline · {jeda}
        </span>
      )}
    </span>
  );
}

export default function HalamanPresensi() {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const manajemen = punyaIzin(saya, "presensi_tim.lihat");
  const bolehLembur = punyaIzin(saya, "lembur.ubah");
  const hariIni = format(new Date(), "yyyy-MM-dd");

  const [mulai, setMulai] = React.useState(hariIni);
  const [sampai, setSampai] = React.useState(hariIni);
  const [status, setStatus] = React.useState("");
  const [lemburSaja, setLemburSaja] = React.useState(false);
  const [dicurigaiSaja, setDicurigaiSaja] = React.useState(false);
  const [offlineSaja, setOfflineSaja] = React.useState(false);
  const [page, setPage] = React.useState(1);

  const params = new URLSearchParams({ page: String(page), limit: "25", startDate: mulai, endDate: sampai });
  if (status) params.set("status", status);
  if (lemburSaja) params.set("onlyPendingOvertime", "true");
  if (dicurigaiSaja) params.set("flaggedOnly", "true");
  if (offlineSaja) params.set("offlineOnly", "true");

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
      offline: rows.filter((r) => r.checkInSyncedAt || r.checkOutSyncedAt).length,
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
    { key: "masuk", header: "Masuk", cell: (p) => <JamPresensi waktu={p.checkInTime} tersinkron={p.checkInSyncedAt} /> },
    { key: "pulang", header: "Pulang", cell: (p) => <JamPresensi waktu={p.checkOutTime} tersinkron={p.checkOutSyncedAt} /> },
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
        // clock_mismatch: jam ponsel diputar saat presensi offline — sama beratnya dengan perpindahan mustahil.
        const berat = flags.some((f) => BLOKIR_INTEGRITAS.has(f) || f === "impossible_speed" || f === "clock_mismatch");
        // Jam yang ditunjukkan ponsel saat presensi offline, untuk dibandingkan dengan yang dicatat.
        const jamPonsel = [
          flags.includes("clock_mismatch") || flags.includes("clock_unverified") ? p.integrityReport?.offline?.capturedAt : null,
          flags.includes("clock_mismatch") || flags.includes("clock_unverified") ? p.checkOutIntegrityReport?.offline?.capturedAt : null,
        ];
        return (
          <span className="inline-flex flex-col gap-0.5">
            <Badge tone={berat ? "danger" : "warning"} dot>Dicurigai</Badge>
            <span className="text-[11px] leading-tight text-muted">{flags.map((f) => LABEL_INTEGRITAS[f] ?? f).join(" · ")}</span>
            {jamPonsel[0] && <span className="text-[11px] leading-tight text-muted">Jam ponsel saat masuk: {formatWaktu(jamPonsel[0])}</span>}
            {jamPonsel[1] && <span className="text-[11px] leading-tight text-muted">Jam ponsel saat pulang: {formatWaktu(jamPonsel[1])}</span>}
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
        return bolehLembur ? (
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <span className="mr-1 tabular-nums">{jam} jam</span>
            <Button size="sm" variant="outline" onClick={() => setujuiLembur.mutate({ id: p.id, approved: true })}><Check className="h-4 w-4" aria-hidden /> Setujui</Button>
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => setujuiLembur.mutate({ id: p.id, approved: false })}><X className="h-4 w-4" aria-hidden /> Tolak</Button>
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { label: "Hadir", nilai: ringkas.hadir, nada: "success" as const },
            { label: "Terlambat", nilai: ringkas.terlambat, nada: "warning" as const },
            { label: "Lupa check-out", nilai: ringkas.lupa, nada: "info" as const },
            { label: "Lokasi dicurigai", nilai: ringkas.dicurigai, nada: "danger" as const },
            { label: "Diambil offline", nilai: ringkas.offline, nada: "info" as const },
          ].map((s) => (
            <Card key={s.label} className="p-3 sm:p-4">
              <p className="text-xs text-muted sm:text-sm">{s.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">{s.nilai}</p>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <div className="grid gap-2 border-b border-border p-3 sm:grid-cols-[auto_auto_1fr_auto] sm:items-center">
          <Input type="date" value={mulai} max={sampai} onChange={(e) => { setMulai(e.target.value); setPage(1); }} aria-label="Dari tanggal" />
          <Input type="date" value={sampai} min={mulai} onChange={(e) => { setSampai(e.target.value); setPage(1); }} aria-label="Sampai tanggal" />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status" className="sm:w-44">
            <option value="">Semua status</option>
            {["present", "late", "absent", "no_checkout"].map((s) => <option key={s} value={s}>{labelStatus(s)}</option>)}
          </Select>
          {manajemen && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={lemburSaja} onChange={(e) => { setLemburSaja(e.target.checked); setPage(1); }} className="h-4 w-4 accent-[var(--primary)]" />
                <Clock className="h-4 w-4 text-muted" aria-hidden /> Lembur menunggu
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={dicurigaiSaja} onChange={(e) => { setDicurigaiSaja(e.target.checked); setPage(1); }} className="h-4 w-4 accent-[var(--primary)]" />
                <ShieldOff className="h-4 w-4 text-muted" aria-hidden /> Lokasi dicurigai
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={offlineSaja} onChange={(e) => { setOfflineSaja(e.target.checked); setPage(1); }} className="h-4 w-4 accent-[var(--primary)]" />
                <CloudOff className="h-4 w-4 text-muted" aria-hidden /> Diambil offline
              </label>
            </div>
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
