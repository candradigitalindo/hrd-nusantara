"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch, Controller } from "react-hook-form";
import { Building2, CalendarRange, Pencil, Plus, Power, PowerOff, Save, Star, X } from "lucide-react";
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
import { cn, kodeDariNama } from "@/lib/utils";
import { formatHariPekan } from "@/components/shift/util-shift";
import type { Departemen, Halaman, PolaKerja } from "@/lib/types";

export const LABEL_JENIS_POLA: Record<string, string> = { fixed: "Hari tetap", shift: "Ikut roster" };

/** Senin lebih dulu seperti kalender kerja; nilainya mengikuti backend (0 = Minggu). */
const HARI = [
  { nilai: 1, pendek: "Sen", panjang: "Senin" },
  { nilai: 2, pendek: "Sel", panjang: "Selasa" },
  { nilai: 3, pendek: "Rab", panjang: "Rabu" },
  { nilai: 4, pendek: "Kam", panjang: "Kamis" },
  { nilai: 5, pendek: "Jum", panjang: "Jumat" },
  { nilai: 6, pendek: "Sab", panjang: "Sabtu" },
  { nilai: 0, pendek: "Min", panjang: "Minggu" },
];

type FormPola = {
  name: string;
  code: string;
  description: string;
  type: "fixed" | "shift";
  workingWeekdays: number[];
  observesPublicHolidays: boolean;
  isDefault: boolean;
};

const KOSONG: FormPola = { name: "", code: "", description: "", type: "fixed", workingWeekdays: [1, 2, 3, 4, 5, 6], observesPublicHolidays: true, isDefault: false };

const dariPola = (p: PolaKerja): FormPola => ({
  name: p.name,
  code: p.code,
  description: p.description ?? "",
  type: p.type === "shift" ? "shift" : "fixed",
  workingWeekdays: [...p.workingWeekdays].sort((a, b) => a - b),
  observesPublicHolidays: p.observesPublicHolidays,
  isDefault: p.isDefault,
});

/** Ringkasan satu pola untuk sel tabel dan panel karyawan. */
export const RingkasanPola = ({ pola }: { pola: Pick<PolaKerja, "type" | "workingWeekdays" | "observesPublicHolidays"> }) => (
  <span>
    {LABEL_JENIS_POLA[pola.type] ?? pola.type} · {formatHariPekan(pola.workingWeekdays)} · {pola.observesPublicHolidays ? "libur saat libur nasional" : "tetap buka saat libur nasional"}
  </span>
);

/**
 * Pola hari kerja: menentukan hari mana yang dihitung saat cuti memotong
 * saldo. Berjenjang — pola milik karyawan, lalu pola departemennya, lalu pola
 * bawaan perusahaan — supaya HR cukup menetapkan satu pola per departemen dan
 * memberi pengecualian hanya pada orang yang memang berbeda (di halaman
 * detail karyawan). Pola tidak dihapus, hanya dinonaktifkan: yang memakainya
 * otomatis jatuh ke jenjang berikutnya.
 */
export const TabPolaKerja = () => {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const bolehBuat = punyaIzin(saya, "pengaturan_cuti.buat");
  const bolehUbah = punyaIzin(saya, "pengaturan_cuti.ubah");

  const [semua, setSemua] = React.useState(false);
  const [form, setForm] = React.useState<{ open: boolean; item: PolaKerja | null }>({ open: false, item: null });
  const [nonaktif, setNonaktif] = React.useState<PolaKerja | null>(null);

  const pola = useQuery({
    queryKey: ["pola-kerja", semua ? "semua" : "aktif"],
    queryFn: async () => (await api.get<Halaman<PolaKerja>>(`/work-patterns?includeInactive=${semua}&limit=100`)).data.data,
  });
  const departemen = useQuery({
    queryKey: ["departemen", "semua"],
    queryFn: async () => (await api.get<Halaman<Departemen>>("/departments?limit=100")).data.data,
  });

  const daftar = pola.data ?? [];
  const aktif = daftar.filter((p) => p.isActive);
  const bawaan = aktif.find((p) => p.isDefault) ?? null;
  const dipakaiDept = (id: string) => (departemen.data ?? []).filter((d) => d.workPatternId === id).length;

  const f = useForm<FormPola>({ defaultValues: KOSONG });
  const { errors, dirtyFields } = f.formState;
  const [nama, jenis, bawaanDicentang] = useWatch({ control: f.control, name: ["name", "type", "isDefault"] });
  const item = form.item;

  // Kode disarankan dari nama saat membuat; setelah tersimpan kode tidak bisa diubah.
  React.useEffect(() => {
    if (item || !form.open || dirtyFields.code) return;
    f.setValue("code", kodeDariNama(nama ?? ""));
  }, [nama, item, form.open, dirtyFields.code, f]);

  const bukaForm = (p: PolaKerja | null) => {
    f.reset(p ? dariPola(p) : KOSONG);
    setForm({ open: true, item: p });
  };
  const tutupForm = () => setForm({ open: false, item: null });
  const segarkan = () => {
    qc.invalidateQueries({ queryKey: ["pola-kerja"] });
    qc.invalidateQueries({ queryKey: ["departemen"] });
    qc.invalidateQueries({ queryKey: ["karyawan"] });
  };

  const simpan = useMutation({
    mutationFn: async (v: FormPola) => {
      const hari = [...v.workingWeekdays].sort((a, b) => a - b);
      if (!item) {
        return (
          await api.post<PolaKerja>("/work-patterns", {
            code: v.code.trim().toLowerCase(),
            name: v.name.trim(),
            ...(v.description.trim() ? { description: v.description.trim() } : {}),
            type: v.type,
            workingWeekdays: hari,
            observesPublicHolidays: v.observesPublicHolidays,
            isDefault: v.isDefault,
          })
        ).data;
      }
      // Hanya yang berubah; kode tidak termasuk karena skema ubah backend tidak menerimanya.
      const badan: Record<string, unknown> = {};
      if (v.name.trim() !== item.name) badan.name = v.name.trim();
      if (v.description.trim() !== (item.description ?? "")) badan.description = v.description.trim() || null;
      if (v.type !== item.type) badan.type = v.type;
      if (hari.join(",") !== [...item.workingWeekdays].sort((a, b) => a - b).join(",")) badan.workingWeekdays = hari;
      if (v.observesPublicHolidays !== item.observesPublicHolidays) badan.observesPublicHolidays = v.observesPublicHolidays;
      if (v.isDefault !== item.isDefault) badan.isDefault = v.isDefault;
      if (Object.keys(badan).length === 0) return null;
      return (await api.put<PolaKerja>(`/work-patterns/${item.id}`, badan)).data;
    },
    onSuccess: (p) => {
      tutupForm();
      if (!p) {
        notifikasi.info("Tidak ada yang diubah", "Pola kerja dibiarkan seperti semula.");
        return;
      }
      segarkan();
      notifikasi.sukses(
        item ? "Pola kerja diperbarui" : "Pola kerja ditambahkan",
        `${p.name} · ${LABEL_JENIS_POLA[p.type] ?? p.type} · ${formatHariPekan(p.workingWeekdays)}${p.isDefault ? " · pola bawaan" : ""}`
      );
    },
    onError: (e) => notifikasi.galat(e, "Pola kerja belum tersimpan"),
  });

  const ubahStatus = useMutation({
    mutationFn: async ({ p, badan }: { p: PolaKerja; badan: { isActive?: boolean; isDefault?: boolean } }) =>
      (await api.put<PolaKerja>(`/work-patterns/${p.id}`, badan)).data,
    onSuccess: (p, v) => {
      segarkan();
      setNonaktif(null);
      if (v.badan.isDefault) notifikasi.sukses("Pola bawaan diganti", `${p.name} dipakai karyawan yang tidak punya pola sendiri maupun lewat departemen.`);
      else if (v.badan.isActive === false) notifikasi.sukses("Pola kerja dinonaktifkan", `${p.name} tidak bisa dipilih lagi. Yang memakainya mengikuti pola departemen atau bawaan.`);
      else notifikasi.sukses("Pola kerja diaktifkan lagi", `${p.name} bisa dipilih kembali.`);
    },
    onError: (e) => {
      setNonaktif(null);
      notifikasi.galat(e, "Pola kerja belum berubah");
    },
  });

  const tetapkanDept = useMutation({
    mutationFn: async ({ d, polaId }: { d: Departemen; polaId: string | null }) =>
      (await api.patch<{ id: string; name: string; workPatternId: string | null }>(`/departments/${d.id}/work-pattern`, { workPatternId: polaId })).data,
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["departemen"] });
      qc.invalidateQueries({ queryKey: ["karyawan"] });
      const nama = v.polaId ? daftar.find((p) => p.id === v.polaId)?.name : null;
      notifikasi.sukses("Pola departemen diperbarui", `${v.d.name} ${nama ? `memakai ${nama}` : "kembali mengikuti pola bawaan perusahaan"}.`);
    },
    onError: (e) => notifikasi.galat(e, "Pola departemen belum berubah"),
  });

  const kolom: Kolom<PolaKerja>[] = [
    {
      key: "pola",
      header: "Pola kerja",
      primary: true,
      cell: (p) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{p.name}</span>
            <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">{p.code}</code>
            {p.isDefault && <Badge tone="primary">Bawaan</Badge>}
            {!p.isActive && <Badge>Nonaktif</Badge>}
          </div>
          {p.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{p.description}</p>}
        </div>
      ),
    },
    { key: "jenis", header: "Jenis", cell: (p) => <Badge tone={p.type === "shift" ? "info" : "neutral"}>{LABEL_JENIS_POLA[p.type] ?? p.type}</Badge> },
    {
      key: "hari",
      header: "Hari kerja",
      cell: (p) => (
        <span>
          {formatHariPekan(p.workingWeekdays)}
          {p.type === "shift" && <span className="block text-xs text-muted">cadangan bila roster belum terbit</span>}
        </span>
      ),
    },
    { key: "libur", header: "Libur nasional", cell: (p) => (p.observesPublicHolidays ? <span className="text-muted">Libur</span> : <Badge tone="warning">Tetap buka</Badge>) },
    { key: "dipakai", header: "Departemen", cell: (p) => <span className="tabular-nums">{dipakaiDept(p.id)}</span> },
    ...(bolehUbah
      ? [
          {
            key: "aksi",
            header: "",
            className: "text-right",
            cell: (p: PolaKerja) => (
              <div className="flex justify-end gap-1.5">
                {p.isActive && !p.isDefault && (
                  <TombolAksi icon={Star} label={`Jadikan ${p.name} pola bawaan`} onClick={() => ubahStatus.mutate({ p, badan: { isDefault: true } })} disabled={ubahStatus.isPending} />
                )}
                <TombolAksi icon={Pencil} label={`Ubah ${p.name}`} onClick={() => bukaForm(p)} />
                {p.isActive ? (
                  !p.isDefault && <TombolAksi icon={PowerOff} label={`Nonaktifkan ${p.name}`} tone="bahaya" onClick={() => setNonaktif(p)} />
                ) : (
                  <TombolAksi icon={Power} label={`Aktifkan lagi ${p.name}`} onClick={() => ubahStatus.mutate({ p, badan: { isActive: true } })} disabled={ubahStatus.isPending} />
                )}
              </div>
            ),
          } satisfies Kolom<PolaKerja>,
        ]
      : []),
  ];

  return (
    <>
      {!pola.isLoading && !bawaan && (
        <Alert tone="warning" title="Belum ada pola bawaan">
          Karyawan tanpa pola sendiri maupun pola departemen dianggap bekerja Senin–Sabtu dan libur pada hari libur nasional. Tandai satu pola sebagai bawaan supaya hitungannya jelas.
        </Alert>
      )}

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">Hari yang dihitung saat cuti memotong saldo. Berlaku berjenjang: pola karyawan, lalu pola departemen, lalu pola bawaan.</p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={semua} onChange={(e) => setSemua(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
              Tampilkan yang nonaktif
            </label>
            {bolehBuat && (
              <Button size="sm" onClick={() => bukaForm(null)}>
                <Plus className="h-4 w-4" aria-hidden /> Pola Kerja
              </Button>
            )}
          </div>
        </div>

        {pola.isLoading ? (
          <SkeletonBaris />
        ) : pola.isError ? (
          <EmptyState title="Pola kerja tidak bisa dimuat" description={(pola.error as Error).message} />
        ) : !daftar.length ? (
          <EmptyState
            icon={CalendarRange}
            title="Belum ada pola kerja"
            description="Contoh: Kantor Senin–Sabtu (hari tetap, libur nasional dihormati) dan Outlet (ikut roster, tetap buka saat libur nasional)."
            action={bolehBuat && <Button onClick={() => bukaForm(null)}><Plus className="h-4 w-4" aria-hidden /> Tambah Pola Kerja</Button>}
          />
        ) : (
          <ResponsiveTable columns={kolom} rows={daftar} rowKey={(p) => p.id} />
        )}
      </Card>

      <Card>
        <div className="border-b border-border p-3">
          <p className="flex items-center gap-2 text-sm font-medium"><Building2 className="h-4 w-4 text-muted" aria-hidden /> Pola per departemen</p>
          <p className="mt-0.5 text-sm text-muted">Karyawan mengikuti pola departemennya, kecuali diberi pola sendiri di halaman detail karyawan.</p>
        </div>
        {departemen.isLoading ? (
          <SkeletonBaris jumlah={3} />
        ) : !departemen.data?.length ? (
          <EmptyState icon={Building2} title="Belum ada departemen" description="Departemen dibuat di halaman Organisasi." />
        ) : (
          <ul className="divide-y divide-border">
            {departemen.data.map((d) => {
              const polaDept = d.workPatternId ? daftar.find((p) => p.id === d.workPatternId) ?? null : null;
              const nonaktifTerpasang = d.workPatternId && (!polaDept || !polaDept.isActive);
              return (
                <li key={d.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{d.name}</p>
                    <p className="text-xs text-muted">
                      {d._count.employees} karyawan · {d.workPatternId ? (polaDept?.name ?? d.workPattern?.name ?? "pola") : `ikut bawaan${bawaan ? ` (${bawaan.name})` : " (Senin–Sabtu)"}`}
                      {nonaktifTerpasang ? " · pola nonaktif, karyawan jatuh ke bawaan" : ""}
                    </p>
                  </div>
                  {bolehUbah && (
                    <Select
                      value={d.workPatternId ?? ""}
                      onChange={(e) => tetapkanDept.mutate({ d, polaId: e.target.value || null })}
                      disabled={tetapkanDept.isPending}
                      aria-label={`Pola kerja departemen ${d.name}`}
                      className="sm:w-64"
                    >
                      <option value="">Ikut bawaan perusahaan</option>
                      {aktif.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      {nonaktifTerpasang && d.workPatternId && <option value={d.workPatternId}>{(polaDept?.name ?? d.workPattern?.name ?? "Pola")} (nonaktif)</option>}
                    </Select>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Modal
        open={form.open}
        onClose={tutupForm}
        size="lg"
        title={item ? "Ubah Pola Kerja" : "Pola Kerja Baru"}
        description={item ? "Berlaku untuk perhitungan cuti berikutnya; pengajuan yang sudah dihitung tidak berubah." : "Pola dipasang ke departemen di bawah, atau ke karyawan tertentu dari halaman detailnya."}
        footer={
          <>
            <Button variant="outline" onClick={tutupForm} disabled={simpan.isPending}><X className="h-4 w-4" aria-hidden /> Batal</Button>
            <Button form="form-pola-kerja" type="submit" loading={simpan.isPending}>
              {!simpan.isPending && <Save className="h-4 w-4" aria-hidden />} Simpan
            </Button>
          </>
        }
      >
        <form id="form-pola-kerja" onSubmit={f.handleSubmit((v) => simpan.mutate(v))} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <Field label="Nama" error={errors.name?.message}>
              <Input
                {...f.register("name", { required: "Nama wajib diisi", validate: (v) => v.trim().length > 0 || "Nama wajib diisi" })}
                placeholder="Kantor Pusat"
                maxLength={100}
                aria-invalid={Boolean(errors.name)}
              />
            </Field>
            <Field label="Kode" error={errors.code?.message} hint={item ? "Kode tidak bisa diubah setelah tersimpan" : "Huruf kecil, angka, garis bawah"}>
              <Input
                {...f.register("code", { required: "Kode wajib diisi", pattern: { value: /^[a-z0-9_]{2,40}$/, message: "2–40 karakter: huruf kecil, angka, garis bawah" } })}
                placeholder="kantor_pusat"
                maxLength={40}
                className="font-mono"
                disabled={Boolean(item)}
                aria-invalid={Boolean(errors.code)}
              />
            </Field>
          </div>

          <Field label="Jenis" hint={jenis === "shift" ? "Hari kerjanya dibaca dari roster shift; hari di bawah hanya cadangan bila jadwal periode itu belum terbit" : "Hari kerjanya sama tiap pekan"}>
            <Select {...f.register("type")}>
              <option value="fixed">Hari tetap — kantor</option>
              <option value="shift">Ikut roster — outlet dan hotel</option>
            </Select>
          </Field>

          <Controller
            control={f.control}
            name="workingWeekdays"
            rules={{ validate: (v) => v.length > 0 || "Pilih minimal satu hari kerja" }}
            render={({ field, fieldState }) => (
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">Hari kerja</legend>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Hari kerja">
                  {HARI.map((h) => {
                    const dipilih = field.value.includes(h.nilai);
                    return (
                      <button
                        key={h.nilai}
                        type="button"
                        role="checkbox"
                        aria-checked={dipilih}
                        aria-label={h.panjang}
                        onClick={() => field.onChange(dipilih ? field.value.filter((x) => x !== h.nilai) : [...field.value, h.nilai])}
                        className={cn(
                          "h-9 min-w-12 rounded-lg border px-3 text-sm font-medium transition-colors",
                          dipilih ? "border-primary bg-primary-soft text-primary" : "border-border text-muted hover:bg-surface-2"
                        )}
                      >
                        {h.pendek}
                      </button>
                    );
                  })}
                </div>
                {fieldState.error ? (
                  <p role="alert" className="mt-1.5 text-xs text-danger">{fieldState.error.message}</p>
                ) : (
                  <p className="mt-1.5 text-xs text-muted">{formatHariPekan(field.value)}</p>
                )}
              </fieldset>
            )}
          />

          <div className="grid gap-2 sm:grid-cols-2">
            <Centang label="Libur saat libur nasional" hint="Matikan untuk hotel dan restoran yang tetap buka" {...f.register("observesPublicHolidays")} />
            <Centang label="Pola bawaan perusahaan" hint="Dipakai karyawan yang tidak punya pola sendiri maupun lewat departemen" {...f.register("isDefault")} />
          </div>
          {bawaanDicentang && bawaan && bawaan.id !== item?.id && (
            <Alert tone="info" title={`Menggantikan ${bawaan.name}`}>Hanya boleh ada satu pola bawaan; yang lama dilepas otomatis.</Alert>
          )}

          <Field label="Keterangan" error={errors.description?.message} hint="Opsional">
            <Textarea rows={2} {...f.register("description", { maxLength: { value: 500, message: "Maksimal 500 karakter" } })} />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(nonaktif)}
        onClose={() => setNonaktif(null)}
        onConfirm={() => nonaktif && ubahStatus.mutate({ p: nonaktif, badan: { isActive: false } })}
        loading={ubahStatus.isPending}
        danger
        title="Nonaktifkan pola kerja?"
        description={
          nonaktif
            ? `${nonaktif.name} tidak bisa dipilih lagi.${dipakaiDept(nonaktif.id) > 0 ? ` ${dipakaiDept(nonaktif.id)} departemen yang memakainya` : " Departemen dan karyawan yang memakainya"} mengikuti pola bawaan perusahaan sampai dipindahkan. Bisa diaktifkan lagi kapan saja.`
            : ""
        }
        confirmLabel="Nonaktifkan"
        confirmIcon={PowerOff}
      />
    </>
  );
};
