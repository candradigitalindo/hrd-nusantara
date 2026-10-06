"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch, Controller } from "react-hook-form";
import { Coins, Pencil, Plus, Power, PowerOff, Save, X } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { Card } from "@/components/ui/card";
import { Button, TombolAksi } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { InputRupiah } from "@/components/ui/input-rupiah";
import { Centang } from "@/components/ui/centang";
import { Badge } from "@/components/ui/badge";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { ResponsiveTable, type Kolom } from "@/components/ui/responsive-table";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatRupiah, kodeDariNama } from "@/lib/utils";
import type { Halaman, KomponenGaji } from "@/lib/types";

const LABEL_JENIS: Record<KomponenGaji["type"], string> = { allowance: "Tunjangan", deduction: "Potongan" };
const LABEL_DASAR: Record<NonNullable<KomponenGaji["percentageBase"]>, string> = { basic: "gaji pokok", gross: "penghasilan kotor" };

type FormKomponen = {
  name: string;
  code: string;
  description: string;
  type: KomponenGaji["type"];
  calculation: KomponenGaji["calculation"];
  percentageBase: "" | "basic" | "gross";
  /** String: InputRupiah mengeluarkan digit polos, kotak persen boleh kosong. */
  defaultAmount: string;
  defaultPercentage: string;
  capAmount: string;
  isTaxable: boolean;
  isStatutory: boolean;
};

const KOSONG: FormKomponen = {
  name: "", code: "", description: "", type: "allowance", calculation: "fixed", percentageBase: "",
  defaultAmount: "", defaultPercentage: "", capAmount: "", isTaxable: true, isStatutory: false,
};

/** Decimal dari backend bisa datang sebagai string ("12000000"); formulir memegang digit polos. */
const nominal = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? "" : String(Math.round(Number(v))));
const persenTeks = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? "" : String(Number(v)));

const dariKomponen = (k: KomponenGaji): FormKomponen => ({
  name: k.name,
  code: k.code,
  description: k.description ?? "",
  type: k.type,
  calculation: k.calculation,
  percentageBase: k.percentageBase ?? "",
  defaultAmount: nominal(k.defaultAmount),
  defaultPercentage: persenTeks(k.defaultPercentage),
  capAmount: nominal(k.capAmount),
  isTaxable: k.isTaxable,
  isStatutory: k.isStatutory,
});

/** "Rp 500.000 tetap" atau "1% dari gaji pokok, plafon Rp 12.000.000". */
export const ringkasNilai = (k: Pick<KomponenGaji, "calculation" | "defaultAmount" | "defaultPercentage" | "percentageBase" | "capAmount">) =>
  k.calculation === "fixed"
    ? `${formatRupiah(k.defaultAmount)} tetap`
    : `${k.defaultPercentage ?? "?"}% dari ${k.percentageBase ? LABEL_DASAR[k.percentageBase] : "—"}${k.capAmount !== null && k.capAmount !== undefined ? `, plafon ${formatRupiah(k.capAmount)}` : ""}`;

/**
 * Daftar tunjangan dan potongan (BPJS, PPh 21, transport, …) yang bisa
 * dipasang ke karyawan dari Struktur Gaji di halaman detailnya. Komponen hanya
 * dihitung untuk karyawan yang dipasangi; nilai bawaan di sini dipakai bila
 * tidak ditimpa per karyawan.
 *
 * Kode, jenis, dan cara hitung dikunci setelah dibuat karena slip lama
 * merujuk ke sana — skema ubah backend memang tidak menerimanya. Komponen
 * tidak dihapus, hanya dinonaktifkan: yang nonaktif diabaikan saat
 * penggajian, pasangan per karyawannya tetap tersimpan.
 */
export const TabKomponenGaji = () => {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const bolehBuat = punyaIzin(saya, "payroll.buat");
  const bolehUbah = punyaIzin(saya, "payroll.ubah");

  const [jenis, setJenis] = React.useState<"" | KomponenGaji["type"]>("");
  const [semua, setSemua] = React.useState(false);
  const [form, setForm] = React.useState<{ open: boolean; item: KomponenGaji | null }>({ open: false, item: null });
  const [nonaktif, setNonaktif] = React.useState<KomponenGaji | null>(null);

  // Awalan kunci "komponen-gaji" sama dengan dropdown di panel Struktur Gaji
  // karyawan, jadi satu invalidasi menyegarkan keduanya.
  const komponen = useQuery({
    queryKey: ["komponen-gaji", "kelola", jenis || "semua-jenis", semua ? "semua" : "aktif"],
    queryFn: async () =>
      (await api.get<Halaman<KomponenGaji>>(`/salary-components?includeInactive=${semua}&limit=100${jenis ? `&type=${jenis}` : ""}`)).data.data,
  });

  const f = useForm<FormKomponen>({ defaultValues: KOSONG });
  const { errors, dirtyFields } = f.formState;
  const [nama, caraHitung, tipe] = useWatch({ control: f.control, name: ["name", "calculation", "type"] });
  const item = form.item;

  // Kode disarankan dari nama (kapital, mis. TUNJANGAN_MAKAN) selama belum diketik sendiri; hanya saat membuat.
  React.useEffect(() => {
    if (item || !form.open || dirtyFields.code) return;
    f.setValue("code", kodeDariNama(nama ?? "").toUpperCase());
  }, [nama, item, form.open, dirtyFields.code, f]);

  const bukaForm = (k: KomponenGaji | null) => {
    f.reset(k ? dariKomponen(k) : KOSONG);
    setForm({ open: true, item: k });
  };
  const tutupForm = () => setForm({ open: false, item: null });
  const segarkan = () => qc.invalidateQueries({ queryKey: ["komponen-gaji"] });

  const simpan = useMutation({
    mutationFn: async (v: FormKomponen) => {
      const persentase = v.calculation === "percentage";
      const angka = (s: string) => (s === "" ? null : Number(s));
      if (!item) {
        return (
          await api.post<KomponenGaji>("/salary-components", {
            code: v.code.trim().toUpperCase(),
            name: v.name.trim(),
            ...(v.description.trim() ? { description: v.description.trim() } : {}),
            type: v.type,
            calculation: v.calculation,
            percentageBase: persentase ? v.percentageBase || null : null,
            defaultAmount: persentase ? null : angka(v.defaultAmount),
            defaultPercentage: persentase ? angka(v.defaultPercentage) : null,
            capAmount: persentase ? angka(v.capAmount) : null,
            isTaxable: v.isTaxable,
            isStatutory: v.isStatutory,
          })
        ).data;
      }
      // Hanya bidang yang boleh dan memang berubah.
      const lama = dariKomponen(item);
      const badan: Record<string, unknown> = {};
      if (v.name.trim() !== item.name) badan.name = v.name.trim();
      if (v.description.trim() !== lama.description) badan.description = v.description.trim() || null;
      if (!persentase && v.defaultAmount !== lama.defaultAmount) badan.defaultAmount = angka(v.defaultAmount);
      if (persentase && v.defaultPercentage !== lama.defaultPercentage) badan.defaultPercentage = angka(v.defaultPercentage);
      if (persentase && v.capAmount !== lama.capAmount) badan.capAmount = angka(v.capAmount);
      if (v.isTaxable !== item.isTaxable) badan.isTaxable = v.isTaxable;
      if (Object.keys(badan).length === 0) return null;
      return (await api.put<KomponenGaji>(`/salary-components/${item.id}`, badan)).data;
    },
    onSuccess: (k) => {
      tutupForm();
      if (!k) {
        notifikasi.info("Tidak ada yang diubah", "Komponen dibiarkan seperti semula.");
        return;
      }
      segarkan();
      notifikasi.sukses(item ? "Komponen gaji diperbarui" : "Komponen gaji ditambahkan", `${LABEL_JENIS[k.type]} ${k.name} · ${ringkasNilai(k)}`);
    },
    onError: (e) => notifikasi.galat(e, "Komponen belum tersimpan"),
  });

  const ubahStatus = useMutation({
    mutationFn: async ({ k, aktif }: { k: KomponenGaji; aktif: boolean }) => (await api.put<KomponenGaji>(`/salary-components/${k.id}`, { isActive: aktif })).data,
    onSuccess: (k, v) => {
      segarkan();
      setNonaktif(null);
      if (v.aktif) notifikasi.sukses("Komponen diaktifkan lagi", `${k.name} ikut dihitung lagi pada batch berikutnya untuk karyawan yang dipasangi.`);
      else notifikasi.sukses("Komponen dinonaktifkan", `${k.name} diabaikan saat penggajian; pasangan per karyawan tetap tersimpan.`);
    },
    onError: (e) => {
      setNonaktif(null);
      notifikasi.galat(e, "Status komponen belum berubah");
    },
  });

  const kolom: Kolom<KomponenGaji>[] = [
    {
      key: "komponen",
      header: "Komponen",
      primary: true,
      cell: (k) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{k.name}</span>
            <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">{k.code}</code>
            {k.isStatutory && <Badge tone="info">Regulasi</Badge>}
            {!k.isActive && <Badge>Nonaktif</Badge>}
          </div>
          {k.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{k.description}</p>}
        </div>
      ),
    },
    { key: "jenis", header: "Jenis", cell: (k) => <Badge tone={k.type === "allowance" ? "success" : "danger"}>{LABEL_JENIS[k.type]}</Badge> },
    { key: "nilai", header: "Nilai bawaan", cell: (k) => <span className="tabular-nums">{ringkasNilai(k)}</span> },
    {
      key: "pajak",
      header: "Pajak",
      cell: (k) => (k.type === "deduction" ? <span className="text-muted">—</span> : k.isTaxable ? "Kena pajak" : <span className="text-muted">Tidak kena pajak</span>),
    },
    ...(bolehUbah
      ? [
          {
            key: "aksi",
            header: "",
            className: "text-right",
            cell: (k: KomponenGaji) => (
              <div className="flex justify-end gap-1.5">
                <TombolAksi icon={Pencil} label={`Ubah ${k.name}`} onClick={() => bukaForm(k)} />
                {k.isActive ? (
                  <TombolAksi icon={PowerOff} label={`Nonaktifkan ${k.name}`} tone="bahaya" onClick={() => setNonaktif(k)} />
                ) : (
                  <TombolAksi icon={Power} label={`Aktifkan lagi ${k.name}`} onClick={() => ubahStatus.mutate({ k, aktif: true })} disabled={ubahStatus.isPending} />
                )}
              </div>
            ),
          } satisfies Kolom<KomponenGaji>,
        ]
      : []),
  ];

  const persentase = caraHitung === "percentage";
  const adaSaringan = Boolean(jenis) || semua;

  return (
    <>
      <Card>
        <div className="grid gap-2 border-b border-border p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
          <p className="text-sm text-muted">Dipasang ke karyawan dari Struktur Gaji di halaman detailnya; hanya karyawan yang dipasangi yang dihitung. Nilai bawaan dipakai bila tidak ditimpa per karyawan.</p>
          <Select value={jenis} onChange={(e) => setJenis(e.target.value as "" | KomponenGaji["type"])} aria-label="Jenis komponen" className="sm:w-44">
            <option value="">Semua jenis</option>
            <option value="allowance">Tunjangan</option>
            <option value="deduction">Potongan</option>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={semua} onChange={(e) => setSemua(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
            Tampilkan yang nonaktif
          </label>
          {bolehBuat && (
            <Button size="sm" onClick={() => bukaForm(null)}>
              <Plus className="h-4 w-4" aria-hidden /> Komponen
            </Button>
          )}
        </div>

        {komponen.isLoading ? (
          <SkeletonBaris />
        ) : komponen.isError ? (
          <EmptyState title="Komponen tidak bisa dimuat" description={(komponen.error as Error).message} />
        ) : !komponen.data?.length ? (
          <EmptyState
            icon={Coins}
            title={adaSaringan ? "Tidak ada yang cocok" : "Belum ada komponen gaji"}
            description={adaSaringan ? "Coba ubah saringan jenis atau tampilkan yang nonaktif." : "Tanpa komponen, slip hanya berisi gaji pokok dan lembur. Mulai dari potongan BPJS (persentase dari gaji pokok, dengan plafon) dan tunjangan tetap seperti transport atau makan."}
            action={bolehBuat && !adaSaringan ? <Button onClick={() => bukaForm(null)}><Plus className="h-4 w-4" aria-hidden /> Tambah Komponen</Button> : undefined}
          />
        ) : (
          <ResponsiveTable columns={kolom} rows={komponen.data} rowKey={(k) => k.id} />
        )}
      </Card>

      <Modal
        open={form.open}
        onClose={tutupForm}
        size="lg"
        title={item ? "Ubah Komponen Gaji" : "Komponen Gaji Baru"}
        description={item ? "Berlaku pada batch yang dihitung setelah ini; slip yang sudah disetujui tidak berubah." : "Setelah dibuat, pasangkan ke karyawan dari Struktur Gaji di halaman detailnya."}
        footer={
          <>
            <Button variant="outline" onClick={tutupForm} disabled={simpan.isPending}><X className="h-4 w-4" aria-hidden /> Batal</Button>
            <Button form="form-komponen-gaji" type="submit" loading={simpan.isPending}>
              {!simpan.isPending && <Save className="h-4 w-4" aria-hidden />} Simpan
            </Button>
          </>
        }
      >
        <form id="form-komponen-gaji" onSubmit={f.handleSubmit((v) => simpan.mutate(v))} className="space-y-4" noValidate>
          {item && (
            <Alert tone="info" title="Kode, jenis, dan cara hitung terkunci">
              Slip yang sudah terbit merujuk ke sana. Bila perlu berubah, buat komponen baru lalu nonaktifkan yang lama.
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <Field label="Nama" error={errors.name?.message}>
              <Input
                {...f.register("name", { required: "Nama wajib diisi", validate: (v) => v.trim().length > 0 || "Nama wajib diisi" })}
                placeholder="Tunjangan Makan"
                maxLength={100}
                aria-invalid={Boolean(errors.name)}
              />
            </Field>
            <Field label="Kode" error={errors.code?.message} hint={item ? "Tidak bisa diubah" : "Huruf kapital, angka, garis bawah"}>
              <Input
                {...f.register("code", { required: "Kode wajib diisi", pattern: { value: /^[A-Z0-9_]{2,40}$/, message: "2–40 karakter: huruf kapital, angka, garis bawah" } })}
                placeholder="TJ_MAKAN"
                maxLength={40}
                className="font-mono uppercase"
                disabled={Boolean(item)}
                aria-invalid={Boolean(errors.code)}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Jenis" hint={tipe === "allowance" ? "Menambah penghasilan" : "Mengurangi penghasilan"}>
              <Select {...f.register("type")} disabled={Boolean(item)}>
                <option value="allowance">Tunjangan</option>
                <option value="deduction">Potongan</option>
              </Select>
            </Field>
            <Field label="Cara hitung">
              <Select {...f.register("calculation")} disabled={Boolean(item)}>
                <option value="fixed">Nominal tetap</option>
                <option value="percentage">Persentase</option>
              </Select>
            </Field>
          </div>

          {persentase ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Persen (%)" error={errors.defaultPercentage?.message} hint="Boleh pecahan, mis. 2,5">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  {...f.register("defaultPercentage", {
                    validate: (v, x) => x.calculation !== "percentage" || (v !== "" && Number(v) >= 0 && Number(v) <= 100) || "Isi 0–100",
                  })}
                  aria-invalid={Boolean(errors.defaultPercentage)}
                />
              </Field>
              <Field label="Dasar persentase" error={errors.percentageBase?.message}>
                <Select
                  {...f.register("percentageBase", { validate: (v, x) => x.calculation !== "percentage" || v !== "" || "Pilih dasarnya" })}
                  disabled={Boolean(item)}
                  aria-invalid={Boolean(errors.percentageBase)}
                >
                  <option value="">— Pilih —</option>
                  <option value="basic">Gaji pokok</option>
                  <option value="gross">Penghasilan kotor</option>
                </Select>
              </Field>
              <Field label="Plafon dasar" hint="Kosongkan bila tanpa plafon">
                <Controller control={f.control} name="capAmount" render={({ field }) => <InputRupiah {...field} />} />
              </Field>
            </div>
          ) : (
            <Field label="Nominal bawaan" error={errors.defaultAmount?.message} hint="Bisa ditimpa per karyawan saat dipasang">
              <Controller
                control={f.control}
                name="defaultAmount"
                rules={{ validate: (v, x) => x.calculation !== "fixed" || v !== "" || "Isi nominalnya; 0 boleh bila selalu ditimpa per karyawan" }}
                render={({ field, fieldState }) => <InputRupiah {...field} aria-invalid={Boolean(fieldState.error)} />}
              />
            </Field>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            {tipe === "allowance" && <Centang label="Kena pajak" hint="Ikut menambah dasar pengenaan PPh 21" {...f.register("isTaxable")} />}
            <Centang label="Berasal dari regulasi" hint="BPJS, PPh 21, dan sejenisnya; ditandai agar tidak dinonaktifkan sembarangan" disabled={Boolean(item)} {...f.register("isStatutory")} />
          </div>

          <Field label="Keterangan" error={errors.description?.message} hint="Opsional, mis. dasar aturan dan porsi perusahaan">
            <Textarea rows={2} {...f.register("description", { maxLength: { value: 500, message: "Maksimal 500 karakter" } })} />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(nonaktif)}
        onClose={() => setNonaktif(null)}
        onConfirm={() => nonaktif && ubahStatus.mutate({ k: nonaktif, aktif: false })}
        loading={ubahStatus.isPending}
        danger
        title="Nonaktifkan komponen gaji?"
        description={
          nonaktif
            ? `${nonaktif.name} diabaikan saat penggajian dihitung, untuk semua karyawan yang dipasangi.${nonaktif.isStatutory ? " Komponen ini berasal dari regulasi; pastikan kewajibannya ditangani dengan cara lain." : ""} Pasangan per karyawan tetap tersimpan dan komponen bisa diaktifkan lagi kapan saja.`
            : ""
        }
        confirmLabel="Nonaktifkan"
        confirmIcon={PowerOff}
      />
    </>
  );
};
