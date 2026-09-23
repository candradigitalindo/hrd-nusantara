"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Camera, Check, Clock, Save, X } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Field } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import { cn, formatTanggal } from "@/lib/utils";
import { LABEL_TIPE_SOAL } from "@/components/cbt/bank-soal";
import type { HasilCbtRinci } from "@/lib/types";

const LABEL_KEJADIAN: Record<string, string> = {
  keluar_layar: "Meninggalkan layar ujian",
  kembali: "Kembali ke layar ujian",
  salin: "Menyalin teks",
  tempel: "Menempel teks",
  layar_penuh_keluar: "Keluar dari layar penuh",
  kamera_mati: "Kamera tidak aktif",
};

/** Rincian satu pengerjaan: jawaban, penilaian esai, dan bukti pengawasan. */
export default function HalamanHasilCbt() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const bolehNilai = punyaIzin(saya, "cbt_hasil.ubah");

  // Nilai yang sedang diketik menimpa nilai tersimpan; selama belum disentuh,
  // yang tampil adalah nilai dari server.
  const [nilaiBaru, setNilaiBaru] = React.useState<Record<string, { points: string; note: string }> | null>(null);
  const [foto, setFoto] = React.useState<string | null>(null);

  const hasil = useQuery({
    queryKey: ["cbt", "hasil", id],
    queryFn: async () => (await api.get<HasilCbtRinci>(`/cbt/hasil/${id}`)).data,
  });

  const nilaiTersimpan: Record<string, { points: string; note: string }> = Object.fromEntries(
    (hasil.data?.butir ?? [])
      .filter((b) => !b.otomatis)
      .map((b) => [b.questionId, { points: b.points === null ? "" : String(b.points), note: b.graderNote ?? "" }])
  );
  const nilai = nilaiBaru ?? nilaiTersimpan;
  const setNilai = (ubah: (n: typeof nilai) => typeof nilai) => setNilaiBaru(ubah(nilai));

  const simpanNilai = useMutation({
    mutationFn: async () => {
      const scores = Object.entries(nilai)
        .filter(([, v]) => v.points !== "")
        .map(([questionId, v]) => ({ questionId, points: Number(v.points), graderNote: v.note || null }));
      return (await api.put(`/cbt/hasil/${id}/nilai`, { scores })).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cbt"] });
      setNilaiBaru(null);
      notifikasi.sukses("Penilaian tersimpan", "Nilai akhir dihitung ulang");
    },
    onError: (e) => notifikasi.galat(e, "Gagal menyimpan penilaian"),
  });

  if (hasil.isLoading) return <Skeleton className="h-96" />;
  if (!hasil.data) return <Alert tone="danger" title="Hasil tidak ditemukan">Periksa kembali tautannya.</Alert>;

  const { attempt, butir, perKategori } = hasil.data;
  const peserta = attempt.assignment.employee?.name ?? attempt.assignment.candidate?.name ?? "Peserta";
  const esai = butir.filter((b) => !b.otomatis);
  const belumDinilai = esai.filter((b) => b.points === null).length;

  return (
    <>
      <Link href="/cbt" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Kembali ke Tes CBT
      </Link>

      <PageHeader
        title={`${attempt.assignment.test.title} — ${peserta}`}
        description={`Dikirim ${formatTanggal(attempt.submittedAt, "d MMM yyyy HH:mm")}${attempt.autoSubmitted ? " (otomatis karena waktu habis)" : ""}`}
        actions={
          attempt.percent !== null ? (
            <div className="text-right">
              <p className="text-2xl font-bold tabular-nums">{attempt.percent}%</p>
              <p className="text-xs text-muted">{attempt.scoreTotal} dari {attempt.maxScore} poin</p>
            </div>
          ) : (
            <Badge tone="warning" dot>Menunggu penilaian</Badge>
          )
        }
      />

      {attempt.passed !== null && (
        <Alert tone={attempt.passed ? "success" : "danger"} title={attempt.passed ? "Lulus" : "Belum lulus"}>
          Ambang lulus paket ini {attempt.assignment.test.passingScore}%.
          {attempt.gradedBy && ` Dinilai ${attempt.gradedBy.name}.`}
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <p className="text-sm font-medium">Nilai per kategori</p>
          <ul className="mt-3 space-y-2">
            {perKategori.map((k) => (
              <li key={k.kategori}>
                <div className="flex items-baseline justify-between text-sm">
                  <span>{k.kategori}</span>
                  <span className="tabular-nums text-muted">{k.diperoleh}/{k.maksimal} · {k.persen}%</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, k.persen)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="space-y-3 p-4">
          <p className="text-sm font-medium">Pengawasan</p>
          <p className="flex items-center gap-2 text-sm text-muted">
            <Clock className="h-4 w-4" aria-hidden /> Mulai {formatTanggal(attempt.startedAt, "HH:mm")} · batas {formatTanggal(attempt.deadlineAt, "HH:mm")}
          </p>
          {attempt.events.length === 0 ? (
            <p className="text-sm text-muted">Tidak ada kejadian tercatat.</p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
              {attempt.events.map((e) => (
                <li key={e.id} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
                  <span>
                    {LABEL_KEJADIAN[e.type] ?? e.type} <span className="text-xs text-muted">{formatTanggal(e.at, "HH:mm:ss")}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {attempt.photos.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><Camera className="h-4 w-4" aria-hidden /> Foto ({attempt.photos.length})</p>
              <div className="grid grid-cols-4 gap-1.5">
                {attempt.photos.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setFoto(p.id)}
                    className="overflow-hidden rounded-lg border border-border"
                    title={`Foto ${formatTanggal(p.takenAt, "HH:mm:ss")}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/backend/cbt/hasil/${attempt.id}/foto/${p.id}`} alt={`Foto pengawasan ${formatTanggal(p.takenAt, "HH:mm:ss")}`} className="aspect-square w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {bolehNilai && esai.length > 0 && (
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">Penilaian esai</p>
              <p className="text-xs text-muted">{belumDinilai > 0 ? `${belumDinilai} jawaban belum dinilai` : "Semua jawaban esai sudah dinilai"}</p>
            </div>
            <Button onClick={() => simpanNilai.mutate()} loading={simpanNilai.isPending}>
              {!simpanNilai.isPending && <Save className="h-4 w-4" aria-hidden />} Simpan penilaian
            </Button>
          </div>

          {esai.map((b) => (
            <div key={b.questionId} className="space-y-2 rounded-xl border border-border p-4">
              <p className="text-sm font-medium">{b.text}</p>
              {b.rubric && <p className="text-xs text-muted">Rubrik: {b.rubric}</p>}
              <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm">{b.answerText || <span className="text-muted">Tidak dijawab</span>}</p>
              <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                <Field label={`Nilai (maks ${b.maxPoints})`}>
                  <Input
                    type="number"
                    min="0"
                    max={b.maxPoints}
                    step="0.5"
                    value={nilai[b.questionId]?.points ?? ""}
                    onChange={(e) => setNilai((n) => ({ ...n, [b.questionId]: { points: e.target.value, note: n[b.questionId]?.note ?? "" } }))}
                  />
                </Field>
                <Field label="Catatan penguji (opsional)">
                  <Input
                    value={nilai[b.questionId]?.note ?? ""}
                    onChange={(e) => setNilai((n) => ({ ...n, [b.questionId]: { points: n[b.questionId]?.points ?? "", note: e.target.value } }))}
                  />
                </Field>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Card className="p-5">
        <p className="mb-3 font-medium">Semua jawaban</p>
        <ol className="space-y-3">
          {butir.map((b, i) => (
            <li key={b.questionId} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs text-muted">{i + 1}. {b.category} · {LABEL_TIPE_SOAL[b.type]} · maks {b.maxPoints} poin</p>
                {b.points !== null ? (
                  <Badge tone={b.otomatis ? (b.isCorrect ? "success" : "danger") : "neutral"}>
                    {b.otomatis ? (b.isCorrect ? "Benar" : "Salah") : "Dinilai"} · {b.points} poin
                  </Badge>
                ) : (
                  <Badge tone="warning">Belum dinilai</Badge>
                )}
              </div>
              <p className="mt-1 text-sm">{b.text}</p>

              {b.options.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {b.options.map((o) => {
                    const dipilih = b.chosen.includes(o.kode);
                    const kunci = b.answerKey.includes(o.kode);
                    return (
                      <li
                        key={o.kode}
                        className={cn(
                          "flex items-center gap-2 rounded-lg px-2 py-1 text-sm",
                          kunci && "bg-success-soft text-success",
                          dipilih && !kunci && "bg-danger-soft text-danger"
                        )}
                      >
                        {dipilih ? <Check className="h-3.5 w-3.5" aria-hidden /> : <span className="w-3.5" />}
                        <span className="uppercase">{o.kode}.</span> {o.teks}
                        {kunci && <span className="ml-auto text-xs">kunci</span>}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm">
                  {b.answerText || <span className="text-muted">Tidak dijawab</span>}
                </p>
              )}

              {b.graderNote && <p className="mt-2 text-xs text-muted">Catatan penguji: {b.graderNote}</p>}
              {b.explanation && <p className="mt-2 text-xs text-muted">Pembahasan: {b.explanation}</p>}
            </li>
          ))}
        </ol>
      </Card>

      <Modal open={Boolean(foto)} onClose={() => setFoto(null)} title="Foto pengawasan" footer={<Button variant="outline" onClick={() => setFoto(null)}><X className="h-4 w-4" aria-hidden /> Tutup</Button>}>
        {foto && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/backend/cbt/hasil/${attempt.id}/foto/${foto}`} alt="Foto pengawasan ujian" className="w-full rounded-xl" />
        )}
      </Modal>
    </>
  );
}
