"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Eye, Link2, Users, X } from "lucide-react";
import { api, ambilSemua } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { Button } from "@/components/ui/button";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTanggal, LABEL_STATUS_TES } from "@/lib/utils";
import { DaftarTautan } from "./tugaskan";
import type { PaketCbt, PenugasanCbt } from "@/lib/types";

/**
 * Peserta satu paket: memantau statusnya, membatalkan yang belum dimulai,
 * dan membuat ulang tautan pelamar yang hilang (tautan hanya tampil sekali
 * saat ditugaskan). Ada di sini, bukan hanya di tab Hasil, supaya pemegang
 * cbt.ubah tanpa akses hasil tetap bisa membereskan penugasannya.
 */
export const DialogPesertaPaket = ({ paket, onClose }: { paket: PaketCbt; onClose: () => void }) => {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const bolehBatal = punyaIzin(saya, "cbt.ubah");
  const bolehTautan = punyaIzin(saya, "cbt.buat", "cbt.ubah");
  const bolehHasil = punyaIzin(saya, "cbt_hasil.lihat");
  const [batal, setBatal] = React.useState<PenugasanCbt | null>(null);
  const [tautan, setTautan] = React.useState<{ assignmentId: string; nama: string; token: string } | null>(null);

  const daftar = useQuery({
    queryKey: ["cbt", "penugasan", paket.id],
    queryFn: async () => ambilSemua<PenugasanCbt>("/cbt/penugasan", { testId: paket.id }),
  });

  const nama = (a: PenugasanCbt) => a.employee?.name ?? a.candidate?.name ?? "Peserta";

  const batalkan = useMutation({
    mutationFn: async (a: PenugasanCbt) => api.delete(`/cbt/penugasan/${a.id}`),
    onSuccess: (_, a) => {
      qc.invalidateQueries({ queryKey: ["cbt"] });
      notifikasi.sukses("Penugasan dibatalkan", nama(a));
      setBatal(null);
    },
    onError: (e) => { notifikasi.galat(e, "Gagal membatalkan"); setBatal(null); },
  });

  const buatTautan = useMutation({
    mutationFn: async (a: PenugasanCbt) => (await api.post<{ assignmentId: string; token: string }>(`/cbt/penugasan/${a.id}/tautan`)).data,
    onSuccess: (d, a) => setTautan({ assignmentId: d.assignmentId, nama: nama(a), token: d.token }),
    onError: (e) => notifikasi.galat(e, "Tautan baru gagal dibuat"),
  });

  return (
    <>
      <Modal
        open={!tautan}
        onClose={onClose}
        size="lg"
        title={`Peserta: ${paket.title}`}
        description="Yang belum dimulai bisa dibatalkan; pelamar yang kehilangan tautannya bisa diberi tautan baru."
        footer={<Button variant="outline" onClick={onClose}><X className="h-4 w-4" aria-hidden /> Tutup</Button>}
      >
        {daftar.isLoading ? (
          <SkeletonBaris jumlah={4} />
        ) : !daftar.data?.length ? (
          <EmptyState icon={Users} title="Belum ada peserta" description="Tugaskan paket ini lewat tombol Tugaskan." />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {daftar.data.map((a) => {
              const selesai = a.status === "submitted" || a.status === "graded";
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{nama(a)} <span className="text-xs font-normal text-muted">{a.employee ? `Karyawan · ${a.employee.nik}` : "Pelamar"}</span></p>
                    <p className="text-xs text-muted">
                      {a.attempt?.submittedAt
                        ? `Dikirim ${formatTanggal(a.attempt.submittedAt, "d MMM yyyy HH:mm")}`
                        : a.availableUntil
                          ? `Batas ${formatTanggal(a.availableUntil, "d MMM yyyy HH:mm")}`
                          : `Ditugaskan ${formatTanggal(a.createdAt, "d MMM yyyy")}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={nadaStatus(a.status)} dot>{LABEL_STATUS_TES[a.status] ?? a.status}</Badge>
                    {selesai && a.attempt && bolehHasil && (
                      <Link href={`/cbt/hasil/${a.attempt.id}`}><Button size="sm" variant="ghost"><Eye className="h-4 w-4" aria-hidden /> Hasil</Button></Link>
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
                </li>
              );
            })}
          </ul>
        )}
      </Modal>

      <Modal
        open={Boolean(tautan)}
        onClose={() => setTautan(null)}
        title="Tautan ujian baru"
        description="Tautan lama sudah tidak berlaku."
        footer={<Button onClick={() => setTautan(null)}><Check className="h-4 w-4" aria-hidden /> Selesai</Button>}
      >
        {tautan && <DaftarTautan tautan={[tautan]} />}
      </Modal>

      <ConfirmDialog
        open={Boolean(batal)}
        onClose={() => setBatal(null)}
        onConfirm={() => batal && batalkan.mutate(batal)}
        loading={batalkan.isPending}
        danger
        title="Batalkan penugasan ini?"
        description={batal ? `${paket.title} untuk ${nama(batal)} dihapus dari daftar tesnya${batal.candidate ? ", dan tautannya tidak berlaku lagi" : ""}. Penugasan yang belum dimulai tidak meninggalkan hasil apa pun.` : ""}
        confirmLabel="Batalkan penugasan"
        confirmIcon={Ban}
      />
    </>
  );
};
