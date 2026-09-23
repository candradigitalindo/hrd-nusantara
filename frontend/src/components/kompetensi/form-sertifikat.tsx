"use client";

import { useForm, useWatch } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { formatTanggal } from "@/lib/utils";
import type { Karyawan, JenisSertifikasi, Sertifikat } from "@/lib/types";
import { Save, X } from "lucide-react";

type Nilai = { employeeId: string; certificationTypeId: string; certificationName: string; issuingOrganization: string; issueDate: string; expiryDate: string; certificateUrl: string; note: string };

/** Mencatat sertifikat karyawan — dari daftar resmi (masa berlaku otomatis) atau di luar daftar. */
export const FormSertifikat = ({ onClose, karyawan, jenis, employeeIdAwal }: { onClose: () => void; karyawan: Karyawan[]; jenis: JenisSertifikasi[]; employeeIdAwal?: string }) => {
  const qc = useQueryClient();
  const f = useForm<Nilai>({ defaultValues: { employeeId: employeeIdAwal ?? "", certificationTypeId: "", certificationName: "", issuingOrganization: "", issueDate: "", expiryDate: "", certificateUrl: "", note: "" } });
  const tipeId = useWatch({ control: f.control, name: "certificationTypeId" });
  const tipe = jenis.find((j) => j.id === tipeId);
  const simpan = useMutation({
    mutationFn: async (v: Nilai) => (await api.post<Sertifikat>("/certifications", {
      employeeId: v.employeeId, issueDate: v.issueDate,
      ...(v.certificationTypeId ? { certificationTypeId: v.certificationTypeId } : {}),
      ...(v.certificationName ? { certificationName: v.certificationName } : {}),
      ...(v.issuingOrganization ? { issuingOrganization: v.issuingOrganization } : {}),
      ...(v.expiryDate ? { expiryDate: v.expiryDate } : {}),
      ...(v.certificateUrl ? { certificateUrl: v.certificateUrl } : {}),
      ...(v.note ? { note: v.note } : {}),
    })).data,
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ["sertifikat"] }); notifikasi.sukses("Sertifikat dicatat", `${s.certificationName} · ${s.employee.name}${s.expiryDate ? ` · berlaku sampai ${formatTanggal(s.expiryDate)}` : " · tanpa kedaluwarsa"}`); onClose(); },
    onError: (e) => notifikasi.galat(e, "Sertifikat gagal dicatat"),
  });

  return (
    <Modal open onClose={onClose} size="lg" title="Catat Sertifikat" description="Pilih jenis resmi agar masa berlaku dihitung otomatis; sertifikat lain boleh dicatat dengan nama dan penerbitnya"
      footer={<><Button variant="outline" onClick={onClose}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button form="form-sertifikat" type="submit" loading={simpan.isPending}>{!simpan.isPending && <Save className="h-4 w-4" aria-hidden />} Simpan</Button></>}>
      <form id="form-sertifikat" onSubmit={f.handleSubmit((v) => simpan.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Karyawan" error={f.formState.errors.employeeId?.message}><Select {...f.register("employeeId", { required: "Pilih karyawan" })}><option value="">— Pilih —</option>{karyawan.map((k) => <option key={k.id} value={k.id}>{k.name} · {k.nik}</option>)}</Select></Field>
        <Field label="Jenis sertifikasi"><Select {...f.register("certificationTypeId")}><option value="">Di luar daftar resmi</option>{jenis.map((j) => <option key={j.id} value={j.id}>{j.name}{j.isMandatory ? " (wajib)" : ""}</option>)}</Select></Field>
        <Field label={tipe ? "Nama (opsional, ganti nama jenis)" : "Nama sertifikat"} error={f.formState.errors.certificationName?.message}><Input {...f.register("certificationName", { validate: (v, x) => Boolean(x.certificationTypeId) || Boolean(v.trim()) || "Wajib bila di luar daftar resmi" })} placeholder={tipe?.name ?? "Food Handler Certificate"} /></Field>
        <Field label={tipe ? "Penerbit (opsional)" : "Penerbit"} error={f.formState.errors.issuingOrganization?.message}><Input {...f.register("issuingOrganization", { validate: (v, x) => Boolean(x.certificationTypeId) || Boolean(v.trim()) || "Wajib bila di luar daftar resmi" })} placeholder={tipe?.issuingOrganization ?? "Dinas Kesehatan"} /></Field>
        <Field label="Tanggal terbit" error={f.formState.errors.issueDate?.message}><Input type="date" {...f.register("issueDate", { required: "Wajib diisi" })} /></Field>
        <Field label="Kedaluwarsa" hint={tipe?.validityMonths ? `kosongkan = ${tipe.validityMonths} bulan sejak terbit` : tipe ? "jenis ini tidak kedaluwarsa" : "kosongkan bila tidak kedaluwarsa"} error={f.formState.errors.expiryDate?.message}><Input type="date" {...f.register("expiryDate", { validate: (v, x) => !v || !x.issueDate || v >= x.issueDate || "Tidak boleh sebelum tanggal terbit" })} /></Field>
        <Field label="Tautan berkas (opsional)" className="sm:col-span-2" error={f.formState.errors.certificateUrl?.message}><Input type="url" placeholder="https://…" {...f.register("certificateUrl", { pattern: { value: /^https?:\/\/.+/, message: "Harus berupa URL" } })} /></Field>
        <Field label="Catatan" className="sm:col-span-2"><Textarea rows={2} {...f.register("note")} /></Field>
      </form>
    </Modal>
  );
};
