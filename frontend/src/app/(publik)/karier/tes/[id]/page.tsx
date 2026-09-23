"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { RuangUjianCbt, SelesaiUjian, type ApiUjian } from "@/components/cbt/ruang-ujian";
import type { HasilKirimCbt, RuangUjian } from "@/lib/types";

/** Ujian CBT yang dikerjakan pelamar dari dalam portal karier. */
export default function HalamanTesPelamar() {
  const { id } = useParams<{ id: string }>();
  const [selesai, setSelesai] = React.useState<HasilKirimCbt | null>(null);

  const ruang = useQuery({
    queryKey: ["pelamar", "tes", id],
    queryFn: async () => (await api.post<RuangUjian>(`/karier/tes/${id}/mulai`)).data,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const alat: ApiUjian = React.useMemo(
    () => ({
      simpan: async (jawaban) => (await api.put<{ dikirimOtomatis?: boolean }>(`/karier/tes/${id}/jawaban`, { jawaban })).data,
      kirim: async () => (await api.post<HasilKirimCbt>(`/karier/tes/${id}/kirim`)).data,
      kejadian: async (type, detail) => {
        await api.post(`/karier/tes/${id}/kejadian`, { type, ...(detail ? { detail } : {}) });
      },
      foto: async (dataUrl) => {
        await api.post(`/karier/tes/${id}/foto`, { image: dataUrl });
      },
      // Gambar soal ikut jalur portal supaya tetap terbaca sesi pelamar.
      gambarSoal: (questionId) => `/api/backend/cbt/soal/${questionId}/gambar`,
    }),
    [id]
  );

  const kembali = (
    <Link href="/karier/dashboard">
      <Button variant="outline"><ArrowLeft className="h-4 w-4" aria-hidden /> Kembali ke dashboard</Button>
    </Link>
  );

  if (selesai) return <SelesaiUjian hasil={selesai} kembali={kembali} />;
  if (ruang.isLoading) return <div className="mx-auto max-w-5xl p-4"><Skeleton className="h-96" /></div>;
  if (ruang.isError || !ruang.data) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Card className="space-y-4 p-6">
          <Alert tone="danger" title="Tes tidak bisa dibuka">
            {(ruang.error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Coba lagi nanti."}
          </Alert>
          {kembali}
        </Card>
      </div>
    );
  }

  return <RuangUjianCbt ruang={ruang.data} api={alat} onSelesai={setSelesai} />;
}
