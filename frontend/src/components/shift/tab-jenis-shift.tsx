"use client";

import * as React from "react";
import axios from "axios";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { Clock, Lock, Pencil, Plus, PowerOff, Save, X } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { useSesi, punyaIzin, bolehHr } from "@/hooks/use-sesi";
import { Card } from "@/components/ui/card";
import { Button, TombolAksi, PenandaAksi } from "@/components/ui/button";
import { Input, Select, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { ResponsiveTable, type Kolom } from "@/components/ui/responsive-table";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import type { Departemen, JenisShift, WarnaJenisShift } from "@/lib/types";
import { ChipJenis } from "./chip-jenis";
import { KUNCI_WARNA, WARNA_JENIS, formatIstirahat, lintasMalam, menitShift } from "./util-shift";

type FormJenis = {
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  breakDuration: string;
  color: WarnaJenisShift;
  departmentId: string;
};

const KOSONG: FormJenis = { name: "", code: "", startTime: "07:00", endTime: "15:00", breakDuration: "1", color: "teal", departmentId: "" };

/** Jam kerja satu jenis, dengan penanda bila selesainya keesokan hari. */
export const JamJenis = ({ mulai, selesai }: { mulai: string; selesai: string }) => (
  <span className="inline-flex flex-wrap items-center gap-1.5 tabular-nums">
    {mulai}–{selesai}
    {lintasMalam(mulai, selesai) && <Badge tone="info" className="px-1.5">+1 hari</Badge>}
  </span>
);

/**
 * Daftar jenis shift (Pagi, Siang, Malam, …) yang menjadi bahan penugasan
 * berulang. Mengubah jam sebuah jenis ikut mengubah shift ke depan yang
 * dibuat darinya, jadi formulirnya memperingatkan sebelum menyimpan.
 */
export const TabJenisShift = ({ departemen }: { departemen: Departemen[] }) => {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const hr = bolehHr(saya?.role);
  const bolehBuat = punyaIzin(saya, "shift.buat");
  const bolehUbah = punyaIzin(saya, "shift.ubah");
  const bolehHapus = punyaIzin(saya, "shift.hapus");

  const [semua, setSemua] = React.useState(false);
  const [form, setForm] = React.useState<{ open: boolean; item: JenisShift | null }>({ open: false, item: null });
  const [nonaktif, setNonaktif] = React.useState<JenisShift | null>(null);

  const jenis = useQuery({
    queryKey: ["shift-jenis", semua ? "semua" : "aktif"],
    queryFn: async () => (await api.get<{ data: JenisShift[] }>(`/shifts/templates?includeInactive=${semua}`)).data.data,
  });

  // Manajer hanya mengelola jenis milik departemennya; jenis untuk semua
  // departemen dibuat HR dan hanya boleh diubah HR (server menolak 403).
  const bisaDikelola = (j: JenisShift) => hr || (j.departmentId !== null && j.departmentId === saya?.departmentId);

  const f = useForm<FormJenis>({ defaultValues: KOSONG });
  const [mulai, selesai, istirahat, warna, kode, nama] = useWatch({
    control: f.control,
    name: ["startTime", "endTime", "breakDuration", "color", "code", "name"],
  });

  const bukaForm = (item: JenisShift | null) => {
    f.reset(
      item
        ? {
            name: item.name,
            code: item.code ?? "",
            startTime: item.startTime,
            endTime: item.endTime,
            breakDuration: String(item.breakDuration),
            color: (KUNCI_WARNA as string[]).includes(item.color) ? (item.color as WarnaJenisShift) : "teal",
            departmentId: item.departmentId ?? "",
          }
        : { ...KOSONG, departmentId: hr ? "" : (saya?.departmentId ?? "") }
    );
    setForm({ open: true, item });
  };
  const tutupForm = () => setForm({ open: false, item: null });

  const item = form.item;
  const jamBerubah =
    item !== null && (mulai !== item.startTime || selesai !== item.endTime || Number(istirahat || 0) !== item.breakDuration);

  const segarkan = () => {
    qc.invalidateQueries({ queryKey: ["shift-jenis"] });
    qc.invalidateQueries({ queryKey: ["shift"] });
    qc.invalidateQueries({ queryKey: ["shift-penugasan"] });
  };

  const simpan = useMutation({
    mutationFn: async (v: FormJenis) => {
      const kodeBersih = v.code.trim().toUpperCase();
      if (!item) {
        const badan = {
          name: v.name.trim(),
          ...(kodeBersih ? { code: kodeBersih } : {}),
          startTime: v.startTime,
          endTime: v.endTime,
          breakDuration: Number(v.breakDuration || 0),
          color: v.color,
          // Manajer tidak mengirim departemen: server memaksanya ke departemen manajer itu.
          ...(hr && v.departmentId ? { departmentId: v.departmentId } : {}),
        };
        const { data } = await api.post<JenisShift>("/shifts/templates", badan);
        return { template: data, rowsUpdated: 0 };
      }
      // Hanya bidang yang berubah: server memperbarui shift ke depan hanya bila jam/istirahat ikut dikirim berbeda.
      const badan: Record<string, unknown> = {};
      if (v.name.trim() !== item.name) badan.name = v.name.trim();
      if (kodeBersih !== (item.code ?? "")) badan.code = kodeBersih || null;
      if (v.startTime !== item.startTime) badan.startTime = v.startTime;
      if (v.endTime !== item.endTime) badan.endTime = v.endTime;
      if (Number(v.breakDuration || 0) !== item.breakDuration) badan.breakDuration = Number(v.breakDuration || 0);
      if (v.color !== item.color) badan.color = v.color;
      if (hr && (v.departmentId || null) !== item.departmentId) badan.departmentId = v.departmentId || null;
      if (Object.keys(badan).length === 0) return { template: item, rowsUpdated: 0 };
      const { data } = await api.put<{ template: JenisShift; rowsUpdated: number }>(`/shifts/templates/${item.id}`, badan);
      return data;
    },
    onSuccess: (r) => {
      segarkan();
      notifikasi.sukses(
        item ? "Jenis shift diperbarui" : "Jenis shift ditambahkan",
        r.rowsUpdated > 0
          ? `${r.template.name} · ${r.rowsUpdated} shift ke depan ikut memakai jam baru.`
          : `${r.template.name} · ${r.template.startTime}–${r.template.endTime}`
      );
      tutupForm();
    },
    onError: (e) => notifikasi.galat(e, "Jenis shift belum tersimpan"),
  });

  const nonaktifkan = useMutation({
    mutationFn: async (j: JenisShift) => api.delete(`/shifts/templates/${j.id}`),
    onSuccess: (_, j) => {
      segarkan();
      notifikasi.sukses("Jenis shift dinonaktifkan", `${j.name} tidak bisa dipilih lagi. Shift yang sudah terjadwal tetap.`);
      setNonaktif(null);
    },
    onError: (e, j) => {
      setNonaktif(null);
      if (axios.isAxiosError(e) && e.response?.status === 409) {
        const n = (e.response.data as { activeAssignments?: number })?.activeAssignments;
        notifikasi.peringatan(
          `${j.name} masih dipakai`,
          `${n ?? "Beberapa"} penugasan belum berakhir. Akhiri penugasannya dulu di tab Penugasan, lalu nonaktifkan lagi.`
        );
        return;
      }
      notifikasi.galat(e, "Tidak bisa dinonaktifkan");
    },
  });

  const durasiMenit = mulai && selesai ? menitShift(mulai, selesai) : 0;

  const kolom: Kolom<JenisShift>[] = [
    {
      key: "nama",
      header: "Jenis",
      primary: true,
      cell: (j) => (
        <div className="flex min-w-0 items-center gap-2">
          <ChipJenis jenis={j} className="shrink-0" />
          <span className="truncate font-medium">{j.name}</span>
          {!j.isActive && <Badge>Nonaktif</Badge>}
        </div>
      ),
    },
    { key: "jam", header: "Jam", cell: (j) => <JamJenis mulai={j.startTime} selesai={j.endTime} /> },
    { key: "istirahat", header: "Istirahat", cell: (j) => formatIstirahat(j.breakDuration) },
    { key: "dept", header: "Departemen", cell: (j) => j.department?.name ?? <span className="text-muted">Semua</span> },
    { key: "penugasan", header: "Penugasan aktif", className: "md:text-right", cell: (j) => <span className="tabular-nums">{j.activeAssignments}</span> },
    ...(bolehUbah || bolehHapus
      ? [
          {
            key: "aksi",
            header: "",
            className: "text-right",
            cell: (j: JenisShift) =>
              !bisaDikelola(j) ? (
                <div className="flex justify-end">
                  <PenandaAksi icon={Lock} label="Jenis untuk semua departemen hanya bisa diubah HR" />
                </div>
              ) : (
                <div className="flex justify-end gap-1.5">
                  {bolehUbah && j.isActive && <TombolAksi icon={Pencil} label={`Ubah ${j.name}`} onClick={() => bukaForm(j)} />}
                  {bolehHapus && j.isActive && <TombolAksi icon={PowerOff} label={`Nonaktifkan ${j.name}`} tone="bahaya" onClick={() => setNonaktif(j)} />}
                </div>
              ),
          } satisfies Kolom<JenisShift>,
        ]
      : []),
  ];

  return (
    <>
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">Jam kerja yang dipakai ulang saat menetapkan shift. Warna dan kodenya muncul di roster.</p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={semua} onChange={(e) => setSemua(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
              Tampilkan yang nonaktif
            </label>
            {bolehBuat && (
              <Button size="sm" onClick={() => bukaForm(null)}>
                <Plus className="h-4 w-4" aria-hidden /> Jenis Shift
              </Button>
            )}
          </div>
        </div>

        {jenis.isLoading ? (
          <SkeletonBaris />
        ) : jenis.isError ? (
          <EmptyState title="Jenis shift tidak bisa dimuat" description={(jenis.error as Error).message} />
        ) : !jenis.data?.length ? (
          <EmptyState
            icon={Clock}
            title="Belum ada jenis shift"
            description="Contoh: Pagi 07:00–15:00, Siang 15:00–23:00, Malam 23:00–07:00. Setelah dibuat, jenis ini bisa ditetapkan berulang untuk seminggu, sebulan, atau seterusnya."
            action={bolehBuat && <Button onClick={() => bukaForm(null)}><Plus className="h-4 w-4" aria-hidden /> Tambah Jenis Shift</Button>}
          />
        ) : (
          <ResponsiveTable columns={kolom} rows={jenis.data} rowKey={(j) => j.id} />
        )}
      </Card>

      <Modal
        open={form.open}
        onClose={tutupForm}
        title={item ? "Ubah Jenis Shift" : "Jenis Shift Baru"}
        description="Shift malam yang melewati tengah malam ditulis apa adanya, mis. 23:00–07:00."
        footer={
          <>
            <Button variant="outline" onClick={tutupForm} disabled={simpan.isPending}><X className="h-4 w-4" aria-hidden /> Batal</Button>
            <Button form="form-jenis-shift" type="submit" loading={simpan.isPending}>
              {!simpan.isPending && <Save className="h-4 w-4" aria-hidden />} {jamBerubah ? "Simpan & perbarui shift" : "Simpan"}
            </Button>
          </>
        }
      >
        <form id="form-jenis-shift" onSubmit={f.handleSubmit((v) => simpan.mutate(v))} className="space-y-4" noValidate>
          <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-4">
            <Field label="Nama" error={f.formState.errors.name?.message}>
              <Input
                {...f.register("name", {
                  required: "Nama wajib diisi",
                  validate: (v) => (v.trim().length >= 2 && v.trim().length <= 40) || "2–40 karakter",
                })}
                placeholder="Pagi"
                maxLength={40}
              />
            </Field>
            <Field label="Kode" hint="Maks 4 huruf" error={f.formState.errors.code?.message}>
              <Input {...f.register("code", { maxLength: { value: 4, message: "Maks 4 karakter" } })} placeholder="P" maxLength={4} className="font-mono uppercase" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Jam mulai" error={f.formState.errors.startTime?.message}>
              <Input type="time" {...f.register("startTime", { required: "Wajib diisi" })} />
            </Field>
            <Field label="Jam selesai" error={f.formState.errors.endTime?.message} hint={mulai && selesai && lintasMalam(mulai, selesai) ? "Berakhir keesokan harinya" : undefined}>
              <Input
                type="time"
                {...f.register("endTime", { required: "Wajib diisi", validate: (v, x) => v !== x.startTime || "Jam selesai tidak boleh sama dengan jam mulai" })}
              />
            </Field>
            <Field label="Istirahat (jam)" error={f.formState.errors.breakDuration?.message} hint="Kelipatan setengah jam" className="col-span-2">
              <Input
                type="number"
                step="0.5"
                min={0}
                max={12}
                {...f.register("breakDuration", {
                  min: { value: 0, message: "Tidak boleh negatif" },
                  max: { value: 12, message: "Paling lama 12 jam" },
                  validate: (v) => Number(v || 0) * 60 < durasiMenit || "Istirahat harus lebih pendek dari panjang shift",
                })}
              />
            </Field>
          </div>

          <fieldset className="min-w-0">
            <legend className="mb-1.5 text-sm font-medium">Warna</legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Warna jenis shift">
              {KUNCI_WARNA.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={warna === k}
                  aria-label={WARNA_JENIS[k].label}
                  title={WARNA_JENIS[k].label}
                  onClick={() => f.setValue("color", k, { shouldDirty: true })}
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-lg border-2 transition-colors",
                    WARNA_JENIS[k].chip,
                    warna === k ? "border-current" : "border-transparent hover:border-border"
                  )}
                >
                  <span className={cn("h-3.5 w-3.5 rounded-full", WARNA_JENIS[k].titik)} aria-hidden />
                </button>
              ))}
            </div>
            <p className="mt-2 flex items-center gap-2 text-xs text-muted">
              Tampil di roster: <ChipJenis jenis={{ id: "contoh", name: nama || "Nama", code: kode.toUpperCase() || null, color: warna }} />
            </p>
          </fieldset>

          {hr ? (
            <Field label="Departemen" hint="Jenis untuk semua departemen bisa dipakai manajer mana pun">
              <Select {...f.register("departmentId")}>
                <option value="">Semua departemen</option>
                {departemen.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
          ) : (
            <p className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
              <Lock className="h-4 w-4 shrink-0" aria-hidden /> Hanya untuk departemen Anda
            </p>
          )}

          {jamBerubah && item && (
            <Alert tone="warning" title="Shift ke depan ikut berubah">
              Shift mulai hari ini yang dibuat dari jenis {item.name} ikut memakai jam baru — kecuali yang sudah diubah manual atau sudah ada presensinya.
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
        title="Nonaktifkan jenis shift?"
        description={nonaktif ? `${nonaktif.name} tidak bisa dipilih lagi untuk penugasan baru. Shift yang sudah terjadwal tetap. Ditolak bila masih ada penugasan yang belum berakhir.` : ""}
        confirmLabel="Nonaktifkan"
        confirmIcon={PowerOff}
      />
    </>
  );
};
