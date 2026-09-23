"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { Plus, KeyRound, Pencil, Trash2, Lock, Users, ShieldCheck, Eye, FilePlus2, PencilLine, Eraser, type LucideIcon, Save, X } from "lucide-react";
import { api } from "@/lib/api";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { notifikasi } from "@/hooks/use-notifikasi";
import { LABEL_LINGKUP, cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Button, TombolAksi, PenandaAksi } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input, Select, Field, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/alert";
import type { KatalogIzin, PeranKustom, Role, AksiIzin, DefinisiHalamanIzin } from "@/lib/types";

type FormPeran = { name: string; description: string; baseRole: Role; permissions: string[] };

const URUTAN_LINGKUP: Role[] = ["EMPLOYEE", "MANAGER", "HR_ADMIN", "SUPER_ADMIN"];

/** Lingkup yang hanya boleh diberikan Super Admin. */
const LINGKUP_TINGGI = new Set<Role>(["HR_ADMIN", "SUPER_ADMIN"]);

const KOLOM: { aksi: AksiIzin; label: string; icon: LucideIcon }[] = [
  { aksi: "lihat", label: "Lihat", icon: Eye },
  { aksi: "buat", label: "Buat", icon: FilePlus2 },
  { aksi: "ubah", label: "Ubah", icon: PencilLine },
  { aksi: "hapus", label: "Hapus", icon: Eraser },
];

/** Baris matriks dikelompokkan per kelompok sidebar, urutannya mengikuti katalog. */
const kelompokkan = (pages: DefinisiHalamanIzin[] | undefined) => {
  const peta = new Map<string, DefinisiHalamanIzin[]>();
  for (const p of pages ?? []) {
    const ada = peta.get(p.kelompok) ?? [];
    ada.push(p);
    peta.set(p.kelompok, ada);
  }
  return [...peta.entries()].map(([kelompok, halaman]) => ({ kelompok, halaman }));
};

const kunciHalaman = (p: DefinisiHalamanIzin) => KOLOM.map((k) => k.aksi).filter((a) => p.aksi[a] !== undefined).map((a) => `${p.halaman}.${a}`);

/** Ringkasan izin sebuah peran untuk kartu: "Karyawan: lihat, buat · Cuti tim: ubah". */
const ringkasIzin = (permissions: string[], pages: DefinisiHalamanIzin[] | undefined) => {
  const dimiliki = new Set(permissions);
  return (pages ?? [])
    .map((p) => {
      const aksi = KOLOM.filter((k) => dimiliki.has(`${p.halaman}.${k.aksi}`)).map((k) => k.label.toLowerCase());
      return aksi.length ? `${p.label}: ${aksi.join(", ")}` : null;
    })
    .filter(Boolean)
    .join(" · ");
};

export default function HalamanPeran() {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const [form, setForm] = React.useState<{ open: boolean; item: PeranKustom | null }>({ open: false, item: null });
  const [hapus, setHapus] = React.useState<PeranKustom | null>(null);

  const bolehBuat = punyaIzin(saya, "peran.buat");
  const bolehUbah = punyaIzin(saya, "peran.ubah");
  const bolehHapus = punyaIzin(saya, "peran.hapus");

  const peran = useQuery({
    queryKey: ["peran"],
    queryFn: async () => (await api.get<{ data: PeranKustom[] }>("/roles")).data.data,
  });
  const katalog = useQuery({
    queryKey: ["peran", "katalog"],
    queryFn: async () => (await api.get<KatalogIzin>("/roles/permissions")).data,
    staleTime: 60 * 60_000,
  });
  const kelompok = React.useMemo(() => kelompokkan(katalog.data?.pages), [katalog.data]);

  const segarkan = () => {
    qc.invalidateQueries({ queryKey: ["peran"] });
    // Izin pengguna yang sedang login bisa ikut berubah bila perannya disunting.
    qc.invalidateQueries({ queryKey: ["sesi"] });
  };

  const f = useForm<FormPeran>({ defaultValues: { name: "", description: "", baseRole: "EMPLOYEE", permissions: [] } });
  const izinTerpilih = useWatch({ control: f.control, name: "permissions" });
  const terpilih = React.useMemo(() => izinTerpilih ?? [], [izinTerpilih]);
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

  const pemilik = saya?.role === "SUPER_ADMIN";
  const terkunci = form.item?.code === "SUPER_ADMIN";
  const izinSaya = React.useMemo(() => new Set(saya?.permissions ?? []), [saya]);
  const bolehBeri = (k: string) => pemilik || izinSaya.has(k);

  // Lingkup Super Admin dan HR Admin hanya ditawarkan kepada pemilik sistem;
  // yang lain membuat peran dari nama dan hak akses saja.
  const lingkupPilihan = React.useMemo(
    () => URUTAN_LINGKUP.filter((r) => pemilik || !LINGKUP_TINGGI.has(r) || r === form.item?.baseRole),
    [pemilik, form.item]
  );

  /**
   * Peran yang tidak boleh ia sentuh sama sekali: Super Admin selalu terkunci,
   * dan bagi yang bukan pemilik juga peran berlingkup tinggi atau yang memuat
   * izin di luar miliknya sendiri. Server menolak keduanya.
   */
  const terlindungi = (r: PeranKustom) =>
    r.code === "SUPER_ADMIN" ||
    (!pemilik && (LINGKUP_TINGGI.has(r.baseRole) || r.permissions.some((k) => !izinSaya.has(k))));
  const dipilih = React.useMemo(() => new Set(terpilih), [terpilih]);

  const ubahKunci = (kunci: string[], nyala: boolean) => {
    const sekarang = new Set(terpilih);
    for (const k of kunci) {
      if (!bolehBeri(k)) continue;
      if (nyala) sekarang.add(k);
      else sekarang.delete(k);
    }
    f.setValue("permissions", [...sekarang], { shouldDirty: true });
  };

  /** Satu baris: nama halaman + empat sel aksi. Sel kosong berarti aksi itu memang tidak ada di halamannya. */
  const Baris = ({ p }: { p: DefinisiHalamanIzin }) => {
    const kunci = kunciHalaman(p);
    const semua = kunci.every((k) => dipilih.has(k));
    const sebagian = !semua && kunci.some((k) => dipilih.has(k));
    return (
      <tr className={cn("border-t border-border", p.induk && "bg-surface-2/40")}>
        <th scope="row" className={cn("py-2 pr-2 text-left text-sm font-normal", p.induk ? "pl-8 text-muted" : "pl-3 font-medium")}>
          <button
            type="button"
            onClick={() => ubahKunci(kunci, !semua)}
            disabled={terkunci || !kunci.some(bolehBeri)}
            className="text-left hover:text-primary disabled:hover:text-inherit"
            title={semua ? "Kosongkan baris" : "Pilih semua aksi di baris ini"}
          >
            {p.label}
            {sebagian && <span className="ml-1.5 text-[11px] text-muted">sebagian</span>}
          </button>
        </th>
        {KOLOM.map(({ aksi }) => {
          const keterangan = p.aksi[aksi];
          if (!keterangan) return <td key={aksi} className="px-2 py-2 text-center text-muted/40" aria-label="Tidak tersedia">–</td>;
          const k = `${p.halaman}.${aksi}`;
          const boleh = !terkunci && bolehBeri(k);
          return (
            <td key={aksi} className="px-2 py-2 text-center">
              <label className={cn("inline-flex cursor-pointer items-center justify-center rounded-md p-1.5", boleh ? "hover:bg-surface-2" : "cursor-not-allowed opacity-50")} title={`${p.label} · ${keterangan}`}>
                <input
                  type="checkbox"
                  value={k}
                  disabled={!boleh}
                  {...f.register("permissions")}
                  className="h-4 w-4 accent-[var(--primary)]"
                  aria-label={`${p.label}: ${keterangan}`}
                />
              </label>
            </td>
          );
        })}
      </tr>
    );
  };

  return (
    <>
      <PageHeader
        title="Peran & Hak Akses"
        description="Setiap menu di sidebar diatur terpisah: apa yang boleh dilihat, dibuat, diubah, dan dihapus. Perubahan langsung berlaku bagi semua pemegang peran."
        actions={bolehBuat && <Button onClick={() => setForm({ open: true, item: null })}><Plus className="h-4 w-4" aria-hidden /> Peran</Button>}
      />

      {!pemilik && (
        <Alert tone="info" title="Batas pengelola peran">
          Anda hanya bisa memberikan izin yang Anda pegang sendiri. Peran berlingkup HR Admin atau Super Admin tidak bisa Anda buat,
          sunting, maupun hapus — begitu juga peran yang memuat izin di luar milik Anda.
        </Alert>
      )}

      {peran.isLoading ? (
        <SkeletonBaris />
      ) : !peran.data?.length ? (
        <Card><EmptyState icon={KeyRound} title="Belum ada peran" description="Peran sistem dibuat otomatis saat server berjalan." /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {peran.data.map((r) => {
            const semuaIzin = r.code === "SUPER_ADMIN";
            const kunci = terlindungi(r);
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
                      <PenandaAksi icon={Lock} label={semuaIzin ? "Peran Super Admin terkunci" : "Terkunci: hanya Super Admin yang bisa mengelola peran ini"} />
                    ) : bolehUbah ? (
                      <TombolAksi icon={Pencil} label={`Sunting ${r.name}`} onClick={() => setForm({ open: true, item: r })} />
                    ) : null}
                    {!r.isSystem && bolehHapus && !kunci && (
                      <TombolAksi icon={Trash2} label={`Hapus ${r.name}`} tone="bahaya" onClick={() => setHapus(r)} />
                    )}
                  </div>
                </CardHeader>
                <CardContent className="mt-auto space-y-2 text-xs text-muted">
                  <p className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Lingkup: {LABEL_LINGKUP[r.baseRole]}</p>
                  <p className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" aria-hidden /> {r._count.employees} karyawan · {semuaIzin ? "semua izin" : `${r.permissions.length} izin`}</p>
                  {!semuaIzin && r.permissions.length > 0 && (
                    <p className="line-clamp-3">{ringkasIzin(r.permissions, katalog.data?.pages)}</p>
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
        description={form.item?.isSystem ? "Peran sistem: nama dan izinnya boleh diubah, lingkup datanya tidak." : "Centang per halaman apa yang boleh dilihat, dibuat, diubah, dan dihapus"}
        footer={
          <>
            <Button variant="outline" onClick={() => setForm({ open: false, item: null })} disabled={simpan.isPending}><X className="h-4 w-4" aria-hidden /> Batal</Button>
            <Button form="form-peran" type="submit" loading={simpan.isPending} disabled={terkunci}>{!simpan.isPending && <Save className="h-4 w-4" aria-hidden />} Simpan</Button>
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
                {lingkupPilihan.map((r) => (
                  <option key={r} value={r}>
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
            <legend className="text-sm font-medium">Hak akses per halaman <span className="font-normal text-muted">({terpilih.length} izin dipilih)</span></legend>
            <p className="text-xs text-muted">
              Baris menjorok adalah bagian dari halaman di atasnya yang haknya diatur terpisah. Tanda – berarti aksi itu memang tidak ada di halaman tersebut.
              Arahkan kursor ke kotak centang untuk melihat persis apa yang dibukanya.
            </p>
            {katalog.isLoading && <SkeletonBaris jumlah={6} />}
            {kelompok.map(({ kelompok: nama, halaman }) => {
              const kunci = halaman.flatMap(kunciHalaman);
              const semua = kunci.every((k) => dipilih.has(k));
              const bolehSemua = !terkunci && kunci.some(bolehBeri);
              return (
                <div key={nama} className="overflow-hidden rounded-xl border border-border">
                  <div className="flex items-center justify-between gap-3 bg-surface-2 px-3 py-2">
                    <p className="text-sm font-semibold">{nama}</p>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline disabled:text-muted disabled:no-underline"
                      disabled={!bolehSemua}
                      onClick={() => ubahKunci(kunci, !semua)}
                    >
                      {semua ? "Kosongkan" : "Pilih semua"}
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[30rem] text-sm">
                      <thead>
                        <tr className="text-xs uppercase tracking-wide text-muted">
                          <th scope="col" className="py-2 pl-3 text-left font-medium">Halaman</th>
                          {KOLOM.map(({ aksi, label, icon: Icon }) => (
                            <th key={aksi} scope="col" className="w-20 px-2 py-2 text-center font-medium">
                              <span className="inline-flex items-center gap-1"><Icon className="h-3.5 w-3.5" aria-hidden />{label}</span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {halaman.map((p) => <Baris key={p.halaman} p={p} />)}
                      </tbody>
                    </table>
                  </div>
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
        confirmIcon={Trash2}
      />
    </>
  );
}
