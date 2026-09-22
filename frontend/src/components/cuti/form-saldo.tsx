"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import type { KaryawanDirektori, TipeCuti, SaldoCuti } from "@/lib/types";

type Nilai = { employeeId: string; leaveTypeId: string; year: string; entitledDays: string; carriedOverDays: string; note: string };

/**
 * Tetapkan atau ubah saldo satu karyawan untuk satu jenis cuti pada satu
 * tahun. Backend meng-upsert berdasarkan (karyawan, jenis, tahun), jadi saat
 * menyunting ketiganya dikunci — yang boleh berubah hanya angkanya.
 */
export const FormSaldoCuti = ({
  open,
  onClose,
  awal,
  karyawan,
  tahun,
}: {
  open: boolean;
  onClose: () => void;
  /** Saldo yang disunting; kosong berarti menetapkan yang baru. */
  awal?: SaldoCuti | null;
  /** Karyawan yang sudah ditentukan (dari halaman detail); pilihannya dikunci. */
  karyawan?: { id: string; name: string } | null;
  tahun: number;
}) => {
  const qc = useQueryClient();
  const sunting = Boolean(awal);

  const direktori = useQuery({
    queryKey: ["direktori"],
    queryFn: async () => (await api.get<{ data: KaryawanDirektori[] }>("/employees/directory")).data.data,
    enabled: open && !karyawan && !sunting,
  });
  const tipe = useQuery({
    queryKey: ["tipe-cuti"],
    queryFn: async () => (await api.get<{ data: TipeCuti[] } | TipeCuti[]>("/leave-types")).data,
    select: (d) => (Array.isArray(d) ? d : d.data).filter((t) => t.isActive),
    enabled: open,
  });

  const f = useForm<Nilai>({ defaultValues: { employeeId: "", leaveTypeId: "", year: String(tahun), entitledDays: "", carriedOverDays: "0", note: "" } });
  const { dirtyFields, errors } = f.formState;

  // Diulang saat daftar jenis cuti datang: <select> tidak bisa memegang nilai
  // yang <option>-nya belum ada, jadi reset sebelum data tiba akan kosong.
  const tipeSiap = tipe.data !== undefined;
  React.useEffect(() => {
    if (!open) return;
    f.reset(
      awal
        ? { employeeId: awal.employeeId, leaveTypeId: awal.leaveType.id, year: String(awal.year), entitledDays: String(awal.entitledDays), carriedOverDays: String(awal.carriedOverDays), note: awal.note ?? "" }
        : { employeeId: karyawan?.id ?? "", leaveTypeId: "", year: String(tahun), entitledDays: "", carriedOverDays: "0", note: "" }
    );
  }, [open, awal, karyawan, tahun, f, tipeSiap]);

  // Jatah mengikuti kuota bawaan jenis cuti yang dipilih, selama belum diketik manual.
  const tipeId = useWatch({ control: f.control, name: "leaveTypeId" });
  const tipeDipilih = (tipe.data ?? []).find((t) => t.id === tipeId);
  React.useEffect(() => {
    if (sunting || !tipeDipilih || dirtyFields.entitledDays) return;
    f.setValue("entitledDays", tipeDipilih.defaultQuotaDays !== null ? String(tipeDipilih.defaultQuotaDays) : "");
  }, [tipeDipilih, sunting, dirtyFields.entitledDays, f]);

  const simpan = useMutation({
    mutationFn: async (v: Nilai) =>
      (
        await api.post<SaldoCuti>("/leave-balances", {
          employeeId: v.employeeId,
          leaveTypeId: v.leaveTypeId,
          year: Number(v.year),
          entitledDays: Number(v.entitledDays),
          carriedOverDays: Number(v.carriedOverDays || 0),
          ...(v.note.trim() ? { note: v.note.trim() } : {}),
        })
      ).data,
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["saldo-cuti"] });
      notifikasi.sukses(sunting ? "Saldo diperbarui" : "Saldo ditetapkan", `${s.leaveType.name} ${s.year} · sisa ${s.remainingDays} hari`);
      onClose();
    },
    onError: (e) => notifikasi.galat(e, "Saldo gagal disimpan"),
  });

  const namaKaryawan = awal?.employee?.name ?? karyawan?.name;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={sunting ? "Ubah Saldo Cuti" : "Tetapkan Saldo Cuti"}
      description={sunting && namaKaryawan ? `${namaKaryawan} · ${awal!.leaveType.name} ${awal!.year}` : "Hari yang dipakai dihitung otomatis dari cuti yang disetujui; yang ditetapkan di sini hanya jatahnya."}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={simpan.isPending}>Batal</Button>
          <Button form="form-saldo-cuti" type="submit" loading={simpan.isPending}>{sunting ? "Simpan" : "Tetapkan"}</Button>
        </>
      }
    >
      <form id="form-saldo-cuti" onSubmit={f.handleSubmit((v) => simpan.mutate(v))} className="space-y-4" noValidate>
        <Field label="Karyawan" error={errors.employeeId?.message}>
          <Select {...f.register("employeeId", { required: "Pilih karyawan" })} disabled={sunting || Boolean(karyawan)} aria-invalid={Boolean(errors.employeeId)}>
            {karyawan || sunting ? (
              <option value={awal?.employeeId ?? karyawan?.id}>{namaKaryawan ?? "Karyawan"}</option>
            ) : (
              <>
                <option value="">— Pilih karyawan —</option>
                {(direktori.data ?? []).map((k) => (
                  <option key={k.id} value={k.id}>{k.name} · {k.nik}{k.department ? ` · ${k.department.name}` : ""}</option>
                ))}
              </>
            )}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
          <Field label="Jenis cuti" error={errors.leaveTypeId?.message}>
            <Select {...f.register("leaveTypeId", { required: "Pilih jenis cuti" })} disabled={sunting} aria-invalid={Boolean(errors.leaveTypeId)}>
              <option value="">— Pilih —</option>
              {(tipe.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.deductsBalance ? "" : " (tidak memotong saldo)"}</option>
              ))}
            </Select>
          </Field>
          <Field label="Tahun" error={errors.year?.message}>
            <Input type="number" min={2000} max={2100} disabled={sunting} {...f.register("year", { required: "Wajib diisi", min: { value: 2000, message: "Tahun tidak valid" }, max: { value: 2100, message: "Tahun tidak valid" } })} />
          </Field>
        </div>
        {tipeDipilih && !tipeDipilih.deductsBalance && (
          <Alert tone="info" title="Jenis ini tidak memotong saldo">Pengajuan jenis ini tidak memerlukan saldo; angka di sini hanya menjadi catatan kuota.</Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Jatah (hari)" error={errors.entitledDays?.message} hint={tipeDipilih?.defaultQuotaDays !== null && tipeDipilih?.defaultQuotaDays !== undefined ? `Bawaan jenis ini ${tipeDipilih.defaultQuotaDays} hari` : "Setengah hari boleh, mis. 12,5"}>
            <Input type="number" min={0} max={365} step="0.5" {...f.register("entitledDays", { required: "Wajib diisi", min: { value: 0, message: "Tidak boleh negatif" }, max: { value: 365, message: "Maksimal 365" } })} aria-invalid={Boolean(errors.entitledDays)} />
          </Field>
          <Field label="Sisa tahun lalu (hari)" error={errors.carriedOverDays?.message} hint="Cuti tahun sebelumnya yang dibawa ke tahun ini">
            <Input type="number" min={0} max={365} step="0.5" {...f.register("carriedOverDays", { min: { value: 0, message: "Tidak boleh negatif" }, max: { value: 365, message: "Maksimal 365" } })} />
          </Field>
        </div>
        <Field label="Catatan" hint="Opsional, mis. prorata karena bergabung Juli">
          <Textarea rows={2} {...f.register("note", { maxLength: { value: 500, message: "Maksimal 500 karakter" } })} />
        </Field>
      </form>
    </Modal>
  );
};
