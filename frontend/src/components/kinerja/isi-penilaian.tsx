"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, CheckCheck, Send, X } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Field } from "@/components/ui/input";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { formatTanggal, labelStatus, LABEL_PENILAI, cn } from "@/lib/utils";
import type { Penilaian, KriteriaKinerja, PenggunaSesi } from "@/lib/types";

/**
 * Satu penilaian: diisi oleh penilai (skor per kriteria + umpan balik),
 * dibaca dan diakui oleh yang dinilai, didiskusikan keduanya.
 */
type Props = { review: Penilaian | null; kriteria: KriteriaKinerja[]; memuat: boolean; saya: PenggunaSesi | undefined; onClose: () => void };

/** Pembungkus: `key` per penilaian membuat state form mulai ulang tiap ganti penilaian tanpa effect. */
export const IsiPenilaian = ({ review, ...sisa }: Props) => (review ? <FormPenilaian key={`${review.id}:${sisa.memuat ? "memuat" : "siap"}`} review={review} {...sisa} /> : null);

const FormPenilaian = ({ review, kriteria, memuat, saya, onClose }: Props & { review: Penilaian }) => {
  const qc = useQueryClient();
  const [skor, setSkor] = React.useState<Record<string, number>>(() => Object.fromEntries(review.scores.map((s) => [s.criterionId, s.score])));
  const [komentar, setKomentar] = React.useState<Record<string, string>>(() => Object.fromEntries(review.scores.map((s) => [s.criterionId, s.comment ?? ""])));
  const [umpan, setUmpan] = React.useState(review.feedback ?? "");
  const [catatan, setCatatan] = React.useState("");

  const sayaPenilai = review.reviewerId === saya?.id;
  const sayaDinilai = review.revieweeId === saya?.id;
  const bisaIsi = sayaPenilai && review.status === "draft";
  const segarkan = () => qc.invalidateQueries({ queryKey: ["penilaian"] });

  const kirim = useMutation({
    mutationFn: async () => {
      const kurang = kriteria.filter((k) => skor[k.id] === undefined);
      if (kurang.length) throw new Error(`Masih ada ${kurang.length} kriteria belum dinilai`);
      return (await api.post<Penilaian>(`/performance/reviews/${review.id}/submit`, { scores: kriteria.map((k) => ({ criterionId: k.id, score: skor[k.id], ...(komentar[k.id] ? { comment: komentar[k.id] } : {}) })), ...(umpan ? { feedback: umpan } : {}) })).data;
    },
    onSuccess: (r) => { segarkan(); notifikasi.sukses("Penilaian terkirim", `Skor akhir ${r.totalScore} · ${r.reviewee.name} kini bisa membacanya.`); onClose(); },
    onError: (e) => notifikasi.galat(e, "Penilaian belum terkirim"),
  });
  const akui = useMutation({
    mutationFn: async () => (await api.post<Penilaian>(`/performance/reviews/${review.id}/acknowledge`, {})).data,
    onSuccess: () => { segarkan(); notifikasi.sukses("Penilaian diakui", "Tercatat bahwa Anda sudah membaca hasilnya."); onClose(); },
    onError: (e) => notifikasi.galat(e),
  });
  const diskusi = useMutation({
    mutationFn: async () => (await api.post<{ id: string; note: string }>(`/performance/reviews/${review.id}/discussions`, { note: catatan })).data,
    onSuccess: () => { segarkan(); notifikasi.sukses("Catatan diskusi ditambahkan"); setCatatan(""); onClose(); },
    onError: (e) => notifikasi.galat(e),
  });

  return (
    <Modal open onClose={onClose} size="lg" title={`Penilaian ${review.reviewee.name}`} description={`${LABEL_PENILAI[review.reviewerType]}: ${review.reviewer.name} · ${labelStatus(review.status)}`}
      footer={<>
        <Button variant="outline" onClick={onClose}><X className="h-4 w-4" aria-hidden /> Tutup</Button>
        {bisaIsi && <Button onClick={() => kirim.mutate()} loading={kirim.isPending}>{!kirim.isPending && <Send className="h-4 w-4" aria-hidden />} Kirim Penilaian</Button>}
        {sayaDinilai && review.status === "submitted" && <Button onClick={() => akui.mutate()} loading={akui.isPending}>{!akui.isPending && <CheckCheck className="h-4 w-4" aria-hidden />} Saya Sudah Membaca</Button>}
      </>}>
      <div className="space-y-5 text-sm">
        {review.totalScore !== null && (
          <div className="rounded-xl bg-primary-soft p-4 text-center"><p className="text-xs uppercase tracking-wide text-primary">Skor akhir</p><p className="text-3xl font-semibold tabular-nums text-primary">{review.totalScore}</p><p className="text-xs text-muted">dari 100, berbobot{review.rating !== null ? ` · rating ${review.rating}` : ""}</p></div>
        )}
        {bisaIsi && <Alert tone="info" title="Nilai tiap kriteria pada skalanya">Skor akhir dihitung berbobot oleh sistem. Komentar per kriteria membantu karyawan tahu apa yang harus diperbaiki.</Alert>}
        {memuat && <SkeletonBaris />}
        <div className="space-y-3">
          {kriteria.map((k) => {
            const nilai = skor[k.id];
            return (
              <fieldset key={k.id} className="rounded-xl border border-border p-3">
                <legend className="px-1 text-sm font-medium">{k.name} <span className="text-xs font-normal text-muted">· bobot {k.weight}%{k.category ? ` · ${k.category}` : ""}</span></legend>
                {k.description && <p className="mb-2 text-xs text-muted">{k.description}</p>}
                {k.maxScore <= 10 ? (
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={k.name}>
                    {Array.from({ length: k.maxScore }, (_, i) => i + 1).map((v) => (
                      <button key={v} type="button" role="radio" aria-checked={nilai === v} disabled={!bisaIsi} onClick={() => setSkor((s) => ({ ...s, [k.id]: v }))}
                        className={cn("h-9 min-w-9 rounded-lg border px-2.5 text-sm font-medium transition-colors disabled:cursor-default", nilai === v ? "border-primary bg-primary text-on-primary" : "border-border bg-surface", bisaIsi && nilai !== v && "hover:bg-surface-2")}>{v}</button>
                    ))}
                  </div>
                ) : (
                  <Input type="number" min={0} max={k.maxScore} className="w-28" aria-label={k.name} disabled={!bisaIsi} value={nilai ?? ""} onChange={(e) => setSkor((s) => ({ ...s, [k.id]: Math.min(k.maxScore, Math.max(0, Number(e.target.value))) }))} />
                )}
                {bisaIsi ? <Textarea rows={2} className="mt-2" placeholder="Komentar (opsional)" value={komentar[k.id] ?? ""} onChange={(e) => setKomentar((c) => ({ ...c, [k.id]: e.target.value }))} /> : komentar[k.id] ? <p className="mt-2 text-xs text-muted">{komentar[k.id]}</p> : null}
              </fieldset>
            );
          })}
        </div>
        <Field label="Umpan balik keseluruhan">{bisaIsi ? <Textarea rows={3} value={umpan} onChange={(e) => setUmpan(e.target.value)} /> : <p className="whitespace-pre-wrap text-muted">{review.feedback ?? "—"}</p>}</Field>
        {(review.status !== "draft") && (
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><MessageSquare className="h-3.5 w-3.5" aria-hidden /> Catatan diskusi</h3>
            {review.discussions.length === 0 ? <p className="text-xs text-muted">Belum ada catatan.</p> : (
              <ul className="space-y-2">{review.discussions.map((d) => <li key={d.id} className="rounded-lg bg-surface-2 px-3 py-2"><p className="whitespace-pre-wrap">{d.note}</p><p className="mt-1 text-xs text-muted">{d.authorId === review.reviewerId ? review.reviewer.name : d.authorId === review.revieweeId ? review.reviewee.name : "HR"} · {formatTanggal(d.createdAt, "d MMM yyyy HH:mm")}</p></li>)}</ul>
            )}
            {(sayaPenilai || sayaDinilai) && (
              <div className="mt-2 flex gap-2"><Textarea rows={2} placeholder="Tambahkan catatan dari sesi evaluasi…" value={catatan} onChange={(e) => setCatatan(e.target.value)} /><Button variant="outline" onClick={() => diskusi.mutate()} loading={diskusi.isPending} disabled={!catatan.trim()}>{!diskusi.isPending && <Send className="h-4 w-4" aria-hidden />} Kirim</Button></div>
            )}
          </section>
        )}
        <div className="flex flex-wrap gap-2"><Badge tone={nadaStatus(review.status)} dot>{labelStatus(review.status)}</Badge>{review.submittedAt && <span className="text-xs text-muted">dikirim {formatTanggal(review.submittedAt, "d MMM yyyy HH:mm")}</span>}</div>
      </div>
    </Modal>
  );
};
