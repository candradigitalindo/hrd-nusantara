"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Target, Plus, ClipboardList, UserPlus, MessageSquareHeart, BarChart3, Lock, MessageSquarePlus, Send, Unlock, UserCheck, X } from "lucide-react";
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
import { GrafikBatang } from "@/components/dashboard/grafik-batang";
import { FormTemplate } from "@/components/kinerja/form-template";
import { IsiPenilaian } from "@/components/kinerja/isi-penilaian";
import { formatTanggal, formatRelatif, labelStatus, LABEL_PERIODE, LABEL_PENILAI, LABEL_UMPAN, cn } from "@/lib/utils";
import type { Halaman, SiklusPenilaian, TemplatePenilaian, Penilaian, UmpanBalik, RingkasanKinerja, KaryawanDirektori, JenisPenilai } from "@/lib/types";

type Tab = "penilaian" | "siklus" | "template" | "ringkasan" | "umpan";
type FormSiklus = { code: string; name: string; periodType: "quarterly" | "semester" | "annual"; periodStart: string; periodEnd: string; note: string };
type FormTugas = { cycleId: string; revieweeId: string; reviewerId: string; reviewerType: JenisPenilai; formTemplateId: string };
type FormUmpan = { recipientId: string; type: "praise" | "improvement" | "note"; message: string; isPrivate: boolean };

export default function HalamanKinerja() {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const hr = bolehKelola(saya, "kinerja");
  const bolehBuat = punyaIzin(saya, "kinerja.buat");
  const bolehUbah = punyaIzin(saya, "kinerja.ubah");
  const [tab, setTab] = React.useState<Tab>("penilaian");
  const [siklusBuka, setSiklusBuka] = React.useState(false);
  const [templateBuka, setTemplateBuka] = React.useState(false);
  const [tugasBuka, setTugasBuka] = React.useState(false);
  const [umpanBuka, setUmpanBuka] = React.useState(false);
  const [review, setReview] = React.useState<Penilaian | null>(null);
  const [filterStatus, setFilterStatus] = React.useState("");
  const [ringkasSiklus, setRingkasSiklus] = React.useState("");
  const [ringkasKaryawan, setRingkasKaryawan] = React.useState("");
  const [umpanUntuk, setUmpanUntuk] = React.useState("");

  const siklus = useQuery({ queryKey: ["siklus-kinerja"], queryFn: async () => (await api.get<Halaman<SiklusPenilaian>>("/performance/cycles?limit=50")).data.data, enabled: hr });
  const template = useQuery({ queryKey: ["template-kinerja"], queryFn: async () => (await api.get<Halaman<TemplatePenilaian> | TemplatePenilaian[]>("/performance/templates?limit=100")).data, select: (d) => (Array.isArray(d) ? d : d.data), enabled: hr });
  const pr = new URLSearchParams({ limit: "100" }); if (filterStatus) pr.set("status", filterStatus);
  const penilaian = useQuery({ queryKey: ["penilaian", pr.toString()], queryFn: async () => (await api.get<Halaman<Penilaian>>(`/performance/reviews?${pr}`)).data.data });
  const karyawan = useQuery({ queryKey: ["direktori"], queryFn: async () => (await api.get<{ data: KaryawanDirektori[] }>("/employees/directory")).data.data, enabled: tugasBuka || umpanBuka || tab === "ringkasan" || (hr && tab === "umpan") });
  const umpan = useQuery({ queryKey: ["umpan-balik", umpanUntuk], queryFn: async () => (await api.get<Halaman<UmpanBalik>>(`/feedback?limit=50${umpanUntuk ? `&recipientId=${umpanUntuk}` : ""}`)).data.data, enabled: tab === "umpan" });
  const ringkasan = useQuery({ queryKey: ["ringkasan-kinerja", ringkasSiklus, ringkasKaryawan], queryFn: async () => (await api.get<RingkasanKinerja>(`/performance/summary/${ringkasSiklus}/${ringkasKaryawan}`)).data, enabled: hr && tab === "ringkasan" && Boolean(ringkasSiklus && ringkasKaryawan) });
  // Detail memuat kriteria formulir + diskusi terbaru; daftar tidak membawanya.
  const detail = useQuery({ queryKey: ["penilaian", "detail", review?.id], queryFn: async () => (await api.get<Penilaian>(`/performance/reviews/${review!.id}`)).data, enabled: Boolean(review) });

  const fs = useForm<FormSiklus>({ defaultValues: { code: "", name: "", periodType: "quarterly", periodStart: "", periodEnd: "", note: "" } });
  const ft = useForm<FormTugas>({ defaultValues: { cycleId: "", revieweeId: "", reviewerId: "", reviewerType: "manager", formTemplateId: "" } });
  const fu = useForm<FormUmpan>({ defaultValues: { recipientId: "", type: "praise", message: "", isPrivate: false } });

  const buatSiklus = useMutation({
    mutationFn: async (v: FormSiklus) => (await api.post<SiklusPenilaian>("/performance/cycles", { code: v.code, name: v.name, periodType: v.periodType, periodStart: v.periodStart, periodEnd: v.periodEnd, ...(v.note ? { note: v.note } : {}) })).data,
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ["siklus-kinerja"] }); notifikasi.sukses("Siklus dibuat", `${s.name} · buka siklus agar penilaian bisa diisi.`); setSiklusBuka(false); fs.reset(); },
    onError: (e) => notifikasi.galat(e, "Siklus gagal dibuat"),
  });
  const ubahSiklus = useMutation({
    mutationFn: async ({ s, status }: { s: SiklusPenilaian; status: "open" | "closed" }) => (await api.patch<SiklusPenilaian>(`/performance/cycles/${s.id}/status`, { status })).data,
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ["siklus-kinerja"] }); notifikasi.sukses(s.status === "open" ? "Siklus dibuka" : "Siklus ditutup", s.status === "closed" ? "Penilaian yang terkirim kini final." : s.name); },
    onError: (e) => notifikasi.galat(e),
  });
  const tugaskan = useMutation({
    mutationFn: async (v: FormTugas) => (await api.post<Penilaian>("/performance/reviews", v)).data,
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["penilaian"] }); notifikasi.sukses("Penilaian ditugaskan", `${r.reviewer.name} menilai ${r.reviewee.name} (${LABEL_PENILAI[r.reviewerType]})`); setTugasBuka(false); ft.reset(); },
    onError: (e) => notifikasi.galat(e, "Penugasan gagal"),
  });
  const kirimUmpan = useMutation({
    mutationFn: async (v: FormUmpan) => (await api.post<UmpanBalik>("/feedback", v)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["umpan-balik"] }); notifikasi.sukses("Umpan balik terkirim", "Tercatat dan bisa dilihat penerimanya."); setUmpanBuka(false); fu.reset(); },
    onError: (e) => notifikasi.galat(e, "Umpan balik gagal dikirim"),
  });

  const perluSaya = (penilaian.data ?? []).filter((r) => r.reviewerId === saya?.id && r.status === "draft").length;
  const perluAkui = (penilaian.data ?? []).filter((r) => r.revieweeId === saya?.id && r.status === "submitted").length;
  const TABS: { id: Tab; label: string; hrSaja?: boolean }[] = [{ id: "penilaian", label: "Penilaian" }, { id: "umpan", label: "Umpan Balik" }, { id: "siklus", label: "Siklus", hrSaja: true }, { id: "template", label: "Form KPI", hrSaja: true }, { id: "ringkasan", label: "Ringkasan 360°", hrSaja: true }];

  return (
    <>
      <PageHeader title="Penilaian Kinerja" description={hr ? "Siklus, form KPI per jabatan, penugasan penilai, dan ringkasan 360°" : "Penilaian yang harus Anda isi, hasil penilaian Anda, dan umpan balik"}
        actions={bolehBuat ? (tab === "siklus" ? <Button onClick={() => setSiklusBuka(true)}><Plus className="h-4 w-4" aria-hidden /> Siklus</Button> : tab === "template" ? <Button onClick={() => setTemplateBuka(true)}><Plus className="h-4 w-4" aria-hidden /> Form KPI</Button> : tab === "penilaian" ? <Button onClick={() => setTugasBuka(true)}><UserPlus className="h-4 w-4" aria-hidden /> Tugaskan Penilai</Button> : tab === "umpan" ? <Button onClick={() => setUmpanBuka(true)}><MessageSquareHeart className="h-4 w-4" aria-hidden /> Beri Umpan Balik</Button> : null) : tab === "umpan" ? <Button onClick={() => setUmpanBuka(true)}><MessageSquareHeart className="h-4 w-4" aria-hidden /> Beri Umpan Balik</Button> : null} />

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1 w-fit max-w-full" role="tablist">
        {TABS.filter((t) => !t.hrSaja || hr).map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors", tab === t.id ? "bg-surface shadow-sm" : "text-muted hover:text-foreground")}>{t.label}{t.id === "penilaian" && perluSaya + perluAkui > 0 && <span className="ml-1.5 rounded-full bg-primary px-1.5 text-xs text-on-primary">{perluSaya + perluAkui}</span>}</button>)}
      </div>

      {tab === "penilaian" && (
        <Card>
          <div className="border-b border-border p-3"><Select className="sm:w-52" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} aria-label="Status"><option value="">Semua status</option>{["draft", "submitted", "acknowledged", "finalized"].map((s) => <option key={s} value={s}>{labelStatus(s)}</option>)}</Select></div>
          {penilaian.isLoading ? <SkeletonBaris /> : !penilaian.data?.length ? (
            <EmptyState icon={Target} title="Belum ada penilaian" description={hr ? "Buat siklus dan form KPI, lalu tugaskan penilai." : "Belum ada penilaian yang melibatkan Anda."} />
          ) : (
            <ul className="divide-y divide-border">
              {penilaian.data.map((r) => {
                const sayaPenilai = r.reviewerId === saya?.id, sayaDinilai = r.revieweeId === saya?.id;
                const tindakan = sayaPenilai && r.status === "draft" ? "Isi penilaian" : sayaDinilai && r.status === "submitted" ? "Baca & akui" : null;
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => setReview(r)} className="flex w-full items-center gap-3 p-4 text-left hover:bg-surface-2 transition-colors animate-fade-up">
                      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-lg", tindakan ? "bg-warning-soft text-warning" : "bg-surface-2 text-muted")}><ClipboardList className="h-5 w-5" aria-hidden /></span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{r.reviewerType === "self" && sayaDinilai ? "Penilaian diri Anda" : sayaDinilai ? `Penilaian Anda oleh ${r.reviewer.name}` : `${r.reviewee.name} · dinilai ${r.reviewer.name}`}</p>
                        <p className="text-xs text-muted">{LABEL_PENILAI[r.reviewerType]}{r.period ? ` · ${r.period}` : ""} · {r.submittedAt ? `dikirim ${formatRelatif(r.submittedAt)}` : `ditugaskan ${formatRelatif(r.createdAt)}`}</p>
                      </div>
                      <div className="flex items-center gap-2">{r.totalScore !== null && <span className="font-semibold tabular-nums">{r.totalScore}</span>}{tindakan ? <Badge tone="warning" dot>{tindakan}</Badge> : <Badge tone={nadaStatus(r.status)} dot>{labelStatus(r.status)}</Badge>}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {tab === "umpan" && (
        <Card>
          {hr && <div className="border-b border-border p-3"><Select className="sm:w-72" value={umpanUntuk} onChange={(e) => setUmpanUntuk(e.target.value)} aria-label="Penerima"><option value="">Umpan balik untuk saya</option>{(karyawan.data ?? []).filter((k) => k.id !== saya?.id).map((k) => <option key={k.id} value={k.id}>Untuk {k.name}</option>)}</Select></div>}
          {umpan.isLoading ? <SkeletonBaris /> : !umpan.data?.length ? (
            <EmptyState icon={MessageSquareHeart} title="Belum ada umpan balik" description="Umpan balik informal antar rekan atau dari atasan, tercatat kapan saja — tidak perlu menunggu siklus penilaian." action={<Button onClick={() => setUmpanBuka(true)}><MessageSquarePlus className="h-4 w-4" aria-hidden /> Beri Umpan Balik</Button>} />
          ) : (
            <ul className="divide-y divide-border">
              {umpan.data.map((u) => (
                <li key={u.id} className="flex gap-3 p-4 animate-fade-up">
                  <Badge tone={nadaStatus(u.type)} className="mt-0.5 shrink-0">{LABEL_UMPAN[u.type]}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap text-sm">{u.message}</p>
                    <p className="mt-1 text-xs text-muted">{u.author?.name ?? "Anonim"} → {u.recipientId === saya?.id ? "Anda" : ((karyawan.data ?? []).find((k) => k.id === u.recipientId)?.name ?? "—")} · {formatRelatif(u.createdAt)}{u.isPrivate ? " · privat" : ""}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "siklus" && hr && (
        siklus.isLoading ? <SkeletonBaris /> : !siklus.data?.length ? <Card><EmptyState icon={Target} title="Belum ada siklus" description="Evaluasi triwulan, semester, atau tahunan." action={<Button onClick={() => setSiklusBuka(true)}><Plus className="h-4 w-4" aria-hidden /> Buat Siklus</Button>} /></Card> : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {siklus.data.map((s) => (
              <Card key={s.id} className="animate-fade-up">
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <div className="min-w-0"><CardTitle className="truncate">{s.name} <span className="font-mono text-xs font-normal text-muted">{s.code}</span></CardTitle><CardDescription>{LABEL_PERIODE[s.periodType]} · {formatTanggal(s.periodStart, "d MMM")} – {formatTanggal(s.periodEnd, "d MMM yyyy")} · {s._count?.reviews ?? 0} penilaian</CardDescription></div>
                  <Badge tone={nadaStatus(s.status)} dot className="shrink-0">{labelStatus(s.status)}</Badge>
                </CardHeader>
                <CardContent className="flex gap-2">
                  {bolehUbah && s.status === "draft" && <Button size="sm" onClick={() => ubahSiklus.mutate({ s, status: "open" })}><Unlock className="h-4 w-4" aria-hidden /> Buka</Button>}
                  {bolehUbah && s.status === "open" && <Button size="sm" variant="outline" onClick={() => ubahSiklus.mutate({ s, status: "closed" })}><Lock className="h-4 w-4" aria-hidden /> Tutup & Finalkan</Button>}
                </CardContent>
              </Card>
            ))}
          </div>
        )
      )}

      {tab === "template" && hr && (
        template.isLoading ? <SkeletonBaris /> : !template.data?.length ? <Card><EmptyState icon={ClipboardList} title="Belum ada form KPI" description="Contoh: kecepatan pelayanan untuk waiter, kerapian untuk housekeeper." action={<Button onClick={() => setTemplateBuka(true)}><Plus className="h-4 w-4" aria-hidden /> Buat Form</Button>} /></Card> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {template.data.map((t) => (
              <Card key={t.id} className="animate-fade-up">
                <CardHeader><CardTitle>{t.name}</CardTitle><CardDescription>{t.description ?? `${t.criteria.length} kriteria`}</CardDescription></CardHeader>
                <CardContent><ul className="space-y-1 text-sm">{t.criteria.map((k) => <li key={k.id} className="flex items-center justify-between gap-3"><span className="truncate">{k.name}</span><span className="shrink-0 text-xs text-muted tabular-nums">{k.weight}% · skala {k.maxScore}</span></li>)}</ul></CardContent>
              </Card>
            ))}
          </div>
        )
      )}

      {tab === "ringkasan" && hr && (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:w-2/3">
            <Select value={ringkasSiklus} onChange={(e) => setRingkasSiklus(e.target.value)} aria-label="Siklus"><option value="">— Pilih siklus —</option>{(siklus.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
            <Select value={ringkasKaryawan} onChange={(e) => setRingkasKaryawan(e.target.value)} aria-label="Karyawan"><option value="">— Pilih karyawan —</option>{(karyawan.data ?? []).map((k) => <option key={k.id} value={k.id}>{k.name} · {k.nik}</option>)}</Select>
          </div>
          {!ringkasSiklus || !ringkasKaryawan ? <Card><EmptyState icon={BarChart3} title="Pilih siklus dan karyawan" description="Ringkasan menggabungkan penilaian diri, atasan, rekan, dan bawahan." /></Card> : ringkasan.isLoading ? <Skeleton className="h-64" /> : ringkasan.data && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <StatCard label="Skor keseluruhan" value={ringkasan.data.overall ?? "—"} hint="rata-rata antar jenis penilai" icon={Target} />
                <StatCard label="Penilaian masuk" value={ringkasan.data.submittedReviews} icon={ClipboardList} tone="success" />
                <StatCard label="Belum diisi" value={ringkasan.data.pendingReviews} icon={ClipboardList} tone={ringkasan.data.pendingReviews > 0 ? "warning" : "info"} />
              </div>
              <Card><CardHeader><CardTitle>Per jenis penilai (360°)</CardTitle><CardDescription>Perbedaan besar antara penilaian diri dan atasan adalah bahan diskusi, bukan kesimpulan</CardDescription></CardHeader><CardContent><GrafikBatang data={ringkasan.data.byReviewerType.map((b) => ({ label: `${LABEL_PENILAI[b.reviewerType]} (${b.count})`, nilai: b.averageScore }))} /></CardContent></Card>
            </>
          )}
        </>
      )}

      <IsiPenilaian review={review ? (detail.data ?? review) : null} kriteria={detail.data?.criteria ?? review?.scores.map((s, i) => ({ id: s.criterionId, code: s.criterion.code, name: s.criterion.name, description: null, category: null, weight: s.criterion.weight, maxScore: s.criterion.maxScore, sortOrder: i })) ?? []} memuat={detail.isLoading} saya={saya} onClose={() => setReview(null)} />
      <FormTemplate open={templateBuka} onClose={() => setTemplateBuka(false)} />

      <Modal open={siklusBuka} onClose={() => setSiklusBuka(false)} title="Siklus Penilaian Baru" footer={<><Button variant="outline" onClick={() => setSiklusBuka(false)}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button form="form-siklus" type="submit" loading={buatSiklus.isPending}>{!buatSiklus.isPending && <Plus className="h-4 w-4" aria-hidden />} Buat</Button></>}>
        <form id="form-siklus" onSubmit={fs.handleSubmit((v) => buatSiklus.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Kode" error={fs.formState.errors.code?.message}><Input className="font-mono" {...fs.register("code", { required: "Wajib diisi", pattern: { value: /^[A-Za-z0-9_-]{3,40}$/, message: "3–40 karakter: huruf, angka, _ -" } })} placeholder="Q4-2026" /></Field>
          <Field label="Nama" error={fs.formState.errors.name?.message}><Input {...fs.register("name", { required: "Wajib diisi" })} placeholder="Evaluasi Triwulan IV 2026" /></Field>
          <Field label="Jenis periode"><Select {...fs.register("periodType")}>{Object.entries(LABEL_PERIODE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <div />
          <Field label="Mulai" error={fs.formState.errors.periodStart?.message}><Input type="date" {...fs.register("periodStart", { required: "Wajib diisi" })} /></Field>
          <Field label="Selesai" error={fs.formState.errors.periodEnd?.message}><Input type="date" {...fs.register("periodEnd", { required: "Wajib diisi", validate: (v, x) => v >= x.periodStart || "Tidak boleh sebelum mulai" })} /></Field>
          <Field label="Catatan" className="sm:col-span-2"><Textarea rows={2} {...fs.register("note")} /></Field>
        </form>
      </Modal>

      <Modal open={tugasBuka} onClose={() => setTugasBuka(false)} title="Tugaskan Penilai" description="Satu penugasan = satu penilai untuk satu karyawan. Ulangi untuk atasan, rekan, dan bawahan (360°)."
        footer={<><Button variant="outline" onClick={() => setTugasBuka(false)}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button form="form-tugas" type="submit" loading={tugaskan.isPending}>{!tugaskan.isPending && <UserCheck className="h-4 w-4" aria-hidden />} Tugaskan</Button></>}>
        <form id="form-tugas" onSubmit={ft.handleSubmit((v) => tugaskan.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Siklus" error={ft.formState.errors.cycleId?.message} className="sm:col-span-2"><Select {...ft.register("cycleId", { required: "Pilih siklus" })}><option value="">— Pilih —</option>{(siklus.data ?? []).filter((s) => s.status !== "closed").map((s) => <option key={s.id} value={s.id}>{s.name} ({labelStatus(s.status)})</option>)}</Select></Field>
          <Field label="Yang dinilai" error={ft.formState.errors.revieweeId?.message}><Select {...ft.register("revieweeId", { required: "Pilih karyawan" })}><option value="">— Pilih —</option>{(karyawan.data ?? []).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</Select></Field>
          <Field label="Penilai" error={ft.formState.errors.reviewerId?.message}><Select {...ft.register("reviewerId", { required: "Pilih penilai" })}><option value="">— Pilih —</option>{(karyawan.data ?? []).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</Select></Field>
          <Field label="Hubungan penilai"><Select {...ft.register("reviewerType")}>{Object.entries(LABEL_PENILAI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Form KPI" error={ft.formState.errors.formTemplateId?.message}><Select {...ft.register("formTemplateId", { required: "Pilih form" })}><option value="">— Pilih —</option>{(template.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        </form>
      </Modal>

      <Modal open={umpanBuka} onClose={() => setUmpanBuka(false)} title="Beri Umpan Balik" description="Informal, tercatat, dan bisa dilihat penerimanya — untuk momen yang tidak perlu menunggu siklus penilaian"
        footer={<><Button variant="outline" onClick={() => setUmpanBuka(false)}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button form="form-umpan" type="submit" loading={kirimUmpan.isPending}>{!kirimUmpan.isPending && <Send className="h-4 w-4" aria-hidden />} Kirim</Button></>}>
        <form id="form-umpan" onSubmit={fu.handleSubmit((v) => kirimUmpan.mutate(v))} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Untuk" error={fu.formState.errors.recipientId?.message}><Select {...fu.register("recipientId", { required: "Pilih penerima" })}><option value="">— Pilih —</option>{(karyawan.data ?? []).filter((k) => k.id !== saya?.id).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</Select></Field>
            <Field label="Jenis"><Select {...fu.register("type")}>{Object.entries(LABEL_UMPAN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          </div>
          <Field label="Pesan" error={fu.formState.errors.message?.message}><Textarea rows={4} {...fu.register("message", { required: "Wajib diisi" })} placeholder="Tadi siang kamu menangani komplain meja 7 dengan tenang — tamu pulang tersenyum." /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...fu.register("isPrivate")} className="h-4 w-4 accent-[var(--primary)]" /> Privat — hanya penerima dan HR yang bisa melihat</label>
        </form>
      </Modal>
    </>
  );
}
