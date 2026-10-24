"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { kandidatBisaDites } from "@/lib/lingkup-cbt";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { DialogTugaskan } from "@/components/cbt/tugaskan";
import type { Kandidat, PaketCbt } from "@/lib/types";

export const TugaskanTesPelamar = ({ candidate, onClose }: { candidate: Kandidat; onClose: () => void }) => {
  const [paketId, setPaketId] = React.useState("");
  const [pilihan, setPilihan] = React.useState<PaketCbt | null>(null);
  const paket = useQuery({
    queryKey: ["cbt", "paket", "recruitment"],
    queryFn: async () => (await api.get<{ data: PaketCbt[] }>("/cbt/tes?scope=recruitment")).data.data,
  });
  const tersedia = (paket.data ?? []).filter((p) => p.status === "published" && p.audience !== "karyawan");
  if (pilihan) return <DialogTugaskan scope="recruitment" paket={pilihan} candidate={candidate} onClose={onClose} />;
  return <Modal open onClose={onClose} title="Tugaskan Tes Seleksi" description={`${candidate.name} · ${candidate.email}`}
    footer={<><Button variant="outline" onClick={onClose}>Batal</Button><Button disabled={!paketId || !kandidatBisaDites(candidate.status)} onClick={() => setPilihan(tersedia.find((p) => p.id === paketId) ?? null)}>Lanjut</Button></>}>
    {paket.isLoading ? <SkeletonBaris jumlah={2} /> : paket.isError ? <Alert tone="danger" title="Paket belum dapat dimuat">Coba tutup dan buka kembali.</Alert> : tersedia.length === 0 ?
      <Alert tone="info" title="Belum ada paket tayang"><Link href="/rekrutmen/tes" className="underline">Buka Tes Seleksi</Link> untuk membuat dan menayangkan paket.</Alert> :
      <Field label="Paket tes" hint="Pelamar sudah dipilih. Berikutnya tentukan batas waktu dan apakah tes wajib."><Select value={paketId} onChange={(e) => setPaketId(e.target.value)}><option value="">— Pilih paket —</option>{tersedia.map((p) => <option key={p.id} value={p.id}>{p.title} · {p.durationMinutes} menit{p.audience === "keduanya" ? " · paket bersama (lama)" : ""}</option>)}</Select></Field>}
  </Modal>;
};
