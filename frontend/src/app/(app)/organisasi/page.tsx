"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Plus, Building2, Briefcase, Trash2, Pencil, Save, X } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { PageHeader } from "@/components/ui/page-header";
import { Button, TombolAksi } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input, Select, Field, Textarea } from "@/components/ui/input";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import type { Halaman, Departemen, Jabatan } from "@/lib/types";

type FormDept = { name: string; description: string };
type FormPos = { name: string; description: string; departmentId: string };

export default function HalamanOrganisasi() {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const bolehBuat = punyaIzin(saya, "organisasi.buat");
  const bolehUbah = punyaIzin(saya, "organisasi.ubah");
  const bolehHapus = punyaIzin(saya, "organisasi.hapus");
  const [tab, setTab] = React.useState<"departemen" | "jabatan">("departemen");
  const [formDept, setFormDept] = React.useState<{ open: boolean; item: Departemen | null }>({ open: false, item: null });
  const [formPos, setFormPos] = React.useState<{ open: boolean; item: Jabatan | null }>({ open: false, item: null });
  const [hapus, setHapus] = React.useState<{ jenis: "departemen" | "jabatan"; id: string; nama: string } | null>(null);

  const departemen = useQuery({
    queryKey: ["departemen", "semua"],
    queryFn: async () => (await api.get<Halaman<Departemen>>("/departments?limit=100")).data.data,
  });
  const jabatan = useQuery({
    queryKey: ["jabatan", "semua"],
    queryFn: async () => (await api.get<Halaman<Jabatan>>("/positions?limit=100")).data.data,
  });

  const segarkan = () => {
    qc.invalidateQueries({ queryKey: ["departemen"] });
    qc.invalidateQueries({ queryKey: ["jabatan"] });
  };

  const fd = useForm<FormDept>();
  const fp = useForm<FormPos>();

  React.useEffect(() => {
    if (formDept.open) fd.reset({ name: formDept.item?.name ?? "", description: formDept.item?.description ?? "" });
  }, [formDept, fd]);
  React.useEffect(() => {
    if (formPos.open)
      fp.reset({ name: formPos.item?.name ?? "", description: formPos.item?.description ?? "", departmentId: formPos.item?.departmentId ?? "" });
  }, [formPos, fp]);

  const simpanDept = useMutation({
    mutationFn: async (v: FormDept) => {
      const body = { name: v.name, ...(v.description ? { description: v.description } : {}) };
      return formDept.item ? api.put(`/departments/${formDept.item.id}`, body) : api.post("/departments", body);
    },
    onSuccess: () => { segarkan(); notifikasi.sukses(formDept.item ? "Departemen diperbarui" : "Departemen ditambahkan"); setFormDept({ open: false, item: null }); },
    onError: (e) => notifikasi.galat(e),
  });

  const simpanPos = useMutation({
    mutationFn: async (v: FormPos) => {
      const body = {
        name: v.name,
        ...(v.description ? { description: v.description } : {}),
        departmentId: v.departmentId || null,
      };
      return formPos.item ? api.put(`/positions/${formPos.item.id}`, body) : api.post("/positions", body);
    },
    onSuccess: () => { segarkan(); notifikasi.sukses(formPos.item ? "Jabatan diperbarui" : "Jabatan ditambahkan"); setFormPos({ open: false, item: null }); },
    onError: (e) => notifikasi.galat(e),
  });

  const hapusItem = useMutation({
    mutationFn: async (h: NonNullable<typeof hapus>) =>
      api.delete(h.jenis === "departemen" ? `/departments/${h.id}` : `/positions/${h.id}`),
    onSuccess: (_, h) => { segarkan(); notifikasi.sukses(`${h.jenis === "departemen" ? "Departemen" : "Jabatan"} dihapus`, h.nama); setHapus(null); },
    onError: (e) => { notifikasi.galat(e, "Tidak bisa dihapus"); setHapus(null); },
  });

  return (
    <>
      <PageHeader
        title="Struktur Organisasi"
        description="Departemen dan jabatan yang menjadi tempat karyawan dikelompokkan"
        actions={
          !bolehBuat ? null : tab === "departemen" ? (
            <Button onClick={() => setFormDept({ open: true, item: null })}><Plus className="h-4 w-4" aria-hidden /> Departemen</Button>
          ) : (
            <Button onClick={() => setFormPos({ open: true, item: null })}><Plus className="h-4 w-4" aria-hidden /> Jabatan</Button>
          )
        }
      />

      <div className="flex gap-1 rounded-xl bg-surface-2 p-1 w-fit" role="tablist">
        {(["departemen", "jabatan"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === t ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"}`}
          >
            {t === "departemen" ? `Departemen (${departemen.data?.length ?? 0})` : `Jabatan (${jabatan.data?.length ?? 0})`}
          </button>
        ))}
      </div>

      {tab === "departemen" ? (
        departemen.isLoading ? (
          <SkeletonBaris />
        ) : !departemen.data?.length ? (
          <Card><EmptyState icon={Building2} title="Belum ada departemen" description="Contoh: Kitchen, Front Office, Housekeeping, Sales & Marketing." action={bolehBuat && <Button onClick={() => setFormDept({ open: true, item: null })}><Plus className="h-4 w-4" aria-hidden /> Tambah Departemen</Button>} /></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {departemen.data.map((d) => (
              <Card key={d.id} className="animate-fade-up">
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{d.name}</CardTitle>
                    <CardDescription className="line-clamp-2">{d.description ?? "Tanpa keterangan"}</CardDescription>
                    <p className="mt-2 text-xs text-muted">{d._count.employees} karyawan · {d._count.positions} jabatan{d.workPattern ? ` · ${d.workPattern.name}` : ""}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {bolehUbah && <TombolAksi icon={Pencil} label={`Sunting ${d.name}`} onClick={() => setFormDept({ open: true, item: d })} />}
                    {bolehHapus && <TombolAksi icon={Trash2} label={`Hapus ${d.name}`} tone="bahaya" onClick={() => setHapus({ jenis: "departemen", id: d.id, nama: d.name })} />}
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        )
      ) : jabatan.isLoading ? (
        <SkeletonBaris />
      ) : !jabatan.data?.length ? (
        <Card><EmptyState icon={Briefcase} title="Belum ada jabatan" description="Contoh: Chef de Partie, Waiter, Receptionist, Room Attendant." action={bolehBuat && <Button onClick={() => setFormPos({ open: true, item: null })}><Plus className="h-4 w-4" aria-hidden /> Tambah Jabatan</Button>} /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {jabatan.data.map((j) => (
            <Card key={j.id} className="animate-fade-up">
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="truncate">{j.name}</CardTitle>
                  <CardDescription>{j.department?.name ?? "Lintas departemen"}</CardDescription>
                  <p className="mt-2 text-xs text-muted">{j._count.employees} karyawan</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {bolehUbah && <TombolAksi icon={Pencil} label={`Sunting ${j.name}`} onClick={() => setFormPos({ open: true, item: j })} />}
                  {bolehHapus && <TombolAksi icon={Trash2} label={`Hapus ${j.name}`} tone="bahaya" onClick={() => setHapus({ jenis: "jabatan", id: j.id, nama: j.name })} />}
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <Modal open={formDept.open} onClose={() => setFormDept({ open: false, item: null })} title={formDept.item ? "Sunting Departemen" : "Tambah Departemen"}
        footer={<><Button variant="outline" onClick={() => setFormDept({ open: false, item: null })}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button form="form-dept" type="submit" loading={simpanDept.isPending}>{!simpanDept.isPending && <Save className="h-4 w-4" aria-hidden />} Simpan</Button></>}>
        <form id="form-dept" onSubmit={fd.handleSubmit((v) => simpanDept.mutate(v))} className="space-y-4" noValidate>
          <Field label="Nama departemen" error={fd.formState.errors.name?.message}>
            <Input {...fd.register("name", { required: "Nama wajib diisi", minLength: { value: 2, message: "Minimal 2 karakter" } })} placeholder="Kitchen" />
          </Field>
          <Field label="Keterangan"><Textarea {...fd.register("description")} rows={2} /></Field>
        </form>
      </Modal>

      <Modal open={formPos.open} onClose={() => setFormPos({ open: false, item: null })} title={formPos.item ? "Sunting Jabatan" : "Tambah Jabatan"}
        footer={<><Button variant="outline" onClick={() => setFormPos({ open: false, item: null })}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button form="form-pos" type="submit" loading={simpanPos.isPending}>{!simpanPos.isPending && <Save className="h-4 w-4" aria-hidden />} Simpan</Button></>}>
        <form id="form-pos" onSubmit={fp.handleSubmit((v) => simpanPos.mutate(v))} className="space-y-4" noValidate>
          <Field label="Nama jabatan" error={fp.formState.errors.name?.message}>
            <Input {...fp.register("name", { required: "Nama wajib diisi", minLength: { value: 2, message: "Minimal 2 karakter" } })} placeholder="Chef de Partie" />
          </Field>
          <Field label="Departemen" hint="Kosongkan bila jabatan berlaku lintas departemen">
            <Select {...fp.register("departmentId")}>
              <option value="">— Lintas departemen —</option>
              {(departemen.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Keterangan"><Textarea {...fp.register("description")} rows={2} /></Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(hapus)}
        onClose={() => setHapus(null)}
        onConfirm={() => hapus && hapusItem.mutate(hapus)}
        loading={hapusItem.isPending}
        danger
        title={`Hapus ${hapus?.jenis}?`}
        description={`"${hapus?.nama}" akan dihapus. Ini ditolak otomatis bila masih ada karyawan atau data lain yang merujuknya.`}
        confirmLabel="Hapus"
        confirmIcon={Trash2}
      />
    </>
  );
}
