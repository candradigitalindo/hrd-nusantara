"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, UserPlus, UserMinus, TrendingDown, CalendarCheck, CalendarOff } from "lucide-react";
import { format, startOfMonth, subMonths } from "date-fns";
import { api } from "@/lib/api";
import { useSesi, bolehManajer } from "@/hooks/use-sesi";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { GrafikBatang } from "@/components/dashboard/grafik-batang";
import { formatAngka, labelStatus, formatTanggal } from "@/lib/utils";
import type { Dashboard, Halaman, Presensi, Cuti } from "@/lib/types";

const PRESET = [
  { label: "Bulan ini", bulan: 0 },
  { label: "3 bulan terakhir", bulan: 2 },
  { label: "6 bulan terakhir", bulan: 5 },
  { label: "12 bulan terakhir", bulan: 11 },
];

const LABEL_TENURE: Record<string, string> = {
  "<3m": "< 3 bln",
  "3-12m": "3–12 bln",
  "1-3y": "1–3 thn",
  "3-5y": "3–5 thn",
  ">5y": "> 5 thn",
};

export default function HalamanDashboard() {
  const { data: saya } = useSesi();
  const manajemen = bolehManajer(saya?.role);
  const [preset, setPreset] = React.useState(0);

  const hariIni = format(new Date(), "yyyy-MM-dd");
  const mulai = format(startOfMonth(subMonths(new Date(), PRESET[preset].bulan)), "yyyy-MM-dd");

  const dashboard = useQuery({
    queryKey: ["dashboard", mulai, hariIni],
    queryFn: async () => (await api.get<Dashboard>(`/reports/dashboard?startDate=${mulai}&endDate=${hariIni}`)).data,
    enabled: manajemen,
  });

  const presensiHariIni = useQuery({
    queryKey: ["presensi", "hari-ini"],
    queryFn: async () =>
      (await api.get<Halaman<Presensi>>(`/attendance?startDate=${hariIni}&endDate=${hariIni}&limit=100`)).data,
    enabled: manajemen,
  });

  const cutiMenunggu = useQuery({
    queryKey: ["cuti", "menunggu"],
    queryFn: async () => (await api.get<Halaman<Cuti>>("/leaves?status=pending&limit=5")).data,
    enabled: manajemen,
  });

  const presensiSaya = useQuery({
    queryKey: ["presensi", "saya"],
    queryFn: async () => (await api.get<Halaman<Presensi>>("/attendance/me?limit=7")).data,
    enabled: !manajemen,
  });

  const d = dashboard.data;
  const hitungStatus = (status: string) => presensiHariIni.data?.data.filter((p) => p.status === status).length ?? 0;

  const dataDept = d
    ? Object.entries(d.headcount.byDepartment)
        .map(([label, nilai]) => ({ label: label === "null" ? "Tanpa departemen" : label, nilai }))
        .sort((a, b) => b.nilai - a.nilai)
    : [];
  const dataTenure = d
    ? Object.entries(d.tenure.distribution).map(([k, nilai]) => ({ label: LABEL_TENURE[k] ?? k, nilai }))
    : [];

  if (!manajemen) {
    return (
      <>
        <PageHeader title={`Halo, ${saya?.name ?? ""}`} description="Ringkasan aktivitas Anda" />
        <Card>
          <CardHeader>
            <CardTitle>Presensi 7 hari terakhir</CardTitle>
          </CardHeader>
          <CardContent>
            {presensiSaya.isLoading ? (
              <Skeleton className="h-32" />
            ) : presensiSaya.data?.data.length ? (
              <ul className="divide-y divide-border">
                {presensiSaya.data.data.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2.5 text-sm">
                    <span>{formatTanggal(p.date, "EEEE, d MMM")}</span>
                    <Badge tone={nadaStatus(p.status)} dot>{labelStatus(p.status)}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Belum ada catatan presensi.</p>
            )}
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Periode ${formatTanggal(mulai)} – ${formatTanggal(hariIni)}`}
        actions={
          <Select value={preset} onChange={(e) => setPreset(Number(e.target.value))} aria-label="Periode" className="w-44">
            {PRESET.map((p, i) => (
              <option key={p.label} value={i}>{p.label}</option>
            ))}
          </Select>
        }
      />

      {dashboard.isError && (
        <Alert tone="danger" title="Ringkasan tidak bisa dimuat">
          {(dashboard.error as Error).message}
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {dashboard.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : d ? (
          <>
            <StatCard label="Karyawan aktif" value={formatAngka(d.headcount.end)} hint={`dari ${formatAngka(d.headcount.start)} di awal periode`} icon={Users} />
            <StatCard label="Bergabung" value={formatAngka(d.movement.hires)} hint="dalam periode ini" icon={UserPlus} tone="success" />
            <StatCard label="Keluar" value={formatAngka(d.movement.exits)} hint="dalam periode ini" icon={UserMinus} tone="warning" />
            <StatCard
              label="Turnover"
              value={d.movement.turnoverRate === null ? "—" : `${(d.movement.turnoverRate * 100).toFixed(1)}%`}
              hint={d.tenure.averageDays ? `rata-rata masa kerja ${Math.round(d.tenure.averageDays / 30)} bln` : undefined}
              icon={TrendingDown}
              tone="danger"
            />
          </>
        ) : null}
      </div>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Karyawan per departemen</CardTitle>
            <CardDescription>Headcount aktif saat ini</CardDescription>
          </CardHeader>
          <CardContent>{dashboard.isLoading ? <Skeleton className="h-64" /> : <GrafikBatang data={dataDept} />}</CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Presensi hari ini</CardTitle>
            <CardDescription>{formatTanggal(hariIni, "EEEE, d MMMM")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {presensiHariIni.isLoading ? (
              <Skeleton className="h-40" />
            ) : (
              <>
                {[
                  { k: "present", ikon: CalendarCheck },
                  { k: "late", ikon: CalendarCheck },
                  { k: "no_checkout", ikon: CalendarOff },
                ].map(({ k }) => (
                  <div key={k} className="flex items-center justify-between">
                    <Badge tone={nadaStatus(k)} dot>{labelStatus(k)}</Badge>
                    <span className="text-lg font-semibold tabular-nums">{hitungStatus(k)}</span>
                  </div>
                ))}
                <p className="pt-1 text-xs text-muted">
                  {presensiHariIni.data?.pagination.total ?? 0} catatan hari ini
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Sebaran masa kerja</CardTitle>
            <CardDescription>
              Rata-rata bisa menipu — satu orang sepuluh tahun menutupi lima yang keluar dalam tiga bulan
            </CardDescription>
          </CardHeader>
          <CardContent>{dashboard.isLoading ? <Skeleton className="h-56" /> : <GrafikBatang data={dataTenure} tinggi={220} />}</CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cuti menunggu persetujuan</CardTitle>
            <CardDescription>{cutiMenunggu.data?.pagination.total ?? 0} pengajuan</CardDescription>
          </CardHeader>
          <CardContent>
            {cutiMenunggu.isLoading ? (
              <Skeleton className="h-40" />
            ) : cutiMenunggu.data?.data.length ? (
              <ul className="divide-y divide-border">
                {cutiMenunggu.data.data.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.employee.name}</p>
                      <p className="truncate text-xs text-muted">
                        {c.leaveType.name} · {formatTanggal(c.startDate, "d MMM")} – {formatTanggal(c.endDate, "d MMM")}
                      </p>
                    </div>
                    <span className="shrink-0 tabular-nums text-muted">{c.totalDays} hari</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Tidak ada pengajuan yang menunggu.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
