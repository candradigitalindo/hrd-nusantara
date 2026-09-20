"use client";

import * as React from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, startOfMonth, startOfYear, subMonths } from "date-fns";
import { UserMinus, Banknote, GraduationCap, UserSearch, CalendarClock, Clock, TimerOff, Download, Database, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useSesi, bolehHr, bolehManajer } from "@/hooks/use-sesi";
import { notifikasi } from "@/hooks/use-notifikasi";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { Skeleton, SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/alert";
import { Pagination } from "@/components/ui/pagination";
import { GrafikBatang } from "@/components/dashboard/grafik-batang";
import { formatTanggal, formatRupiah, formatAngka, labelStatus, LABEL_DATASET, LABEL_EXIT, cn } from "@/lib/utils";
import type { Halaman, Departemen, LaporanTurnover, LaporanBiaya, LaporanProduktivitas, DataMentah, DatasetMentah } from "@/lib/types";

type Tab = "turnover" | "biaya" | "produktivitas" | "mentah";
const PRESET = [
  { label: "Bulan ini", mulai: () => startOfMonth(new Date()) },
  { label: "3 bulan terakhir", mulai: () => startOfMonth(subMonths(new Date(), 2)) },
  { label: "12 bulan terakhir", mulai: () => startOfMonth(subMonths(new Date(), 11)) },
  { label: "Tahun ini", mulai: () => startOfYear(new Date()) },
];

/** Meratakan objek bersarang jadi satu tingkat: employee.name, leaveType.code, dst. */
const ratakan = (obj: Record<string, unknown>, awalan = ""): Record<string, unknown> =>
  Object.entries(obj).reduce<Record<string, unknown>>((hasil, [k, v]) => {
    const kunci = awalan ? `${awalan}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(hasil, ratakan(v as Record<string, unknown>, kunci));
    else hasil[kunci] = v;
    return hasil;
  }, {});

const tampilkan = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Ya" : "Tidak";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return formatTanggal(v, "d MMM yyyy HH:mm");
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatTanggal(v);
  return String(v);
};
const judulKolom = (k: string) => k.replace(/\./g, " › ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

export default function HalamanLaporan() {
  const { data: saya } = useSesi();
  const hr = bolehHr(saya?.role);
  const manajemen = bolehManajer(saya?.role);
  const [tab, setTab] = React.useState<Tab>(hr ? "turnover" : "produktivitas");
  const [preset, setPreset] = React.useState(2);
  const [kustom, setKustom] = React.useState<{ mulai: string; selesai: string } | null>(null);
  const [dept, setDept] = React.useState("");
  const [dataset, setDataset] = React.useState<DatasetMentah>("employees");
  const [halaman, setHalaman] = React.useState(1);

  const hariIni = format(new Date(), "yyyy-MM-dd");
  const mulai = kustom ? kustom.mulai : format(PRESET[preset].mulai(), "yyyy-MM-dd");
  const selesai = kustom ? kustom.selesai : hariIni;
  const periodeSah = Boolean(mulai && selesai && mulai <= selesai);
  const q = new URLSearchParams({ startDate: mulai, endDate: selesai }); if (dept) q.set("departmentId", dept);

  const departemen = useQuery({ queryKey: ["departemen", "semua"], queryFn: async () => (await api.get<Halaman<Departemen>>("/departments?limit=100")).data.data, enabled: hr });
  const turnover = useQuery({ queryKey: ["laporan", "turnover", q.toString()], queryFn: async () => (await api.get<LaporanTurnover>(`/reports/turnover?${q}`)).data, enabled: hr && tab === "turnover" && periodeSah });
  const biaya = useQuery({ queryKey: ["laporan", "biaya", q.toString()], queryFn: async () => (await api.get<LaporanBiaya>(`/reports/costs?${q}`)).data, enabled: hr && tab === "biaya" && periodeSah });
  const produktivitas = useQuery({ queryKey: ["laporan", "produktivitas", q.toString()], queryFn: async () => (await api.get<LaporanProduktivitas>(`/reports/productivity?${q}`)).data, enabled: tab === "produktivitas" && periodeSah });
  const qm = new URLSearchParams(q); qm.set("dataset", dataset); qm.set("page", String(halaman)); qm.set("limit", "25");
  const mentah = useQuery({ queryKey: ["laporan", "mentah", qm.toString()], queryFn: async () => (await api.get<DataMentah>(`/reports/raw-data?${qm}`)).data, enabled: hr && tab === "mentah" && periodeSah, placeholderData: (prev) => prev });

  const unduh = useMutation({
    mutationFn: async () => {
      const baris: Record<string, unknown>[] = [];
      for (let page = 1; page <= 50; page++) {
        const qq = new URLSearchParams(q); qq.set("dataset", dataset); qq.set("page", String(page)); qq.set("limit", "100");
        const r = (await api.get<DataMentah>(`/reports/raw-data?${qq}`)).data;
        baris.push(...r.data.map((b) => ratakan(b)));
        if (page * 100 >= r.pagination.total) break;
      }
      const kolom = [...new Set(baris.flatMap((b) => Object.keys(b)))];
      const esc = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      // BOM + pemisah titik koma: terbuka langsung di Excel berbahasa Indonesia.
      const csv = "﻿" + [kolom.map(judulKolom).join(";"), ...baris.map((b) => kolom.map((k) => esc(b[k])).join(";"))].join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a"); a.href = url; a.download = `laporan-${dataset}-${mulai}-${selesai}.csv`; a.click(); URL.revokeObjectURL(url);
      return baris.length;
    },
    onSuccess: (n) => notifikasi.sukses("CSV diunduh", `${formatAngka(n)} baris ${LABEL_DATASET[dataset].toLowerCase()} · ${formatTanggal(mulai)} – ${formatTanggal(selesai)}`),
    onError: (e) => notifikasi.galat(e, "Unduhan gagal"),
  });

  const TABS: { id: Tab; label: string; hrSaja?: boolean }[] = [{ id: "turnover", label: "Perputaran", hrSaja: true }, { id: "biaya", label: "Biaya SDM", hrSaja: true }, { id: "produktivitas", label: "Produktivitas" }, { id: "mentah", label: "Data Mentah & CSV", hrSaja: true }];
  const seri = (h: { value: string; count: number }[], label?: (v: string) => string) => h.map((x) => ({ label: label ? label(x.value) : x.value, nilai: x.count }));
  const kolomMentah = mentah.data?.data.length ? [...new Set(mentah.data.data.flatMap((b) => Object.keys(ratakan(b))))].filter((k) => !/(^|\.)id$|Id$/.test(k)) : [];

  if (saya && !manajemen) {
    return (
      <>
        <PageHeader title="Analisis & Laporan" />
        <Card><EmptyState icon={Users} title="Laporan hanya untuk manajemen" description="Ringkasan aktivitas Anda sendiri ada di Dashboard." /></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Analisis & Laporan" description={hr ? "Perputaran karyawan, biaya SDM, produktivitas, dan data mentah yang bisa diunduh sebagai CSV untuk laporan kustom" : "Produktivitas departemen Anda: kehadiran, keterlambatan, jam kerja"} />

      <div className="flex flex-wrap items-end gap-2">
        <Select value={kustom ? "kustom" : String(preset)} onChange={(e) => { if (e.target.value === "kustom") setKustom({ mulai, selesai }); else { setKustom(null); setPreset(Number(e.target.value)); } setHalaman(1); }} aria-label="Periode" className="sm:w-48">{PRESET.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}<option value="kustom">Rentang kustom…</option></Select>
        {kustom && <><Input type="date" value={kustom.mulai} max={kustom.selesai} onChange={(e) => { setKustom({ ...kustom, mulai: e.target.value }); setHalaman(1); }} aria-label="Mulai" className="sm:w-40" /><Input type="date" value={kustom.selesai} min={kustom.mulai} onChange={(e) => { setKustom({ ...kustom, selesai: e.target.value }); setHalaman(1); }} aria-label="Selesai" className="sm:w-40" /></>}
        {hr && <Select value={dept} onChange={(e) => { setDept(e.target.value); setHalaman(1); }} aria-label="Departemen" className="sm:w-52"><option value="">Semua departemen</option>{(departemen.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}
        <p className="text-xs text-muted sm:ml-auto">{formatTanggal(mulai)} – {formatTanggal(selesai)}</p>
      </div>
      {!periodeSah && <Alert tone="warning" title="Rentang tanggal terbalik">Tanggal selesai harus sesudah tanggal mulai.</Alert>}

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1 w-fit max-w-full" role="tablist">
        {TABS.filter((t) => !t.hrSaja || hr).map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors", tab === t.id ? "bg-surface shadow-sm" : "text-muted hover:text-foreground")}>{t.label}</button>)}
      </div>

      {tab === "turnover" && hr && (turnover.isLoading ? <Skeleton className="h-80" /> : turnover.data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Keluar dalam periode" value={formatAngka(turnover.data.totalExits)} icon={UserMinus} tone={turnover.data.totalExits > 0 ? "warning" : "success"} />
            <StatCard label="Rata-rata masa kerja saat keluar" value={turnover.data.tenureAtExit.averageDays === null ? "—" : `${Math.round(turnover.data.tenureAtExit.averageDays / 30)} bln`} hint={turnover.data.tenureAtExit.averageDays === null ? "belum ada yang keluar" : `${formatAngka(turnover.data.tenureAtExit.averageDays)} hari`} icon={CalendarClock} />
            {turnover.data.byType.slice(0, 2).map((t) => <StatCard key={t.value} label={LABEL_EXIT[t.value] ?? t.value} value={formatAngka(t.count)} icon={Users} tone={t.value === "involuntary" ? "danger" : "info"} />)}
          </div>
          {turnover.data.totalExits === 0 ? <Card><EmptyState icon={UserMinus} title="Tidak ada yang keluar" description="Tidak ada karyawan dengan tanggal keluar dalam periode ini." /></Card> : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card><CardHeader><CardTitle>Alasan berhenti</CardTitle><CardDescription>Yang paling sering di atas — inilah yang bisa ditindaklanjuti</CardDescription></CardHeader><CardContent><GrafikBatang data={seri(turnover.data.byReason)} tinggi={220} /></CardContent></Card>
                <Card><CardHeader><CardTitle>Per departemen</CardTitle><CardDescription>Perputaran yang menumpuk di satu unit biasanya soal atasan atau beban kerja</CardDescription></CardHeader><CardContent><GrafikBatang data={seri(turnover.data.byDepartment, (v) => (v === "tidak dicatat" ? "Tanpa departemen" : v))} tinggi={220} /></CardContent></Card>
                <Card className="lg:col-span-2"><CardHeader><CardTitle>Masa kerja saat keluar</CardTitle><CardDescription>Banyak yang keluar di bawah 3 bulan = masalah rekrutmen atau onboarding, bukan retensi</CardDescription></CardHeader><CardContent><GrafikBatang data={turnover.data.tenureAtExit.distribution.map((b) => ({ label: b.label, nilai: b.count }))} tinggi={200} /></CardContent></Card>
              </div>
              <Card>
                <CardHeader><CardTitle>Daftar yang keluar</CardTitle></CardHeader>
                <ul className="divide-y divide-border">
                  {turnover.data.exits.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4">
                      <div className="min-w-0 flex-1"><p className="font-medium">{e.name} <span className="text-xs font-normal text-muted">{e.nik}</span></p><p className="text-xs text-muted">{e.department?.name ?? "Tanpa departemen"} · {e.position?.name ?? "Tanpa jabatan"} · masuk {formatTanggal(e.joinDate)} · keluar {formatTanggal(e.exitDate)}</p>{e.exitReason && <p className="mt-0.5 text-xs">{e.exitReason}</p>}</div>
                      <Badge tone={e.exitType === "involuntary" ? "danger" : "info"}>{LABEL_EXIT[e.exitType ?? "tidak dicatat"] ?? e.exitType}</Badge>
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          )}
        </>
      ))}

      {tab === "biaya" && hr && (biaya.isLoading ? <Skeleton className="h-80" /> : biaya.data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Total biaya SDM" value={formatRupiah(biaya.data.costs.total)} hint="payroll + pelatihan + rekrutmen" icon={Banknote} />
            <StatCard label="Payroll" value={formatRupiah(biaya.data.costs.payroll)} hint={`${biaya.data.costs.shares.payroll}% · ${formatAngka(biaya.data.detail.payslipCount)} slip`} icon={Banknote} tone="info" />
            <StatCard label="Pelatihan" value={formatRupiah(biaya.data.costs.training)} hint={`${biaya.data.costs.shares.training}% · ${formatAngka(biaya.data.detail.trainingSessions)} sesi`} icon={GraduationCap} tone="success" />
            <StatCard label="Rekrutmen" value={formatRupiah(biaya.data.costs.recruitment)} hint={`${biaya.data.costs.shares.recruitment}% · ${formatAngka(biaya.data.detail.jobPostings)} lowongan`} icon={UserSearch} tone="warning" />
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
            <Card><CardHeader><CardTitle>Komposisi biaya</CardTitle><CardDescription>Hanya batch penggajian yang sudah disetujui yang dihitung</CardDescription></CardHeader><CardContent><GrafikBatang data={[{ label: "Payroll", nilai: biaya.data.costs.payroll }, { label: "Pelatihan", nilai: biaya.data.costs.training }, { label: "Rekrutmen", nilai: biaya.data.costs.recruitment }]} tinggi={220} satuan="Rp" /></CardContent></Card>
            <Card>
              <CardHeader><CardTitle>Rincian</CardTitle></CardHeader>
              <CardContent>
                <dl className="space-y-2 text-sm">
                  {[["Biaya per rekrutan", biaya.data.costPerHire === null ? "belum ada yang direkrut" : formatRupiah(biaya.data.costPerHire)], ["Direkrut dalam periode", formatAngka(biaya.data.hires)], ["Lembur dibayar", formatRupiah(biaya.data.detail.overtimePay)], ["Tunjangan", formatRupiah(biaya.data.detail.allowances)]].map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-right font-medium tabular-nums">{v}</dd></div>)}
                </dl>
              </CardContent>
            </Card>
          </div>
        </>
      ))}

      {tab === "produktivitas" && (produktivitas.isLoading ? <Skeleton className="h-64" /> : produktivitas.isError ? <Alert tone="danger" title="Laporan tidak bisa dimuat">Periksa rentang tanggal, lalu coba lagi.</Alert> : produktivitas.data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard label="Shift terjadwal" value={formatAngka(produktivitas.data.scheduledShifts)} icon={CalendarClock} />
            <StatCard label="Presensi tercatat" value={formatAngka(produktivitas.data.attendanceCount)} hint={`dari ${formatAngka(produktivitas.data.scheduledShifts)} shift`} icon={Users} tone="info" />
            <StatCard label="Rata-rata jam kerja" value={`${produktivitas.data.averageWorkedHours} jam`} hint="per presensi" icon={Clock} tone="success" />
            <StatCard label="Keterlambatan" value={`${produktivitas.data.latePercentage}%`} hint="dari shift terjadwal" icon={TimerOff} tone={produktivitas.data.latePercentage > 10 ? "danger" : produktivitas.data.latePercentage > 5 ? "warning" : "success"} />
            <StatCard label="Ketidakhadiran" value={`${produktivitas.data.absencePercentage}%`} hint="shift tanpa presensi" icon={UserMinus} tone={produktivitas.data.absencePercentage > 10 ? "danger" : produktivitas.data.absencePercentage > 5 ? "warning" : "success"} />
            <StatCard label="Lembur disetujui" value={`${produktivitas.data.approvedOvertimeHours} jam`} icon={Clock} tone="warning" />
          </div>
          <Alert tone="info" title="Persentase dihitung terhadap shift terjadwal, bukan presensi">Kalau dibagi jumlah presensi, karyawan yang sering mangkir justru terlihat jarang terlambat, karena hari mangkirnya tidak masuk pembagi.</Alert>
        </>
      ))}

      {tab === "mentah" && hr && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-end justify-between gap-3">
            <div><CardTitle>Data mentah</CardTitle><CardDescription>Pilih kumpulan data dan periode, lalu unduh CSV untuk diolah sendiri di spreadsheet</CardDescription></div>
            <div className="flex flex-wrap gap-2">
              <Select value={dataset} onChange={(e) => { setDataset(e.target.value as DatasetMentah); setHalaman(1); }} aria-label="Kumpulan data" className="w-44">{Object.entries(LABEL_DATASET).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              <Button onClick={() => unduh.mutate()} loading={unduh.isPending} disabled={!mentah.data?.pagination.total}><Download className="h-4 w-4" aria-hidden /> Unduh CSV{mentah.data ? ` (${formatAngka(Math.min(mentah.data.pagination.total, 5000))})` : ""}</Button>
            </div>
          </CardHeader>
          {mentah.isLoading ? <SkeletonBaris /> : !mentah.data?.data.length ? <EmptyState icon={Database} title="Tidak ada baris" description="Tidak ada data pada kumpulan, periode, dan departemen ini." /> : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-max text-left text-sm">
                  <thead className="sticky top-0 bg-surface-2 text-xs uppercase tracking-wide text-muted"><tr>{kolomMentah.map((k) => <th key={k} className="px-4 py-2 font-medium">{judulKolom(k)}</th>)}</tr></thead>
                  <tbody className="divide-y divide-border">{mentah.data.data.map((b, i) => { const r = ratakan(b); return <tr key={String(b.id ?? i)} className="hover:bg-surface-2/60">{kolomMentah.map((k) => <td key={k} className="px-4 py-2 whitespace-nowrap tabular-nums">{k === "status" ? <Badge tone={nadaStatus(String(r[k]))}>{labelStatus(String(r[k]))}</Badge> : tampilkan(r[k])}</td>)}</tr>; })}</tbody>
                </table>
              </div>
              <div className="border-t border-border p-3"><Pagination pagination={{ ...mentah.data.pagination, totalPages: Math.max(1, Math.ceil(mentah.data.pagination.total / mentah.data.pagination.limit)) }} onPage={setHalaman} /></div>
              {mentah.data.pagination.total > 5000 && <p className="px-4 pb-3 text-xs text-muted">Unduhan CSV dibatasi 5.000 baris pertama; persempit periode untuk mengambil sisanya.</p>}
            </>
          )}
        </Card>
      )}
    </>
  );
}
