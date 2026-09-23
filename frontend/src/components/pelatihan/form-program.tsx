"use client";

import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Button } from "@/components/ui/button";
import { Input, Select, Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import type { Halaman, Jabatan, Departemen, ProgramPelatihan } from "@/lib/types";
import { X, Save, Plus } from "lucide-react";
import { EditorTeks } from "@/components/ui/editor-teks";

type Nilai = { code: string; name: string; description: string; category: string; isMandatory: boolean; targetPositionId: string; targetDepartmentId: string; passingScore: string; validityMonths: string; durationHours: string; isActive: boolean };
const kosong: Nilai = { code: "", name: "", description: "", category: "", isMandatory: false, targetPositionId: "", targetDepartmentId: "", passingScore: "", validityMonths: "", durationHours: "", isActive: true };

export const FormProgram = ({ open, onClose, program }: { open: boolean; onClose: () => void; program?: ProgramPelatihan | null }) => {
  const qc = useQueryClient();
  const sunting = Boolean(program);
  const jabatan = useQuery({ queryKey: ["jabatan", "semua"], queryFn: async () => (await api.get<Halaman<Jabatan>>("/positions?limit=100")).data.data, enabled: open });
  const departemen = useQuery({ queryKey: ["departemen", "semua"], queryFn: async () => (await api.get<Halaman<Departemen>>("/departments?limit=100")).data.data, enabled: open });
  const f = useForm<Nilai>({ defaultValues: kosong });

  React.useEffect(() => {
    if (!open) return;
    f.reset(program ? { code: program.code, name: program.name, description: program.descriptionHtml ?? program.description ?? "", category: program.category ?? "", isMandatory: program.isMandatory, targetPositionId: program.targetPositionId ?? "", targetDepartmentId: program.targetDepartmentId ?? "", passingScore: program.passingScore?.toString() ?? "", validityMonths: program.validityMonths?.toString() ?? "", durationHours: program.durationHours?.toString() ?? "", isActive: program.isActive } : kosong);
  }, [open, program, f]);

  const simpan = useMutation({
    mutationFn: async (v: Nilai) => {
      const body = {
        name: v.name, isMandatory: v.isMandatory,
        ...(sunting ? { isActive: v.isActive } : { code: v.code.toUpperCase() }),
        ...(v.description ? { descriptionHtml: v.description } : {}), ...(v.category ? { category: v.category } : {}),
        targetPositionId: v.targetPositionId || null, targetDepartmentId: v.targetDepartmentId || null,
        passingScore: v.passingScore ? Number(v.passingScore) : null, validityMonths: v.validityMonths ? Number(v.validityMonths) : null, durationHours: v.durationHours ? Number(v.durationHours) : null,
      };
      return sunting ? (await api.put<ProgramPelatihan>(`/training/programs/${program!.id}`, body)).data : (await api.post<ProgramPelatihan>("/training/programs", body)).data;
    },
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ["program-pelatihan"] }); notifikasi.sukses(sunting ? "Program diperbarui" : "Program dibuat", p.name); onClose(); },
    onError: (e) => notifikasi.galat(e, "Program gagal disimpan"),
  });

  return (
    <Modal open={open} onClose={onClose} size="lg" title={sunting ? "Sunting Program" : "Program Pelatihan Baru"}
      footer={<><Button variant="outline" onClick={onClose}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button form="form-program" type="submit" loading={simpan.isPending}>{!simpan.isPending && (sunting ? <Save className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />)} {sunting ? "Simpan" : "Buat"}</Button></>}>
      <form id="form-program" onSubmit={f.handleSubmit((v) => simpan.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
        {!sunting && <Field label="Kode" error={f.formState.errors.code?.message} hint="Huruf kapital, angka, garis bawah"><Input className="font-mono uppercase" {...f.register("code", { required: "Wajib diisi", pattern: { value: /^[A-Za-z0-9_]{2,40}$/, message: "2–40 karakter: huruf, angka, _" } })} placeholder="HYGIENE_DASAR" /></Field>}
        <Field label="Nama" error={f.formState.errors.name?.message} className={sunting ? "sm:col-span-2" : ""}><Input {...f.register("name", { required: "Wajib diisi" })} placeholder="Hygiene & Sanitasi Dasar" /></Field>
        <Field label="Kategori"><Input {...f.register("category")} placeholder="Hygiene, SOP Pelayanan, K3" /></Field>
        <Field label="Durasi (jam)"><Input type="number" min={0.5} step={0.5} {...f.register("durationHours")} /></Field>
        <Field label="Nilai kelulusan" hint="Kosongkan bila tanpa ujian"><Input type="number" min={0} max={100} {...f.register("passingScore")} /></Field>
        <Field label="Masa berlaku (bulan)" hint="Kosongkan bila tidak kedaluwarsa"><Input type="number" min={1} {...f.register("validityMonths")} /></Field>
        <Field label="Sasaran jabatan"><Select {...f.register("targetPositionId")}><option value="">Semua jabatan</option>{(jabatan.data ?? []).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</Select></Field>
        <Field label="Sasaran departemen"><Select {...f.register("targetDepartmentId")}><option value="">Semua departemen</option>{(departemen.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        <Field label="Deskripsi" className="sm:col-span-2">
          <Controller control={f.control} name="description" render={({ field }) => <EditorTeks {...field} placeholder="Apa yang dipelajari dan untuk siapa…" minTinggi="8rem" />} />
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...f.register("isMandatory")} className="h-4 w-4 accent-[var(--primary)]" /> Wajib — masuk laporan kepatuhan</label>
        {sunting && <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...f.register("isActive")} className="h-4 w-4 accent-[var(--primary)]" /> Aktif</label>}
      </form>
    </Modal>
  );
};
