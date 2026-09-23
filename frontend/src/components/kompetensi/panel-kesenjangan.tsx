"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { Award, CheckCircle2, AlertTriangle, HelpCircle, ClipboardCheck, Save, X } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { StatCard } from "@/components/ui/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { labelTingkat, cn } from "@/lib/utils";
import type { Halaman, AnalisisKesenjangan, ButirKesenjangan, Kompetensi, PenilaianKompetensi } from "@/lib/types";

const pesanGalat = (e: unknown) => (e as { response?: { data?: { error?: string } } })?.response?.data?.error;

/** Batang bertingkat: terisi = tingkat saat ini, bergaris kuning = masih disyaratkan. */
export const BarTingkat = ({ max, current, required, meets }: { max: number; current: number | null; required: number; meets: boolean }) => (
  <div className="flex gap-1" role="img" aria-label={`Tingkat ${current ?? 0} dari ${max}, disyaratkan ${required}`}>
    {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
      <span key={n} className={cn("h-2 flex-1 rounded-full", n <= (current ?? 0) ? (meets ? "bg-success" : "bg-primary") : n <= required ? "bg-warning-soft ring-1 ring-inset ring-warning" : "bg-surface-2")} />
    ))}
  </div>
);

type NilaiForm = { competencyId: string; currentLevel: string; note: string; evidenceUrl: string };

const FormNilai = ({ employeeId, awal, kompetensi, onClose }: { employeeId: string; awal: ButirKesenjangan | null; kompetensi: Kompetensi[]; onClose: () => void }) => {
  const qc = useQueryClient();
  const f = useForm<NilaiForm>({ defaultValues: { competencyId: awal?.competencyId ?? "", currentLevel: String(awal?.currentLevel ?? 0), note: "", evidenceUrl: "" } });
  const pilihan = useWatch({ control: f.control, name: "competencyId" });
  const terpilih = kompetensi.find((k) => k.id === pilihan);
  const simpan = useMutation({
    mutationFn: async (v: NilaiForm) => (await api.put<PenilaianKompetensi>(`/employees/${employeeId}/competencies`, { competencyId: v.competencyId, currentLevel: Number(v.currentLevel), ...(v.note ? { note: v.note } : {}), ...(v.evidenceUrl ? { evidenceUrl: v.evidenceUrl } : {}) })).data,
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ["kesenjangan"] }); qc.invalidateQueries({ queryKey: ["laporan-kesenjangan"] }); notifikasi.sukses("Kompetensi dinilai", `${p.competency.name}: ${labelTingkat(p.currentLevel, terpilih?.levelLabels)}`); onClose(); },
    onError: (e) => notifikasi.galat(e, "Penilaian gagal disimpan"),
  });
  return (
    <Modal open onClose={onClose} title="Nilai Kompetensi" description="Tingkat yang dinilai menggantikan penilaian sebelumnya untuk kompetensi yang sama"
      footer={<><Button variant="outline" onClick={onClose}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button form="form-nilai" type="submit" loading={simpan.isPending}>{!simpan.isPending && <Save className="h-4 w-4" aria-hidden />} Simpan</Button></>}>
      <form id="form-nilai" onSubmit={f.handleSubmit((v) => simpan.mutate(v))} className="space-y-4" noValidate>
        <Field label="Kompetensi" error={f.formState.errors.competencyId?.message}><Select {...f.register("competencyId", { required: "Pilih kompetensi" })}><option value="">— Pilih —</option>{kompetensi.map((k) => <option key={k.id} value={k.id}>{k.name}{k.category ? ` · ${k.category}` : ""}</option>)}</Select></Field>
        <Field label={`Tingkat saat ini${terpilih ? ` (0–${terpilih.maxLevel})` : ""}`}><Select {...f.register("currentLevel")}>{Array.from({ length: (terpilih?.maxLevel ?? 4) + 1 }, (_, n) => <option key={n} value={n}>{n} · {labelTingkat(n, terpilih?.levelLabels)}</option>)}</Select></Field>
        <Field label="Bukti (tautan, opsional)" error={f.formState.errors.evidenceUrl?.message}><Input type="url" placeholder="https://…" {...f.register("evidenceUrl", { pattern: { value: /^https?:\/\/.+/, message: "Harus berupa URL" } })} /></Field>
        <Field label="Catatan"><Textarea rows={2} {...f.register("note")} placeholder="Diamati saat shift malam 12 Sep: plating konsisten" /></Field>
      </form>
    </Modal>
  );
};

/** Kesenjangan kompetensi seorang karyawan terhadap syarat jabatannya. */
export const PanelKesenjangan = ({ employeeId, bolehNilai }: { employeeId: string; bolehNilai: boolean }) => {
  const [nilai, setNilai] = React.useState<{ awal: ButirKesenjangan | null } | null>(null);
  const gap = useQuery({ queryKey: ["kesenjangan", employeeId], queryFn: async () => (await api.get<AnalisisKesenjangan>(`/employees/${employeeId}/competency-gap`)).data, retry: false });
  const kompetensi = useQuery({ queryKey: ["kompetensi", "semua"], queryFn: async () => (await api.get<Halaman<Kompetensi>>("/competencies?limit=100")).data.data });
  const peta = new Map((kompetensi.data ?? []).map((k) => [k.id, k]));

  if (gap.isLoading) return <Skeleton className="h-72" />;
  if (gap.isError) return <Alert tone="warning" title="Analisis belum bisa dibuat">{pesanGalat(gap.error) ?? "Data kesenjangan tidak tersedia."}</Alert>;
  const d = gap.data!;
  const belumDinilai = d.gaps.filter((g) => g.notAssessed).length;
  const kurang = d.totalRequired - d.totalMet;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Kesiapan jabatan" value={`${d.readinessPercent}%`} hint={`${d.totalMet} dari ${d.totalRequired} syarat terpenuhi`} icon={Award} tone={d.readinessPercent >= 100 ? "success" : d.readinessPercent >= 50 ? "warning" : "danger"} />
        <StatCard label="Belum terpenuhi" value={kurang} hint={kurang > 0 ? "bahan rencana pelatihan" : "semua syarat tercapai"} icon={AlertTriangle} tone={kurang > 0 ? "warning" : "success"} />
        <StatCard label="Belum dinilai" value={belumDinilai} hint="dihitung sebagai tingkat 0" icon={HelpCircle} tone="info" />
      </div>
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div><CardTitle>Syarat kompetensi jabatan</CardTitle><CardDescription>Batang terisi = tingkat saat ini · bergaris kuning = masih disyaratkan</CardDescription></div>
          {bolehNilai && <Button size="sm" onClick={() => setNilai({ awal: null })}><ClipboardCheck className="h-4 w-4" aria-hidden /> Nilai</Button>}
        </CardHeader>
        {d.gaps.length === 0 ? (
          <EmptyState icon={Award} title="Jabatan ini belum punya standar kompetensi" description="HR menetapkan syarat per jabatan di tab Standar Jabatan." />
        ) : (
          <ul className="divide-y divide-border">
            {d.gaps.map((g) => {
              const k = peta.get(g.competencyId);
              const max = k?.maxLevel ?? Math.max(g.requiredLevel, g.currentLevel ?? 0, 1);
              return (
                <li key={g.competencyId} className="flex items-center gap-3 p-4 animate-fade-up">
                  <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", g.meets ? "bg-success-soft text-success" : g.notAssessed ? "bg-info-soft text-info" : "bg-warning-soft text-warning")} aria-hidden>
                    {g.meets ? <CheckCircle2 className="h-5 w-5" /> : g.notAssessed ? <HelpCircle className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <p className="font-medium">{g.competencyName} <span className="font-mono text-xs font-normal text-muted">{g.competencyCode}</span></p>
                      <p className="text-xs text-muted tabular-nums">{g.notAssessed ? "belum dinilai" : labelTingkat(g.currentLevel ?? 0, k?.levelLabels)} · syarat {labelTingkat(g.requiredLevel, k?.levelLabels)}{!g.meets && !g.notAssessed ? ` · kurang ${g.gap}` : ""}</p>
                    </div>
                    <BarTingkat max={max} current={g.currentLevel} required={g.requiredLevel} meets={g.meets} />
                  </div>
                  {bolehNilai && <Button size="sm" variant="ghost" onClick={() => setNilai({ awal: g })}><ClipboardCheck className="h-4 w-4" aria-hidden /> Nilai</Button>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {nilai && <FormNilai key={nilai.awal?.competencyId ?? "baru"} employeeId={employeeId} awal={nilai.awal} kompetensi={kompetensi.data ?? []} onClose={() => setNilai(null)} />}
    </div>
  );
};
