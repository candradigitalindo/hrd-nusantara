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
import { PeringatanTautanWhatsApp } from "@/components/whatsapp/peringatan-tautan";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { GrafikBatang } from "@/components/dashboard/grafik-batang";
import { formatAngka, labelStatus, formatTanggal } from "@/lib/utils";
import type { Dashboard, Halaman, Presensi, Cuti, DokumenKaryawan } from "@/lib/types";
import Link from "next/link";
import { FileWarning } from "lucide-react";
import { LABEL_DOKUMEN, sisaHari } from "@/lib/utils";
import { bolehHr } from "@/hooks/use-sesi";

const PRESET = [
  { label: "Bulan ini", bulan: 0 },
  { label: "3 bulan terakhir", bulan: 2 },
  { label: "6 bulan terakhir", bulan: 5 },
  { label: "12 bulan terakhir", bulan: 11 },
];


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

  const dokumenKedaluwarsa = useQuery({
    queryKey: ["dokumen", "kedaluwarsa"],
    queryFn: async () => (await api.get<Halaman<DokumenKaryawan>>("/documents/expiring?days=30&limit=5")).data,
    enabled: bolehHr(saya?.role),
  });

  const presensiSaya = useQuery({
    queryKey: ["presensi", "saya"],
    queryFn: async () => (await api.get<Halaman<Presensi>>("/attendance/me?limit=7")).data,
    enabled: !manajemen,
  });

  const d = dashboard.data;
  const hitungStatus = (status: string) => presensiHariIni.data?.data.filter((p) => p.status === status).length ?? 0;

  // Server sudah mengurutkan dari yang terbanyak; "tidak dicatat" = tanpa departemen.
  const dataDept = d
    ? d.headcount.byDepartment.map((h) => ({ label: h.value === "tidak dicatat" ? "Tanpa departemen" : h.value, nilai: h.count }))
    : [];
  const dataTenure = d ? d.tenure.distribution.map((b) => ({ label: b.label, nilai: b.count })) : [];

  if (!manajemen) {
    return (
      <>
        <PageHeader title={`Halo, ${saya?.name ?? ""}`} description="Ringkasan aktivitas Anda" />
        <PeringatanTautanWhatsApp />
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

      <PeringatanTautanWhatsApp />

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

        {bolehHr(saya?.role) && (
          <Card className="lg:col-span-2">
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>Dokumen perlu diperbarui</CardTitle>
                <CardDescription>Kontrak, SKCK, dan sertifikat yang kedaluwarsa dalam 30 hari</CardDescription>
              </div>
              {(dokumenKedaluwarsa.data?.pagination.total ?? 0) > 0 && (
                <Badge tone="warning" dot>{dokumenKedaluwarsa.data!.pagination.total}</Badge>
              )}
            </CardHeader>
            <CardContent>
              {dokumenKedaluwarsa.isLoading ? (
                <Skeleton className="h-24" />
              ) : dokumenKedaluwarsa.data?.data.length ? (
                <ul className="divide-y divide-border">
                  {dokumenKedaluwarsa.data.data.map((d) => {
                    const sisa = sisaHari(d.expiresAt) ?? 0;
                    return (
                      <li key={d.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                        <div className="min-w-0">
                          <Link href={`/karyawan/${d.employeeId}`} className="font-medium hover:underline">{d.employee?.name}</Link>
                          <p className="truncate text-xs text-muted">{LABEL_DOKUMEN[d.type]} · {d.title}</p>
                        </div>
                        <Badge tone={sisa < 0 ? "danger" : "warning"} dot className="shrink-0">
                          {sisa < 0 ? `lewat ${Math.abs(sisa)} hari` : `${sisa} hari lagi`}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted"><FileWarning className="h-4 w-4" aria-hidden /> Tidak ada dokumen yang segera kedaluwarsa.</div>
              )}
            </CardContent>
          </Card>
        )}

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
