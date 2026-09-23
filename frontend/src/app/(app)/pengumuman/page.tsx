"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Megaphone, Plus, Pencil, Users, CheckCheck, AlertTriangle, Archive, X, Save } from "lucide-react";
import { api } from "@/lib/api";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { notifikasi } from "@/hooks/use-notifikasi";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { Pagination } from "@/components/ui/pagination";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { PanelSurvei } from "@/components/komunikasi/panel-survei";
import { formatTanggal, formatRelatif, labelStatus, LABEL_PRIORITAS, cn } from "@/lib/utils";
import type { Halaman, Pengumuman, Departemen, Prioritas } from "@/lib/types";

type FormPengumuman = { title: string; content: string; priority: Prioritas; targetDepartmentId: string; requiresAcknowledgment: boolean; expiresAt: string };
type BarisPembaca = { employee: { id: string; nik: string; name: string }; readAt: string | null; acknowledgedAt: string | null };
type LaporanPembaca = { announcement: { id: string; title: string }; targetCount: number; readCount: number; acknowledgedCount: number; notRead: BarisPembaca[]; notAcknowledged?: BarisPembaca[] };

export default function HalamanPengumuman() {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const bolehBuat = punyaIzin(saya, "pengumuman.buat");
  const bolehUbah = punyaIzin(saya, "pengumuman.ubah");
  const hr = bolehBuat || bolehUbah;
  const survei = punyaIzin(saya, "survei.buat", "survei.ubah");
  const [tab, setTab] = React.useState<"pengumuman" | "survei">("pengumuman");
  const [status, setStatus] = React.useState("");
  const [belumDibaca, setBelumDibaca] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [detail, setDetail] = React.useState<Pengumuman | null>(null);
  const [form, setForm] = React.useState<{ open: boolean; item: Pengumuman | null }>({ open: false, item: null });
  const [pembaca, setPembaca] = React.useState<Pengumuman | null>(null);

  const params = new URLSearchParams({ page: String(page), limit: "20" });
  if (hr && status) params.set("status", status);
  if (belumDibaca) params.set("unreadOnly", "true");

  const daftar = useQuery({ queryKey: ["pengumuman", params.toString()], queryFn: async () => (await api.get<Halaman<Pengumuman>>(`/announcements?${params}`)).data, placeholderData: (p) => p });
  const departemen = useQuery({ queryKey: ["departemen", "semua"], queryFn: async () => (await api.get<Halaman<Departemen>>("/departments?limit=100")).data.data, enabled: form.open });
  const laporan = useQuery({ queryKey: ["pengumuman", "pembaca", pembaca?.id], queryFn: async () => (await api.get<LaporanPembaca>(`/announcements/${pembaca!.id}/reads`)).data, enabled: Boolean(pembaca) });

  const f = useForm<FormPengumuman>({ defaultValues: { title: "", content: "", priority: "normal", targetDepartmentId: "", requiresAcknowledgment: false, expiresAt: "" } });
  React.useEffect(() => {
    if (!form.open) return;
    f.reset(form.item ? { title: form.item.title, content: form.item.content, priority: form.item.priority, targetDepartmentId: form.item.targetDepartmentId ?? "", requiresAcknowledgment: form.item.requiresAcknowledgment, expiresAt: form.item.expiresAt?.slice(0, 10) ?? "" } : { title: "", content: "", priority: "normal", targetDepartmentId: "", requiresAcknowledgment: false, expiresAt: "" });
  }, [form, f]);

  const segarkan = () => qc.invalidateQueries({ queryKey: ["pengumuman"] });

  const tandaiBaca = useMutation({
    mutationFn: async ({ id, acknowledge }: { id: string; acknowledge: boolean }) => (await api.post(`/announcements/${id}/read`, { acknowledge })).data,
    onSuccess: (_, v) => { segarkan(); if (v.acknowledge) { notifikasi.sukses("Konfirmasi tercatat", "HR bisa melihat Anda sudah membaca dan memahami pengumuman ini."); setDetail((d) => (d ? { ...d, acknowledgedAt: new Date().toISOString(), isRead: true } : d)); } },
    onError: (e, v) => { if (v.acknowledge) notifikasi.galat(e); },
  });

  const bukaDetail = (p: Pengumuman) => {
    setDetail(p);
    // Dibuka = dibaca. Konfirmasi "sudah paham" tetap tombol terpisah.
    if (!p.isRead && p.status === "published") tandaiBaca.mutate({ id: p.id, acknowledge: false });
  };

  const simpan = useMutation({
    mutationFn: async (v: FormPengumuman) => {
      const body = { title: v.title, content: v.content, priority: v.priority, targetDepartmentId: v.targetDepartmentId || null, requiresAcknowledgment: v.requiresAcknowledgment, expiresAt: v.expiresAt ? new Date(v.expiresAt + "T23:59:59").toISOString() : null };
      return form.item ? (await api.put<Pengumuman>(`/announcements/${form.item.id}`, body)).data : (await api.post<Pengumuman>("/announcements", body)).data;
    },
    onSuccess: (p) => { segarkan(); notifikasi.sukses(form.item ? "Pengumuman diperbarui" : "Pengumuman dibuat", form.item ? p.title : `${p.title} · masih draft, tayangkan agar terlihat.`); setForm({ open: false, item: null }); },
    onError: (e) => notifikasi.galat(e, "Pengumuman gagal disimpan"),
  });

  const ubahStatus = useMutation({
    mutationFn: async ({ p, status }: { p: Pengumuman; status: "published" | "archived" }) => (await api.patch<Pengumuman>(`/announcements/${p.id}/status`, { status })).data,
    onSuccess: (p) => { segarkan(); notifikasi.sukses(p.status === "published" ? "Pengumuman tayang" : "Pengumuman diarsipkan", p.title); },
    onError: (e) => notifikasi.galat(e),
  });

  const belumDikonfirmasi = (daftar.data?.data ?? []).filter((p) => p.requiresAcknowledgment && !p.acknowledgedAt && p.status === "published").length;

  return (
    <>
      <PageHeader title="Pengumuman & Survei" description={hr ? "Papan informasi perusahaan dan survei karyawan" : "Informasi dari perusahaan untuk Anda"}
        actions={bolehBuat && tab === "pengumuman" && <Button onClick={() => setForm({ open: true, item: null })}><Plus className="h-4 w-4" aria-hidden /> Pengumuman</Button>} />

      <div className="flex gap-1 rounded-xl bg-surface-2 p-1 w-fit" role="tablist">
        {(["pengumuman", "survei"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("rounded-lg px-4 py-2 text-sm font-medium transition-colors", tab === t ? "bg-surface shadow-sm" : "text-muted hover:text-foreground")}>{t === "pengumuman" ? "Pengumuman" : "Survei"}</button>
        ))}
      </div>

      {tab === "survei" ? <PanelSurvei hr={survei} bolehBuat={punyaIzin(saya, "survei.buat")} /> : (
        <>
          {belumDikonfirmasi > 0 && <Alert tone="warning" title={`${belumDikonfirmasi} pengumuman perlu konfirmasi Anda`}>Buka pengumumannya lalu tekan &ldquo;Saya sudah membaca&rdquo;.</Alert>}
          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
              {hr && <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status" className="w-44"><option value="">Semua status</option>{["draft", "published", "archived"].map((s) => <option key={s} value={s}>{labelStatus(s)}</option>)}</Select>}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={belumDibaca} onChange={(e) => { setBelumDibaca(e.target.checked); setPage(1); }} className="h-4 w-4 accent-[var(--primary)]" /> Belum dibaca saja</label>
            </div>
            {daftar.isLoading ? <SkeletonBaris /> : !daftar.data?.data.length ? (
              <EmptyState icon={Megaphone} title="Tidak ada pengumuman" description={belumDibaca ? "Semua sudah Anda baca." : "Belum ada pengumuman untuk Anda."} />
            ) : (
              <>
                <ul className="divide-y divide-border">
                  {daftar.data.data.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => bukaDetail(p)} className={cn("flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-surface-2 animate-fade-up", !p.isRead && p.status === "published" && "bg-primary-soft/40")}>
                        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", !p.isRead && p.status === "published" ? "bg-primary" : "bg-transparent")} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className={cn("truncate", !p.isRead ? "font-semibold" : "font-medium")}>{p.title}</p>
                            {p.priority !== "normal" && <Badge tone={nadaStatus(p.priority)} dot>{LABEL_PRIORITAS[p.priority]}</Badge>}
                            {hr && p.status !== "published" && <Badge tone={nadaStatus(p.status)}>{labelStatus(p.status)}</Badge>}
                            {p.requiresAcknowledgment && !p.acknowledgedAt && p.status === "published" && <Badge tone="warning"><AlertTriangle className="h-3 w-3" aria-hidden /> Perlu konfirmasi</Badge>}
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-sm text-muted">{p.content}</p>
                          <p className="mt-1 text-xs text-muted">{p.author?.name ?? "HR"} · {p.publishedAt ? formatRelatif(p.publishedAt) : `dibuat ${formatRelatif(p.createdAt)}`}{p.expiresAt ? ` · berlaku s/d ${formatTanggal(p.expiresAt)}` : ""}{hr ? ` · ${p.readCount} dibaca` : ""}</p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
                <Pagination pagination={daftar.data.pagination} onPage={setPage} />
              </>
            )}
          </Card>
        </>
      )}

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} size="lg" title={detail?.title ?? ""} description={detail ? `${detail.author?.name ?? "HR"} · ${detail.publishedAt ? formatTanggal(detail.publishedAt, "d MMMM yyyy HH:mm") : labelStatus(detail.status)}` : undefined}
        footer={detail && (
          <div className="flex flex-wrap gap-2">
            {bolehUbah && detail.status === "draft" && <Button onClick={() => { ubahStatus.mutate({ p: detail, status: "published" }); setDetail(null); }}><Megaphone className="h-4 w-4" aria-hidden /> Tayangkan</Button>}
            {bolehUbah && detail.status === "published" && <Button variant="outline" onClick={() => { ubahStatus.mutate({ p: detail, status: "archived" }); setDetail(null); }}><Archive className="h-4 w-4" aria-hidden /> Arsipkan</Button>}
            {bolehUbah && <Button variant="outline" onClick={() => { setForm({ open: true, item: detail }); setDetail(null); }}><Pencil className="h-4 w-4" aria-hidden /> Sunting</Button>}
            {bolehUbah && <Button variant="ghost" onClick={() => { setPembaca(detail); setDetail(null); }}><Users className="h-4 w-4" aria-hidden /> {detail.readCount} pembaca</Button>}
            {detail.requiresAcknowledgment && detail.status === "published" && (detail.acknowledgedAt ? <span className="inline-flex items-center gap-1 self-center text-sm text-success"><CheckCheck className="h-4 w-4" aria-hidden /> Dikonfirmasi {formatTanggal(detail.acknowledgedAt, "d MMM HH:mm")}</span> : <Button onClick={() => tandaiBaca.mutate({ id: detail.id, acknowledge: true })} loading={tandaiBaca.isPending}>{!tandaiBaca.isPending && <CheckCheck className="h-4 w-4" aria-hidden />} Saya sudah membaca</Button>)}
            {!hr && !detail.requiresAcknowledgment && <Button onClick={() => setDetail(null)}><X className="h-4 w-4" aria-hidden /> Tutup</Button>}
          </div>
        )}>
        {detail && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">{detail.priority !== "normal" && <Badge tone={nadaStatus(detail.priority)} dot>{LABEL_PRIORITAS[detail.priority]}</Badge>}{detail.targetDepartmentId && <Badge tone="neutral">Khusus departemen</Badge>}</div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{detail.content}</p>
          </div>
        )}
      </Modal>

      <Modal open={form.open} onClose={() => setForm({ open: false, item: null })} size="lg" title={form.item ? "Sunting Pengumuman" : "Pengumuman Baru"}
        footer={<><Button variant="outline" onClick={() => setForm({ open: false, item: null })}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button form="form-pengumuman" type="submit" loading={simpan.isPending}>{!simpan.isPending && (form.item ? <Save className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />)} {form.item ? "Simpan" : "Buat Draft"}</Button></>}>
        <form id="form-pengumuman" onSubmit={f.handleSubmit((v) => simpan.mutate(v))} className="space-y-4" noValidate>
          <Field label="Judul" error={f.formState.errors.title?.message}><Input {...f.register("title", { required: "Wajib diisi" })} /></Field>
          <Field label="Isi" error={f.formState.errors.content?.message}><Textarea rows={8} {...f.register("content", { required: "Wajib diisi" })} /></Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Prioritas"><Select {...f.register("priority")}>{Object.entries(LABEL_PRIORITAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Sasaran"><Select {...f.register("targetDepartmentId")}><option value="">Semua karyawan</option>{(departemen.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
            <Field label="Berlaku sampai" hint="Kosongkan bila tidak kedaluwarsa"><Input type="date" {...f.register("expiresAt")} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...f.register("requiresAcknowledgment")} className="h-4 w-4 accent-[var(--primary)]" /> Wajib dikonfirmasi karyawan (&ldquo;Saya sudah membaca&rdquo;) — untuk SOP dan kebijakan</label>
        </form>
      </Modal>

      <Modal open={Boolean(pembaca)} onClose={() => setPembaca(null)} title="Laporan pembaca" description={pembaca?.title} footer={<Button onClick={() => setPembaca(null)}><X className="h-4 w-4" aria-hidden /> Tutup</Button>}>
        {laporan.isLoading || !laporan.data ? <SkeletonBaris jumlah={3} /> : (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl bg-surface-2 p-3"><p className="text-2xl font-semibold tabular-nums">{laporan.data.readCount}</p><p className="text-xs text-muted">dari {laporan.data.targetCount} membaca</p></div>
              <div className="rounded-xl bg-surface-2 p-3"><p className="text-2xl font-semibold tabular-nums">{laporan.data.acknowledgedCount}</p><p className="text-xs text-muted">mengonfirmasi</p></div>
              <div className="rounded-xl bg-surface-2 p-3"><p className="text-2xl font-semibold tabular-nums">{laporan.data.notRead.length}</p><p className="text-xs text-muted">belum membaca</p></div>
            </div>
            {(laporan.data.notAcknowledged ?? laporan.data.notRead).length > 0 && (
              <section>
                {/* Yang belum itulah yang perlu ditindaklanjuti — bukan daftar yang sudah. */}
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{laporan.data.notAcknowledged ? "Belum mengonfirmasi" : "Belum membaca"}</h3>
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {(laporan.data.notAcknowledged ?? laporan.data.notRead).map((r) => (
                    <li key={r.employee.id} className="flex items-center justify-between gap-3 px-3 py-2"><span>{r.employee.name} <span className="text-xs text-muted">{r.employee.nik}</span></span>{r.readAt && <span className="text-xs text-muted">dibaca, belum konfirmasi</span>}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
