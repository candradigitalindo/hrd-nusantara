"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, Camera, Check, ClipboardCheck, Eye, Link2 } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { ResponsiveTable, type Kolom } from "@/components/ui/responsive-table";
import { Pagination } from "@/components/ui/pagination";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTanggal, LABEL_STATUS_TES } from "@/lib/utils";
import { DaftarTautan } from "./tugaskan";
import type { Halaman, PaketCbt, PenugasanCbt } from "@/lib/types";

/** Status yang belum menghasilkan jawaban: dipantau di sini, dibatalkan atau diberi tautan baru. */
const BELUM_SELESAI = new Set(["assigned", "in_progress", "expired"]);

/** Hasil semua peserta, pintu masuk ke penilaian esai dan bukti pengawasan, serta pemantauan penugasan. */
export const HasilTes = () => {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const bolehBatal = punyaIzin(saya, "cbt.ubah");
  const bolehTautan = punyaIzin(saya, "cbt.buat", "cbt.ubah");
  const [page, setPage] = React.useState(1);
  const [testId, setTestId] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [batal, setBatal] = React.useState<PenugasanCbt | null>(null);
  const [tautan, setTautan] = React.useState<{ assignmentId: string; nama: string; token: string } | null>(null);

  const paket = useQuery({
    queryKey: ["cbt", "paket"],
    queryFn: async () => (await api.get<{ data: PaketCbt[] }>("/cbt/tes")).data.data,
  });

  const params = new URLSearchParams({ page: String(page), limit: "20" });
  if (testId) params.set("testId", testId);
  if (status) params.set("status", status);

  const hasil = useQuery({
    queryKey: ["cbt", "hasil", params.toString()],
    queryFn: async () => (await api.get<Halaman<PenugasanCbt>>(`/cbt/hasil?${params}`)).data,
    placeholderData: (p) => p,
  });

  const nama = (a: PenugasanCbt) => a.employee?.name ?? a.candidate?.name ?? "Peserta";

  const batalkan = useMutation({
    mutationFn: async (a: PenugasanCbt) => api.delete(`/cbt/penugasan/${a.id}`),
    onSuccess: (_, a) => {
      qc.invalidateQueries({ queryKey: ["cbt"] });
      notifikasi.sukses("Penugasan dibatalkan", `${a.test.title} · ${nama(a)}`);
      setBatal(null);
    },
    onError: (e) => { notifikasi.galat(e, "Gagal membatalkan"); setBatal(null); },
  });

  const buatTautan = useMutation({
    mutationFn: async (a: PenugasanCbt) => (await api.post<{ assignmentId: string; token: string }>(`/cbt/penugasan/${a.id}/tautan`)).data,
    onSuccess: (d, a) => setTautan({ assignmentId: d.assignmentId, nama: nama(a), token: d.token }),
    onError: (e) => notifikasi.galat(e, "Tautan baru gagal dibuat"),
  });

  const kolom: Kolom<PenugasanCbt>[] = [
    {
      key: "peserta",
      header: "Peserta",
      primary: true,
      cell: (a) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{nama(a)}</p>
          <p className="truncate text-xs text-muted">
            {a.employee ? `Karyawan · ${a.employee.nik}` : `Pelamar · ${a.candidate?.email ?? ""}`}
          </p>
        </div>
      ),
    },
    { key: "tes", header: "Paket", cell: (a) => <span>{a.test.title}{a.test.kind === "kepribadian" && <Badge tone="info" className="ml-1.5">Kepribadian</Badge>}</span> },
    {
      key: "nilai",
      header: "Nilai",
      cell: (a) =>
        BELUM_SELESAI.has(a.status) ? (
          <Badge tone={nadaStatus(a.status)} dot>{LABEL_STATUS_TES[a.status] ?? a.status}</Badge>
        ) : a.test.kind === "kepribadian" ? (
          <span className="text-xs text-muted">Profil kepribadian</span>
        ) : a.status === "graded" && a.attempt?.percent !== null && a.attempt ? (
          <span className="font-medium tabular-nums">
            {a.attempt.percent}% <span className="text-xs font-normal text-muted">({a.attempt.scoreTotal}/{a.attempt.maxScore})</span>
          </span>
        ) : (
          <span className="text-xs text-muted">Menunggu penilaian</span>
        ),
    },
    {
      key: "lulus",
      header: "Hasil",
      cell: (a) =>
        // Inventori kepribadian tidak punya kelulusan (hasil lama bisa masih menyimpannya).
        a.test.kind === "kepribadian" || a.attempt?.passed === null || a.attempt?.passed === undefined ? (
          <span className="text-muted">—</span>
        ) : (
          <Badge tone={a.attempt.passed ? "success" : "danger"} dot>{a.attempt.passed ? "Lulus" : "Belum lulus"}</Badge>
        ),
    },
    {
      key: "catatan",
      header: "Catatan",
      cell: (a) => (
        <div className="flex items-center gap-2 text-xs text-muted">
          {a.attempt?.autoSubmitted && (
            <span className="inline-flex items-center gap-1" title="Dikirim otomatis karena waktu habis">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> waktu habis
            </span>
          )}
          {(a.attempt?._count.events ?? 0) > 0 && <span title="Kejadian pengawasan tercatat">{a.attempt?._count.events} kejadian</span>}
          {(a.attempt?._count.photos ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1" title="Foto pengawasan tersimpan">
              <Camera className="h-3.5 w-3.5" aria-hidden /> {a.attempt?._count.photos}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "waktu",
      header: "Waktu",
      cell: (a) =>
        a.attempt?.submittedAt
          ? `Dikirim ${formatTanggal(a.attempt.submittedAt, "d MMM yyyy HH:mm")}`
          : a.availableUntil
            ? `Batas ${formatTanggal(a.availableUntil, "d MMM yyyy HH:mm")}`
            : "—",
    },
    {
      key: "aksi",
      header: "",
      className: "text-right",
      cell: (a) => {
        const selesai = a.status === "submitted" || a.status === "graded";
        return (
          <div className="flex flex-wrap justify-end gap-1.5">
            {selesai && a.attempt && (
              <Link href={`/cbt/hasil/${a.attempt.id}`}>
                <Button size="sm" variant="outline">
                  {a.status === "submitted" ? <ClipboardCheck className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                  {a.status === "submitted" ? "Nilai" : "Lihat"}
                </Button>
              </Link>
            )}
            {bolehTautan && a.candidate && (a.status === "assigned" || a.status === "in_progress") && (
              <Button size="sm" variant="outline" onClick={() => buatTautan.mutate(a)} loading={buatTautan.isPending && buatTautan.variables?.id === a.id}>
                <Link2 className="h-4 w-4" aria-hidden /> Tautan baru
              </Button>
            )}
            {bolehBatal && !a.attempt && (a.status === "assigned" || a.status === "expired") && (
              <Button size="sm" variant="ghost" className="text-danger" onClick={() => setBatal(a)}>
                <Ban className="h-4 w-4" aria-hidden /> Batalkan
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const pantauPenugasan = BELUM_SELESAI.has(status);

  return (
    <Card>
      <div className="grid gap-2 border-b border-border p-3 sm:grid-cols-2">
        <Select value={testId} onChange={(e) => { setTestId(e.target.value); setPage(1); }} aria-label="Saring paket tes">
          <option value="">Semua paket tes</option>
          {(paket.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </Select>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Saring status">
          <option value="">Sudah dikerjakan</option>
          <option value="submitted">Menunggu penilaian</option>
          <option value="graded">Selesai dinilai</option>
          <option value="assigned">Belum dikerjakan</option>
          <option value="in_progress">Sedang dikerjakan</option>
          <option value="expired">Kedaluwarsa</option>
        </Select>
      </div>

      {hasil.isLoading ? (
        <SkeletonBaris />
      ) : !hasil.data?.data.length ? (
        <EmptyState
          icon={ClipboardCheck}
          title={pantauPenugasan ? "Tidak ada penugasan" : "Belum ada hasil"}
          description={pantauPenugasan ? `Tidak ada penugasan berstatus "${LABEL_STATUS_TES[status]?.toLowerCase() ?? status}".` : "Hasil muncul setelah peserta mengirimkan jawabannya."}
        />
      ) : (
        <>
          <ResponsiveTable columns={kolom} rows={hasil.data.data} rowKey={(a) => a.id} />
          <Pagination pagination={hasil.data.pagination} onPage={setPage} />
        </>
      )}

      <ConfirmDialog
        open={Boolean(batal)}
        onClose={() => setBatal(null)}
        onConfirm={() => batal && batalkan.mutate(batal)}
        loading={batalkan.isPending}
        danger
        title="Batalkan penugasan ini?"
        description={batal ? `${batal.test.title} untuk ${nama(batal)} dihapus dari daftar tesnya${batal.candidate ? ", dan tautannya tidak berlaku lagi" : ""}. Penugasan yang belum dimulai tidak meninggalkan hasil apa pun.` : ""}
        confirmLabel="Batalkan penugasan"
        confirmIcon={Ban}
      />

      <Modal
        open={Boolean(tautan)}
        onClose={() => setTautan(null)}
        title="Tautan ujian baru"
        description="Tautan lama sudah tidak berlaku."
        footer={<Button onClick={() => setTautan(null)}><Check className="h-4 w-4" aria-hidden /> Selesai</Button>}
      >
        {tautan && <DaftarTautan tautan={[tautan]} />}
      </Modal>
    </Card>
  );
};
