"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { LABEL_EMPLOYMENT } from "@/lib/utils";
import type { Halaman, Jabatan, Lowongan } from "@/lib/types";

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
      title: lowongan.title, description: lowongan.description, requirements: lowongan.requirements, positionId: lowongan.positionId,
      openings: String(lowongan.openings), employmentType: lowongan.employmentType ?? "", salaryRangeMin: lowongan.salaryRangeMin?.toString() ?? "",
      salaryRangeMax: lowongan.salaryRangeMax?.toString() ?? "", location: lowongan.location ?? "", deadline: lowongan.deadline?.slice(0, 10) ?? "",
    } : kosong);
  }, [open, lowongan, f]);

  const simpan = useMutation({
    mutationFn: async (v: Nilai) => {
      const body = {
        title: v.title, description: v.description, requirements: v.requirements, positionId: v.positionId, openings: Number(v.openings),
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
      footer={<><Button variant="outline" onClick={onClose}>Batal</Button><Button form="form-lowongan" type="submit" loading={simpan.isPending}>{sunting ? "Simpan" : "Buat"}</Button></>}>
      <form id="form-lowongan" onSubmit={f.handleSubmit((v) => simpan.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Judul" error={f.formState.errors.title?.message} className="sm:col-span-2"><Input {...f.register("title", { required: "Wajib diisi" })} placeholder="Waiter Outlet Kemang" /></Field>
        <Field label="Jabatan" error={f.formState.errors.positionId?.message}>
          <Select {...f.register("positionId", { required: "Pilih jabatan" })}><option value="">— Pilih —</option>{(jabatan.data ?? []).map((j) => <option key={j.id} value={j.id}>{j.name}{j.department ? ` · ${j.department.name}` : ""}</option>)}</Select>
        </Field>
        <Field label="Jumlah dibutuhkan" error={f.formState.errors.openings?.message}><Input type="number" min={1} {...f.register("openings", { required: "Wajib diisi", min: { value: 1, message: "Minimal 1" } })} /></Field>
        <Field label="Jenis kerja"><Select {...f.register("employmentType")}><option value="">— Tidak ditentukan —</option>{Object.entries(LABEL_EMPLOYMENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Lokasi"><Input {...f.register("location")} placeholder="Jakarta Selatan" /></Field>
        <Field label="Gaji minimal (Rp)"><Input type="number" min={0} step={100000} {...f.register("salaryRangeMin")} /></Field>
        <Field label="Gaji maksimal (Rp)"><Input type="number" min={0} step={100000} {...f.register("salaryRangeMax")} /></Field>
        <Field label="Batas lamaran"><Input type="date" {...f.register("deadline")} /></Field>
        <Field label="Deskripsi pekerjaan" error={f.formState.errors.description?.message} className="sm:col-span-2"><Textarea rows={3} {...f.register("description", { required: "Wajib diisi" })} /></Field>
        <Field label="Persyaratan" error={f.formState.errors.requirements?.message} className="sm:col-span-2"><Textarea rows={3} {...f.register("requirements", { required: "Wajib diisi" })} placeholder="Minimal SMA, ramah, bersedia shift" /></Field>
      </form>
    </Modal>
  );
};
