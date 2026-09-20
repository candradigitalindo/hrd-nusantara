"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { Award, Plus, BookOpen, ListChecks, BadgeCheck, ShieldCheck, AlertTriangle, Clock, Ban, ExternalLink, Trash2, FilePlus2 } from "lucide-react";
import { api } from "@/lib/api";
import { useSesi, bolehHr } from "@/hooks/use-sesi";
import { notifikasi } from "@/hooks/use-notifikasi";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { StatCard } from "@/components/ui/stat-card";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { PanelKesenjangan } from "@/components/kompetensi/panel-kesenjangan";
import { FormSertifikat } from "@/components/kompetensi/form-sertifikat";
import { formatTanggal, labelStatus, labelTingkat, cn } from "@/lib/utils";
import type { Halaman, Karyawan, Jabatan, Departemen, Kompetensi, StandarKompetensi, BarisLaporanKesenjangan, JenisSertifikasi, Sertifikat, DaftarSertifikat, ProgramPelatihan, StatusSertifikat } from "@/lib/types";

type Tab = "kesenjangan" | "laporan" | "kamus" | "standar" | "sertifikat";
type FormKompetensi = { code: string; name: string; category: string; description: string; maxLevel: string; labels: Record<string, string> };
type FormStandar = { competencyId: string; requiredLevel: string; description: string };
type FormJenis = { code: string; name: string; description: string; issuingOrganization: string; validityMonths: string; isMandatory: boolean; targetPositionId: string; trainingProgramId: string };

const STATUS_SERTIFIKAT: { kode: StatusSertifikat; label: string; kunci: keyof DaftarSertifikat["summary"]; icon: typeof ShieldCheck; tone: "success" | "warning" | "danger" | "info" }[] = [
  { kode: "valid", label: "Berlaku", kunci: "valid", icon: ShieldCheck, tone: "success" },
  { kode: "expiring_soon", label: "Segera kedaluwarsa", kunci: "expiringSoon", icon: Clock, tone: "warning" },
  { kode: "expired", label: "Kedaluwarsa", kunci: "expired", icon: AlertTriangle, tone: "danger" },
  { kode: "revoked", label: "Dicabut", kunci: "revoked", icon: Ban, tone: "info" },
];

export default function HalamanKompetensi() {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const hr = bolehHr(saya?.role);
  const [tab, setTab] = React.useState<Tab>("kesenjangan");
  const [karyawanGap, setKaryawanGap] = React.useState("");
  const [filterDept, setFilterDept] = React.useState("");
  const [filterJabatan, setFilterJabatan] = React.useState("");
  const [jabatanStandar, setJabatanStandar] = React.useState("");
  const [hapusStandar, setHapusStandar] = React.useState<StandarKompetensi | null>(null);
  const [kompetensiBuka, setKompetensiBuka] = React.useState(false);
  const [jenisBuka, setJenisBuka] = React.useState(false);
  const [sertifikatBuka, setSertifikatBuka] = React.useState(false);
  const [cabut, setCabut] = React.useState<Sertifikat | null>(null);
  const [alasanCabut, setAlasanCabut] = React.useState("");
  const [fState, setFState] = React.useState("");
  const [fKaryawan, setFKaryawan] = React.useState("");
  const [fJenis, setFJenis] = React.useState("");

  const daftar = <T,>(d: Halaman<T> | T[]) => (Array.isArray(d) ? d : d.data);
  const karyawan = useQuery({ queryKey: ["karyawan", "pilihan"], queryFn: async () => (await api.get<Halaman<Karyawan>>("/employees?limit=100")).data.data, enabled: hr });
  const jabatan = useQuery({ queryKey: ["jabatan", "semua"], queryFn: async () => (await api.get<Halaman<Jabatan>>("/positions?limit=100")).data.data, enabled: hr });
  const departemen = useQuery({ queryKey: ["departemen", "semua"], queryFn: async () => (await api.get<Halaman<Departemen>>("/departments?limit=100")).data.data, enabled: hr && tab === "laporan" });
  const kompetensi = useQuery({ queryKey: ["kompetensi", "semua"], queryFn: async () => (await api.get<Halaman<Kompetensi>>("/competencies?limit=100")).data.data });
  const program = useQuery({ queryKey: ["program-pelatihan", "semua"], queryFn: async () => daftar((await api.get<Halaman<ProgramPelatihan> | ProgramPelatihan[]>("/training/programs?limit=100")).data), enabled: jenisBuka });
  const pl = new URLSearchParams(); if (filterDept) pl.set("departmentId", filterDept); if (filterJabatan) pl.set("positionId", filterJabatan);
  const laporan = useQuery({ queryKey: ["laporan-kesenjangan", pl.toString()], queryFn: async () => (await api.get<{ data: BarisLaporanKesenjangan[] }>(`/competency-gap?${pl}`)).data.data, enabled: hr && tab === "laporan" });
  const standar = useQuery({ queryKey: ["standar-jabatan", jabatanStandar], queryFn: async () => (await api.get<{ data: StandarKompetensi[] }>(`/positions/${jabatanStandar}/competency-standards`)).data.data, enabled: hr && tab === "standar" && Boolean(jabatanStandar) });
  const jenis = useQuery({ queryKey: ["jenis-sertifikasi"], queryFn: async () => (await api.get<Halaman<JenisSertifikasi>>("/certification-types?limit=100")).data.data, enabled: tab === "sertifikat" });
  const ps = new URLSearchParams({ limit: "100", warningDays: "30" }); if (fState) ps.set("state", fState); if (fKaryawan) ps.set("employeeId", fKaryawan); if (fJenis) ps.set("certificationTypeId", fJenis);
  const sertifikat = useQuery({ queryKey: ["sertifikat", ps.toString()], queryFn: async () => (await api.get<DaftarSertifikat>(`/certifications?${ps}`)).data, enabled: tab === "sertifikat" });

  const fk = useForm<FormKompetensi>({ defaultValues: { code: "", name: "", category: "", description: "", maxLevel: "4", labels: { "1": "Dasar", "2": "Menengah", "3": "Mahir", "4": "Ahli" } } });
  const maxLevelForm = Math.min(20, Math.max(1, Number(useWatch({ control: fk.control, name: "maxLevel" })) || 1));
  const fst = useForm<FormStandar>({ defaultValues: { competencyId: "", requiredLevel: "1", description: "" } });
  const idStandar = useWatch({ control: fst.control, name: "competencyId" });
  const kompetensiStandar = (kompetensi.data ?? []).find((k) => k.id === idStandar);
  const fj = useForm<FormJenis>({ defaultValues: { code: "", name: "", description: "", issuingOrganization: "", validityMonths: "", isMandatory: false, targetPositionId: "", trainingProgramId: "" } });

  const buatKompetensi = useMutation({
    mutationFn: async (v: FormKompetensi) => {
      const labels = Object.fromEntries(Object.entries(v.labels).filter(([n, l]) => Number(n) <= Number(v.maxLevel) && l.trim()).map(([n, l]) => [n, l.trim()]));
      return (await api.post<Kompetensi>("/competencies", { code: v.code.toUpperCase(), name: v.name, maxLevel: Number(v.maxLevel), ...(v.category ? { category: v.category } : {}), ...(v.description ? { description: v.description } : {}), ...(Object.keys(labels).length ? { levelLabels: labels } : {}) })).data;
    },
    onSuccess: (k) => { qc.invalidateQueries({ queryKey: ["kompetensi"] }); notifikasi.sukses("Kompetensi ditambahkan", `${k.name} · skala 1–${k.maxLevel}`); setKompetensiBuka(false); fk.reset(); },
    onError: (e) => notifikasi.galat(e, "Kompetensi gagal ditambahkan"),
  });
  const simpanStandar = useMutation({
    mutationFn: async (v: FormStandar) => (await api.put<StandarKompetensi>(`/positions/${jabatanStandar}/competency-standards`, { competencyId: v.competencyId, requiredLevel: Number(v.requiredLevel), ...(v.description ? { description: v.description } : {}) })).data,
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ["standar-jabatan"] }); qc.invalidateQueries({ queryKey: ["kesenjangan"] }); qc.invalidateQueries({ queryKey: ["laporan-kesenjangan"] }); notifikasi.sukses("Standar ditetapkan", `${s.competency.name} minimal tingkat ${s.requiredLevel}`); fst.reset(); },
    onError: (e) => notifikasi.galat(e, "Standar gagal disimpan"),
  });
  const buangStandar = useMutation({
    mutationFn: async (s: StandarKompetensi) => api.delete(`/competency-standards/${s.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["standar-jabatan"] }); qc.invalidateQueries({ queryKey: ["kesenjangan"] }); qc.invalidateQueries({ queryKey: ["laporan-kesenjangan"] }); notifikasi.sukses("Standar dihapus"); setHapusStandar(null); },
    onError: (e) => notifikasi.galat(e),
  });
  const buatJenis = useMutation({
    mutationFn: async (v: FormJenis) => (await api.post<JenisSertifikasi>("/certification-types", { code: v.code.toUpperCase(), name: v.name, isMandatory: v.isMandatory, validityMonths: v.validityMonths ? Number(v.validityMonths) : null, targetPositionId: v.targetPositionId || null, trainingProgramId: v.trainingProgramId || null, ...(v.description ? { description: v.description } : {}), ...(v.issuingOrganization ? { issuingOrganization: v.issuingOrganization } : {}) })).data,
    onSuccess: (j) => { qc.invalidateQueries({ queryKey: ["jenis-sertifikasi"] }); notifikasi.sukses("Jenis sertifikasi dibuat", j.validityMonths ? `${j.name} · berlaku ${j.validityMonths} bulan` : `${j.name} · tanpa kedaluwarsa`); setJenisBuka(false); fj.reset(); },
    onError: (e) => notifikasi.galat(e, "Jenis gagal dibuat"),
  });
  const cabutSertifikat = useMutation({
    mutationFn: async () => (await api.patch<Sertifikat>(`/certifications/${cabut!.id}/revoke`, { reason: alasanCabut })).data,
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ["sertifikat"] }); notifikasi.sukses("Sertifikat dicabut", s.certificationName); setCabut(null); setAlasanCabut(""); },
    onError: (e) => notifikasi.galat(e, "Pencabutan gagal"),
  });

  const namaJabatan = (id: string | null) => (jabatan.data ?? []).find((j) => j.id === id)?.name ?? "—";
  const TABS: { id: Tab; label: string; hrSaja?: boolean }[] = [{ id: "kesenjangan", label: hr ? "Kesenjangan" : "Kompetensi Saya" }, { id: "sertifikat", label: hr ? "Sertifikat" : "Sertifikat Saya" }, { id: "kamus", label: "Kamus Kompetensi" }, { id: "laporan", label: "Laporan Kesiapan", hrSaja: true }, { id: "standar", label: "Standar Jabatan", hrSaja: true }];
  const idGap = hr ? karyawanGap : (saya?.id ?? "");
  const kategori = [...new Set((kompetensi.data ?? []).map((k) => k.category ?? "Lainnya"))];

  return (
    <>
      <PageHeader title="Kompetensi & Sertifikasi" description={hr ? "Standar kompetensi per jabatan, kesenjangan tiap karyawan, dan masa berlaku sertifikat wajib" : "Syarat kompetensi jabatan Anda, tingkat yang sudah dinilai, dan sertifikat Anda"}
        actions={hr ? (tab === "kamus" ? <Button onClick={() => setKompetensiBuka(true)}><Plus className="h-4 w-4" aria-hidden /> Kompetensi</Button> : tab === "sertifikat" ? <div className="flex gap-2"><Button variant="outline" onClick={() => setJenisBuka(true)}><Plus className="h-4 w-4" aria-hidden /> Jenis</Button><Button onClick={() => setSertifikatBuka(true)}><FilePlus2 className="h-4 w-4" aria-hidden /> Catat Sertifikat</Button></div> : null) : null} />

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1 w-fit max-w-full" role="tablist">
        {TABS.filter((t) => !t.hrSaja || hr).map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors", tab === t.id ? "bg-surface shadow-sm" : "text-muted hover:text-foreground")}>{t.label}</button>)}
      </div>

      {tab === "kesenjangan" && (
        <>
          {hr && <div className="sm:w-80"><Select value={karyawanGap} onChange={(e) => setKaryawanGap(e.target.value)} aria-label="Karyawan"><option value="">— Pilih karyawan —</option>{(karyawan.data ?? []).map((k) => <option key={k.id} value={k.id}>{k.name} · {k.nik}</option>)}</Select></div>}
          {idGap ? <PanelKesenjangan employeeId={idGap} bolehNilai={hr} /> : <Card><EmptyState icon={Award} title="Pilih karyawan" description="Kesenjangan dibandingkan terhadap standar jabatan karyawan tersebut." /></Card>}
        </>
      )}

      {tab === "laporan" && hr && (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:w-2/3">
            <Select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} aria-label="Departemen"><option value="">Semua departemen</option>{(departemen.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
            <Select value={filterJabatan} onChange={(e) => setFilterJabatan(e.target.value)} aria-label="Jabatan"><option value="">Semua jabatan</option>{(jabatan.data ?? []).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</Select>
          </div>
          <Card>
            <CardHeader><CardTitle>Kesiapan kompetensi per karyawan</CardTitle><CardDescription>Diurutkan dari yang paling butuh pelatihan. Karyawan tanpa jabatan tidak ikut dihitung.</CardDescription></CardHeader>
            {laporan.isLoading ? <SkeletonBaris /> : !laporan.data?.length ? <EmptyState icon={ListChecks} title="Tidak ada data" description="Belum ada karyawan berjabatan pada filter ini, atau jabatannya belum punya standar." /> : (
              <ul className="divide-y divide-border">
                {[...laporan.data].sort((a, b) => a.readinessPercent - b.readinessPercent).map((b) => (
                  <li key={b.employee.id} className="p-4 space-y-2 animate-fade-up">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <button type="button" className="text-left font-medium hover:underline" onClick={() => { setKaryawanGap(b.employee.id); setTab("kesenjangan"); }}>{b.employee.name} <span className="text-xs font-normal text-muted">{b.employee.nik} · {namaJabatan(b.employee.positionId)}</span></button>
                      <span className={cn("text-sm font-semibold tabular-nums", b.readinessPercent >= 100 ? "text-success" : b.readinessPercent >= 50 ? "text-warning" : "text-danger")}>{b.readinessPercent}% <span className="text-xs font-normal text-muted">({b.totalMet}/{b.totalRequired})</span></span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-2" role="img" aria-label={`Kesiapan ${b.readinessPercent}%`}><div className={cn("h-2 rounded-full transition-[width]", b.readinessPercent >= 100 ? "bg-success" : b.readinessPercent >= 50 ? "bg-warning" : "bg-danger")} style={{ width: `${Math.min(100, b.readinessPercent)}%` }} /></div>
                    {b.unmetCompetencies.length > 0 && <div className="flex flex-wrap gap-1.5">{b.unmetCompetencies.map((u) => <Badge key={u.competencyId} tone={u.notAssessed ? "info" : "warning"}>{u.competencyName}{u.notAssessed ? " · belum dinilai" : ` · kurang ${u.gap}`}</Badge>)}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {tab === "kamus" && (
        kompetensi.isLoading ? <SkeletonBaris /> : !kompetensi.data?.length ? <Card><EmptyState icon={BookOpen} title="Kamus kompetensi masih kosong" description="Contoh: Food Safety, Table Service, Housekeeping Standard — masing-masing dengan skala tingkat." action={hr ? <Button onClick={() => setKompetensiBuka(true)}>Tambah Kompetensi</Button> : undefined} /></Card> : (
          <div className="space-y-5">
            {kategori.map((kat) => (
              <section key={kat}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{kat}</h2>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {(kompetensi.data ?? []).filter((k) => (k.category ?? "Lainnya") === kat).map((k) => (
                    <Card key={k.id} className="animate-fade-up">
                      <CardHeader><CardTitle>{k.name} <span className="font-mono text-xs font-normal text-muted">{k.code}</span></CardTitle>{k.description && <CardDescription>{k.description}</CardDescription>}</CardHeader>
                      <CardContent><ol className="flex flex-wrap gap-1.5 text-xs">{Array.from({ length: k.maxLevel }, (_, i) => i + 1).map((n) => <li key={n} className="rounded-md bg-surface-2 px-2 py-1 tabular-nums"><span className="font-semibold">{n}</span> {labelTingkat(n, k.levelLabels)}</li>)}</ol></CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )
      )}

      {tab === "standar" && hr && (
        <>
          <div className="sm:w-80"><Select value={jabatanStandar} onChange={(e) => { setJabatanStandar(e.target.value); fst.reset(); }} aria-label="Jabatan"><option value="">— Pilih jabatan —</option>{(jabatan.data ?? []).map((j) => <option key={j.id} value={j.id}>{j.name}{j.department ? ` · ${j.department.name}` : ""}</option>)}</Select></div>
          {!jabatanStandar ? <Card><EmptyState icon={ListChecks} title="Pilih jabatan" description="Tiap jabatan menyatakan satu tingkat minimal per kompetensi." /></Card> : (
            <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
              <Card>
                <CardHeader><CardTitle>Syarat {namaJabatan(jabatanStandar)}</CardTitle><CardDescription>Menetapkan kompetensi yang sama lagi akan memperbarui tingkatnya</CardDescription></CardHeader>
                {standar.isLoading ? <SkeletonBaris /> : !standar.data?.length ? <EmptyState icon={ListChecks} title="Belum ada syarat" description="Tambahkan dari panel di samping." /> : (
                  <ul className="divide-y divide-border">
                    {standar.data.map((s) => (
                      <li key={s.id} className="flex items-center gap-3 p-4">
                        <div className="min-w-0 flex-1"><p className="font-medium">{s.competency.name} <span className="font-mono text-xs font-normal text-muted">{s.competency.code}</span></p><p className="text-xs text-muted">minimal tingkat {s.requiredLevel} dari {s.competency.maxLevel}{s.description ? ` · ${s.description}` : ""}</p></div>
                        <Button size="icon" variant="ghost" className="text-danger" aria-label="Hapus syarat" onClick={() => setHapusStandar(s)}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card>
                <CardHeader><CardTitle>Tetapkan syarat</CardTitle></CardHeader>
                <CardContent>
                  <form onSubmit={fst.handleSubmit((v) => simpanStandar.mutate(v))} className="space-y-3" noValidate>
                    <Field label="Kompetensi" error={fst.formState.errors.competencyId?.message}><Select {...fst.register("competencyId", { required: "Pilih kompetensi" })}><option value="">— Pilih —</option>{(kompetensi.data ?? []).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</Select></Field>
                    <Field label="Tingkat minimal"><Select {...fst.register("requiredLevel")}>{Array.from({ length: (kompetensiStandar?.maxLevel ?? 4) + 1 }, (_, n) => <option key={n} value={n}>{n} · {labelTingkat(n, kompetensiStandar?.levelLabels)}</option>)}</Select></Field>
                    <Field label="Keterangan"><Input {...fst.register("description")} placeholder="Wajib sebelum lepas probation" /></Field>
                    <Button type="submit" className="w-full" loading={simpanStandar.isPending}>Simpan Syarat</Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {tab === "sertifikat" && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {STATUS_SERTIFIKAT.map((s) => (
              <button key={s.kode} type="button" aria-pressed={fState === s.kode} onClick={() => setFState(fState === s.kode ? "" : s.kode)} className="rounded-2xl text-left ring-2 ring-transparent transition-shadow aria-pressed:ring-primary focus-visible:outline-none focus-visible:ring-ring">
                <StatCard label={s.label} value={sertifikat.data?.summary[s.kunci] ?? "—"} icon={s.icon} tone={s.tone} />
              </button>
            ))}
          </div>
          {hr && (
            <div className="grid gap-2 sm:grid-cols-2 lg:w-2/3">
              <Select value={fKaryawan} onChange={(e) => setFKaryawan(e.target.value)} aria-label="Karyawan"><option value="">Semua karyawan</option>{(karyawan.data ?? []).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</Select>
              <Select value={fJenis} onChange={(e) => setFJenis(e.target.value)} aria-label="Jenis"><option value="">Semua jenis</option>{(jenis.data ?? []).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</Select>
            </div>
          )}
          <Card>
            {sertifikat.isLoading ? <SkeletonBaris /> : !sertifikat.data?.data.length ? <EmptyState icon={BadgeCheck} title={fState ? `Tidak ada sertifikat ${labelStatus(fState).toLowerCase()}` : "Belum ada sertifikat"} description={hr ? "Catat sertifikat manual, atau tautkan jenis sertifikasi ke program pelatihan agar terbit otomatis saat lulus." : "Sertifikat yang dicatat HR untuk Anda akan tampil di sini."} /> : (
              <ul className="divide-y divide-border">
                {sertifikat.data.data.map((s) => (
                  <li key={s.id} className="flex items-start gap-3 p-4 animate-fade-up">
                    <span className={cn("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg", s.state === "valid" ? "bg-success-soft text-success" : s.state === "expiring_soon" ? "bg-warning-soft text-warning" : s.state === "expired" ? "bg-danger-soft text-danger" : "bg-surface-2 text-muted")} aria-hidden><BadgeCheck className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><p className="font-medium">{s.certificationName}</p><Badge tone={nadaStatus(s.state)} dot>{labelStatus(s.state)}</Badge></div>
                      <p className="text-xs text-muted">{s.issuingOrganization}{hr ? ` · ${s.employee.name}` : ""} · terbit {formatTanggal(s.issueDate)} · {s.expiryDate ? `berlaku sampai ${formatTanggal(s.expiryDate)}` : "tanpa kedaluwarsa"}{s.trainingRegistrationId ? " · dari pelatihan" : ""}</p>
                      {s.revokedAt && <p className="mt-1 text-xs text-danger">Dicabut {formatTanggal(s.revokedAt)}: {s.revokedReason}</p>}
                      {s.note && <p className="mt-1 text-xs text-muted">{s.note}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {s.certificateUrl && <a href={s.certificateUrl} target="_blank" rel="noopener noreferrer" aria-label="Buka berkas sertifikat" className="grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-foreground"><ExternalLink className="h-4 w-4" aria-hidden /></a>}
                      {hr && !s.revokedAt && <Button size="sm" variant="ghost" className="text-danger" onClick={() => { setCabut(s); setAlasanCabut(""); }}>Cabut</Button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader><CardTitle>Jenis sertifikasi resmi</CardTitle><CardDescription>Wajib untuk jabatan tertentu dan masa berlakunya; yang tertaut ke program pelatihan terbit otomatis saat peserta lulus</CardDescription></CardHeader>
            {jenis.isLoading ? <SkeletonBaris jumlah={2} /> : !jenis.data?.length ? <EmptyState icon={BadgeCheck} title="Belum ada jenis" description="Contoh: Food Handler Certificate (24 bulan), First Aid (36 bulan)." action={hr ? <Button onClick={() => setJenisBuka(true)}>Buat Jenis</Button> : undefined} /> : (
              <ul className="divide-y divide-border">
                {jenis.data.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4">
                    <div className="min-w-0 flex-1"><p className="font-medium">{j.name} <span className="font-mono text-xs font-normal text-muted">{j.code}</span></p><p className="text-xs text-muted">{j.issuingOrganization ?? "penerbit bebas"} · {j.validityMonths ? `berlaku ${j.validityMonths} bulan` : "tanpa kedaluwarsa"}{j.targetPositionId && hr ? ` · untuk ${namaJabatan(j.targetPositionId)}` : ""}{j.trainingProgramId ? " · terbit dari pelatihan" : ""}</p></div>
                    {j.isMandatory && <Badge tone="danger">Wajib</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      <Modal open={kompetensiBuka} onClose={() => setKompetensiBuka(false)} size="lg" title="Kompetensi Baru" description="Skala tingkat dipakai untuk membandingkan syarat jabatan dengan kemampuan karyawan"
        footer={<><Button variant="outline" onClick={() => setKompetensiBuka(false)}>Batal</Button><Button form="form-kompetensi" type="submit" loading={buatKompetensi.isPending}>Simpan</Button></>}>
        <form id="form-kompetensi" onSubmit={fk.handleSubmit((v) => buatKompetensi.mutate(v))} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kode" error={fk.formState.errors.code?.message}><Input className="font-mono uppercase" {...fk.register("code", { required: "Wajib diisi", pattern: { value: /^[A-Za-z0-9_]{2,40}$/, message: "Huruf, angka, garis bawah (2–40)" } })} placeholder="FOOD_SAFETY" /></Field>
            <Field label="Nama" error={fk.formState.errors.name?.message}><Input {...fk.register("name", { required: "Wajib diisi" })} placeholder="Food Safety" /></Field>
            <Field label="Kategori"><Input {...fk.register("category")} placeholder="Teknis / Perilaku" list="kategori-kompetensi" /><datalist id="kategori-kompetensi">{kategori.map((k) => <option key={k} value={k} />)}</datalist></Field>
            <Field label="Tingkat tertinggi (1–20)"><Input type="number" min={1} max={20} {...fk.register("maxLevel")} /></Field>
            <Field label="Deskripsi" className="sm:col-span-2"><Textarea rows={2} {...fk.register("description")} /></Field>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Label tiap tingkat (opsional)</legend>
            <div className="grid gap-2 sm:grid-cols-2">{Array.from({ length: maxLevelForm }, (_, i) => i + 1).map((n) => <Input key={n} {...fk.register(`labels.${n}`)} placeholder={`Tingkat ${n}`} aria-label={`Label tingkat ${n}`} />)}</div>
          </fieldset>
        </form>
      </Modal>

      <Modal open={jenisBuka} onClose={() => setJenisBuka(false)} size="lg" title="Jenis Sertifikasi Baru" description="Sertifikat resmi yang masa berlakunya dipantau, misalnya Food Handler atau First Aid"
        footer={<><Button variant="outline" onClick={() => setJenisBuka(false)}>Batal</Button><Button form="form-jenis" type="submit" loading={buatJenis.isPending}>Simpan</Button></>}>
        <form id="form-jenis" onSubmit={fj.handleSubmit((v) => buatJenis.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Kode" error={fj.formState.errors.code?.message}><Input className="font-mono uppercase" {...fj.register("code", { required: "Wajib diisi", pattern: { value: /^[A-Za-z0-9_]{2,40}$/, message: "Huruf, angka, garis bawah (2–40)" } })} placeholder="FOOD_HANDLER" /></Field>
          <Field label="Nama" error={fj.formState.errors.name?.message}><Input {...fj.register("name", { required: "Wajib diisi" })} placeholder="Food Handler Certificate" /></Field>
          <Field label="Penerbit"><Input {...fj.register("issuingOrganization")} placeholder="Dinas Kesehatan" /></Field>
          <Field label="Masa berlaku (bulan)" hint="kosongkan bila tidak kedaluwarsa"><Input type="number" min={1} max={600} {...fj.register("validityMonths")} placeholder="24" /></Field>
          <Field label="Untuk jabatan"><Select {...fj.register("targetPositionId")}><option value="">Semua jabatan</option>{(jabatan.data ?? []).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</Select></Field>
          <Field label="Terbit otomatis dari program pelatihan"><Select {...fj.register("trainingProgramId")}><option value="">Tidak tertaut</option>{(program.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Deskripsi" className="sm:col-span-2"><Textarea rows={2} {...fj.register("description")} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" {...fj.register("isMandatory")} className="h-4 w-4 accent-[var(--color-primary)]" /> Wajib dimiliki — muncul di laporan kepatuhan</label>
        </form>
      </Modal>

      {sertifikatBuka && <FormSertifikat onClose={() => setSertifikatBuka(false)} karyawan={karyawan.data ?? []} jenis={jenis.data ?? []} employeeIdAwal={fKaryawan || undefined} />}

      <Modal open={Boolean(cabut)} onClose={() => setCabut(null)} title="Cabut Sertifikat" description={cabut ? `${cabut.certificationName} · ${cabut.employee.name}` : undefined}
        footer={<><Button variant="outline" onClick={() => setCabut(null)}>Batal</Button><Button variant="danger" onClick={() => cabutSertifikat.mutate()} loading={cabutSertifikat.isPending} disabled={alasanCabut.trim().length < 3}>Cabut</Button></>}>
        <Field label="Alasan pencabutan"><Textarea rows={3} value={alasanCabut} onChange={(e) => setAlasanCabut(e.target.value)} placeholder="Sertifikat terbukti tidak sah / dikembalikan oleh penerbit" /></Field>
        <p className="mt-2 text-xs text-muted">Pencabutan tidak bisa dibatalkan. Sertifikat tetap tercatat dengan status dicabut.</p>
      </Modal>

      <Modal open={Boolean(hapusStandar)} onClose={() => setHapusStandar(null)} title="Hapus syarat kompetensi?" description={hapusStandar ? `${hapusStandar.competency.name} tidak lagi disyaratkan untuk ${namaJabatan(jabatanStandar)}.` : undefined}
        footer={<><Button variant="outline" onClick={() => setHapusStandar(null)}>Batal</Button><Button variant="danger" onClick={() => hapusStandar && buangStandar.mutate(hapusStandar)} loading={buangStandar.isPending}>Hapus</Button></>} />
    </>
  );
}
