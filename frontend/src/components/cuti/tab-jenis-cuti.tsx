"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { CalendarOff, Pencil, Plus, Power, PowerOff, Save, X } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { Card } from "@/components/ui/card";
import { Button, TombolAksi } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Centang } from "@/components/ui/centang";
import { Badge } from "@/components/ui/badge";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { ResponsiveTable, type Kolom } from "@/components/ui/responsive-table";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { kodeDariNama } from "@/lib/utils";
import type { Halaman, TipeCuti } from "@/lib/types";

type Gender = "" | "female" | "male";

type FormJenis = {
  name: string;
  code: string;
  description: string;
  /** String, bukan number: kotak angka yang kosong berarti "tanpa kuota", bukan 0. */
  defaultQuotaDays: string;
  maxConsecutiveDays: string;
  genderRestriction: Gender;
  isPaid: boolean;
  deductsBalance: boolean;
  absorbsCollectiveLeave: boolean;
  requiresAttachment: boolean;
  countsCalendarDays: boolean;
};

const KOSONG: FormJenis = {
  name: "", code: "", description: "", defaultQuotaDays: "", maxConsecutiveDays: "", genderRestriction: "",
  isPaid: true, deductsBalance: true, absorbsCollectiveLeave: false, requiresAttachment: false, countsCalendarDays: false,
};

const LABEL_GENDER: Record<Exclude<Gender, "">, string> = { female: "Khusus perempuan", male: "Khusus laki-laki" };

const dariTipe = (t: TipeCuti): FormJenis => ({
  name: t.name,
  code: t.code,
  description: t.description ?? "",
  defaultQuotaDays: t.defaultQuotaDays === null ? "" : String(t.defaultQuotaDays),
  maxConsecutiveDays: t.maxConsecutiveDays === null ? "" : String(t.maxConsecutiveDays),
  genderRestriction: t.genderRestriction === "female" || t.genderRestriction === "male" ? t.genderRestriction : "",
  isPaid: t.isPaid,
  deductsBalance: t.deductsBalance,
  absorbsCollectiveLeave: t.absorbsCollectiveLeave,
  requiresAttachment: t.requiresAttachment,
  countsCalendarDays: t.countsCalendarDays,
});

/** Badan permintaan dari nilai form. Angka kosong dikirim null: tanpa kuota / tanpa batas. */
const keBadan = (v: FormJenis) => ({
  name: v.name.trim(),
  code: v.code.trim().toLowerCase(),
  description: v.description.trim(),
  defaultQuotaDays: v.defaultQuotaDays === "" ? null : Number(v.defaultQuotaDays),
  maxConsecutiveDays: v.maxConsecutiveDays === "" ? null : Number(v.maxConsecutiveDays),
  genderRestriction: v.genderRestriction === "" ? null : v.genderRestriction,
  isPaid: v.isPaid,
  deductsBalance: v.deductsBalance,
  absorbsCollectiveLeave: v.absorbsCollectiveLeave,
  requiresAttachment: v.requiresAttachment,
  countsCalendarDays: v.countsCalendarDays,
});
type Badan = ReturnType<typeof keBadan>;

/** Aturan sebuah jenis sebagai lencana, supaya perbedaan antar jenis terbaca sekilas di daftar. */
const AturanJenis = ({ t }: { t: TipeCuti }) => (
  <div className="flex flex-wrap gap-1">
    {!t.isPaid && <Badge tone="warning">Tanpa gaji</Badge>}
    {t.deductsBalance ? <Badge tone="primary">Memotong saldo</Badge> : <Badge>Tidak memotong saldo</Badge>}
    {t.absorbsCollectiveLeave && <Badge tone="info">Kena cuti bersama</Badge>}
    {t.requiresAttachment && <Badge tone="info">Wajib lampiran</Badge>}
    {t.countsCalendarDays && <Badge tone="info">Hari kalender</Badge>}
    {t.maxConsecutiveDays !== null && <Badge>Maks {t.maxConsecutiveDays} hari</Badge>}
    {(t.genderRestriction === "female" || t.genderRestriction === "male") && <Badge>{LABEL_GENDER[t.genderRestriction]}</Badge>}
  </div>
);

/**
 * Jenis cuti (tahunan, sakit, melahirkan, …) yang dipilih karyawan saat
 * mengajukan. Kuota dan aturannya — memotong saldo, wajib lampiran, batas
 * hari, pembatasan gender — ditegakkan backend saat pengajuan masuk, jadi
 * perubahan di sini berlaku untuk pengajuan berikutnya tanpa mengubah kode.
 *
 * Jenis tidak pernah dihapus, hanya dinonaktifkan: pengajuan dan saldo lama
 * menunjuk ke sini, dan riwayat cuti karyawan tidak boleh terputus.
 */
export const TabJenisCuti = () => {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const bolehBuat = punyaIzin(saya, "pengaturan_cuti.buat");
  const bolehUbah = punyaIzin(saya, "pengaturan_cuti.ubah");
  const bolehHapus = punyaIzin(saya, "pengaturan_cuti.hapus");

  const [semua, setSemua] = React.useState(false);
  const [form, setForm] = React.useState<{ open: boolean; item: TipeCuti | null }>({ open: false, item: null });
  const [nonaktif, setNonaktif] = React.useState<TipeCuti | null>(null);

  // Awalan kunci "tipe-cuti" sama dengan dropdown form pengajuan dan saldo,
  // jadi satu invalidasi menyegarkan semuanya.
  const jenis = useQuery({
    queryKey: ["tipe-cuti", "kelola", semua ? "semua" : "aktif"],
    queryFn: async () => (await api.get<Halaman<TipeCuti>>(`/leave-types?includeInactive=${semua}&limit=100`)).data.data,
  });

  const f = useForm<FormJenis>({ defaultValues: KOSONG });
  const { errors, dirtyFields } = f.formState;
  const [nama, kuota, memotong] = useWatch({ control: f.control, name: ["name", "defaultQuotaDays", "deductsBalance"] });
  const item = form.item;

  // Kode disarankan dari nama selama belum diketik sendiri — hanya saat
  // membuat; kode jenis yang sudah ada tidak digeser diam-diam.
  React.useEffect(() => {
    if (item || !form.open || dirtyFields.code) return;
    f.setValue("code", kodeDariNama(nama ?? ""));
  }, [nama, item, form.open, dirtyFields.code, f]);

  const bukaForm = (t: TipeCuti | null) => {
    f.reset(t ? dariTipe(t) : KOSONG);
    setForm({ open: true, item: t });
  };
  const tutupForm = () => setForm({ open: false, item: null });
  const segarkan = () => qc.invalidateQueries({ queryKey: ["tipe-cuti"] });

  const simpan = useMutation({
    mutationFn: async (v: FormJenis) => {
      const baru = keBadan(v);
      if (!item) {
        const { description, ...tanpaKeterangan } = baru;
        return (await api.post<TipeCuti>("/leave-types", description ? baru : tanpaKeterangan)).data;
      }
      // Hanya bidang yang berubah: skema ubah backend tidak memberi nilai
      // bawaan, jadi yang tidak dikirim benar-benar tidak tersentuh.
      const lama = keBadan(dariTipe(item));
      const badan: Record<string, unknown> = {};
      for (const k of Object.keys(baru) as (keyof Badan)[]) if (baru[k] !== lama[k]) badan[k] = baru[k];
      if (Object.keys(badan).length === 0) return null;
      return (await api.put<TipeCuti>(`/leave-types/${item.id}`, badan)).data;
    },
    onSuccess: (t) => {
      tutupForm();
      if (!t) {
        notifikasi.info("Tidak ada yang diubah", "Jenis cuti dibiarkan seperti semula.");
        return;
      }
      segarkan();
      notifikasi.sukses(
        item ? "Jenis cuti diperbarui" : "Jenis cuti ditambahkan",
        `${t.name} · kode ${t.code}${t.defaultQuotaDays !== null ? ` · ${t.defaultQuotaDays} hari/tahun` : " · tanpa kuota"}`
      );
    },
    onError: (e) => notifikasi.galat(e, "Jenis cuti belum tersimpan"),
  });

  const nonaktifkan = useMutation({
    mutationFn: async (t: TipeCuti) => api.delete(`/leave-types/${t.id}`),
    onSuccess: (_, t) => {
      segarkan();
      notifikasi.sukses("Jenis cuti dinonaktifkan", `${t.name} tidak bisa dipilih untuk pengajuan baru. Pengajuan dan saldo yang sudah ada tetap tersimpan.`);
      setNonaktif(null);
    },
    onError: (e) => {
      setNonaktif(null);
      notifikasi.galat(e, "Tidak bisa dinonaktifkan");
    },
  });

  const aktifkan = useMutation({
    mutationFn: async (t: TipeCuti) => (await api.put<TipeCuti>(`/leave-types/${t.id}`, { isActive: true })).data,
    onSuccess: (t) => {
      segarkan();
      notifikasi.sukses("Jenis cuti diaktifkan lagi", `${t.name} bisa dipilih kembali saat mengajukan.`);
    },
    onError: (e) => notifikasi.galat(e, "Tidak bisa diaktifkan"),
  });

  const kolom: Kolom<TipeCuti>[] = [
    {
      key: "jenis",
      header: "Jenis cuti",
      primary: true,
      cell: (t) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{t.name}</span>
            <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">{t.code}</code>
            {!t.isActive && <Badge>Nonaktif</Badge>}
          </div>
          {t.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{t.description}</p>}
        </div>
      ),
    },
    {
      key: "kuota",
      header: "Kuota bawaan",
      cell: (t) => (t.defaultQuotaDays === null ? <span className="text-muted">Tanpa kuota</span> : <span className="tabular-nums">{t.defaultQuotaDays} hari/tahun</span>),
    },
    { key: "aturan", header: "Aturan", cell: (t) => <AturanJenis t={t} /> },
    ...(bolehUbah || bolehHapus
      ? [
          {
            key: "aksi",
            header: "",
            className: "text-right",
            cell: (t: TipeCuti) => (
              <div className="flex justify-end gap-1.5">
                {bolehUbah && <TombolAksi icon={Pencil} label={`Ubah ${t.name}`} onClick={() => bukaForm(t)} />}
                {t.isActive
                  ? bolehHapus && <TombolAksi icon={PowerOff} label={`Nonaktifkan ${t.name}`} tone="bahaya" onClick={() => setNonaktif(t)} />
                  : bolehUbah && <TombolAksi icon={Power} label={`Aktifkan lagi ${t.name}`} onClick={() => aktifkan.mutate(t)} disabled={aktifkan.isPending} />}
              </div>
            ),
          } satisfies Kolom<TipeCuti>,
        ]
      : []),
  ];

  return (
    <>
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">Pilihan yang muncul saat karyawan mengajukan cuti. Kuota bawaan dipakai saat menerapkan saldo massal di tab Saldo Karyawan.</p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={semua} onChange={(e) => setSemua(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
              Tampilkan yang nonaktif
            </label>
            {bolehBuat && (
              <Button size="sm" onClick={() => bukaForm(null)}>
                <Plus className="h-4 w-4" aria-hidden /> Jenis Cuti
              </Button>
            )}
          </div>
        </div>

        {jenis.isLoading ? (
          <SkeletonBaris />
        ) : jenis.isError ? (
          <EmptyState title="Jenis cuti tidak bisa dimuat" description={(jenis.error as Error).message} />
        ) : !jenis.data?.length ? (
          <EmptyState
            icon={CalendarOff}
            title="Belum ada jenis cuti"
            description="Tanpa jenis cuti, karyawan tidak bisa mengajukan apa pun. Mulai dari Cuti Tahunan (12 hari, memotong saldo) dan Cuti Sakit (tanpa kuota, wajib surat dokter)."
            action={bolehBuat && <Button onClick={() => bukaForm(null)}><Plus className="h-4 w-4" aria-hidden /> Tambah Jenis Cuti</Button>}
          />
        ) : (
          <ResponsiveTable columns={kolom} rows={jenis.data} rowKey={(t) => t.id} />
        )}
      </Card>

      <Modal
        open={form.open}
        onClose={tutupForm}
        size="lg"
        title={item ? "Ubah Jenis Cuti" : "Jenis Cuti Baru"}
        description={item ? "Berlaku untuk pengajuan berikutnya; pengajuan yang sudah masuk tidak berubah." : "Aturan di bawah ditegakkan otomatis saat karyawan mengajukan."}
        footer={
          <>
            <Button variant="outline" onClick={tutupForm} disabled={simpan.isPending}><X className="h-4 w-4" aria-hidden /> Batal</Button>
            <Button form="form-jenis-cuti" type="submit" loading={simpan.isPending}>
              {!simpan.isPending && <Save className="h-4 w-4" aria-hidden />} Simpan
            </Button>
          </>
        }
      >
        <form id="form-jenis-cuti" onSubmit={f.handleSubmit((v) => simpan.mutate(v))} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <Field label="Nama" error={errors.name?.message}>
              <Input
                {...f.register("name", { required: "Nama wajib diisi", validate: (v) => v.trim().length > 0 || "Nama wajib diisi" })}
                placeholder="Cuti Tahunan"
                maxLength={100}
                aria-invalid={Boolean(errors.name)}
              />
            </Field>
            <Field label="Kode" error={errors.code?.message} hint="Huruf kecil, angka, garis bawah">
              <Input
                {...f.register("code", { required: "Kode wajib diisi", pattern: { value: /^[a-z0-9_]{2,40}$/, message: "2–40 karakter: huruf kecil, angka, garis bawah" } })}
                placeholder="cuti_tahunan"
                maxLength={40}
                className="font-mono"
                aria-invalid={Boolean(errors.code)}
              />
            </Field>
          </div>
          <Field label="Keterangan" error={errors.description?.message} hint="Tampil untuk karyawan saat memilih jenis ini, mis. dasar hukumnya">
            <Textarea rows={2} {...f.register("description", { maxLength: { value: 500, message: "Maksimal 500 karakter" } })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Kuota bawaan (hari/tahun)" error={errors.defaultQuotaDays?.message} hint="Kosongkan bila tanpa kuota">
              <Input
                type="number"
                min={0}
                max={365}
                step={1}
                {...f.register("defaultQuotaDays", {
                  min: { value: 0, message: "Tidak boleh negatif" },
                  max: { value: 365, message: "Maksimal 365" },
                  validate: (v) => v === "" || Number.isInteger(Number(v)) || "Harus bilangan bulat",
                })}
                aria-invalid={Boolean(errors.defaultQuotaDays)}
              />
            </Field>
            <Field label="Maks. hari berturut-turut" error={errors.maxConsecutiveDays?.message} hint="Kosongkan bila tanpa batas">
              <Input
                type="number"
                min={1}
                max={365}
                step={1}
                {...f.register("maxConsecutiveDays", {
                  min: { value: 1, message: "Minimal 1 hari" },
                  max: { value: 365, message: "Maksimal 365" },
                  validate: (v) => v === "" || Number.isInteger(Number(v)) || "Harus bilangan bulat",
                })}
                aria-invalid={Boolean(errors.maxConsecutiveDays)}
              />
            </Field>
            <Field label="Berlaku untuk" hint="Cuti haid dan melahirkan dibatasi undang-undang">
              <Select {...f.register("genderRestriction")}>
                <option value="">Semua karyawan</option>
                <option value="female">Karyawan perempuan</option>
                <option value="male">Karyawan laki-laki</option>
              </Select>
            </Field>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Aturan</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <Centang label="Dibayar" hint="Gaji tetap dibayar selama cuti" {...f.register("isPaid")} />
              <Centang label="Memotong saldo" hint="Ditolak bila saldo karyawan belum ditetapkan atau habis" {...f.register("deductsBalance")} />
              <Centang label="Kuota dipotong cuti bersama" hint="Lazimnya hanya cuti tahunan" {...f.register("absorbsCollectiveLeave")} />
              <Centang label="Wajib lampiran" hint="Mis. surat keterangan dokter" {...f.register("requiresAttachment")} />
              <Centang label="Dihitung hari kalender" hint="Akhir pekan dan libur ikut dihitung, seperti cuti melahirkan 3 bulan" {...f.register("countsCalendarDays")} />
            </div>
          </fieldset>

          {memotong && kuota === "" && (
            <Alert tone="info" title="Memotong saldo tanpa kuota bawaan">
              Saldo tiap karyawan harus ditetapkan satu per satu di tab Saldo Karyawan; penerapan massal hanya tersedia untuk jenis yang punya kuota bawaan.
            </Alert>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(nonaktif)}
        onClose={() => setNonaktif(null)}
        onConfirm={() => nonaktif && nonaktifkan.mutate(nonaktif)}
        loading={nonaktifkan.isPending}
        danger
        title="Nonaktifkan jenis cuti?"
        description={nonaktif ? `${nonaktif.name} tidak lagi muncul saat karyawan mengajukan. Pengajuan dan saldo yang sudah ada tetap tersimpan, dan jenis ini bisa diaktifkan lagi kapan saja.` : ""}
        confirmLabel="Nonaktifkan"
        confirmIcon={PowerOff}
      />
    </>
  );
};
