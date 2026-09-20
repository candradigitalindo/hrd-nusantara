"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import type { ProgramPelatihan, SesiPelatihan } from "@/lib/types";

type Nilai = { programId: string; title: string; description: string; trainer: string; startDateTime: string; endDateTime: string; location: string; maxParticipants: string; registrationDeadline: string; cost: string };

export const FormSesi = ({ open, onClose, programs }: { open: boolean; onClose: () => void; programs: ProgramPelatihan[] }) => {
  const qc = useQueryClient();
  const f = useForm<Nilai>({ defaultValues: { programId: "", title: "", description: "", trainer: "", startDateTime: "", endDateTime: "", location: "", maxParticipants: "", registrationDeadline: "", cost: "" } });
  React.useEffect(() => { if (open) f.reset(); }, [open, f]);

  const simpan = useMutation({
    mutationFn: async (v: Nilai) => (await api.post<SesiPelatihan>("/training/sessions", {
      programId: v.programId, title: v.title, trainer: v.trainer,
      startDateTime: new Date(v.startDateTime).toISOString(), endDateTime: new Date(v.endDateTime).toISOString(),
      ...(v.description ? { description: v.description } : {}), ...(v.location ? { location: v.location } : {}),
      ...(v.maxParticipants ? { maxParticipants: Number(v.maxParticipants) } : {}),
      ...(v.registrationDeadline ? { registrationDeadline: new Date(v.registrationDeadline).toISOString() } : {}),
      ...(v.cost ? { cost: Number(v.cost) } : {}),
    })).data,
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ["sesi-pelatihan"] }); notifikasi.sukses("Sesi dijadwalkan", `${s.title} · karyawan bisa mendaftar sekarang.`); onClose(); },
    onError: (e) => notifikasi.galat(e, "Sesi gagal dijadwalkan"),
  });

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Jadwalkan Sesi Pelatihan"
      footer={<><Button variant="outline" onClick={onClose}>Batal</Button><Button form="form-sesi" type="submit" loading={simpan.isPending}>Jadwalkan</Button></>}>
      <form id="form-sesi" onSubmit={f.handleSubmit((v) => simpan.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Program" error={f.formState.errors.programId?.message} className="sm:col-span-2"><Select {...f.register("programId", { required: "Pilih program" })}><option value="">— Pilih —</option>{programs.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isMandatory ? " (wajib)" : ""}</option>)}</Select></Field>
        <Field label="Judul sesi" error={f.formState.errors.title?.message}><Input {...f.register("title", { required: "Wajib diisi" })} placeholder="Hygiene Dasar — Batch Oktober" /></Field>
        <Field label="Pengajar" error={f.formState.errors.trainer?.message}><Input {...f.register("trainer", { required: "Wajib diisi" })} /></Field>
        <Field label="Mulai" error={f.formState.errors.startDateTime?.message}><Input type="datetime-local" {...f.register("startDateTime", { required: "Wajib diisi" })} /></Field>
        <Field label="Selesai" error={f.formState.errors.endDateTime?.message}><Input type="datetime-local" {...f.register("endDateTime", { required: "Wajib diisi", validate: (v, x) => v > x.startDateTime || "Harus setelah waktu mulai" })} /></Field>
        <Field label="Lokasi"><Input {...f.register("location")} placeholder="Ruang training / Google Meet" /></Field>
        <Field label="Kuota peserta" hint="Kosongkan bila tak terbatas"><Input type="number" min={1} {...f.register("maxParticipants")} /></Field>
        <Field label="Batas pendaftaran"><Input type="datetime-local" {...f.register("registrationDeadline")} /></Field>
        <Field label="Biaya (Rp)"><Input type="number" min={0} step={10000} {...f.register("cost")} /></Field>
        <Field label="Deskripsi" className="sm:col-span-2"><Textarea rows={2} {...f.register("description")} /></Field>
      </form>
    </Modal>
  );
};
