"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { RuangUjianCbt, SelesaiUjian, type ApiUjian } from "@/components/cbt/ruang-ujian";
import type { HasilKirimCbt, RuangUjian } from "@/lib/types";

/** Layar pengerjaan untuk karyawan; pelamar memakai /tes/[token]. */
export default function HalamanKerjakanCbt() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [selesai, setSelesai] = React.useState<HasilKirimCbt | null>(null);

  // Dimulai sekali lewat POST: server yang menentukan batas waktunya, dan
  // memanggilnya lagi hanya melanjutkan pengerjaan yang sama.
  const ruang = useQuery({
    queryKey: ["cbt", "kerjakan", id],
    queryFn: async () => (await api.post<RuangUjian>(`/cbt/saya/${id}/mulai`)).data,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const alat: ApiUjian = React.useMemo(
    () => ({
      simpan: async (jawaban) => (await api.put<{ dikirimOtomatis?: boolean }>(`/cbt/saya/${id}/jawaban`, { jawaban })).data,
      kirim: async () => (await api.post<HasilKirimCbt>(`/cbt/saya/${id}/kirim`)).data,
      kejadian: async (type, detail) => {
        await api.post(`/cbt/saya/${id}/kejadian`, { type, ...(detail ? { detail } : {}) });
      },
      foto: async (dataUrl) => {
        await api.post(`/cbt/saya/${id}/foto`, { image: dataUrl });
      },
      gambarSoal: (questionId) => `/api/backend/cbt/soal/${questionId}/gambar`,
    }),
    [id]
  );

  const kembali = (
    <Link href="/cbt">
      <Button variant="outline"><ArrowLeft className="h-4 w-4" aria-hidden /> Kembali ke daftar tes</Button>
    </Link>
  );

  if (selesai) return <SelesaiUjian hasil={selesai} kembali={kembali} />;

  if (ruang.isLoading) return <Skeleton className="h-96" />;
  if (ruang.isError || !ruang.data) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Card className="space-y-4 p-6">
          <Alert tone="danger" title="Tes tidak bisa dibuka">{(ruang.error as Error)?.message ?? "Coba lagi nanti."}</Alert>
          {kembali}
        </Card>
      </div>
    );
  }

  return (
    <RuangUjianCbt
      ruang={ruang.data}
      api={alat}
      onSelesai={(hasil) => {
        // Daftar "Tes Saya" ikut berubah statusnya; disegarkan di sini, bukan
        // saat render layar selesai.
        qc.invalidateQueries({ queryKey: ["cbt", "saya"] });
        setSelesai(hasil);
      }}
    />
  );
}
