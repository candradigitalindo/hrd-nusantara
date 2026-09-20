"use client";

import * as React from "react";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import type { Halaman, Jabatan, TemplatePenilaian } from "@/lib/types";

type Kriteria = { code: string; name: string; description: string; category: string; weight: string; maxScore: string };
type Nilai = { name: string; description: string; positionId: string; criteria: Kriteria[] };

export const FormTemplate = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const qc = useQueryClient();
  const jabatan = useQuery({ queryKey: ["jabatan", "semua"], queryFn: async () => (await api.get<Halaman<Jabatan>>("/positions?limit=100")).data.data, enabled: open });
  const f = useForm<Nilai>({ defaultValues: { name: "", description: "", positionId: "", criteria: [{ code: "KPI_1", name: "", description: "", category: "", weight: "50", maxScore: "5" }, { code: "KPI_2", name: "", description: "", category: "", weight: "50", maxScore: "5" }] } });
  const daftar = useFieldArray({ control: f.control, name: "criteria" });
  const kriteria = useWatch({ control: f.control, name: "criteria" });
  const totalBobot = (kriteria ?? []).reduce((s, k) => s + (Number(k.weight) || 0), 0);
  React.useEffect(() => { if (open) f.reset(); }, [open, f]);

  const simpan = useMutation({
    mutationFn: async (v: Nilai) => (await api.post<TemplatePenilaian>("/performance/templates", {
      name: v.name, ...(v.description ? { description: v.description } : {}), positionId: v.positionId || null,
      criteria: v.criteria.map((k) => ({ code: k.code.toUpperCase(), name: k.name, weight: Number(k.weight), maxScore: Number(k.maxScore), ...(k.description ? { description: k.description } : {}), ...(k.category ? { category: k.category } : {}) })),
    })).data,
    onSuccess: (t) => { qc.invalidateQueries({ queryKey: ["template-kinerja"] }); notifikasi.sukses("Form penilaian dibuat", `${t.name} · ${t.criteria.length} kriteria`); onClose(); },
    onError: (e) => notifikasi.galat(e, "Form gagal dibuat"),
  });

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Form Penilaian Baru" description="KPI per jabatan — misalnya kecepatan pelayanan untuk waiter, kerapian untuk housekeeper"
      footer={<><Button variant="outline" onClick={onClose}>Batal</Button><Button form="form-template" type="submit" loading={simpan.isPending} disabled={Math.abs(totalBobot - 100) > 0.01}>Buat</Button></>}>
      <form id="form-template" onSubmit={f.handleSubmit((v) => simpan.mutate(v))} className="space-y-5" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nama form" error={f.formState.errors.name?.message}><Input {...f.register("name", { required: "Wajib diisi" })} placeholder="KPI Waiter 2026" /></Field>
          <Field label="Untuk jabatan"><Select {...f.register("positionId")}><option value="">Semua jabatan</option>{(jabatan.data ?? []).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</Select></Field>
          <Field label="Deskripsi" className="sm:col-span-2"><Textarea rows={2} {...f.register("description")} /></Field>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Kriteria — total bobot <span className={Math.abs(totalBobot - 100) > 0.01 ? "text-danger" : "text-success"}>{totalBobot}%</span></p>
            <Button size="sm" variant="outline" type="button" onClick={() => daftar.append({ code: `KPI_${daftar.fields.length + 1}`, name: "", description: "", category: "", weight: "0", maxScore: "5" })}><Plus className="h-4 w-4" aria-hidden /> Kriteria</Button>
          </div>
          {Math.abs(totalBobot - 100) > 0.01 && <Alert tone="warning" title="Bobot harus berjumlah 100%">Skor akhir dihitung dari bobot; kalau tidak 100%, nilainya tidak bisa dibandingkan antar karyawan.</Alert>}
          {daftar.fields.map((k, i) => (
            <div key={k.id} className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-[6rem_1fr_5rem_5rem_auto] sm:items-end">
              <Field label="Kode"><Input className="font-mono uppercase" {...f.register(`criteria.${i}.code`, { required: true })} /></Field>
              <Field label="Kriteria" error={f.formState.errors.criteria?.[i]?.name?.message}><Input {...f.register(`criteria.${i}.name`, { required: "Wajib diisi" })} placeholder="Kecepatan pelayanan" /></Field>
              <Field label="Bobot %"><Input type="number" min={0.01} max={100} step="0.01" {...f.register(`criteria.${i}.weight`)} /></Field>
              <Field label="Skala"><Input type="number" min={1} max={100} {...f.register(`criteria.${i}.maxScore`)} /></Field>
              <Button type="button" size="icon" variant="ghost" className="text-danger" onClick={() => daftar.remove(i)} aria-label="Hapus kriteria" disabled={daftar.fields.length <= 1}><Trash2 className="h-4 w-4" aria-hidden /></Button>
            </div>
          ))}
        </div>
      </form>
    </Modal>
  );
};
