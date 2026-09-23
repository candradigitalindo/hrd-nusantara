"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input, Select, Field, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { notifikasi } from "@/hooks/use-notifikasi";
import { punyaIzin } from "@/hooks/use-sesi";
import { LABEL_STATUS, LABEL_LINGKUP } from "@/lib/utils";
import type { Halaman, Departemen, Jabatan, Karyawan, PenggunaSesi, PeranKustom } from "@/lib/types";

const STATUS = ["active", "probation", "contract", "internship", "on_leave", "inactive"] as const;

const skema = z.object({
  nik: z.string().trim().min(2, "NIK minimal 2 karakter").max(50),
  name: z.string().trim().min(2, "Nama minimal 2 karakter").max(150),
  email: z.string().trim().email("Format email tidak valid"),
  phoneNumber: z
    .string()
    .trim()
    .max(25)
    .refine((v) => v === "" || v.replace(/\D/g, "").length >= 10, "Nomor HP minimal 10 digit, mis. 0812xxxx")
    .optional()
    .or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  dateOfBirth: z.string().optional().or(z.literal("")),
  joinDate: z.string().optional().or(z.literal("")),
  status: z.enum(STATUS),
  customRoleId: z.string().min(1, "Pilih peran"),
  departmentId: z.string().optional().or(z.literal("")),
  positionId: z.string().optional().or(z.literal("")),
  password: z.string().min(8, "Minimal 8 karakter").optional().or(z.literal("")),
});
type Nilai = z.infer<typeof skema>;

/** Nilai kosong dari formulir tidak dikirim: backend memakai .strict() dan
 *  membedakan "tidak diubah" dari "dikosongkan". */
const bersihkan = (nilai: Nilai, sunting: boolean) => {
  const hasil: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(nilai)) {
    if (v === "" || v === undefined) {
      if (sunting && (k === "departmentId" || k === "positionId")) hasil[k] = null;
      continue;
    }
    hasil[k] = v;
  }
  return hasil;
};

export const FormKaryawan = ({
  open,
  onClose,
  karyawan,
  sesi,
}: {
  open: boolean;
  onClose: () => void;
  karyawan?: Karyawan | null;
  sesi: PenggunaSesi | undefined;
}) => {
  const qc = useQueryClient();
  const sunting = Boolean(karyawan);
  const bolehUbahRole = punyaIzin(sesi, "karyawan.buat", "karyawan.ubah");

  const { data: peran } = useQuery({
    queryKey: ["peran"],
    queryFn: async () => (await api.get<{ data: PeranKustom[] }>("/roles")).data.data,
    enabled: open && bolehUbahRole,
  });
  // Akun lama yang belum pernah diberi peran secara eksplisit memakai peran
  // sistem sesuai lingkupnya; formulir menampilkannya sebagai pilihan aktif.
  const peranAwal = karyawan?.customRoleId ?? peran?.find((r) => r.code === karyawan?.role)?.id ?? "";
  const peranBawaan = peran?.find((r) => r.code === "EMPLOYEE")?.id ?? "";

  const { data: departemen } = useQuery({
    queryKey: ["departemen", "semua"],
    queryFn: async () => (await api.get<Halaman<Departemen>>("/departments?limit=100")).data.data,
    enabled: open,
  });
  const { data: jabatan } = useQuery({
    queryKey: ["jabatan", "semua"],
    queryFn: async () => (await api.get<Halaman<Jabatan>>("/positions?limit=100")).data.data,
    enabled: open,
  });

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<Nilai>({
    resolver: zodResolver(skema),
    defaultValues: { status: "active", customRoleId: "" },
  });

  React.useEffect(() => {
    if (!open) return;
    reset(
      karyawan
        ? {
            nik: karyawan.nik,
            name: karyawan.name,
            email: karyawan.email,
            phoneNumber: karyawan.phoneNumber ?? "",
            address: karyawan.address ?? "",
            dateOfBirth: karyawan.dateOfBirth?.slice(0, 10) ?? "",
            joinDate: karyawan.joinDate?.slice(0, 10) ?? "",
            status: (STATUS as readonly string[]).includes(karyawan.status)
              ? (karyawan.status as (typeof STATUS)[number])
              : "active",
            customRoleId: peranAwal,
            departmentId: karyawan.departmentId ?? "",
            positionId: karyawan.positionId ?? "",
            password: "",
          }
        : { status: "active", customRoleId: peranBawaan, nik: "", name: "", email: "" }
    );
  }, [open, karyawan, reset, peranAwal, peranBawaan]);

  const simpan = useMutation({
    mutationFn: async (nilai: Nilai) => {
      const body = bersihkan(nilai, sunting);
      return sunting
        ? (await api.put<Karyawan>(`/employees/${karyawan!.id}`, body)).data
        : (await api.post<Karyawan>("/employees", body)).data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["karyawan"] });
      notifikasi.sukses(
        sunting ? "Data karyawan diperbarui" : "Karyawan ditambahkan",
        `${data.name} · ${data.nik}`
      );
      onClose();
    },
    onError: (e) => notifikasi.galat(e, sunting ? "Gagal memperbarui" : "Gagal menambahkan"),
  });

  const deptDipilih = useWatch({ control, name: "departmentId" });
  const jabatanTersaring = (jabatan ?? []).filter((j) => !deptDipilih || !j.departmentId || j.departmentId === deptDipilih);
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={sunting ? "Sunting Karyawan" : "Tambah Karyawan"}
      description={sunting ? karyawan?.email : "Akun login dibuat bersamaan bila kata sandi diisi"}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={simpan.isPending}>
            Batal
          </Button>
          <Button form="form-karyawan" type="submit" loading={simpan.isPending}>
            {sunting ? "Simpan Perubahan" : "Tambah"}
          </Button>
        </>
      }
    >
      <form id="form-karyawan" onSubmit={handleSubmit((v) => simpan.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="NIK" error={errors.nik?.message}>
          <Input {...register("nik")} aria-invalid={Boolean(errors.nik)} placeholder="EMP-0001" />
        </Field>
        <Field label="Nama lengkap" error={errors.name?.message}>
          <Input {...register("name")} aria-invalid={Boolean(errors.name)} />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" inputMode="email" {...register("email")} aria-invalid={Boolean(errors.email)} />
        </Field>
        <Field label="No. HP / WhatsApp" error={errors.phoneNumber?.message} hint="Dipakai karyawan sebagai username login (08xx atau +62xx); disimpan dalam bentuk baku 62xx">
          <Input inputMode="tel" placeholder="0812 3456 7890" {...register("phoneNumber")} />
        </Field>
        <Field label="Departemen">
          <Select {...register("departmentId")}>
            <option value="">— Belum ditentukan —</option>
            {(departemen ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Jabatan">
          <Select {...register("positionId")}>
            <option value="">— Belum ditentukan —</option>
            {jabatanTersaring.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select {...register("status")}>
            {STATUS.map((s) => (
              <option key={s} value={s}>
                {LABEL_STATUS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Peran" error={errors.customRoleId?.message} hint={bolehUbahRole ? "Menentukan hak akses dan lingkup data. Kelola di menu Peran & Hak Akses." : "Hanya HR yang bisa mengubah peran"}>
          <Select {...register("customRoleId")} disabled={!bolehUbahRole} aria-invalid={Boolean(errors.customRoleId)}>
            <option value="">— Pilih peran —</option>
            {(peran ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {LABEL_LINGKUP[r.baseRole]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tanggal bergabung">
          <Input type="date" {...register("joinDate")} />
        </Field>
        <Field label="Tanggal lahir">
          <Input type="date" {...register("dateOfBirth")} />
        </Field>
        <Field label="Alamat" className="sm:col-span-2">
          <Textarea {...register("address")} rows={2} />
        </Field>
        {!sunting && (
          <Field
            label="Kata sandi awal (opsional)"
            error={errors.password?.message}
            hint="Minimal 8 karakter; karyawan wajib menggantinya saat login pertama. Kosongkan bila belum perlu akun login. Untuk yang lupa sandi, pakai tombol Atur ulang sandi di daftar."
            className="sm:col-span-2"
          >
            <Input type="password" autoComplete="new-password" {...register("password")} />
          </Field>
        )}
      </form>
    </Modal>
  );
};
