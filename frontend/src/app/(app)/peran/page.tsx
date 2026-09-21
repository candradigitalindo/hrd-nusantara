"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { Plus, KeyRound, Pencil, Trash2, Lock, Users, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useSesi } from "@/hooks/use-sesi";
import { notifikasi } from "@/hooks/use-notifikasi";
import { LABEL_LINGKUP } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input, Select, Field, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/alert";
import type { KatalogIzin, PeranKustom, Role } from "@/lib/types";

type FormPeran = { name: string; description: string; baseRole: Role; permissions: string[] };

const URUTAN_LINGKUP: Role[] = ["EMPLOYEE", "MANAGER", "HR_ADMIN", "SUPER_ADMIN"];

/** Izin dikelompokkan per modul, mengikuti urutan katalog. */
const kelompokkan = (katalog: KatalogIzin | undefined) => {
  const peta = new Map<string, KatalogIzin["permissions"]>();
  for (const izin of katalog?.permissions ?? []) {
    const ada = peta.get(izin.modul) ?? [];
    ada.push(izin);
    peta.set(izin.modul, ada);
  }
  return [...peta.entries()].map(([modul, izin]) => ({ modul, izin }));
};

export default function HalamanPeran() {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const [form, setForm] = React.useState<{ open: boolean; item: PeranKustom | null }>({ open: false, item: null });
  const [hapus, setHapus] = React.useState<PeranKustom | null>(null);

  const peran = useQuery({
    queryKey: ["peran"],
    queryFn: async () => (await api.get<{ data: PeranKustom[] }>("/roles")).data.data,
  });
  const katalog = useQuery({
    queryKey: ["peran", "katalog"],
    queryFn: async () => (await api.get<KatalogIzin>("/roles/permissions")).data,
    staleTime: 60 * 60_000,
  });
  const modul = React.useMemo(() => kelompokkan(katalog.data), [katalog.data]);
  const labelIzin = React.useMemo(
    () => new Map((katalog.data?.permissions ?? []).map((p) => [p.key, p.label])),
    [katalog.data]
  );

  const segarkan = () => {
    qc.invalidateQueries({ queryKey: ["peran"] });
    // Izin pengguna yang sedang login bisa ikut berubah bila perannya disunting.
    qc.invalidateQueries({ queryKey: ["sesi"] });
  };

  const f = useForm<FormPeran>({ defaultValues: { name: "", description: "", baseRole: "EMPLOYEE", permissions: [] } });
  const terpilih = useWatch({ control: f.control, name: "permissions" }) ?? [];
  const lingkupDipilih = useWatch({ control: f.control, name: "baseRole" });

  React.useEffect(() => {
    if (!form.open) return;
    f.reset({
      name: form.item?.name ?? "",
      description: form.item?.description ?? "",
      baseRole: form.item?.baseRole ?? "EMPLOYEE",
      permissions: form.item?.permissions ?? [],
    });
  }, [form, f]);

  const simpan = useMutation({
    mutationFn: async (v: FormPeran) => {
      const body = {
        name: v.name,
        description: v.description || (form.item ? null : undefined),
        permissions: v.permissions,
        // Lingkup peran sistem tidak bisa diubah, jadi tidak dikirim.
        ...(form.item?.isSystem ? {} : { baseRole: v.baseRole }),
      };
      return form.item ? api.put(`/roles/${form.item.id}`, body) : api.post("/roles", body);
    },
    onSuccess: () => {
      segarkan();
      notifikasi.sukses(form.item ? "Peran diperbarui" : "Peran dibuat", "Berlaku seketika bagi semua pemegangnya");
      setForm({ open: false, item: null });
    },
    onError: (e) => notifikasi.galat(e, "Gagal menyimpan peran"),
  });

  const hapusPeran = useMutation({
    mutationFn: async (r: PeranKustom) => api.delete(`/roles/${r.id}`),
    onSuccess: (_, r) => { segarkan(); notifikasi.sukses("Peran dihapus", r.name); setHapus(null); },
    onError: (e) => { notifikasi.galat(e, "Tidak bisa dihapus"); setHapus(null); },
  });

  const setModul = (kunci: string[], nyala: boolean) => {
    const sekarang = new Set(terpilih);
    for (const k of kunci) {
      if (nyala) sekarang.add(k);
      else sekarang.delete(k);
    }
    f.setValue("permissions", [...sekarang], { shouldDirty: true });
  };

  const pemilik = saya?.role === "SUPER_ADMIN";
  const terkunci = form.item?.code === "SUPER_ADMIN";
  const izinSaya = new Set(saya?.permissions ?? []);

  return (
    <>
      <PageHeader
        title="Peran & Hak Akses"
        description="Buat peran sendiri dan tentukan izin per modul; perubahan langsung berlaku bagi semua pemegangnya"
        actions={<Button onClick={() => setForm({ open: true, item: null })}><Plus className="h-4 w-4" aria-hidden /> Peran</Button>}
      />

      {!pemilik && (
        <Alert tone="info" title="Batas pengelola peran">
          Anda hanya bisa memberikan izin yang Anda pegang sendiri, dan tidak bisa membuat peran berlingkup HR Admin atau Super Admin.
        </Alert>
      )}

      {peran.isLoading ? (
        <SkeletonBaris />
      ) : !peran.data?.length ? (
        <Card><EmptyState icon={KeyRound} title="Belum ada peran" description="Peran sistem dibuat otomatis saat server berjalan." /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {peran.data.map((r) => {
            const kunci = r.code === "SUPER_ADMIN";
            return (
              <Card key={r.id} className="animate-fade-up flex flex-col">
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2 truncate">
                      {r.name}
                      {r.isSystem && <Badge tone="neutral">Sistem</Badge>}
                    </CardTitle>
                    <CardDescription className="line-clamp-2">{r.description ?? "Tanpa keterangan"}</CardDescription>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {kunci ? (
                      <span className="grid h-9 w-9 place-items-center text-muted" title="Terkunci"><Lock className="h-4 w-4" aria-hidden /><span className="sr-only">Terkunci</span></span>
                    ) : (
                      <Button variant="ghost" size="icon" onClick={() => setForm({ open: true, item: r })} aria-label={`Sunting ${r.name}`}><Pencil className="h-4 w-4" aria-hidden /></Button>
                    )}
                    {!r.isSystem && (
                      <Button variant="ghost" size="icon" className="text-danger" onClick={() => setHapus(r)} aria-label={`Hapus ${r.name}`}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="mt-auto space-y-2 text-xs text-muted">
                  <p className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Lingkup: {LABEL_LINGKUP[r.baseRole]}</p>
                  <p className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" aria-hidden /> {r._count.employees} karyawan · {kunci ? "semua izin" : `${r.permissions.length} izin`}</p>
                  {!kunci && r.permissions.length > 0 && (
                    <p className="line-clamp-2">{r.permissions.map((k) => labelIzin.get(k) ?? k).join(" · ")}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={form.open}
        onClose={() => setForm({ open: false, item: null })}
        size="lg"
        title={form.item ? `Sunting Peran: ${form.item.name}` : "Buat Peran"}
        description={form.item?.isSystem ? "Peran sistem: nama dan izinnya boleh diubah, lingkup datanya tidak." : "Centang izin yang boleh dipakai pemegang peran ini"}
        footer={
          <>
            <Button variant="outline" onClick={() => setForm({ open: false, item: null })} disabled={simpan.isPending}>Batal</Button>
            <Button form="form-peran" type="submit" loading={simpan.isPending} disabled={terkunci}>Simpan</Button>
          </>
        }
      >
        <form id="form-peran" onSubmit={f.handleSubmit((v) => simpan.mutate(v))} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nama peran" error={f.formState.errors.name?.message}>
              <Input {...f.register("name", { required: "Nama wajib diisi", minLength: { value: 2, message: "Minimal 2 karakter" } })} placeholder="Supervisor Outlet" />
            </Field>
            <Field label="Lingkup data" hint="Seberapa luas data yang bisa dilihat: diri sendiri, departemen, atau seluruh perusahaan">
              <Select {...f.register("baseRole")} disabled={Boolean(form.item?.isSystem)}>
                {URUTAN_LINGKUP.map((r) => (
                  <option key={r} value={r} disabled={!pemilik && (r === "HR_ADMIN" || r === "SUPER_ADMIN")}>
                    {LABEL_LINGKUP[r]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Keterangan"><Textarea {...f.register("description")} rows={2} placeholder="Untuk apa peran ini dipakai" /></Field>

          {lingkupDipilih === "SUPER_ADMIN" && (
            <Alert tone="warning" title="Lingkup pemilik sistem">Pemegang lingkup ini selalu memegang semua izin, apa pun yang dicentang.</Alert>
          )}

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Izin ({terpilih.length} dipilih)</legend>
            {katalog.isLoading && <SkeletonBaris jumlah={4} />}
            {modul.map(({ modul: nama, izin }) => {
              const kunci = izin.map((i) => i.key);
              const semua = kunci.every((k) => terpilih.includes(k));
              const bolehSemua = pemilik || kunci.every((k) => izinSaya.has(k));
              return (
                <div key={nama} className="rounded-xl border border-border">
                  <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2 px-3 py-2">
                    <p className="text-sm font-medium">{nama}</p>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline disabled:text-muted disabled:no-underline"
                      disabled={!bolehSemua}
                      onClick={() => setModul(kunci, !semua)}
                    >
                      {semua ? "Kosongkan" : "Pilih semua"}
                    </button>
                  </div>
                  <ul className="grid gap-1 p-2 sm:grid-cols-2">
                    {izin.map((i) => {
                      const boleh = pemilik || izinSaya.has(i.key);
                      return (
                        <li key={i.key}>
                          <label className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm ${boleh ? "hover:bg-surface-2" : "text-muted"}`}>
                            <input
                              type="checkbox"
                              value={i.key}
                              disabled={!boleh}
                              {...f.register("permissions")}
                              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
                            />
                            <span>{i.label}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </fieldset>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(hapus)}
        onClose={() => setHapus(null)}
        onConfirm={() => hapus && hapusPeran.mutate(hapus)}
        loading={hapusPeran.isPending}
        danger
        title="Hapus peran?"
        description={`"${hapus?.name}" akan dihapus. Ini ditolak otomatis bila masih ada karyawan yang memegangnya.`}
        confirmLabel="Hapus"
      />
    </>
  );
}
