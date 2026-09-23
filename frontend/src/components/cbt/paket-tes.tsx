"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { Archive, Camera, Clock, Eye, ListChecks, Megaphone, MonitorCheck, Pencil, Plus, Save, Send, Trash2, Users, X } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Button, TombolAksi } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input, Select, Field, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { DialogTugaskan } from "./tugaskan";
import { LABEL_TIPE_SOAL } from "./bank-soal";
import type { AudiensCbt, Halaman, PaketCbt, PaketCbtRinci, SoalCbt } from "@/lib/types";

const LABEL_AUDIENS: Record<AudiensCbt, string> = { karyawan: "Karyawan", pelamar: "Pelamar", keduanya: "Karyawan & pelamar" };
const LABEL_STATUS: Record<string, string> = { draft: "Draf", published: "Tayang", archived: "Arsip" };

type FormPaket = {
  code: string;
  title: string;
  description: string;
  audience: AudiensCbt;
  durationMinutes: number;
  passingScore: string;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showResultToTaker: boolean;
  recordProctorEvents: boolean;
  proctorPhotos: boolean;
  proctorPhotoIntervalSec: number;
};

const kosong: FormPaket = {
  code: "",
  title: "",
  description: "",
  audience: "keduanya",
  durationMinutes: 30,
  passingScore: "70",
  shuffleQuestions: true,
  shuffleOptions: true,
  showResultToTaker: false,
  recordProctorEvents: true,
  proctorPhotos: false,
  proctorPhotoIntervalSec: 180,
};

/** Memilih butir soal yang menyusun sebuah paket. */
const DialogSusunSoal = ({ paketId, onClose }: { paketId: string; onClose: () => void }) => {
  const qc = useQueryClient();
  // Pilihan pengguna menimpa susunan yang sudah tersimpan; selama belum
  // disentuh, yang tampil adalah isi paket dari server.
  const [pilihanBaru, setPilihanBaru] = React.useState<string[] | null>(null);
  const [kategori, setKategori] = React.useState("");

  const rinci = useQuery({
    queryKey: ["cbt", "paket", paketId],
    queryFn: async () => (await api.get<PaketCbtRinci>(`/cbt/tes/${paketId}`)).data,

  });
  const soal = useQuery({
    queryKey: ["cbt", "soal", "semua", kategori],
    queryFn: async () => (await api.get<Halaman<SoalCbt>>(`/cbt/soal?limit=100${kategori ? `&category=${encodeURIComponent(kategori)}` : ""}`)).data.data,
  });
  const kategoriTersedia = useQuery({
    queryKey: ["cbt", "soal", "kategori"],
    queryFn: async () => (await api.get<{ data: { category: string; jumlah: number }[] }>("/cbt/soal/kategori")).data.data,
  });

  const simpan = useMutation({
    mutationFn: async () => api.put(`/cbt/tes/${paketId}/soal`, { questions: terpilih.map((id) => ({ questionId: id })) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cbt"] });
      notifikasi.sukses("Susunan soal tersimpan", `${terpilih.length} soal`);
      onClose();
    },
    onError: (e) => notifikasi.galat(e, "Gagal menyimpan susunan"),
  });

  const terpilih = pilihanBaru ?? rinci.data?.questions.map((q) => q.question.id) ?? [];
  const setTerpilih = (ubah: (t: string[]) => string[]) => setPilihanBaru(ubah(terpilih));
  const daftar = soal.data ?? [];
  const totalPoin = daftar.filter((s) => terpilih.includes(s.id)).reduce((n, s) => n + s.points, 0);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Susun soal paket"
      description="Urutan mengikuti urutan pemilihan di daftar ini; peserta tetap menerimanya teracak bila paket memakai pengacakan."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={simpan.isPending}><X className="h-4 w-4" aria-hidden /> Batal</Button>
          <Button onClick={() => simpan.mutate()} loading={simpan.isPending} disabled={terpilih.length === 0}>
            {!simpan.isPending && <Save className="h-4 w-4" aria-hidden />} Simpan ({terpilih.length} soal · {totalPoin} poin)
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Select value={kategori} onChange={(e) => setKategori(e.target.value)} aria-label="Saring kategori">
          <option value="">Semua kategori</option>
          {(kategoriTersedia.data ?? []).map((k) => <option key={k.category} value={k.category}>{k.category} ({k.jumlah})</option>)}
        </Select>

        {soal.isLoading ? (
          <SkeletonBaris jumlah={5} />
        ) : daftar.length === 0 ? (
          <EmptyState icon={ListChecks} title="Bank soal masih kosong" description="Tambahkan soal lebih dulu di tab Bank Soal." />
        ) : (
          <ul className="max-h-96 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
            {daftar.map((s) => (
              <li key={s.id}>
                <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg p-2", terpilih.includes(s.id) ? "bg-primary-soft" : "hover:bg-surface-2")}>
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-[var(--primary)]"
                    checked={terpilih.includes(s.id)}
                    onChange={() => setTerpilih((t) => (t.includes(s.id) ? t.filter((x) => x !== s.id) : [...t, s.id]))}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{s.text}</span>
                    <span className="text-xs text-muted">{s.category} · {LABEL_TIPE_SOAL[s.type]} · {s.points} poin</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
};

/** Daftar paket tes beserta pengelolaannya. */
export const PaketTes = ({ bolehBuat, bolehUbah, bolehHapus }: { bolehBuat: boolean; bolehUbah: boolean; bolehHapus: boolean }) => {
  const qc = useQueryClient();
  const [form, setForm] = React.useState<{ open: boolean; item: PaketCbt | null }>({ open: false, item: null });
  const [susun, setSusun] = React.useState<PaketCbt | null>(null);
  const [tugas, setTugas] = React.useState<PaketCbt | null>(null);
  const [hapus, setHapus] = React.useState<PaketCbt | null>(null);

  const paket = useQuery({
    queryKey: ["cbt", "paket"],
    queryFn: async () => (await api.get<{ data: PaketCbt[] }>("/cbt/tes")).data.data,
  });

  const f = useForm<FormPaket>({ defaultValues: kosong });
  const pakaiFoto = useWatch({ control: f.control, name: "proctorPhotos" });

  React.useEffect(() => {
    if (!form.open) return;
    const p = form.item;
    f.reset(
      p
        ? {
            code: p.code,
            title: p.title,
            description: p.description ?? "",
            audience: p.audience,
            durationMinutes: p.durationMinutes,
            passingScore: p.passingScore === null ? "" : String(p.passingScore),
            shuffleQuestions: p.shuffleQuestions,
            shuffleOptions: p.shuffleOptions,
            showResultToTaker: p.showResultToTaker,
            recordProctorEvents: p.recordProctorEvents,
            proctorPhotos: p.proctorPhotos,
            proctorPhotoIntervalSec: p.proctorPhotoIntervalSec,
          }
        : kosong
    );
  }, [form, f]);

  const segarkan = () => qc.invalidateQueries({ queryKey: ["cbt"] });

  const simpan = useMutation({
    mutationFn: async (v: FormPaket) => {
      const body = {
        code: v.code.toUpperCase(),
        title: v.title,
        description: v.description || null,
        audience: v.audience,
        durationMinutes: Number(v.durationMinutes),
        passingScore: v.passingScore === "" ? null : Number(v.passingScore),
        shuffleQuestions: v.shuffleQuestions,
        shuffleOptions: v.shuffleOptions,
        showResultToTaker: v.showResultToTaker,
        recordProctorEvents: v.recordProctorEvents,
        proctorPhotos: v.proctorPhotos,
        proctorPhotoIntervalSec: Number(v.proctorPhotoIntervalSec),
      };
      // Paket yang sudah ditugaskan menolak perubahan aturan main; yang dikirim
      // saat menyunting hanya yang memang masih boleh berubah.
      const bodySunting = form.item?._count.assignments
        ? { title: body.title, description: body.description, audience: body.audience, showResultToTaker: body.showResultToTaker }
        : body;
      return form.item ? api.put(`/cbt/tes/${form.item.id}`, bodySunting) : api.post("/cbt/tes", body);
    },
    onSuccess: () => { segarkan(); notifikasi.sukses(form.item ? "Paket diperbarui" : "Paket dibuat"); setForm({ open: false, item: null }); },
    onError: (e) => notifikasi.galat(e, "Gagal menyimpan paket"),
  });

  const ubahStatus = useMutation({
    mutationFn: async ({ p, status }: { p: PaketCbt; status: string }) => api.put(`/cbt/tes/${p.id}`, { status }),
    onSuccess: (_, v) => { segarkan(); notifikasi.sukses(v.status === "published" ? "Paket ditayangkan" : "Paket diarsipkan", v.p.title); },
    onError: (e) => notifikasi.galat(e, "Gagal mengubah status"),
  });

  const buang = useMutation({
    mutationFn: async (p: PaketCbt) => api.delete(`/cbt/tes/${p.id}`),
    onSuccess: () => { segarkan(); notifikasi.sukses("Paket dihapus"); setHapus(null); },
    onError: (e) => { notifikasi.galat(e, "Gagal menghapus"); setHapus(null); },
  });

  return (
    <>
      {bolehBuat && (
        <div className="flex justify-end">
          <Button onClick={() => setForm({ open: true, item: null })}><Plus className="h-4 w-4" aria-hidden /> Paket Tes</Button>
        </div>
      )}

      {paket.isLoading ? (
        <SkeletonBaris />
      ) : !paket.data?.length ? (
        <Card><EmptyState icon={MonitorCheck} title="Belum ada paket tes" description="Paket menggabungkan butir dari bank soal beserta durasi, ambang lulus, dan aturan pengawasannya." /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {paket.data.map((p) => (
            <Card key={p.id} className="animate-fade-up flex flex-col">
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    <span className="truncate">{p.title}</span>
                    <Badge tone={p.status === "published" ? "success" : p.status === "draft" ? "neutral" : "warning"}>{LABEL_STATUS[p.status]}</Badge>
                  </CardTitle>
                  <CardDescription className="line-clamp-2">{p.description ?? `Kode ${p.code}`}</CardDescription>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {bolehUbah && <TombolAksi icon={Pencil} label={`Sunting ${p.title}`} onClick={() => setForm({ open: true, item: p })} />}
                  {bolehHapus && p._count.assignments === 0 && <TombolAksi icon={Trash2} label={`Hapus ${p.title}`} tone="bahaya" onClick={() => setHapus(p)} />}
                </div>
              </CardHeader>
              <CardContent className="mt-auto space-y-2 text-xs text-muted">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden /> {p.durationMinutes} menit</span>
                  <span className="inline-flex items-center gap-1"><ListChecks className="h-3.5 w-3.5" aria-hidden /> {p._count.questions} soal</span>
                  <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" aria-hidden /> {p._count.assignments} peserta</span>
                </p>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{LABEL_AUDIENS[p.audience]}</span>
                  <span>{p.passingScore === null ? "Tanpa ambang lulus" : `Lulus ≥ ${p.passingScore}%`}</span>
                  {p.proctorPhotos && <span className="inline-flex items-center gap-1 text-warning"><Camera className="h-3.5 w-3.5" aria-hidden /> Foto pengawasan</span>}
                  {p.showResultToTaker && <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" aria-hidden /> Nilai dibuka</span>}
                </p>
                {bolehUbah && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {p._count.assignments === 0 && (
                      <Button size="sm" variant="outline" onClick={() => setSusun(p)}><ListChecks className="h-4 w-4" aria-hidden /> Susun soal</Button>
                    )}
                    {p.status === "draft" && (
                      <Button size="sm" onClick={() => ubahStatus.mutate({ p, status: "published" })} disabled={p._count.questions === 0}>
                        <Megaphone className="h-4 w-4" aria-hidden /> Tayangkan
                      </Button>
                    )}
                    {p.status === "published" && (
                      <>
                        <Button size="sm" onClick={() => setTugas(p)}><Send className="h-4 w-4" aria-hidden /> Tugaskan</Button>
                        <Button size="sm" variant="outline" onClick={() => ubahStatus.mutate({ p, status: "archived" })}><Archive className="h-4 w-4" aria-hidden /> Arsipkan</Button>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={form.open}
        onClose={() => setForm({ open: false, item: null })}
        size="lg"
        title={form.item ? `Sunting: ${form.item.title}` : "Paket Tes Baru"}
        description={form.item?._count.assignments ? "Paket sudah ditugaskan: durasi, ambang lulus, pengacakan, dan isinya terkunci." : "Aturan main dikunci begitu paket ditugaskan ke peserta pertama."}
        footer={
          <>
            <Button variant="outline" onClick={() => setForm({ open: false, item: null })} disabled={simpan.isPending}><X className="h-4 w-4" aria-hidden /> Batal</Button>
            <Button form="form-paket" type="submit" loading={simpan.isPending}>{!simpan.isPending && <Save className="h-4 w-4" aria-hidden />} Simpan</Button>
          </>
        }
      >
        <form id="form-paket" onSubmit={f.handleSubmit((v) => simpan.mutate(v))} className="space-y-4" noValidate>
          {form.item && form.item._count.assignments > 0 && (
            <Alert tone="info" title="Sebagian setelan terkunci">
              {form.item._count.assignments} peserta sudah ditugaskan. Yang masih bisa diubah: judul, keterangan, sasaran peserta, dan pembukaan nilai.
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Kode" error={f.formState.errors.code?.message}>
              <Input className="font-mono uppercase" {...f.register("code", { required: "Wajib diisi", pattern: { value: /^[A-Za-z0-9_-]{2,40}$/, message: "2–40 karakter: huruf, angka, _ -" } })} placeholder="HIG-DASAR" disabled={Boolean(form.item?._count.assignments)} />
            </Field>
            <Field label="Judul" className="sm:col-span-2" error={f.formState.errors.title?.message}>
              <Input {...f.register("title", { required: "Wajib diisi" })} placeholder="Tes Higiene Dasar" />
            </Field>
          </div>
          <Field label="Keterangan"><Textarea rows={2} {...f.register("description")} placeholder="Untuk siapa tes ini dan apa yang diukur" /></Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Sasaran peserta">
              <Select {...f.register("audience")}>
                {Object.entries(LABEL_AUDIENS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Durasi (menit)">
              <Input type="number" min="1" {...f.register("durationMinutes", { valueAsNumber: true })} disabled={Boolean(form.item?._count.assignments)} />
            </Field>
            <Field label="Ambang lulus (%)" hint="Kosongkan bila tanpa kelulusan">
              <Input type="number" min="0" max="100" {...f.register("passingScore")} disabled={Boolean(form.item?._count.assignments)} />
            </Field>
          </div>

          <fieldset className="space-y-2 rounded-xl border border-border p-3">
            <legend className="px-1 text-sm font-medium">Aturan pengerjaan</legend>
            {[
              { name: "shuffleQuestions" as const, label: "Acak urutan soal", kunci: true },
              { name: "shuffleOptions" as const, label: "Acak urutan pilihan jawaban", kunci: true },
              { name: "showResultToTaker" as const, label: "Peserta boleh melihat nilainya sendiri", kunci: false },
              { name: "recordProctorEvents" as const, label: "Catat saat peserta berpindah tab atau keluar layar", kunci: false },
              { name: "proctorPhotos" as const, label: "Ambil foto wajah berkala lewat kamera peserta", kunci: false },
            ].map((o) => (
              <label key={o.name} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" {...f.register(o.name)} disabled={o.kunci && Boolean(form.item?._count.assignments)} />
                {o.label}
              </label>
            ))}
            {pakaiFoto && (
              <Field label="Jeda antar foto (detik)" hint="Minimal 30 detik">
                <Input type="number" min="30" max="1800" {...f.register("proctorPhotoIntervalSec", { valueAsNumber: true })} />
              </Field>
            )}
          </fieldset>
        </form>
      </Modal>

      {/* Keduanya dipasang hanya saat dibuka: satu kali pakai, keadaannya
          selalu mulai dari nol tanpa perlu effect pereset. */}
      {susun && <DialogSusunSoal paketId={susun.id} onClose={() => setSusun(null)} />}
      {tugas && <DialogTugaskan paket={tugas} onClose={() => setTugas(null)} />}

      <ConfirmDialog
        open={Boolean(hapus)}
        onClose={() => setHapus(null)}
        onConfirm={() => hapus && buang.mutate(hapus)}
        loading={buang.isPending}
        danger
        title="Hapus paket tes?"
        description={`"${hapus?.title}" akan dihapus beserta susunan soalnya. Paket yang sudah pernah ditugaskan tidak bisa dihapus.`}
        confirmLabel="Hapus"
        confirmIcon={Trash2}
      />
    </>
  );
};
