"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch, Controller } from "react-hook-form";
import { ListChecks, Pencil, Plus, Search, Trash2, X, Save } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Button, TombolAksi } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select, Field, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/utils";
import type { Halaman, PilihanSoal, SoalCbt, TingkatSoalCbt, TipeSoalCbt } from "@/lib/types";
import { EditorTeks } from "@/components/ui/editor-teks";

export const LABEL_TIPE_SOAL: Record<TipeSoalCbt, string> = {
  pilihan_ganda: "Pilihan ganda",
  banyak_jawaban: "Banyak jawaban",
  benar_salah: "Benar / salah",
  isian: "Isian singkat",
  esai: "Esai",
};

const LABEL_TINGKAT: Record<TingkatSoalCbt, string> = { mudah: "Mudah", sedang: "Sedang", sulit: "Sulit" };

const KODE = ["a", "b", "c", "d", "e"];

/**
 * `kunci` sengaja longgar: react-hook-form mengembalikan string untuk grup
 * radio (pilihan ganda, benar/salah) dan array untuk kotak centang (banyak
 * jawaban). Dinormalkan sekali di daftarKunci() sebelum dikirim.
 */
type FormSoal = {
  category: string;
  difficulty: TingkatSoalCbt;
  type: TipeSoalCbt;
  text: string;
  points: number;
  rubric: string;
  explanation: string;
  /** Teks tiap pilihan, diindeks sama dengan KODE. */
  pilihan: string[];
  /** Kode pilihan yang benar; string bila dari radio, array bila dari centang. */
  kunci: string[] | string;
  /** Jawaban yang diterima untuk isian, dipisah baris baru. */
  kunciIsian: string;
};

const kosong: FormSoal = {
  category: "",
  difficulty: "sedang",
  type: "pilihan_ganda",
  text: "",
  points: 1,
  rubric: "",
  explanation: "",
  pilihan: ["", "", "", ""],
  kunci: [],
  kunciIsian: "",
};

/** Bank soal: sumber butir untuk semua paket tes. */
export const BankSoal = ({ bolehBuat, bolehUbah, bolehHapus }: { bolehBuat: boolean; bolehUbah: boolean; bolehHapus: boolean }) => {
  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [cari, setCari] = React.useState("");
  const [kategori, setKategori] = React.useState("");
  const [tipe, setTipe] = React.useState("");
  const [form, setForm] = React.useState<{ open: boolean; item: SoalCbt | null }>({ open: false, item: null });
  const [hapus, setHapus] = React.useState<SoalCbt | null>(null);

  const params = new URLSearchParams({ page: String(page), limit: "20", includeInactive: "true" });
  if (cari) params.set("search", cari);
  if (kategori) params.set("category", kategori);
  if (tipe) params.set("type", tipe);

  const soal = useQuery({
    queryKey: ["cbt", "soal", params.toString()],
    queryFn: async () => (await api.get<Halaman<SoalCbt>>(`/cbt/soal?${params}`)).data,
    placeholderData: (p) => p,
  });
  const kategoriTersedia = useQuery({
    queryKey: ["cbt", "soal", "kategori"],
    queryFn: async () => (await api.get<{ data: { category: string; jumlah: number }[] }>("/cbt/soal/kategori")).data.data,
  });

  const f = useForm<FormSoal>({ defaultValues: kosong });
  const tipeDipilih = useWatch({ control: f.control, name: "type" });
  const berpilihan = tipeDipilih === "pilihan_ganda" || tipeDipilih === "banyak_jawaban" || tipeDipilih === "benar_salah";

  React.useEffect(() => {
    if (!form.open) return;
    const s = form.item;
    f.reset(
      s
        ? {
            category: s.category,
            difficulty: s.difficulty,
            type: s.type,
            text: s.textHtml ?? s.text,
            points: s.points,
            rubric: s.rubric ?? "",
            explanation: s.explanation ?? "",
            pilihan: KODE.map((k) => s.options?.find((o) => o.kode === k)?.teks ?? ""),
            kunci: s.type === "isian" || s.type === "esai" ? [] : s.type === "banyak_jawaban" ? s.answerKey : (s.answerKey[0] ?? ""),
            kunciIsian: s.type === "isian" ? s.answerKey.join("\n") : "",
          }
        : kosong
    );
  }, [form, f]);

  const segarkan = () => {
    qc.invalidateQueries({ queryKey: ["cbt", "soal"] });
    qc.invalidateQueries({ queryKey: ["cbt", "paket"] });
  };

  const daftarKunci = (kunci: FormSoal["kunci"]) =>
    (Array.isArray(kunci) ? kunci : [kunci]).filter((k): k is string => Boolean(k));

  const simpan = useMutation({
    mutationFn: async (v: FormSoal) => {
      const isBenarSalah = v.type === "benar_salah";
      const pilihan: PilihanSoal[] = isBenarSalah
        ? [{ kode: "a", teks: "Benar" }, { kode: "b", teks: "Salah" }]
        : v.pilihan.map((teks, i) => ({ kode: KODE[i], teks: teks.trim() })).filter((o) => o.teks.length > 0);

      const body = {
        category: v.category,
        difficulty: v.difficulty,
        type: v.type,
        textHtml: v.text,
        points: Number(v.points),
        rubric: v.type === "esai" ? v.rubric || null : null,
        explanation: v.explanation || null,
        ...(v.type === "isian"
          ? { answerKey: v.kunciIsian.split("\n").map((t) => t.trim()).filter(Boolean) }
          : v.type === "esai"
            ? { answerKey: [] }
            : { options: pilihan, answerKey: daftarKunci(v.kunci).filter((k) => pilihan.some((o) => o.kode === k)) }),
      };
      return form.item ? api.put(`/cbt/soal/${form.item.id}`, body) : api.post("/cbt/soal", body);
    },
    onSuccess: () => {
      segarkan();
      notifikasi.sukses(form.item ? "Soal diperbarui" : "Soal ditambahkan");
      setForm({ open: false, item: null });
    },
    onError: (e) => notifikasi.galat(e, "Gagal menyimpan soal"),
  });

  const buang = useMutation({
    mutationFn: async (s: SoalCbt) => api.delete(`/cbt/soal/${s.id}`),
    onSuccess: () => { segarkan(); notifikasi.sukses("Soal dihapus atau dinonaktifkan"); setHapus(null); },
    onError: (e) => { notifikasi.galat(e, "Gagal menghapus"); setHapus(null); },
  });

  return (
    <>
      <Card>
        <div className="grid gap-2 border-b border-border p-3 sm:grid-cols-[1fr_auto_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input className="pl-9" placeholder="Cari teks soal…" value={cari} onChange={(e) => { setCari(e.target.value); setPage(1); }} aria-label="Cari soal" />
          </div>
          <Select value={kategori} onChange={(e) => { setKategori(e.target.value); setPage(1); }} aria-label="Saring kategori" className="sm:w-52">
            <option value="">Semua kategori</option>
            {(kategoriTersedia.data ?? []).map((k) => <option key={k.category} value={k.category}>{k.category} ({k.jumlah})</option>)}
          </Select>
          <Select value={tipe} onChange={(e) => { setTipe(e.target.value); setPage(1); }} aria-label="Saring tipe" className="sm:w-44">
            <option value="">Semua tipe</option>
            {Object.entries(LABEL_TIPE_SOAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          {bolehBuat && <Button onClick={() => setForm({ open: true, item: null })}><Plus className="h-4 w-4" aria-hidden /> Soal</Button>}
        </div>

        {soal.isLoading ? (
          <SkeletonBaris />
        ) : !soal.data?.data.length ? (
          <EmptyState icon={ListChecks} title="Belum ada soal" description="Bank soal dipakai bersama oleh semua paket tes, jadi satu butir cukup ditulis sekali." />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {soal.data.data.map((s) => (
                <li key={s.id} className={cn("flex items-start gap-3 p-4", !s.isActive && "opacity-60")}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">{s.category}</Badge>
                      <span className="text-xs text-muted">{LABEL_TIPE_SOAL[s.type]} · {LABEL_TINGKAT[s.difficulty]} · {s.points} poin</span>
                      {!s.isActive && <Badge tone="danger">Nonaktif</Badge>}
                      {s._count.answers > 0 && <Badge tone="warning">Sudah dijawab {s._count.answers}×</Badge>}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm">{s.text}</p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {bolehUbah && <TombolAksi icon={Pencil} label={`Sunting soal ${s.category}`} onClick={() => setForm({ open: true, item: s })} />}
                    {bolehHapus && <TombolAksi icon={Trash2} label={`Hapus soal ${s.category}`} tone="bahaya" onClick={() => setHapus(s)} />}
                  </div>
                </li>
              ))}
            </ul>
            <Pagination pagination={soal.data.pagination} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal
        open={form.open}
        onClose={() => setForm({ open: false, item: null })}
        size="lg"
        title={form.item ? "Sunting Soal" : "Soal Baru"}
        description={form.item && form.item._count.answers > 0 ? "Soal ini sudah pernah dijawab: kunci, pilihan, tipe, dan bobotnya terkunci." : "Kunci jawaban tidak pernah dikirim ke peserta."}
        footer={
          <>
            <Button variant="outline" onClick={() => setForm({ open: false, item: null })} disabled={simpan.isPending}><X className="h-4 w-4" aria-hidden /> Batal</Button>
            <Button form="form-soal" type="submit" loading={simpan.isPending}>{!simpan.isPending && <Save className="h-4 w-4" aria-hidden />} Simpan</Button>
          </>
        }
      >
        <form id="form-soal" onSubmit={f.handleSubmit((v) => simpan.mutate(v))} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Kategori" hint="Mis. Numerik, Higiene" error={f.formState.errors.category?.message}>
              <Input list="kategori-cbt" {...f.register("category", { required: "Wajib diisi" })} placeholder="Higiene Dapur" />
              <datalist id="kategori-cbt">
                {(kategoriTersedia.data ?? []).map((k) => <option key={k.category} value={k.category} />)}
              </datalist>
            </Field>
            <Field label="Tipe soal">
              <Select {...f.register("type")} disabled={Boolean(form.item && form.item._count.answers > 0)}>
                {Object.entries(LABEL_TIPE_SOAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Tingkat">
              <Select {...f.register("difficulty")}>
                {Object.entries(LABEL_TINGKAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
          </div>

          <Field label="Pertanyaan" error={f.formState.errors.text?.message}>
            <Controller
              control={f.control}
              name="text"
              rules={{ required: "Wajib diisi" }}
              render={({ field }) => <EditorTeks {...field} placeholder="Tulis pertanyaannya…" minTinggi="8rem" />}
            />
          </Field>

          {berpilihan && tipeDipilih !== "benar_salah" && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Pilihan jawaban</legend>
              <p className="text-xs text-muted">Centang yang benar. Pilihan yang dikosongkan tidak ikut disimpan.</p>
              {KODE.map((kode, i) => (
                <div key={kode} className="flex items-center gap-2">
                  <input
                    type={tipeDipilih === "banyak_jawaban" ? "checkbox" : "radio"}
                    value={kode}
                    {...f.register("kunci")}
                    className="h-4 w-4 accent-[var(--primary)]"
                    aria-label={`Pilihan ${kode} benar`}
                  />
                  <span className="w-5 text-sm font-medium uppercase text-muted">{kode}</span>
                  <Input {...f.register(`pilihan.${i}` as const)} placeholder={i < 2 ? "Wajib" : "Opsional"} />
                </div>
              ))}
            </fieldset>
          )}

          {tipeDipilih === "benar_salah" && (
            <Field label="Jawaban benar">
              <Select {...f.register("kunci.0" as const)}>
                <option value="a">Benar</option>
                <option value="b">Salah</option>
              </Select>
            </Field>
          )}

          {tipeDipilih === "isian" && (
            <Field label="Jawaban yang diterima" hint="Satu per baris. Besar-kecil huruf dan spasi berlebih diabaikan.">
              <Textarea rows={3} {...f.register("kunciIsian")} placeholder={"HACCP\nHazard Analysis Critical Control Point"} />
            </Field>
          )}

          {tipeDipilih === "esai" && (
            <Field label="Rubrik penilaian" hint="Panduan untuk penguji, tidak ditampilkan ke peserta.">
              <Textarea rows={3} {...f.register("rubric")} placeholder="Menyebut enam langkah berurutan…" />
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bobot nilai">
              <Input type="number" step="0.5" min="0.5" {...f.register("points", { valueAsNumber: true })} disabled={Boolean(form.item && form.item._count.answers > 0)} />
            </Field>
            <Field label="Pembahasan (opsional)" hint="Hanya tampil bila paket membuka hasil untuk peserta.">
              <Input {...f.register("explanation")} />
            </Field>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(hapus)}
        onClose={() => setHapus(null)}
        onConfirm={() => hapus && buang.mutate(hapus)}
        loading={buang.isPending}
        danger
        title="Hapus soal?"
        description="Soal yang sudah dipakai paket atau pernah dijawab tidak benar-benar dihapus, hanya dinonaktifkan supaya hasil lama tetap bisa dibuka."
        confirmLabel="Hapus"
        confirmIcon={Trash2}
      />
    </>
  );
};
