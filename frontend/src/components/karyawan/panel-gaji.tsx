"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { Wallet, Plus, History, Save, X, Unlink } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button, TombolAksi } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRupiah, formatTanggal, LABEL_SALARY_TYPE } from "@/lib/utils";
import type { GajiPokok, KomponenKaryawan, KomponenGaji, Halaman } from "@/lib/types";

type FormGaji = { salaryType: "monthly" | "daily" | "hourly"; baseAmount: string; effectiveFrom: string; note: string };
type FormKomponen = { componentId: string; amount: string; percentage: string; effectiveFrom: string; note: string };

const hariIni = () => new Date().toISOString().slice(0, 10);

/**
 * Struktur gaji seorang karyawan: gaji pokok yang berlaku, riwayatnya, dan
 * komponen tunjangan/potongan yang melekat. Hanya HR — angka gaji orang
 * lain bukan urusan manajer sekalipun.
 */
export const PanelGaji = ({ employeeId }: { employeeId: string }) => {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const bolehTetapkan = punyaIzin(saya, "payroll.buat", "payroll.ubah");
  const bolehTambah = punyaIzin(saya, "payroll.buat");
  const bolehLepas = punyaIzin(saya, "payroll.hapus");
  const [gajiBuka, setGajiBuka] = React.useState(false);
  const [komponenBuka, setKomponenBuka] = React.useState(false);
  const [riwayatBuka, setRiwayatBuka] = React.useState(false);
  const [hapus, setHapus] = React.useState<KomponenKaryawan | null>(null);

  const gaji = useQuery({
    queryKey: ["gaji-karyawan", employeeId],
    queryFn: async () => (await api.get<{ salaries: GajiPokok[]; components: KomponenKaryawan[] }>(`/employees/${employeeId}/salary`)).data,
  });

  const komponen = useQuery({
    queryKey: ["komponen-gaji"],
    queryFn: async () => (await api.get<Halaman<KomponenGaji> | KomponenGaji[]>("/salary-components?limit=100")).data,
    select: (d) => (Array.isArray(d) ? d : d.data).filter((k) => k.isActive),
    enabled: komponenBuka,
  });

  const fg = useForm<FormGaji>({ defaultValues: { salaryType: "monthly", baseAmount: "", effectiveFrom: hariIni(), note: "" } });
  const fk = useForm<FormKomponen>({ defaultValues: { componentId: "", amount: "", percentage: "", effectiveFrom: hariIni(), note: "" } });
  const segarkan = () => qc.invalidateQueries({ queryKey: ["gaji-karyawan", employeeId] });

  const berlaku = (gaji.data?.salaries ?? []).find((s) => !s.effectiveTo) ?? gaji.data?.salaries[0];
  const komponenAktif = (gaji.data?.components ?? []).filter((c) => !c.effectiveTo || new Date(c.effectiveTo) >= new Date());
  const komponenIdDipilih = useWatch({ control: fk.control, name: "componentId" });
  const komponenDipilih = (komponen.data ?? []).find((k) => k.id === komponenIdDipilih);

  const setGaji = useMutation({
    mutationFn: async (v: FormGaji) => (await api.post<GajiPokok>(`/employees/${employeeId}/salary`, { salaryType: v.salaryType, baseAmount: Number(v.baseAmount), effectiveFrom: v.effectiveFrom, ...(v.note ? { note: v.note } : {}) })).data,
    onSuccess: (g) => { segarkan(); notifikasi.sukses("Gaji pokok ditetapkan", `${formatRupiah(g.baseAmount)} ${LABEL_SALARY_TYPE[g.salaryType]?.toLowerCase()} berlaku sejak ${formatTanggal(g.effectiveFrom)}. Gaji sebelumnya ditutup otomatis.`); setGajiBuka(false); fg.reset({ salaryType: "monthly", baseAmount: "", effectiveFrom: hariIni(), note: "" }); },
    onError: (e) => notifikasi.galat(e, "Gaji gagal ditetapkan"),
  });

  const tambahKomponen = useMutation({
    mutationFn: async (v: FormKomponen) => (await api.post(`/employees/${employeeId}/salary-components`, {
      componentId: v.componentId, effectiveFrom: v.effectiveFrom,
      ...(v.amount ? { amount: Number(v.amount) } : {}), ...(v.percentage ? { percentage: Number(v.percentage) } : {}), ...(v.note ? { note: v.note } : {}),
    })).data,
    onSuccess: () => { segarkan(); notifikasi.sukses("Komponen ditambahkan", "Akan ikut dihitung pada batch penggajian berikutnya."); setKomponenBuka(false); fk.reset({ componentId: "", amount: "", percentage: "", effectiveFrom: hariIni(), note: "" }); },
    onError: (e) => notifikasi.galat(e, "Komponen gagal ditambahkan"),
  });

  const hapusKomponen = useMutation({
    mutationFn: async (k: KomponenKaryawan) => api.delete(`/employee-salary-components/${k.id}`),
    onSuccess: (_, k) => { segarkan(); notifikasi.sukses("Komponen dilepas", `${k.component.name} tidak lagi dihitung untuk karyawan ini.`); setHapus(null); },
    onError: (e) => notifikasi.galat(e),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Struktur Gaji</CardTitle>
          <CardDescription>Gaji pokok dan komponen yang dihitung saat penggajian</CardDescription>
        </div>
        <div className="flex gap-1">
          {(gaji.data?.salaries.length ?? 0) > 1 && <Button size="sm" variant="ghost" onClick={() => setRiwayatBuka(true)} aria-label="Riwayat gaji"><History className="h-4 w-4" aria-hidden /></Button>}
          {bolehTetapkan && <Button size="sm" onClick={() => setGajiBuka(true)}><Wallet className="h-4 w-4" aria-hidden /> {berlaku ? "Ubah" : "Tetapkan"}</Button>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {gaji.isLoading ? <Skeleton className="h-24" /> : berlaku ? (
          <div className="rounded-xl bg-surface-2 p-4">
            <p className="text-xs uppercase tracking-wide text-muted">Gaji pokok · {LABEL_SALARY_TYPE[berlaku.salaryType] ?? berlaku.salaryType}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{formatRupiah(berlaku.baseAmount)}</p>
            <p className="mt-1 text-xs text-muted">Berlaku sejak {formatTanggal(berlaku.effectiveFrom)}{berlaku.note ? ` · ${berlaku.note}` : ""}</p>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted">Gaji pokok belum ditetapkan — karyawan ini akan <span className="font-medium text-warning">dilewati</span> saat penggajian dihitung.</p>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">Komponen</p>
            {bolehTambah && <Button size="sm" variant="outline" onClick={() => setKomponenBuka(true)}><Plus className="h-4 w-4" aria-hidden /> Tambah</Button>}
          </div>
          {komponenAktif.length === 0 ? (
            <p className="text-sm text-muted">Belum ada tunjangan atau potongan khusus. Komponen wajib (BPJS) tetap dihitung otomatis.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {komponenAktif.map((k) => (
                <li key={k.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <Badge tone={k.component.type === "allowance" ? "success" : "danger"}>{k.component.type === "allowance" ? "Tunjangan" : "Potongan"}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{k.component.name}</p>
                    <p className="text-xs text-muted">sejak {formatTanggal(k.effectiveFrom)}</p>
                  </div>
                  <span className="tabular-nums">{k.amount !== null ? formatRupiah(k.amount) : k.percentage !== null ? `${k.percentage}%` : "bawaan"}</span>
                  {bolehLepas && <TombolAksi icon={Unlink} label={`Lepas ${k.component.name}`} tone="bahaya" onClick={() => setHapus(k)} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>

      <Modal open={gajiBuka} onClose={() => setGajiBuka(false)} title={berlaku ? "Ubah Gaji Pokok" : "Tetapkan Gaji Pokok"} description="Gaji yang berlaku sebelumnya ditutup otomatis sehari sebelum tanggal berlaku yang baru"
        footer={<><Button variant="outline" onClick={() => setGajiBuka(false)}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button form="form-gaji" type="submit" loading={setGaji.isPending}>{!setGaji.isPending && <Save className="h-4 w-4" aria-hidden />} Simpan</Button></>}>
        <form id="form-gaji" onSubmit={fg.handleSubmit((v) => setGaji.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Jenis">
            <Select {...fg.register("salaryType")}>{Object.entries(LABEL_SALARY_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          </Field>
          <Field label="Nominal (Rp)" error={fg.formState.errors.baseAmount?.message}>
            <Input type="number" inputMode="numeric" min={0} step={1000} {...fg.register("baseAmount", { required: "Wajib diisi", min: { value: 1, message: "Harus lebih dari 0" } })} />
          </Field>
          <Field label="Berlaku sejak" error={fg.formState.errors.effectiveFrom?.message}>
            <Input type="date" {...fg.register("effectiveFrom", { required: "Wajib diisi" })} />
          </Field>
          <Field label="Catatan" className="sm:col-span-2"><Textarea rows={2} {...fg.register("note")} placeholder="Kenaikan berkala, promosi, …" /></Field>
        </form>
      </Modal>

      <Modal open={komponenBuka} onClose={() => setKomponenBuka(false)} title="Tambah Komponen" description="Kosongkan nominal/persentase untuk memakai nilai bawaan komponen"
        footer={<><Button variant="outline" onClick={() => setKomponenBuka(false)}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button form="form-komponen" type="submit" loading={tambahKomponen.isPending}>{!tambahKomponen.isPending && <Plus className="h-4 w-4" aria-hidden />} Tambah</Button></>}>
        <form id="form-komponen" onSubmit={fk.handleSubmit((v) => tambahKomponen.mutate(v))} className="space-y-4" noValidate>
          <Field label="Komponen" error={fk.formState.errors.componentId?.message}>
            <Select {...fk.register("componentId", { required: "Pilih komponen" })}>
              <option value="">— Pilih —</option>
              {(komponen.data ?? []).map((k) => <option key={k.id} value={k.id}>{k.type === "allowance" ? "+" : "−"} {k.name} ({k.calculation === "fixed" ? formatRupiah(k.defaultAmount) : `${k.defaultPercentage ?? "?"}% ${k.percentageBase ?? ""}`})</option>)}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {komponenDipilih?.calculation === "percentage" ? (
              <Field label="Persentase khusus (%)" hint={`Bawaan ${komponenDipilih.defaultPercentage ?? "—"}%`}><Input type="number" step="0.01" min={0} max={100} {...fk.register("percentage")} /></Field>
            ) : (
              <Field label="Nominal khusus (Rp)" hint={komponenDipilih ? `Bawaan ${formatRupiah(komponenDipilih.defaultAmount)}` : undefined}><Input type="number" min={0} step={1000} {...fk.register("amount")} /></Field>
            )}
            <Field label="Berlaku sejak"><Input type="date" {...fk.register("effectiveFrom", { required: true })} /></Field>
          </div>
          <Field label="Catatan"><Textarea rows={2} {...fk.register("note")} /></Field>
        </form>
      </Modal>

      <Modal open={riwayatBuka} onClose={() => setRiwayatBuka(false)} title="Riwayat Gaji Pokok" footer={<Button onClick={() => setRiwayatBuka(false)}><X className="h-4 w-4" aria-hidden /> Tutup</Button>}>
        <ul className="divide-y divide-border text-sm">
          {(gaji.data?.salaries ?? []).map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
              <div><p className="font-medium tabular-nums">{formatRupiah(s.baseAmount)} <span className="text-xs font-normal text-muted">{LABEL_SALARY_TYPE[s.salaryType]}</span></p><p className="text-xs text-muted">{formatTanggal(s.effectiveFrom)} – {s.effectiveTo ? formatTanggal(s.effectiveTo) : "sekarang"}{s.note ? ` · ${s.note}` : ""}</p></div>
              {!s.effectiveTo && <Badge tone="success" dot>Berlaku</Badge>}
            </li>
          ))}
        </ul>
      </Modal>

      <ConfirmDialog open={Boolean(hapus)} onClose={() => setHapus(null)} onConfirm={() => hapus && hapusKomponen.mutate(hapus)} loading={hapusKomponen.isPending} danger
        title="Lepas komponen?" description={`${hapus?.component.name ?? ""} tidak akan dihitung lagi untuk karyawan ini mulai batch berikutnya. Slip yang sudah disetujui tidak berubah.`} confirmLabel="Lepas" confirmIcon={Unlink} />
    </Card>
  );
};
