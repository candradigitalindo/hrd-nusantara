"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Users, UserPlus, UserMinus, TrendingDown, CalendarCheck, CalendarOff, FileWarning, Megaphone, Wallet, ArrowRight } from "lucide-react";
import { format, startOfMonth, subMonths } from "date-fns";
import { api } from "@/lib/api";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PeringatanTautanWhatsApp } from "@/components/whatsapp/peringatan-tautan";
import { GrafikBatang } from "@/components/dashboard/grafik-batang";
import { formatAngka, formatRupiah, labelStatus, formatTanggal, formatWaktu, LABEL_DOKUMEN, sisaHari } from "@/lib/utils";
import type { Dashboard, Halaman, Presensi, Cuti, DokumenKaryawan, SaldoCuti, Pengumuman, SlipGaji } from "@/lib/types";

const PRESET = [
  { label: "Bulan ini", bulan: 0 },
  { label: "3 bulan terakhir", bulan: 2 },
  { label: "6 bulan terakhir", bulan: 5 },
  { label: "12 bulan terakhir", bulan: 11 },
];

/** Tautan kecil "Lihat semua" di sudut kartu. */
const TautanKartu = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline">
    {children} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
  </Link>
);

/** Dashboard karyawan: apa yang perlu diketahui dan dikerjakan hari ini. */
function DashboardKaryawan({ nama, hariIni, izin }: { nama: string; hariIni: string; izin: (kunci: string) => boolean }) {
  // Kartu hanya dimuat bila menunya termasuk peran; API-nya pun ditutup server.
  const bolehPresensi = izin("halaman.presensi");
  const bolehCuti = izin("halaman.cuti");
  const bolehPengumuman = izin("halaman.pengumuman");
  const bolehGaji = izin("halaman.gaji");
  const presensiHariIni = useQuery({ queryKey: ["presensi", "saya", "hari-ini"], queryFn: async () => (await api.get<Halaman<Presensi>>(`/attendance/me?startDate=${hariIni}&endDate=${hariIni}&limit=5`)).data.data[0] ?? null, enabled: bolehPresensi });
  const presensiSaya = useQuery({ queryKey: ["presensi", "saya", "7-hari"], queryFn: async () => (await api.get<Halaman<Presensi>>("/attendance/me?limit=7")).data.data, enabled: bolehPresensi });
  const saldo = useQuery({ queryKey: ["cuti", "saldo-saya"], queryFn: async () => (await api.get<{ data: SaldoCuti[] }>(`/leave-balances/me?year=${new Date().getFullYear()}`)).data.data, enabled: bolehCuti });
  const cutiSaya = useQuery({ queryKey: ["cuti", "saya", "terakhir"], queryFn: async () => (await api.get<Halaman<Cuti>>("/leaves/me?limit=3")).data.data, enabled: bolehCuti });
  const pengumuman = useQuery({ queryKey: ["pengumuman", "ringkas"], queryFn: async () => (await api.get<Halaman<Pengumuman>>("/announcements?limit=5")).data.data, enabled: bolehPengumuman });
  const slip = useQuery({ queryKey: ["gaji", "slip-terakhir"], queryFn: async () => (await api.get<Halaman<SlipGaji>>("/payrolls/me?limit=1")).data.data[0] ?? null, enabled: bolehGaji });

  const p = presensiHariIni.data;
  const tahunan = (saldo.data ?? []).find((s) => s.leaveType.name.toLowerCase().includes("tahun")) ?? saldo.data?.[0];
  const belumDibaca = (pengumuman.data ?? []).filter((a) => !a.isRead).length;

  return (
    <>
      <PageHeader title={`Halo, ${nama.split(" ")[0]}`} description={formatTanggal(hariIni, "EEEE, d MMMM yyyy")} />
      <PeringatanTautanWhatsApp />

      {!bolehPresensi && !bolehCuti && !bolehPengumuman && !bolehGaji && (
        <Card><EmptyState icon={Users} title="Selamat datang" description="Pilih menu di samping untuk mulai bekerja." /></Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {bolehPresensi && (presensiHariIni.isLoading ? <Skeleton className="h-28" /> : (
          <StatCard label="Presensi hari ini" value={p ? (p.checkOutTime ? "Selesai" : "Bekerja") : "Belum"} hint={p ? `masuk ${formatWaktu(p.checkInTime)}${p.checkOutTime ? ` · pulang ${formatWaktu(p.checkOutTime)}` : ""}` : "check-in lewat aplikasi mobile"} icon={CalendarCheck} tone={p ? (p.status === "late" ? "warning" : "success") : "info"} />
        ))}
        {bolehCuti && (saldo.isLoading ? <Skeleton className="h-28" /> : (
          <StatCard label={tahunan ? `Sisa ${tahunan.leaveType.name.toLowerCase()}` : "Sisa cuti"} value={tahunan ? `${tahunan.remainingDays} hari` : "—"} hint={tahunan ? `dari ${tahunan.entitledDays + tahunan.carriedOverDays} hari` : "belum ditetapkan HR"} icon={CalendarOff} tone="primary" />
        ))}
        {bolehPengumuman && (pengumuman.isLoading ? <Skeleton className="h-28" /> : (
          <StatCard label="Pengumuman belum dibaca" value={formatAngka(belumDibaca)} hint={(pengumuman.data ?? []).some((a) => a.requiresAcknowledgment && !a.acknowledgedAt) ? "ada yang perlu konfirmasi" : "semua sudah dibaca"} icon={Megaphone} tone={belumDibaca > 0 ? "warning" : "success"} />
        ))}
        {bolehGaji && (slip.isLoading ? <Skeleton className="h-28" /> : (
          <StatCard label="Slip gaji terakhir" value={slip.data ? formatRupiah(slip.data.netSalary) : "—"} hint={slip.data ? `${formatTanggal(slip.data.payPeriodStart, "d MMM")} – ${formatTanggal(slip.data.payPeriodEnd, "d MMM yyyy")} · ${labelStatus(slip.data.status)}` : "belum ada slip"} icon={Wallet} tone="secondary" />
        ))}
      </div>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        {bolehPresensi && (
        <div className="space-y-3 sm:space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div><CardTitle>Presensi 7 hari terakhir</CardTitle><CardDescription>Jam masuk, pulang, dan statusnya</CardDescription></div>
              <TautanKartu href="/presensi">Semua</TautanKartu>
            </CardHeader>
            <CardContent>
              {presensiSaya.isLoading ? <Skeleton className="h-40" /> : presensiSaya.data?.length ? (
                <ul className="divide-y divide-border">
                  {presensiSaya.data.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <div className="min-w-0"><p className="font-medium">{formatTanggal(r.date, "EEEE, d MMM")}</p><p className="text-xs text-muted tabular-nums">{formatWaktu(r.checkInTime)} – {r.checkOutTime ? formatWaktu(r.checkOutTime) : "…"}{r.workLocation ? ` · ${r.workLocation.name}` : ""}</p></div>
                      <Badge tone={nadaStatus(r.status)} dot>{labelStatus(r.status)}</Badge>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState icon={CalendarCheck} title="Belum ada catatan presensi" description="Check-in dilakukan lewat aplikasi mobile HRD Nusantara." />}
            </CardContent>
          </Card>
        </div>
        )}

        <div className="space-y-3 sm:space-y-4">
          {bolehPengumuman && (
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <CardTitle>Pengumuman terbaru</CardTitle>
              <TautanKartu href="/pengumuman">Semua</TautanKartu>
            </CardHeader>
            <CardContent>
              {pengumuman.isLoading ? <Skeleton className="h-32" /> : pengumuman.data?.length ? (
                <ul className="divide-y divide-border">
                  {pengumuman.data.slice(0, 4).map((a) => (
                    <li key={a.id} className="py-2.5 text-sm">
                      <Link href="/pengumuman" className={`block truncate hover:underline ${a.isRead ? "font-medium" : "font-semibold"}`}>{!a.isRead && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-primary align-middle" aria-label="belum dibaca" />}{a.title}</Link>
                      <p className="text-xs text-muted">{formatTanggal(a.publishedAt)}{a.priority !== "normal" ? ` · ${labelStatus(a.priority)}` : ""}</p>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted">Belum ada pengumuman.</p>}
            </CardContent>
          </Card>
          )}

          {bolehCuti && (
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <CardTitle>Pengajuan cuti terakhir</CardTitle>
              <TautanKartu href="/cuti">Ajukan</TautanKartu>
            </CardHeader>
            <CardContent>
              {cutiSaya.isLoading ? <Skeleton className="h-24" /> : cutiSaya.data?.length ? (
                <ul className="divide-y divide-border">
                  {cutiSaya.data.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <div className="min-w-0"><p className="truncate font-medium">{c.leaveType.name}</p><p className="text-xs text-muted">{formatTanggal(c.startDate, "d MMM")} – {formatTanggal(c.endDate, "d MMM")} · {c.totalDays} hari</p></div>
                      <Badge tone={nadaStatus(c.status)} dot>{labelStatus(c.status)}</Badge>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted">Belum ada pengajuan cuti.</p>}
            </CardContent>
          </Card>
          )}
        </div>
      </div>
    </>
  );
}

export default function HalamanDashboard() {
  const { data: saya } = useSesi();
  const manajemen = punyaIzin(saya, "laporan.dashboard");
  const hr = punyaIzin(saya, "dokumen.kelola");
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
    queryFn: async () => (await api.get<Halaman<Presensi>>(`/attendance?startDate=${hariIni}&endDate=${hariIni}&limit=100`)).data,
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
    enabled: hr,
  });

  if (!saya) return <Skeleton className="h-64" />;
  if (!manajemen) return <DashboardKaryawan nama={saya.name} hariIni={hariIni} izin={(k) => punyaIzin(saya, k)} />;

  const d = dashboard.data;
  const hitungStatus = (status: string) => presensiHariIni.data?.data.filter((p) => p.status === status).length ?? 0;
  // Server sudah mengurutkan dari yang terbanyak; "tidak dicatat" = tanpa departemen.
  const dataDept = d ? d.headcount.byDepartment.map((h) => ({ label: h.value === "tidak dicatat" ? "Tanpa departemen" : h.value, nilai: h.count })) : [];
  const dataTenure = d ? d.tenure.distribution.map((b) => ({ label: b.label, nilai: b.count })) : [];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Periode ${formatTanggal(mulai)} – ${formatTanggal(hariIni)}`}
        actions={
          <Select value={preset} onChange={(e) => setPreset(Number(e.target.value))} aria-label="Periode" className="w-44">
            {PRESET.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
          </Select>
        }
      />

      <PeringatanTautanWhatsApp />

      {dashboard.isError && (
        <Alert tone="danger" title="Ringkasan tidak bisa dimuat">{(dashboard.error as Error).message}</Alert>
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

      {/* Dua kolom tetap: grafik di kiri (2/3), ringkasan harian di kanan (1/3). Tiap kolom
          menumpuk kartunya sendiri, jadi tinggi kartu yang berbeda tidak menyisakan lubang. */}
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        <div className="space-y-3 sm:space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Karyawan per departemen</CardTitle><CardDescription>Headcount aktif saat ini</CardDescription></CardHeader>
            <CardContent>{dashboard.isLoading ? <Skeleton className="h-64" /> : <GrafikBatang data={dataDept} />}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Sebaran masa kerja</CardTitle><CardDescription>Rata-rata bisa menipu — satu orang sepuluh tahun menutupi lima yang keluar dalam tiga bulan</CardDescription></CardHeader>
            <CardContent>{dashboard.isLoading ? <Skeleton className="h-56" /> : <GrafikBatang data={dataTenure} tinggi={220} />}</CardContent>
          </Card>
        </div>

        <div className="space-y-3 sm:space-y-4">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div><CardTitle>Presensi hari ini</CardTitle><CardDescription>{formatTanggal(hariIni, "EEEE, d MMMM")}</CardDescription></div>
              <TautanKartu href="/presensi">Rincian</TautanKartu>
            </CardHeader>
            <CardContent className="space-y-3">
              {presensiHariIni.isLoading ? <Skeleton className="h-32" /> : (
                <>
                  {["present", "late", "no_checkout"].map((k) => (
                    <div key={k} className="flex items-center justify-between">
                      <Badge tone={nadaStatus(k)} dot>{labelStatus(k)}</Badge>
                      <span className="text-lg font-semibold tabular-nums">{hitungStatus(k)}</span>
                    </div>
                  ))}
                  <p className="pt-1 text-xs text-muted">{presensiHariIni.data?.pagination.total ?? 0} catatan hari ini</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div><CardTitle>Cuti menunggu persetujuan</CardTitle><CardDescription>{cutiMenunggu.data?.pagination.total ?? 0} pengajuan</CardDescription></div>
              <TautanKartu href="/cuti">Tinjau</TautanKartu>
            </CardHeader>
            <CardContent>
              {cutiMenunggu.isLoading ? <Skeleton className="h-32" /> : cutiMenunggu.data?.data.length ? (
                <ul className="divide-y divide-border">
                  {cutiMenunggu.data.data.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <div className="min-w-0"><p className="truncate font-medium">{c.employee.name}</p><p className="truncate text-xs text-muted">{c.leaveType.name} · {formatTanggal(c.startDate, "d MMM")} – {formatTanggal(c.endDate, "d MMM")}</p></div>
                      <span className="shrink-0 tabular-nums text-muted">{c.totalDays} hari</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted">Tidak ada pengajuan yang menunggu.</p>}
            </CardContent>
          </Card>

          {hr && (
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div><CardTitle>Dokumen perlu diperbarui</CardTitle><CardDescription>Kedaluwarsa dalam 30 hari</CardDescription></div>
                {(dokumenKedaluwarsa.data?.pagination.total ?? 0) > 0 && <Badge tone="warning" dot>{dokumenKedaluwarsa.data!.pagination.total}</Badge>}
              </CardHeader>
              <CardContent>
                {dokumenKedaluwarsa.isLoading ? <Skeleton className="h-24" /> : dokumenKedaluwarsa.data?.data.length ? (
                  <ul className="divide-y divide-border">
                    {dokumenKedaluwarsa.data.data.map((dok) => {
                      const sisa = sisaHari(dok.expiresAt) ?? 0;
                      return (
                        <li key={dok.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                          <div className="min-w-0"><Link href={`/karyawan/${dok.employeeId}`} className="font-medium hover:underline">{dok.employee?.name}</Link><p className="truncate text-xs text-muted">{LABEL_DOKUMEN[dok.type]} · {dok.title}</p></div>
                          <Badge tone={sisa < 0 ? "danger" : "warning"} dot className="shrink-0">{sisa < 0 ? `lewat ${Math.abs(sisa)} hari` : `${sisa} hari lagi`}</Badge>
                        </li>
                      );
                    })}
                  </ul>
                ) : <div className="flex items-center gap-2 text-sm text-muted"><FileWarning className="h-4 w-4" aria-hidden /> Tidak ada dokumen yang segera kedaluwarsa.</div>}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
