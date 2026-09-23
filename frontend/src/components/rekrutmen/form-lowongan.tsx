"use client";

import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { InputRupiah } from "@/components/ui/input-rupiah";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Button } from "@/components/ui/button";
import { Input, Select, Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { LABEL_EMPLOYMENT } from "@/lib/utils";
import type { Halaman, Jabatan, Lowongan } from "@/lib/types";
import { X, Save, Plus } from "lucide-react";
import { EditorTeks } from "@/components/ui/editor-teks";

type Nilai = {
  title: string; description: string; requirements: string; positionId: string; openings: string;
  employmentType: string; salaryRangeMin: string; salaryRangeMax: string; location: string; deadline: string;
};

const kosong: Nilai = { title: "", description: "", requirements: "", positionId: "", openings: "1", employmentType: "", salaryRangeMin: "", salaryRangeMax: "", location: "", deadline: "" };

export const FormLowongan = ({ open, onClose, lowongan }: { open: boolean; onClose: () => void; lowongan?: Lowongan | null }) => {
  const qc = useQueryClient();
  const sunting = Boolean(lowongan);
  const jabatan = useQuery({
    queryKey: ["jabatan", "semua"],
    queryFn: async () => (await api.get<Halaman<Jabatan>>("/positions?limit=100")).data.data,
    enabled: open,
  });
  const f = useForm<Nilai>({ defaultValues: kosong });

  React.useEffect(() => {
    if (!open) return;
    f.reset(lowongan ? {
      title: lowongan.title, description: lowongan.descriptionHtml ?? lowongan.description, requirements: lowongan.requirementsHtml ?? lowongan.requirements, positionId: lowongan.positionId,
      openings: String(lowongan.openings), employmentType: lowongan.employmentType ?? "", salaryRangeMin: lowongan.salaryRangeMin?.toString() ?? "",
      salaryRangeMax: lowongan.salaryRangeMax?.toString() ?? "", location: lowongan.location ?? "", deadline: lowongan.deadline?.slice(0, 10) ?? "",
    } : kosong);
  }, [open, lowongan, f]);

  const simpan = useMutation({
    mutationFn: async (v: Nilai) => {
      const body = {
        title: v.title, descriptionHtml: v.description, requirementsHtml: v.requirements, positionId: v.positionId, openings: Number(v.openings),
        ...(v.employmentType ? { employmentType: v.employmentType } : {}),
        ...(v.salaryRangeMin ? { salaryRangeMin: Number(v.salaryRangeMin) } : {}),
        ...(v.salaryRangeMax ? { salaryRangeMax: Number(v.salaryRangeMax) } : {}),
        ...(v.location ? { location: v.location } : {}),
        ...(v.deadline ? { deadline: v.deadline } : {}),
      };
      return sunting ? (await api.put<Lowongan>(`/job-postings/${lowongan!.id}`, body)).data : (await api.post<Lowongan>("/job-postings", body)).data;
    },
    onSuccess: (l) => { qc.invalidateQueries({ queryKey: ["lowongan"] }); notifikasi.sukses(sunting ? "Lowongan diperbarui" : "Lowongan dibuat", sunting ? l.title : `${l.title} · masih draft, tayangkan agar terlihat.`); onClose(); },
    onError: (e) => notifikasi.galat(e, "Lowongan gagal disimpan"),
  });

  return (
    <Modal open={open} onClose={onClose} size="lg" title={sunting ? "Sunting Lowongan" : "Lowongan Baru"}
      footer={<><Button variant="outline" onClick={onClose}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button form="form-lowongan" type="submit" loading={simpan.isPending}>{!simpan.isPending && (sunting ? <Save className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />)} {sunting ? "Simpan" : "Buat"}</Button></>}>
      <form id="form-lowongan" onSubmit={f.handleSubmit((v) => simpan.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Judul" error={f.formState.errors.title?.message} className="sm:col-span-2"><Input {...f.register("title", { required: "Wajib diisi" })} placeholder="Waiter Outlet Kemang" /></Field>
        <Field label="Jabatan" error={f.formState.errors.positionId?.message}>
          <Select {...f.register("positionId", { required: "Pilih jabatan" })}><option value="">— Pilih —</option>{(jabatan.data ?? []).map((j) => <option key={j.id} value={j.id}>{j.name}{j.department ? ` · ${j.department.name}` : ""}</option>)}</Select>
        </Field>
        <Field label="Jumlah dibutuhkan" error={f.formState.errors.openings?.message}><Input type="number" min={1} {...f.register("openings", { required: "Wajib diisi", min: { value: 1, message: "Minimal 1" } })} /></Field>
        <Field label="Jenis kerja"><Select {...f.register("employmentType")}><option value="">— Tidak ditentukan —</option>{Object.entries(LABEL_EMPLOYMENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Lokasi"><Input {...f.register("location")} placeholder="Jakarta Selatan" /></Field>
        <Field label="Gaji minimal"><Controller control={f.control} name="salaryRangeMin" render={({ field }) => <InputRupiah {...field} />} /></Field>
        <Field label="Gaji maksimal"><Controller control={f.control} name="salaryRangeMax" render={({ field }) => <InputRupiah {...field} />} /></Field>
        <Field label="Batas lamaran"><Input type="date" {...f.register("deadline")} /></Field>
        <Field label="Deskripsi pekerjaan" error={f.formState.errors.description?.message} className="sm:col-span-2">
          <Controller control={f.control} name="description" rules={{ required: "Wajib diisi" }} render={({ field }) => <EditorTeks {...field} placeholder="Tugas sehari-hari, jam kerja, lingkungan kerja…" />} />
        </Field>
        <Field label="Persyaratan" error={f.formState.errors.requirements?.message} className="sm:col-span-2">
          <Controller control={f.control} name="requirements" rules={{ required: "Wajib diisi" }} render={({ field }) => <EditorTeks {...field} placeholder="Minimal SMA, ramah, bersedia shift" minTinggi="8rem" />} />
        </Field>
      </form>
    </Modal>
  );
};
