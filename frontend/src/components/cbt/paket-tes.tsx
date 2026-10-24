"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch, Controller } from "react-hook-form";
import { Archive, Brain, Camera, Clock, Eye, ListChecks, Megaphone, MonitorCheck, Pencil, Plus, Save, Send, Trash2, Users, X } from "lucide-react";
import { api, ambilSemua } from "@/lib/api";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Button, TombolAksi } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input, Select, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { DialogTugaskan } from "./tugaskan";
import { DialogPesertaPaket } from "./peserta-paket";
import { LABEL_TIPE_SOAL } from "./bank-soal";
import type { LingkupCbt, AudiensCbt, PaketCbt, PaketCbtRinci, SoalCbt } from "@/lib/types";
import { EditorTeks } from "@/components/ui/editor-teks";

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
  audience: "karyawan",
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
const DialogSusunSoal = ({ paketId, scope, onClose }: { paketId: string; scope: LingkupCbt; onClose: () => void }) => {
  const qc = useQueryClient();
  // Pilihan pengguna menimpa susunan yang sudah tersimpan; selama belum
  // disentuh, yang tampil adalah isi paket dari server.
  const [pilihanBaru, setPilihanBaru] = React.useState<string[] | null>(null);
  const [kategori, setKategori] = React.useState("");

  const rinci = useQuery({
    queryKey: ["cbt", "paket", scope, paketId],
    queryFn: async () => (await api.get<PaketCbtRinci>(`/cbt/tes/${paketId}?scope=${scope}`)).data,

  });
  const soal = useQuery({
    queryKey: ["cbt", "soal", "semua", scope, kategori],
    // Seluruh bank soal aktif, bukan 100 pertama: paket Big Five saja sudah
    // 50 butir, dan soal di luar halaman pertama tidak bisa dipilih.
    queryFn: async () => ambilSemua<SoalCbt>("/cbt/soal", { scope, ...(kategori ? { category: kategori } : {}) }),
  });
  const kategoriTersedia = useQuery({
    queryKey: ["cbt", "soal", "kategori", scope],
    queryFn: async () => (await api.get<{ data: { category: string; jumlah: number }[] }>(`/cbt/soal/kategori?scope=${scope}`)).data.data,
  });

  const simpan = useMutation({
    mutationFn: async () => api.put(`/cbt/tes/${paketId}/soal?scope=${scope}`, { questions: terpilih.map((id) => ({ questionId: id })) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cbt"] });
      notifikasi.sukses("Susunan soal tersimpan", `${terpilih.length} soal`);
      onClose();
    },
    onError: (e) => notifikasi.galat(e, "Gagal menyimpan susunan"),
  });

  // Soal yang sudah dinonaktifkan dikeluarkan dari susunan awal: server menolak
  // menyimpannya, dan dulu dialog ini buntu karena soal itu tidak tampil di
  // daftar sehingga tidak bisa dihapus centangnya.
  const tersimpan = rinci.data?.questions ?? [];
  const nonaktif = tersimpan.filter((q) => !q.question.isActive);
  const terpilih = pilihanBaru ?? tersimpan.filter((q) => q.question.isActive).map((q) => q.question.id);
  const setTerpilih = (ubah: (t: string[]) => string[]) => setPilihanBaru(ubah(terpilih));
  const daftar = soal.data ?? [];
  // Poin dari isi paket dan bank soal sekaligus: soal terpilih dari kategori
  // lain tidak ada di daftar yang sedang disaring.
  const poin = new Map<string, number>([...tersimpan.map((q) => [q.question.id, q.question.points] as const), ...daftar.map((s) => [s.id, s.points] as const)]);
  const totalPoin = terpilih.reduce((n, id) => n + (poin.get(id) ?? 0), 0);

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
        {nonaktif.length > 0 && (
          <Alert tone="warning" title={`${nonaktif.length} soal nonaktif dikeluarkan`}>
            Soal yang sudah dinonaktifkan di bank soal tidak ikut susunan ini. Simpan agar paket bisa ditayangkan dan ditugaskan.
          </Alert>
        )}
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
export const PaketTes = ({ scope, bolehBuat, bolehUbah, bolehHapus }: { scope: LingkupCbt; bolehBuat: boolean; bolehUbah: boolean; bolehHapus: boolean }) => {
  const qc = useQueryClient();
  // Paket standar Big Five juga menulis 50 butir ke bank soal.
  const { data: saya } = useSesi();
  const bolehSoal = punyaIzin(saya, "cbt_soal.buat");
  const bolehPaketBersama = punyaIzin(saya, "rekrutmen.lihat", "rekrutmen.buat", "rekrutmen.ubah", "rekrutmen.hapus");
  const bolehSunting = (p: PaketCbt) => bolehUbah && (p.audience !== "keduanya" || bolehPaketBersama);
  const [form, setForm] = React.useState<{ open: boolean; item: PaketCbt | null }>({ open: false, item: null });
  const [susun, setSusun] = React.useState<PaketCbt | null>(null);
  const [tugas, setTugas] = React.useState<PaketCbt | null>(null);
  const [hapus, setHapus] = React.useState<PaketCbt | null>(null);
  const [peserta, setPeserta] = React.useState<PaketCbt | null>(null);

  const paket = useQuery({
    queryKey: ["cbt", "paket", scope],
    queryFn: async () => (await api.get<{ data: PaketCbt[] }>(`/cbt/tes?scope=${scope}`)).data.data,
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
            description: p.descriptionHtml ?? p.description ?? "",
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
        : { ...kosong, audience: scope === "recruitment" ? "pelamar" : "karyawan" }
    );
  }, [form, f, scope]);

  const segarkan = () => qc.invalidateQueries({ queryKey: ["cbt"] });

  const simpan = useMutation({
    mutationFn: async (v: FormPaket) => {
      const body = {
        code: v.code.toUpperCase(),
        title: v.title,
        descriptionHtml: v.description || null,
        audience: form.item?.audience ?? (scope === "recruitment" ? "pelamar" : "karyawan"),
        durationMinutes: Number(v.durationMinutes),
        passingScore: form.item?.kind === "kepribadian" || v.passingScore === "" ? null : Number(v.passingScore),
        shuffleQuestions: v.shuffleQuestions,
        shuffleOptions: v.shuffleOptions,
        showResultToTaker: v.showResultToTaker,
        recordProctorEvents: v.recordProctorEvents,
        proctorPhotos: v.proctorPhotos,
        // Isian jeda yang dikosongkan lalu disembunyikan (foto dimatikan)
        // bernilai NaN; mengirimnya membuat seluruh simpanan ditolak.
        ...(Number.isFinite(Number(v.proctorPhotoIntervalSec)) ? { proctorPhotoIntervalSec: Number(v.proctorPhotoIntervalSec) } : {}),
      };
      // Paket yang sudah ditugaskan menolak perubahan aturan main; yang dikirim
      // saat menyunting hanya yang memang masih boleh berubah — termasuk
      // pengawasan, yang dulu tampak bisa diubah tetapi dibuang diam-diam.
      const bodySunting = form.item?._count.assignments
        ? {
            title: body.title,
            descriptionHtml: body.descriptionHtml,
            audience: body.audience,
            showResultToTaker: body.showResultToTaker,
            recordProctorEvents: body.recordProctorEvents,
            proctorPhotos: body.proctorPhotos,
            ...(body.proctorPhotos && body.proctorPhotoIntervalSec !== undefined ? { proctorPhotoIntervalSec: body.proctorPhotoIntervalSec } : {}),
          }
        : body;
      return form.item ? api.put(`/cbt/tes/${form.item.id}?scope=${scope}`, bodySunting) : api.post(`/cbt/tes?scope=${scope}`, { ...body, scope });
    },
    onSuccess: () => { segarkan(); notifikasi.sukses(form.item ? "Paket diperbarui" : "Paket dibuat"); setForm({ open: false, item: null }); },
    onError: (e) => notifikasi.galat(e, "Gagal menyimpan paket"),
  });

  const ubahStatus = useMutation({
    mutationFn: async ({ p, status }: { p: PaketCbt; status: string }) => api.put(`/cbt/tes/${p.id}?scope=${scope}`, { status }),
    onSuccess: (_, v) => { segarkan(); notifikasi.sukses(v.status === "published" ? "Paket ditayangkan" : "Paket diarsipkan", v.p.title); },
    onError: (e) => notifikasi.galat(e, "Gagal mengubah status"),
  });

  // Paket standar inventori kepribadian Big Five (IPIP-50, domain publik):
  // 50 butir skala dibuat sekali di bank soal, paketnya langsung tayang.
  const buatStandar = useMutation({
    mutationFn: async () => (await api.post<PaketCbt & { dibuat: boolean }>(`/cbt/tes/standar/kepribadian-big5?scope=${scope}`, { scope })).data,
    onSuccess: (p) => {
      segarkan();
      if (p.dibuat) notifikasi.sukses("Paket kepribadian dibuat", `${p.title} · 50 butir skala dalam 5 dimensi, siap ditugaskan.`);
      else if (p.status === "archived") notifikasi.info("Paket kepribadian sudah ada, tetapi diarsipkan", `Tayangkan lagi ${p.title} dari daftar untuk menugaskannya.`);
      else notifikasi.info("Paket kepribadian sudah ada", `${p.title} sudah tersedia di daftar.`);
    },
    onError: (e) => notifikasi.galat(e, "Paket kepribadian belum dibuat"),
  });

  const buang = useMutation({
    mutationFn: async (p: PaketCbt) => api.delete(`/cbt/tes/${p.id}?scope=${scope}`),
    onSuccess: () => { segarkan(); notifikasi.sukses("Paket dihapus"); setHapus(null); },
    onError: (e) => { notifikasi.galat(e, "Gagal menghapus"); setHapus(null); },
  });

  return (
    <>
      {bolehBuat && (
        <div className="flex flex-wrap justify-end gap-2">
          {scope === "recruitment" && bolehSoal && <Button variant="outline" onClick={() => buatStandar.mutate()} loading={buatStandar.isPending} title="Inventori Big Five berbasis IPIP-50 (domain publik): 50 pernyataan skala 1–5, hasilnya profil per dimensi">
            {!buatStandar.isPending && <Brain className="h-4 w-4" aria-hidden />} Paket Kepribadian Big Five
          </Button>}
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
                    {p.kind === "kepribadian" && <Badge tone="info">Kepribadian</Badge>}
                    {p.audience === "keduanya" && <Badge tone="info">Paket bersama (lama)</Badge>}
                  </CardTitle>
                  <CardDescription className="line-clamp-2">{p.description ?? `Kode ${p.code}`}</CardDescription>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {bolehSunting(p) && <TombolAksi icon={Pencil} label={`Sunting ${p.title}`} onClick={() => setForm({ open: true, item: p })} />}
                  {bolehHapus && (p.audience !== "keduanya" || bolehPaketBersama) && p._count.assignments === 0 && <TombolAksi icon={Trash2} label={`Hapus ${p.title}`} tone="bahaya" onClick={() => setHapus(p)} />}
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
                  <span>{p.kind === "kepribadian" ? "Profil per dimensi, tanpa kelulusan" : p.passingScore === null ? "Tanpa ambang lulus" : `Lulus ≥ ${p.passingScore}%`}</span>
                  {p.proctorPhotos && <span className="inline-flex items-center gap-1 text-warning"><Camera className="h-3.5 w-3.5" aria-hidden /> Foto pengawasan</span>}
                  {p.showResultToTaker && <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" aria-hidden /> Nilai dibuka</span>}
                </p>
                {(bolehBuat || bolehUbah) && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {(bolehBuat || bolehUbah) && p._count.assignments > 0 && (
                      <Button size="sm" variant="outline" onClick={() => setPeserta(p)}><Users className="h-4 w-4" aria-hidden /> Peserta</Button>
                    )}
                    {bolehSunting(p) && (<>
                    {p._count.assignments === 0 && (
                      <Button size="sm" variant="outline" onClick={() => setSusun(p)}><ListChecks className="h-4 w-4" aria-hidden /> Susun soal</Button>
                    )}
                    {p.status === "draft" && (
                      <Button size="sm" onClick={() => ubahStatus.mutate({ p, status: "published" })} disabled={p._count.questions === 0}>
                        <Megaphone className="h-4 w-4" aria-hidden /> Tayangkan
                      </Button>
                    )}
                    {p.status === "published" && <Button size="sm" variant="outline" onClick={() => ubahStatus.mutate({ p, status: "archived" })}><Archive className="h-4 w-4" aria-hidden /> Arsipkan</Button>}
                    </>)}
                    {bolehBuat && p.status === "published" && <Button size="sm" onClick={() => setTugas(p)}><Send className="h-4 w-4" aria-hidden /> Tugaskan</Button>}
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
        title={form.item ? `Sunting: ${form.item.title}` : scope === "recruitment" ? "Paket Tes Seleksi Baru" : "Paket Tes Karyawan Baru"}
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
              {form.item._count.assignments} peserta sudah ditugaskan. Yang masih bisa diubah: judul, keterangan, pembukaan nilai, dan pengawasan.
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
          <Field label="Keterangan">
            <Controller control={f.control} name="description" render={({ field }) => <EditorTeks {...field} placeholder="Untuk siapa tes ini dan apa yang diukur" minTinggi="7rem" />} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Sasaran peserta">
              <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">{LABEL_AUDIENS[form.item?.audience ?? (scope === "recruitment" ? "pelamar" : "karyawan")]}</p>
            </Field>
            <Field label="Durasi (menit)">
              <Input type="number" min="1" {...f.register("durationMinutes", { valueAsNumber: true })} disabled={Boolean(form.item?._count.assignments)} />
            </Field>
            {form.item?.kind === "kepribadian" ? <Field label="Hasil"><p className="py-2 text-sm text-muted">Profil per dimensi, tanpa kelulusan</p></Field> : <Field label="Ambang lulus (%)" hint="Kosongkan bila tanpa kelulusan">
              <Input type="number" min="0" max="100" {...f.register("passingScore")} disabled={Boolean(form.item?._count.assignments)} />
            </Field>}
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
      {susun && <DialogSusunSoal scope={scope} paketId={susun.id} onClose={() => setSusun(null)} />}
      {peserta && <DialogPesertaPaket scope={scope} paket={peserta} onClose={() => setPeserta(null)} />}
      {tugas && <DialogTugaskan scope={scope} paket={tugas} onClose={() => setTugas(null)} />}

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
