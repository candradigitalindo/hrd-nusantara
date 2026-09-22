"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { format, subMonths, startOfMonth } from "date-fns";
import { Briefcase, Plus, Pencil, Users, CalendarClock, MessageSquareText } from "lucide-react";
import { api } from "@/lib/api";
import { useSesi, punyaIzin, bolehKelola } from "@/hooks/use-sesi";
import { notifikasi } from "@/hooks/use-notifikasi";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { StatCard } from "@/components/ui/stat-card";
import { Skeleton, SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { GrafikBatang } from "@/components/dashboard/grafik-batang";
import { FormLowongan } from "@/components/rekrutmen/form-lowongan";
import { PanelPelamar } from "@/components/rekrutmen/panel-pelamar";
import { formatTanggal, formatRupiah, labelStatus, LABEL_TAHAP, LABEL_EMPLOYMENT, LABEL_HASIL_WAWANCARA } from "@/lib/utils";
import type { Halaman, Lowongan, Wawancara, CorongRekrutmen, StatusLowongan } from "@/lib/types";

type Tab = "lowongan" | "pelamar" | "wawancara" | "corong";
type FormUmpan = { status: "completed" | "cancelled" | "no_show"; result: "pass" | "fail" | "hold" | ""; score: string; notes: string };

const TRANSISI: Record<StatusLowongan, StatusLowongan[]> = { draft: ["open", "cancelled"], open: ["closed", "filled", "cancelled"], closed: ["open"], filled: [], cancelled: [] };

/** Corong bisa datang sebagai array {stage, ...angka} atau record; keduanya dinormalkan. */
const normalkanCorong = (f: CorongRekrutmen["funnel"]) =>
  Array.isArray(f)
    ? f.map((x) => { const angka = Object.entries(x).find(([k, v]) => k !== "stage" && typeof v === "number"); return { label: LABEL_TAHAP[x.stage] ?? x.stage, nilai: (angka?.[1] as number) ?? 0 }; })
    : Object.entries(f).map(([k, v]) => ({ label: LABEL_TAHAP[k] ?? k, nilai: v }));

export default function HalamanRekrutmen() {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const hr = punyaIzin(saya, "rekrutmen.lihat") || bolehKelola(saya, "rekrutmen");
  const bolehBuat = punyaIzin(saya, "rekrutmen.buat");
  const bolehUbah = punyaIzin(saya, "rekrutmen.ubah");
  // Sesi belum tentu sudah termuat saat render pertama, jadi tab bawaan
  // dihitung tiap render; hanya pilihan pengguna yang disimpan.
  const [tabDipilih, setTab] = React.useState<Tab | null>(null);
  const tab: Tab = tabDipilih ?? (hr ? "pelamar" : "wawancara");
  const [formBuka, setFormBuka] = React.useState<{ open: boolean; item: Lowongan | null }>({ open: false, item: null });
  const [pageLowongan, setPageLowongan] = React.useState(1);
  const [umpan, setUmpan] = React.useState<Wawancara | null>(null);
  const [statusW, setStatusW] = React.useState("scheduled");
  const [pageW, setPageW] = React.useState(1);

  const lowongan = useQuery({ queryKey: ["lowongan", pageLowongan], queryFn: async () => (await api.get<Halaman<Lowongan>>(`/job-postings?page=${pageLowongan}&limit=12`)).data, placeholderData: (p) => p });

  const pw = new URLSearchParams({ page: String(pageW), limit: "20" }); if (statusW) pw.set("status", statusW);
  const wawancara = useQuery({ queryKey: ["wawancara", pw.toString()], queryFn: async () => (await api.get<Halaman<Wawancara>>(`/interviews?${pw}`)).data, enabled: tab === "wawancara", placeholderData: (p) => p });

  const mulai = format(startOfMonth(subMonths(new Date(), 5)), "yyyy-MM-dd"), sampai = format(new Date(), "yyyy-MM-dd");
  const corong = useQuery({ queryKey: ["corong", mulai, sampai], queryFn: async () => (await api.get<CorongRekrutmen>(`/recruitment/funnel?startDate=${mulai}&endDate=${sampai}`)).data, enabled: tab === "corong" && hr });

  const ubahStatus = useMutation({
    mutationFn: async ({ l, status }: { l: Lowongan; status: StatusLowongan }) => (await api.patch<Lowongan>(`/job-postings/${l.id}/status`, { status })).data,
    onSuccess: (l) => { qc.invalidateQueries({ queryKey: ["lowongan"] }); notifikasi.sukses(`Lowongan ${labelStatus(l.status).toLowerCase()}`, l.status === "open" ? `${l.title} kini menerima pelamar.` : l.title); },
    onError: (e) => notifikasi.galat(e, "Status gagal diubah"),
  });

  const fu = useForm<FormUmpan>({ defaultValues: { status: "completed", result: "", score: "", notes: "" } });
  const kirimUmpan = useMutation({
    mutationFn: async (v: FormUmpan) => (await api.patch(`/interviews/${umpan!.id}/feedback`, { status: v.status, ...(v.result ? { result: v.result } : {}), ...(v.score ? { score: Number(v.score) } : {}), ...(v.notes ? { notes: v.notes } : {}) })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["wawancara"] }); qc.invalidateQueries({ queryKey: ["kandidat"] }); notifikasi.sukses("Umpan balik tersimpan", "HR akan melihatnya di profil kandidat."); setUmpan(null); fu.reset(); },
    onError: (e) => notifikasi.galat(e, "Umpan balik gagal disimpan"),
  });
  const statusUmpan = useWatch({ control: fu.control, name: "status" });

  const TABS: { id: Tab; label: string; hrSaja?: boolean }[] = [
    { id: "lowongan", label: "Lowongan" }, { id: "pelamar", label: "Pelamar", hrSaja: true }, { id: "wawancara", label: "Wawancara" }, { id: "corong", label: "Corong", hrSaja: true },
  ];

  return (
    <>
      <PageHeader title="Rekrutmen" description={hr ? "Lowongan, pelamar, wawancara, dan corong seleksi" : "Wawancara yang dijadwalkan untuk Anda"}
        actions={bolehBuat && tab === "lowongan" && <Button onClick={() => setFormBuka({ open: true, item: null })}><Plus className="h-4 w-4" aria-hidden /> Lowongan</Button>} />

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1 w-fit max-w-full" role="tablist">
        {TABS.filter((t) => !t.hrSaja || hr).map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === t.id ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"}`}>{t.label}</button>
        ))}
      </div>

      {tab === "lowongan" && (
        lowongan.isLoading ? <SkeletonBaris /> : !lowongan.data?.data.length ? (
          <Card><EmptyState icon={Briefcase} title="Belum ada lowongan" description="Buat lowongan, lalu tayangkan agar pelamar bisa dicatat." action={bolehBuat && <Button onClick={() => setFormBuka({ open: true, item: null })}>Buat Lowongan</Button>} /></Card>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {lowongan.data.data.map((l) => (
                <Card key={l.id} className="flex flex-col animate-fade-up">
                  <CardHeader className="flex-row items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{l.title}</CardTitle>
                      <CardDescription>{l.position.name}{l.location ? ` · ${l.location}` : ""}{l.employmentType ? ` · ${LABEL_EMPLOYMENT[l.employmentType]}` : ""}</CardDescription>
                    </div>
                    <Badge tone={nadaStatus(l.status)} dot className="shrink-0">{labelStatus(l.status)}</Badge>
                  </CardHeader>
                  <CardContent className="mt-auto space-y-3">
                    <p className="text-sm text-muted">
                      {l.openings} posisi · {l._count?.candidates ?? 0} pelamar
                      {l.salaryRangeMin || l.salaryRangeMax ? ` · ${formatRupiah(l.salaryRangeMin)} – ${formatRupiah(l.salaryRangeMax)}` : ""}
                      {l.deadline ? ` · s/d ${formatTanggal(l.deadline)}` : ""}
                    </p>
                    {hr && (
                      <div className="flex flex-wrap gap-2">
                        {bolehUbah && <Button size="sm" variant="ghost" onClick={() => setFormBuka({ open: true, item: l })}><Pencil className="h-4 w-4" aria-hidden /> Sunting</Button>}
                        {bolehUbah && TRANSISI[l.status].map((s) => <Button key={s} size="sm" variant={s === "open" ? "primary" : "outline"} onClick={() => ubahStatus.mutate({ l, status: s })}>{s === "open" ? "Tayangkan" : labelStatus(s)}</Button>)}
                        {(l._count?.candidates ?? 0) > 0 && <Button size="sm" variant="ghost" onClick={() => setTab("pelamar")}><Users className="h-4 w-4" aria-hidden /> Pelamar</Button>}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card><Pagination pagination={lowongan.data.pagination} onPage={setPageLowongan} /></Card>
          </>
        )
      )}

      {tab === "pelamar" && hr && <PanelPelamar />}

      {tab === "wawancara" && (
        <Card>
          <div className="border-b border-border p-3">
            <Select className="sm:w-56" value={statusW} onChange={(e) => { setStatusW(e.target.value); setPageW(1); }} aria-label="Status wawancara"><option value="">Semua</option>{["scheduled", "completed", "cancelled", "no_show"].map((s) => <option key={s} value={s}>{labelStatus(s)}</option>)}</Select>
          </div>
          {wawancara.isLoading ? <SkeletonBaris /> : !wawancara.data?.data.length ? (
            <EmptyState icon={CalendarClock} title="Tidak ada wawancara" description={statusW === "scheduled" ? "Tidak ada jadwal yang menunggu." : undefined} />
          ) : (
            <>
              <ul className="divide-y divide-border">
                {wawancara.data.data.map((w) => (
                  <li key={w.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center animate-fade-up">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{w.candidate.name} <span className="text-xs font-normal text-muted">· {w.stage} putaran {w.round}</span></p>
                      <p className="text-xs text-muted">{formatTanggal(w.scheduledDateTime, "EEEE, d MMM yyyy HH:mm")} · {w.durationMinutes} mnt{w.location ? ` · ${w.location}` : ""} · pewawancara {w.interviewer.name}</p>
                      {w.notes && <p className="mt-1 text-xs text-muted line-clamp-2">{w.notes}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {w.score !== null && <span className="tabular-nums text-sm">{w.score}/100</span>}
                      <Badge tone={nadaStatus(w.result ?? w.status)} dot>{w.result ? LABEL_HASIL_WAWANCARA[w.result] : labelStatus(w.status)}</Badge>
                      {w.status === "scheduled" && (bolehUbah || w.interviewerId === saya?.id) && <Button size="sm" onClick={() => { setUmpan(w); fu.reset(); }}><MessageSquareText className="h-4 w-4" aria-hidden /> Umpan balik</Button>}
                    </div>
                  </li>
                ))}
              </ul>
              <Pagination pagination={wawancara.data.pagination} onPage={setPageW} />
            </>
          )}
        </Card>
      )}

      {tab === "corong" && hr && (
        corong.isLoading ? <Skeleton className="h-64" /> : corong.data ? (
          <>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <StatCard label="Pelamar" value={corong.data.totalCandidates} hint="6 bulan terakhir" icon={Users} />
              <StatCard label="Diterima" value={normalkanCorong(corong.data.funnel).find((x) => x.label === LABEL_TAHAP.hired)?.nilai ?? 0} icon={Briefcase} tone="success" />
              <StatCard label="Ditolak / mundur" value={`${corong.data.rejected} / ${corong.data.withdrawn}`} icon={Users} tone="warning" />
              <StatCard label="Rata-rata hari ke hire" value={corong.data.averageDaysToHire ?? "—"} icon={CalendarClock} tone="info" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card><CardHeader><CardTitle>Corong seleksi</CardTitle><CardDescription>Berapa pelamar mencapai tiap tahap</CardDescription></CardHeader><CardContent><GrafikBatang data={normalkanCorong(corong.data.funnel)} /></CardContent></Card>
              <Card><CardHeader><CardTitle>Per sumber</CardTitle><CardDescription>Dari mana pelamar yang akhirnya diterima</CardDescription></CardHeader><CardContent>
                <GrafikBatang data={corong.data.bySource.map((s) => ({ label: s.source || "tidak diketahui", nilai: Number((s as Record<string, unknown>).hired ?? 0) }))} satuan=" diterima" />
              </CardContent></Card>
            </div>
          </>
        ) : null
      )}

      <FormLowongan open={formBuka.open} onClose={() => setFormBuka({ open: false, item: null })} lowongan={formBuka.item} />

      <Modal open={Boolean(umpan)} onClose={() => setUmpan(null)} title="Umpan Balik Wawancara" description={umpan ? `${umpan.candidate.name} · ${umpan.stage} putaran ${umpan.round}` : undefined}
        footer={<><Button variant="outline" onClick={() => setUmpan(null)}>Batal</Button><Button form="form-umpan" type="submit" loading={kirimUmpan.isPending}>Simpan</Button></>}>
        <form id="form-umpan" onSubmit={fu.handleSubmit((v) => kirimUmpan.mutate(v))} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status"><Select {...fu.register("status")}><option value="completed">Selesai</option><option value="no_show">Kandidat tidak hadir</option><option value="cancelled">Dibatalkan</option></Select></Field>
            {statusUmpan === "completed" && <Field label="Hasil" error={fu.formState.errors.result?.message}><Select {...fu.register("result", { validate: (v, f) => f.status !== "completed" || Boolean(v) || "Wawancara yang selesai harus punya hasil" })}><option value="">— Pilih —</option><option value="pass">Lolos</option><option value="hold">Ditahan</option><option value="fail">Tidak lolos</option></Select></Field>}
          </div>
          {statusUmpan === "completed" && <Field label="Skor (0–100)"><Input type="number" min={0} max={100} {...fu.register("score")} /></Field>}
          <Field label="Catatan" hint="Apa yang menonjol, apa yang meragukan — untuk pewawancara berikutnya"><Textarea rows={4} {...fu.register("notes")} /></Field>
        </form>
      </Modal>
    </>
  );
}
