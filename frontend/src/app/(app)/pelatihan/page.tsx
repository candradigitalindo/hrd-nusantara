"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { GraduationCap, Plus, CalendarPlus, Pencil, Users, ClipboardCheck, Award, ShieldCheck, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { useSesi, bolehHr } from "@/hooks/use-sesi";
import { notifikasi } from "@/hooks/use-notifikasi";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { Pagination } from "@/components/ui/pagination";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ResponsiveTable, type Kolom } from "@/components/ui/responsive-table";
import { FormProgram } from "@/components/pelatihan/form-program";
import { FormSesi } from "@/components/pelatihan/form-sesi";
import { formatTanggal, formatRupiah, labelStatus, cn } from "@/lib/utils";
import type { Halaman, ProgramPelatihan, SesiPelatihan, PendaftaranPelatihan, KepatuhanPelatihan, Departemen } from "@/lib/types";

type Tab = "jadwal" | "program" | "pendaftaran" | "kepatuhan";
type FormEvaluasi = { score: string; certificateUrl: string; note: string };

export default function HalamanPelatihan() {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const hr = bolehHr(saya?.role);
  const [tab, setTab] = React.useState<Tab>("jadwal");
  const [statusSesi, setStatusSesi] = React.useState("scheduled");
  const [pageSesi, setPageSesi] = React.useState(1);
  const [formProgram, setFormProgram] = React.useState<{ open: boolean; item: ProgramPelatihan | null }>({ open: false, item: null });
  const [formSesi, setFormSesi] = React.useState(false);
  const [batal, setBatal] = React.useState<PendaftaranPelatihan | null>(null);
  const [peserta, setPeserta] = React.useState<SesiPelatihan | null>(null);
  const [hadir, setHadir] = React.useState<Record<string, boolean>>({});
  const [evaluasi, setEvaluasi] = React.useState<PendaftaranPelatihan | null>(null);
  const [deptKepatuhan, setDeptKepatuhan] = React.useState("");
  const [pageDaftar, setPageDaftar] = React.useState(1);

  const program = useQuery({ queryKey: ["program-pelatihan"], queryFn: async () => (await api.get<Halaman<ProgramPelatihan>>(`/training/programs?limit=100${hr ? "&includeInactive=true" : ""}`)).data.data });
  const ps = new URLSearchParams({ page: String(pageSesi), limit: "12" }); if (statusSesi) ps.set("status", statusSesi);
  const sesi = useQuery({ queryKey: ["sesi-pelatihan", ps.toString()], queryFn: async () => (await api.get<Halaman<SesiPelatihan>>(`/training/sessions?${ps}`)).data, placeholderData: (p) => p });
  const pendaftaranSaya = useQuery({ queryKey: ["pendaftaran-pelatihan", "saya"], queryFn: async () => (await api.get<Halaman<PendaftaranPelatihan>>("/training/registrations?limit=100")).data.data, enabled: !hr || tab === "jadwal" });
  const pendaftaranSemua = useQuery({ queryKey: ["pendaftaran-pelatihan", "semua", pageDaftar], queryFn: async () => (await api.get<Halaman<PendaftaranPelatihan>>(`/training/registrations?page=${pageDaftar}&limit=25`)).data, enabled: hr && tab === "pendaftaran", placeholderData: (p) => p });
  const pesertaSesi = useQuery({ queryKey: ["pendaftaran-pelatihan", "sesi", peserta?.id], queryFn: async () => (await api.get<Halaman<PendaftaranPelatihan>>(`/training/registrations?trainingSessionId=${peserta!.id}&limit=200`)).data.data, enabled: Boolean(peserta) });
  const departemen = useQuery({ queryKey: ["departemen", "semua"], queryFn: async () => (await api.get<Halaman<Departemen>>("/departments?limit=100")).data.data, enabled: tab === "kepatuhan" });
  const kepatuhan = useQuery({ queryKey: ["kepatuhan-pelatihan", deptKepatuhan], queryFn: async () => (await api.get<KepatuhanPelatihan>(`/training/compliance?warningDays=30${deptKepatuhan ? `&departmentId=${deptKepatuhan}` : ""}`)).data, enabled: hr && tab === "kepatuhan" });

  const segarkan = () => { qc.invalidateQueries({ queryKey: ["sesi-pelatihan"] }); qc.invalidateQueries({ queryKey: ["pendaftaran-pelatihan"] }); qc.invalidateQueries({ queryKey: ["kepatuhan-pelatihan"] }); };
  const pendaftaranUntuk = (sesiId: string) => (pendaftaranSaya.data ?? []).find((p) => p.trainingSessionId === sesiId && p.status !== "cancelled");

  const daftar = useMutation({
    mutationFn: async (s: SesiPelatihan) => (await api.post<PendaftaranPelatihan>(`/training/sessions/${s.id}/register`, {})).data,
    onSuccess: (p, s) => { segarkan(); notifikasi.sukses(p.status === "waitlisted" ? "Masuk daftar tunggu" : "Terdaftar", `${s.title} · ${formatTanggal(s.startDateTime, "EEE, d MMM HH:mm")}`); },
    onError: (e) => notifikasi.galat(e, "Pendaftaran gagal"),
  });
  const batalkan = useMutation({
    mutationFn: async (p: PendaftaranPelatihan) => api.patch(`/training/registrations/${p.id}/cancel`, {}),
    onSuccess: (_, p) => { segarkan(); notifikasi.sukses("Pendaftaran dibatalkan", p.trainingSession.title); setBatal(null); },
    onError: (e) => notifikasi.galat(e),
  });
  const ubahStatusSesi = useMutation({
    mutationFn: async ({ s, status }: { s: SesiPelatihan; status: "ongoing" | "completed" | "cancelled" }) => (await api.patch<SesiPelatihan>(`/training/sessions/${s.id}/status`, { status })).data,
    onSuccess: (s) => { segarkan(); notifikasi.sukses(`Sesi ${labelStatus(s.status).toLowerCase()}`, s.title); },
    onError: (e) => notifikasi.galat(e),
  });
  const simpanKehadiran = useMutation({
    mutationFn: async () => (await api.post(`/training/sessions/${peserta!.id}/attendance`, { entries: (pesertaSesi.data ?? []).filter((p) => p.status !== "cancelled").map((p) => ({ registrationId: p.id, attended: hadir[p.id] ?? (p.status === "attended" || p.status === "completed") })) })).data,
    onSuccess: () => { segarkan(); qc.invalidateQueries({ queryKey: ["pendaftaran-pelatihan", "sesi", peserta?.id] }); notifikasi.sukses("Kehadiran tersimpan", "Yang hadir kini bisa dievaluasi."); },
    onError: (e) => notifikasi.galat(e, "Kehadiran gagal disimpan"),
  });
  const fe = useForm<FormEvaluasi>({ defaultValues: { score: "", certificateUrl: "", note: "" } });
  const nilai = useMutation({
    mutationFn: async (v: FormEvaluasi) => (await api.post<PendaftaranPelatihan>(`/training/registrations/${evaluasi!.id}/evaluate`, { ...(v.score ? { score: Number(v.score) } : {}), ...(v.certificateUrl ? { certificateUrl: v.certificateUrl } : {}), ...(v.note ? { note: v.note } : {}) })).data,
    onSuccess: (p) => { segarkan(); qc.invalidateQueries({ queryKey: ["pendaftaran-pelatihan", "sesi", peserta?.id] }); notifikasi.sukses(p.passed ? "Lulus" : p.passed === false ? "Tidak lulus" : "Evaluasi tersimpan", `${p.employee.name}${p.expiresAt ? ` · berlaku s/d ${formatTanggal(p.expiresAt)}` : ""}`); setEvaluasi(null); fe.reset(); },
    onError: (e) => notifikasi.galat(e, "Evaluasi gagal disimpan"),
  });

  const kolomDaftar: Kolom<PendaftaranPelatihan>[] = [
    { key: "k", header: "Karyawan", primary: true, cell: (p) => <div><p className="font-medium">{p.employee.name}</p><p className="text-xs text-muted">{p.trainingSession.program.name} · {p.trainingSession.title}</p></div> },
    { key: "t", header: "Sesi", cell: (p) => formatTanggal(p.trainingSession.startDateTime, "d MMM yyyy") },
    { key: "s", header: "Status", cell: (p) => <Badge tone={nadaStatus(p.status)} dot>{labelStatus(p.status)}</Badge> },
    { key: "n", header: "Nilai", cell: (p) => p.evaluationScore !== null ? <span className="tabular-nums">{p.evaluationScore}</span> : <span className="text-muted">—</span> },
    { key: "b", header: "Berlaku s/d", cell: (p) => p.expiresAt ? formatTanggal(p.expiresAt) : <span className="text-muted">—</span> },
  ];

  const TABS: { id: Tab; label: string; hrSaja?: boolean }[] = [{ id: "jadwal", label: "Jadwal" }, { id: "program", label: "Program" }, { id: "pendaftaran", label: hr ? "Semua Pendaftaran" : "Riwayat Saya" }, { id: "kepatuhan", label: "Kepatuhan", hrSaja: true }];

  return (
    <>
      <PageHeader title="Pelatihan" description={hr ? "Program, jadwal sesi, kehadiran, evaluasi, dan kepatuhan pelatihan wajib" : "Jadwal pelatihan dan riwayat Anda"}
        actions={hr && (tab === "program" ? <Button onClick={() => setFormProgram({ open: true, item: null })}><Plus className="h-4 w-4" aria-hidden /> Program</Button> : tab === "jadwal" ? <Button onClick={() => setFormSesi(true)}><CalendarPlus className="h-4 w-4" aria-hidden /> Jadwalkan Sesi</Button> : null)} />

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1 w-fit max-w-full" role="tablist">
        {TABS.filter((t) => !t.hrSaja || hr).map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors", tab === t.id ? "bg-surface shadow-sm" : "text-muted hover:text-foreground")}>{t.label}</button>)}
      </div>

      {tab === "jadwal" && (
        <>
          <div className="w-52"><Select value={statusSesi} onChange={(e) => { setStatusSesi(e.target.value); setPageSesi(1); }} aria-label="Status sesi"><option value="">Semua sesi</option>{["scheduled", "ongoing", "completed", "cancelled"].map((s) => <option key={s} value={s}>{labelStatus(s)}</option>)}</Select></div>
          {sesi.isLoading ? <SkeletonBaris /> : !sesi.data?.data.length ? (
            <Card><EmptyState icon={GraduationCap} title="Tidak ada sesi" description={hr ? "Jadwalkan sesi dari program yang ada." : "Belum ada jadwal pelatihan."} /></Card>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {sesi.data.data.map((s) => {
                  const p = pendaftaranUntuk(s.id);
                  const penuh = s.maxParticipants !== null && s.registrationCount >= s.maxParticipants;
                  const lewatBatas = s.registrationDeadline ? new Date(s.registrationDeadline) < new Date() : false;
                  return (
                    <Card key={s.id} className="flex flex-col animate-fade-up">
                      <CardHeader>
                        <div className="flex items-start justify-between gap-2"><CardTitle className="min-w-0 truncate">{s.title}</CardTitle><Badge tone={nadaStatus(s.status)} dot className="shrink-0">{labelStatus(s.status)}</Badge></div>
                        <CardDescription>{s.program.name}{s.program.isMandatory && <span className="text-warning"> · wajib</span>}</CardDescription>
                        <p className="text-xs text-muted">{formatTanggal(s.startDateTime, "EEE, d MMM yyyy HH:mm")} – {formatTanggal(s.endDateTime, "HH:mm")} · {s.trainer}{s.location ? ` · ${s.location}` : ""}</p>
                        <p className="text-xs text-muted">{s.registrationCount}{s.maxParticipants ? `/${s.maxParticipants}` : ""} peserta{s.cost ? ` · ${formatRupiah(s.cost)}` : ""}{s.registrationDeadline ? ` · daftar s/d ${formatTanggal(s.registrationDeadline, "d MMM")}` : ""}</p>
                      </CardHeader>
                      <CardContent className="mt-auto flex flex-wrap gap-2">
                        {p ? (
                          <><Badge tone={nadaStatus(p.status)} dot>{labelStatus(p.status)}</Badge>{(p.status === "registered" || p.status === "waitlisted") && s.status === "scheduled" && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setBatal(p)}>Batalkan</Button>}</>
                        ) : s.status === "scheduled" && !lewatBatas ? (
                          <Button size="sm" onClick={() => daftar.mutate(s)} loading={daftar.isPending && daftar.variables?.id === s.id}>{penuh ? "Daftar Tunggu" : "Daftar"}</Button>
                        ) : null}
                        {hr && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => { setPeserta(s); setHadir({}); }}><Users className="h-4 w-4" aria-hidden /> Peserta</Button>
                            {s.status === "scheduled" && <Button size="sm" variant="ghost" onClick={() => ubahStatusSesi.mutate({ s, status: "ongoing" })}>Mulai</Button>}
                            {s.status === "ongoing" && <Button size="sm" variant="ghost" onClick={() => ubahStatusSesi.mutate({ s, status: "completed" })}>Selesai</Button>}
                            {s.status !== "completed" && s.status !== "cancelled" && <Button size="sm" variant="ghost" className="text-danger" onClick={() => ubahStatusSesi.mutate({ s, status: "cancelled" })}>Batalkan</Button>}
                          </>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
              <Card><Pagination pagination={sesi.data.pagination} onPage={setPageSesi} /></Card>
            </>
          )}
        </>
      )}

      {tab === "program" && (
        program.isLoading ? <SkeletonBaris /> : !program.data?.length ? (
          <Card><EmptyState icon={GraduationCap} title="Belum ada program" description="Contoh: Hygiene & Sanitasi, SOP Pelayanan Tamu, Keselamatan Kerja." action={hr && <Button onClick={() => setFormProgram({ open: true, item: null })}>Buat Program</Button>} /></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {program.data.map((p) => (
              <Card key={p.id} className={cn("animate-fade-up", !p.isActive && "opacity-60")}>
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{p.name} <span className="font-mono text-xs font-normal text-muted">{p.code}</span></CardTitle>
                    <CardDescription className="line-clamp-2">{p.description ?? p.category ?? "—"}</CardDescription>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      {p.isMandatory && <Badge tone="warning">Wajib</Badge>}
                      {p.category && <Badge tone="neutral">{p.category}</Badge>}
                      {p.validityMonths && <Badge tone="info">berlaku {p.validityMonths} bln</Badge>}
                      {p.passingScore !== null && <Badge tone="neutral">lulus ≥ {p.passingScore}</Badge>}
                      {!p.isActive && <Badge tone="danger">Nonaktif</Badge>}
                    </div>
                  </div>
                  {hr && <Button variant="ghost" size="icon" onClick={() => setFormProgram({ open: true, item: p })} aria-label={`Sunting ${p.name}`}><Pencil className="h-4 w-4" aria-hidden /></Button>}
                </CardHeader>
              </Card>
            ))}
          </div>
        )
      )}

      {tab === "pendaftaran" && (
        <Card>
          {hr ? (
            pendaftaranSemua.isLoading ? <SkeletonBaris /> : !pendaftaranSemua.data?.data.length ? <EmptyState icon={ClipboardCheck} title="Belum ada pendaftaran" /> : (
              <><ResponsiveTable columns={kolomDaftar} rows={pendaftaranSemua.data.data} rowKey={(p) => p.id} /><Pagination pagination={pendaftaranSemua.data.pagination} onPage={setPageDaftar} /></>
            )
          ) : (
            pendaftaranSaya.isLoading ? <SkeletonBaris /> : !pendaftaranSaya.data?.length ? <EmptyState icon={ClipboardCheck} title="Belum ada riwayat" description="Pelatihan yang Anda ikuti akan tercatat di sini beserta sertifikatnya." /> : (
              <ul className="divide-y divide-border">
                {pendaftaranSaya.data.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 p-4">
                    <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-lg", p.passed ? "bg-success-soft text-success" : "bg-surface-2 text-muted")}>{p.passed ? <Award className="h-5 w-5" aria-hidden /> : <GraduationCap className="h-5 w-5" aria-hidden />}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{p.trainingSession.program.name}</p>
                      <p className="text-xs text-muted">{p.trainingSession.title} · {formatTanggal(p.trainingSession.startDateTime)}{p.evaluationScore !== null ? ` · nilai ${p.evaluationScore}` : ""}{p.expiresAt ? ` · berlaku s/d ${formatTanggal(p.expiresAt)}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-2"><Badge tone={nadaStatus(p.status)} dot>{labelStatus(p.status)}</Badge>{p.certificateUrl && <a href={p.certificateUrl} target="_blank" rel="noreferrer" className="text-primary" aria-label="Sertifikat"><ExternalLink className="h-4 w-4" aria-hidden /></a>}</div>
                  </li>
                ))}
              </ul>
            )
          )}
        </Card>
      )}

      {tab === "kepatuhan" && hr && (
        <>
          <div className="w-56"><Select value={deptKepatuhan} onChange={(e) => setDeptKepatuhan(e.target.value)} aria-label="Departemen"><option value="">Semua departemen</option>{(departemen.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
          {kepatuhan.isLoading ? <SkeletonBaris /> : !kepatuhan.data?.programs.length ? (
            <Card><EmptyState icon={ShieldCheck} title="Tidak ada program wajib" description="Tandai program sebagai wajib agar kepatuhannya dipantau." /></Card>
          ) : kepatuhan.data.programs.map((k) => (
            <Card key={k.program.id}>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div><CardTitle>{k.program.name}</CardTitle><CardDescription>Wajib bagi {k.requiredFor} karyawan · peringatan {kepatuhan.data!.warningDays} hari sebelum kedaluwarsa</CardDescription></div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="success">{k.summary.compliant} terpenuhi</Badge>
                  {k.summary.expiringSoon > 0 && <Badge tone="warning">{k.summary.expiringSoon} segera</Badge>}
                  {k.summary.expired > 0 && <Badge tone="danger">{k.summary.expired} kedaluwarsa</Badge>}
                  {k.summary.neverCompleted > 0 && <Badge tone="danger">{k.summary.neverCompleted} belum pernah</Badge>}
                </div>
              </CardHeader>
              {k.needsAction.length > 0 && (
                <CardContent className="p-0 sm:p-0">
                  {/* Hanya yang bermasalah yang dirinci — itulah yang harus dikerjakan. */}
                  <ul className="divide-y divide-border border-t border-border">
                    {k.needsAction.map((b) => (
                      <li key={b.employee.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                        <span>{b.employee.name} <span className="text-xs text-muted">{b.employee.nik}</span></span>
                        <div className="flex items-center gap-2">{b.validUntil && <span className="text-xs text-muted">s/d {formatTanggal(b.validUntil)}</span>}<Badge tone={nadaStatus(b.state)} dot>{labelStatus(b.state)}</Badge></div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              )}
            </Card>
          ))}
        </>
      )}

      <FormProgram open={formProgram.open} onClose={() => setFormProgram({ open: false, item: null })} program={formProgram.item} />
      <FormSesi open={formSesi} onClose={() => setFormSesi(false)} programs={(program.data ?? []).filter((p) => p.isActive)} />

      <Modal open={Boolean(peserta)} onClose={() => setPeserta(null)} size="lg" title={`Peserta: ${peserta?.title ?? ""}`} description={peserta ? `${formatTanggal(peserta.startDateTime, "EEE, d MMM yyyy HH:mm")} · ${labelStatus(peserta.status)}` : undefined}
        footer={peserta && peserta.status !== "cancelled" && <><Button variant="outline" onClick={() => setPeserta(null)}>Tutup</Button><Button onClick={() => simpanKehadiran.mutate()} loading={simpanKehadiran.isPending} disabled={!pesertaSesi.data?.length}>Simpan Kehadiran</Button></>}>
        {pesertaSesi.isLoading ? <SkeletonBaris /> : !pesertaSesi.data?.length ? <p className="text-sm text-muted">Belum ada yang mendaftar.</p> : (
          <div className="space-y-3">
            {peserta?.status === "scheduled" && <Alert tone="info" title="Kehadiran bisa dicatat setelah sesi dimulai atau selesai" />}
            <ul className="divide-y divide-border rounded-xl border border-border">
              {pesertaSesi.data.filter((p) => p.status !== "cancelled").map((p) => {
                const sudahHadir = p.status === "attended" || p.status === "completed" || p.status === "failed";
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                    <label className="flex flex-1 items-center gap-3 min-w-0"><input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={hadir[p.id] ?? sudahHadir} onChange={(e) => setHadir((h) => ({ ...h, [p.id]: e.target.checked }))} /><span className="min-w-0"><span className="font-medium">{p.employee.name}</span> <span className="text-xs text-muted">{p.employee.nik}</span></span></label>
                    <Badge tone={nadaStatus(p.status)} dot>{labelStatus(p.status)}</Badge>
                    {p.evaluationScore !== null && <span className="tabular-nums text-xs">{p.evaluationScore}</span>}
                    {sudahHadir && <Button size="sm" variant="outline" onClick={() => { setEvaluasi(p); fe.reset({ score: p.evaluationScore?.toString() ?? "", certificateUrl: p.certificateUrl ?? "", note: "" }); }}><ClipboardCheck className="h-4 w-4" aria-hidden /> Nilai</Button>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(evaluasi)} onClose={() => setEvaluasi(null)} title="Evaluasi Peserta" description={evaluasi ? `${evaluasi.employee.name} · ${evaluasi.trainingSession.program.name}` : undefined}
        footer={<><Button variant="outline" onClick={() => setEvaluasi(null)}>Batal</Button><Button form="form-evaluasi" type="submit" loading={nilai.isPending}>Simpan</Button></>}>
        <form id="form-evaluasi" onSubmit={fe.handleSubmit((v) => nilai.mutate(v))} className="space-y-4" noValidate>
          <Field label="Nilai (0–100)" hint={peserta?.program.passingScore !== null && peserta?.program.passingScore !== undefined ? `Lulus bila ≥ ${peserta.program.passingScore}` : "Program ini tanpa ambang kelulusan"}><Input type="number" min={0} max={100} step="0.5" {...fe.register("score")} /></Field>
          <Field label="Tautan sertifikat"><Input placeholder="https://…" {...fe.register("certificateUrl")} /></Field>
          <Field label="Catatan"><Textarea rows={2} {...fe.register("note")} /></Field>
        </form>
      </Modal>

      <ConfirmDialog open={Boolean(batal)} onClose={() => setBatal(null)} onConfirm={() => batal && batalkan.mutate(batal)} loading={batalkan.isPending} danger title="Batalkan pendaftaran?" description={`${batal?.trainingSession.title ?? ""} — kursi Anda diberikan ke peserta daftar tunggu.`} confirmLabel="Batalkan" />
    </>
  );
}
