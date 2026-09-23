"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { ClipboardList, Plus, Trash2, BarChart3, CheckCircle2, Clock, Megaphone, Send, X } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { GrafikBatang } from "@/components/dashboard/grafik-batang";
import { formatTanggal, labelStatus, cn } from "@/lib/utils";
import type { Halaman, Survei, HasilSurvei, Departemen, JenisPertanyaan } from "@/lib/types";

type FormPertanyaan = { code: string; text: string; type: JenisPertanyaan; options: string; minScale: string; maxScale: string; isRequired: boolean };
type FormSurvei = { title: string; description: string; isAnonymous: boolean; targetDepartmentId: string; startDate: string; endDate: string; questions: FormPertanyaan[] };
type Jawaban = Record<string, string>;

/** Satu pertanyaan saat diisi: skala sebagai deret tombol, pilihan sebagai radio, teks sebagai textarea. */
const IsiPertanyaan = ({ q, nilai, onUbah, galat }: { q: Survei["questions"][number]; nilai: string; onUbah: (v: string) => void; galat?: string }) => {
  const min = q.minScale ?? 1, max = q.maxScale ?? 5;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{q.text}{q.isRequired && <span className="text-danger"> *</span>}</legend>
      {q.type === "scale" && (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={q.text}>
          {Array.from({ length: max - min + 1 }, (_, i) => String(min + i)).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={nilai === v} onClick={() => onUbah(v)}
              className={cn("h-10 min-w-10 rounded-lg border px-3 text-sm font-medium transition-colors", nilai === v ? "border-primary bg-primary text-on-primary" : "border-border bg-surface hover:bg-surface-2")}>{v}</button>
          ))}
        </div>
      )}
      {q.type === "choice" && (
        <div className="space-y-1.5" role="radiogroup" aria-label={q.text}>
          {(q.options ?? []).map((o) => (
            <label key={o} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", nilai === o ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-2")}>
              <input type="radio" name={q.id} value={o} checked={nilai === o} onChange={() => onUbah(o)} className="accent-[var(--primary)]" />{o}
            </label>
          ))}
        </div>
      )}
      {q.type === "text" && <Textarea rows={3} value={nilai} onChange={(e) => onUbah(e.target.value)} aria-label={q.text} />}
      {galat && <p role="alert" className="text-xs text-danger">{galat}</p>}
    </fieldset>
  );
};

export const PanelSurvei = ({ hr, bolehBuat }: { hr: boolean; bolehBuat: boolean }) => {
  const qc = useQueryClient();
  const [buatBuka, setBuatBuka] = React.useState(false);
  const [isi, setIsi] = React.useState<Survei | null>(null);
  const [jawaban, setJawaban] = React.useState<Jawaban>({});
  const [galat, setGalat] = React.useState<Record<string, string>>({});
  const [hasil, setHasil] = React.useState<Survei | null>(null);

  const survei = useQuery({ queryKey: ["survei"], queryFn: async () => (await api.get<Halaman<Survei>>("/surveys?limit=50")).data.data });
  const departemen = useQuery({ queryKey: ["departemen", "semua"], queryFn: async () => (await api.get<Halaman<Departemen>>("/departments?limit=100")).data.data, enabled: buatBuka });
  const hasilSurvei = useQuery({ queryKey: ["survei", "hasil", hasil?.id], queryFn: async () => (await api.get<HasilSurvei>(`/surveys/${hasil!.id}/results`)).data, enabled: Boolean(hasil) });

  const f = useForm<FormSurvei>({ defaultValues: { title: "", description: "", isAnonymous: true, targetDepartmentId: "", startDate: "", endDate: "", questions: [{ code: "Q1", text: "", type: "scale", options: "", minScale: "1", maxScale: "5", isRequired: true }] } });
  const daftar = useFieldArray({ control: f.control, name: "questions" });
  const pertanyaanDiawasi = useWatch({ control: f.control, name: "questions" });

  const buat = useMutation({
    mutationFn: async (v: FormSurvei) => (await api.post<Survei>("/surveys", {
      title: v.title, ...(v.description ? { description: v.description } : {}), isAnonymous: v.isAnonymous,
      ...(v.targetDepartmentId ? { targetDepartmentId: v.targetDepartmentId } : {}),
      startDate: new Date(v.startDate).toISOString(), endDate: new Date(v.endDate + "T23:59:59").toISOString(),
      questions: v.questions.map((q) => ({
        code: q.code.toUpperCase(), text: q.text, type: q.type, isRequired: q.isRequired,
        ...(q.type === "choice" ? { options: q.options.split("\n").map((o) => o.trim()).filter(Boolean) } : {}),
        ...(q.type === "scale" ? { minScale: Number(q.minScale), maxScale: Number(q.maxScale) } : {}),
      })),
    })).data,
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ["survei"] }); notifikasi.sukses("Survei dibuat", `${s.title} · masih draft, tayangkan agar karyawan bisa mengisi.`); setBuatBuka(false); f.reset(); },
    onError: (e) => notifikasi.galat(e, "Survei gagal dibuat"),
  });

  const ubahStatus = useMutation({
    mutationFn: async ({ s, status }: { s: Survei; status: string }) => (await api.patch<Survei>(`/surveys/${s.id}/status`, { status })).data,
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ["survei"] }); notifikasi.sukses(`Survei ${labelStatus(s.status).toLowerCase()}`, s.title); },
    onError: (e) => notifikasi.galat(e),
  });

  const kirim = useMutation({
    mutationFn: async () => {
      const s = isi!;
      const kosong: Record<string, string> = {};
      for (const q of s.questions) if (q.isRequired && !(jawaban[q.id] ?? "").trim()) kosong[q.id] = "Wajib diisi";
      if (Object.keys(kosong).length) { setGalat(kosong); throw new Error("Masih ada pertanyaan wajib yang belum dijawab"); }
      return (await api.post(`/surveys/${s.id}/submit`, {
        answers: s.questions.filter((q) => (jawaban[q.id] ?? "") !== "").map((q) => ({
          questionId: q.id,
          ...(q.type === "scale" ? { scaleValue: Number(jawaban[q.id]) } : q.type === "choice" ? { choiceValue: jawaban[q.id] } : { textValue: jawaban[q.id] }),
        })),
      })).data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["survei"] }); notifikasi.sukses("Terima kasih, jawaban tersimpan", isi?.isAnonymous ? "Survei ini anonim — jawaban tidak dikaitkan dengan nama Anda." : undefined); setIsi(null); setJawaban({}); setGalat({}); },
    onError: (e) => notifikasi.galat(e, "Jawaban belum terkirim"),
  });

  const aktif = (s: Survei) => s.status === "published" && new Date(s.endDate) >= new Date();

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{survei.data ? `${survei.data.filter(aktif).length} survei sedang berjalan` : ""}</p>
        {bolehBuat && <Button onClick={() => setBuatBuka(true)}><Plus className="h-4 w-4" aria-hidden /> Survei</Button>}
      </div>

      {survei.isLoading ? <SkeletonBaris /> : !survei.data?.length ? (
        <Card><EmptyState icon={ClipboardList} title="Belum ada survei" description={hr ? "Buat survei kepuasan karyawan untuk mendengar masukan mereka." : "Belum ada survei yang ditujukan untuk Anda."} /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {survei.data.map((s) => (
            <Card key={s.id} className="flex flex-col animate-fade-up">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="min-w-0 truncate">{s.title}</CardTitle>
                  <Badge tone={nadaStatus(s.status)} dot className="shrink-0">{labelStatus(s.status)}</Badge>
                </div>
                <CardDescription className="line-clamp-2">{s.description ?? `${s.questions.length} pertanyaan`}</CardDescription>
                <p className="text-xs text-muted">{formatTanggal(s.startDate, "d MMM")} – {formatTanggal(s.endDate, "d MMM yyyy")} · {s.questions.length} pertanyaan{s.isAnonymous ? " · anonim" : ""}{hr ? ` · ${s.participationCount} respons` : ""}</p>
              </CardHeader>
              <CardContent className="mt-auto flex flex-wrap gap-2">
                {s.hasSubmitted ? (
                  <span className="inline-flex items-center gap-1 text-sm text-success"><CheckCircle2 className="h-4 w-4" aria-hidden /> Sudah diisi</span>
                ) : aktif(s) ? (
                  <Button size="sm" onClick={() => { setIsi(s); setJawaban({}); setGalat({}); }}><ClipboardList className="h-4 w-4" aria-hidden /> Isi Survei</Button>
                ) : null}
                {hr && (
                  <>
                    {s.status === "draft" && <Button size="sm" variant="outline" onClick={() => ubahStatus.mutate({ s, status: "published" })}><Megaphone className="h-4 w-4" aria-hidden /> Tayangkan</Button>}
                    {s.status === "published" && <Button size="sm" variant="outline" onClick={() => ubahStatus.mutate({ s, status: "closed" })}><X className="h-4 w-4" aria-hidden /> Tutup</Button>}
                    {s.participationCount > 0 && <Button size="sm" variant="ghost" onClick={() => setHasil(s)}><BarChart3 className="h-4 w-4" aria-hidden /> Hasil</Button>}
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Modal open={Boolean(isi)} onClose={() => setIsi(null)} size="lg" title={isi?.title ?? ""} description={isi?.description ?? undefined}
        footer={<><Button variant="outline" onClick={() => setIsi(null)}><Clock className="h-4 w-4" aria-hidden /> Nanti</Button><Button onClick={() => kirim.mutate()} loading={kirim.isPending}>{!kirim.isPending && <Send className="h-4 w-4" aria-hidden />} Kirim Jawaban</Button></>}>
        {isi && (
          <div className="space-y-5">
            {isi.isAnonymous && <Alert tone="info" title="Survei anonim">Jawaban tidak dikaitkan dengan nama Anda; yang tercatat hanya bahwa Anda sudah berpartisipasi.</Alert>}
            {isi.questions.map((q) => <IsiPertanyaan key={q.id} q={q} nilai={jawaban[q.id] ?? ""} onUbah={(v) => { setJawaban((j) => ({ ...j, [q.id]: v })); setGalat((g) => { const { [q.id]: _, ...sisa } = g; void _; return sisa; }); }} galat={galat[q.id]} />)}
          </div>
        )}
      </Modal>

      <Modal open={buatBuka} onClose={() => setBuatBuka(false)} size="lg" title="Survei Baru"
        footer={<><Button variant="outline" onClick={() => setBuatBuka(false)}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button form="form-survei" type="submit" loading={buat.isPending}>{!buat.isPending && <Plus className="h-4 w-4" aria-hidden />} Buat</Button></>}>
        <form id="form-survei" onSubmit={f.handleSubmit((v) => buat.mutate(v))} className="space-y-5" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Judul" error={f.formState.errors.title?.message} className="sm:col-span-2"><Input {...f.register("title", { required: "Wajib diisi" })} placeholder="Kepuasan Karyawan Q4 2026" /></Field>
            <Field label="Deskripsi" className="sm:col-span-2"><Textarea rows={2} {...f.register("description")} /></Field>
            <Field label="Mulai" error={f.formState.errors.startDate?.message}><Input type="date" {...f.register("startDate", { required: "Wajib diisi" })} /></Field>
            <Field label="Selesai" error={f.formState.errors.endDate?.message}><Input type="date" {...f.register("endDate", { required: "Wajib diisi", validate: (v, x) => v > x.startDate || "Harus setelah tanggal mulai" })} /></Field>
            <Field label="Sasaran"><Select {...f.register("targetDepartmentId")}><option value="">Semua karyawan</option>{(departemen.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" {...f.register("isAnonymous")} className="h-4 w-4 accent-[var(--primary)]" /> Anonim (jawaban tidak dikaitkan dengan nama)</label>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between"><p className="text-sm font-medium">Pertanyaan ({daftar.fields.length})</p><Button size="sm" variant="outline" type="button" onClick={() => daftar.append({ code: `Q${daftar.fields.length + 1}`, text: "", type: "scale", options: "", minScale: "1", maxScale: "5", isRequired: true })}><Plus className="h-4 w-4" aria-hidden /> Pertanyaan</Button></div>
            {daftar.fields.map((p, i) => {
              const jenis = pertanyaanDiawasi?.[i]?.type;
              return (
                <div key={p.id} className="space-y-3 rounded-xl border border-border p-3">
                  <div className="grid gap-3 sm:grid-cols-[6rem_1fr_8rem_auto] sm:items-end">
                    <Field label="Kode"><Input className="font-mono uppercase" {...f.register(`questions.${i}.code`, { required: true })} /></Field>
                    <Field label="Pertanyaan" error={f.formState.errors.questions?.[i]?.text?.message}><Input {...f.register(`questions.${i}.text`, { required: "Wajib diisi" })} placeholder="Seberapa puas Anda dengan jadwal shift?" /></Field>
                    <Field label="Jenis"><Select {...f.register(`questions.${i}.type`)}><option value="scale">Skala</option><option value="choice">Pilihan</option><option value="text">Teks bebas</option></Select></Field>
                    <Button type="button" size="icon" variant="ghost" className="text-danger" onClick={() => daftar.remove(i)} aria-label="Hapus pertanyaan" disabled={daftar.fields.length <= 1}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                  </div>
                  {jenis === "scale" && <div className="grid grid-cols-2 gap-3 sm:w-64"><Field label="Skala dari"><Input type="number" min={0} max={10} {...f.register(`questions.${i}.minScale`)} /></Field><Field label="sampai"><Input type="number" min={1} max={10} {...f.register(`questions.${i}.maxScale`)} /></Field></div>}
                  {jenis === "choice" && <Field label="Pilihan (satu per baris, minimal 2)"><Textarea rows={3} {...f.register(`questions.${i}.options`)} placeholder={"Sangat puas\nCukup\nKurang"} /></Field>}
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...f.register(`questions.${i}.isRequired`)} className="h-4 w-4 accent-[var(--primary)]" /> Wajib dijawab</label>
                </div>
              );
            })}
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(hasil)} onClose={() => setHasil(null)} size="lg" title={`Hasil: ${hasil?.title ?? ""}`} footer={<Button onClick={() => setHasil(null)}><X className="h-4 w-4" aria-hidden /> Tutup</Button>}>
        {hasilSurvei.isLoading || !hasilSurvei.data ? <SkeletonBaris /> : (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl bg-surface-2 p-3"><p className="text-2xl font-semibold tabular-nums">{hasilSurvei.data.responseCount}</p><p className="text-xs text-muted">respons</p></div>
              <div className="rounded-xl bg-surface-2 p-3"><p className="text-2xl font-semibold tabular-nums">{hasilSurvei.data.targetCount}</p><p className="text-xs text-muted">sasaran</p></div>
              <div className="rounded-xl bg-surface-2 p-3"><p className="text-2xl font-semibold tabular-nums">{hasilSurvei.data.responseRate}%</p><p className="text-xs text-muted">tingkat respons</p></div>
            </div>
            {hasilSurvei.data.questions.filter((q) => q.type !== "text").map((q) => (
              <section key={q.questionId}>
                <h3 className="text-sm font-medium">{q.text}</h3>
                <p className="mb-2 text-xs text-muted">{q.responseCount} jawaban{q.average !== null ? ` · rata-rata ${q.average}` : ""}</p>
                <GrafikBatang data={Object.entries(q.distribution).sort(([a], [b]) => (isNaN(+a) ? a.localeCompare(b) : +a - +b)).map(([label, nilai]) => ({ label, nilai }))} tinggi={180} />
              </section>
            ))}
            {hasilSurvei.data.textAnswers.map((t) => (
              <section key={t.questionId}>
                <h3 className="text-sm font-medium">{t.text}</h3>
                {t.answers.length === 0 ? <p className="text-xs text-muted">Belum ada jawaban.</p> : (
                  <ul className="mt-2 space-y-1.5">{t.answers.map((a, i) => <li key={i} className="rounded-lg bg-surface-2 px-3 py-2 text-sm whitespace-pre-wrap">{a}</li>)}</ul>
                )}
              </section>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
};
