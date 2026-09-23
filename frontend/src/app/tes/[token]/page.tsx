"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { Clock, ListChecks, Play, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { Logo } from "@/components/ui/logo";
import { formatTanggal } from "@/lib/utils";
import { RuangUjianCbt, SelesaiUjian, type ApiUjian } from "@/components/cbt/ruang-ujian";
import { TeksKaya } from "@/components/ui/editor-teks";
import type { HasilKirimCbt, InfoTesPublik, RuangUjian } from "@/lib/types";

/**
 * Halaman ujian untuk pelamar: dibuka dari tautan bertoken, tanpa akun dan
 * tanpa sidebar aplikasi. Tokennya sendiri yang menjadi kunci masuk, jadi
 * halaman ini berada di luar area yang dijaga cookie sesi.
 */
export default function HalamanTesPublik() {
  const { token } = useParams<{ token: string }>();
  const [ruang, setRuang] = React.useState<RuangUjian | null>(null);
  const [selesai, setSelesai] = React.useState<HasilKirimCbt | null>(null);

  const info = useQuery({
    queryKey: ["tes-publik", token],
    queryFn: async () => (await api.get<InfoTesPublik>(`/cbt/publik/${token}`)).data,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const mulai = useMutation({
    mutationFn: async () => (await api.post<RuangUjian>(`/cbt/publik/${token}/mulai`)).data,
    onSuccess: (d) => setRuang(d),
  });

  const alat: ApiUjian = React.useMemo(
    () => ({
      simpan: async (jawaban) => (await api.put<{ dikirimOtomatis?: boolean }>(`/cbt/publik/${token}/jawaban`, { jawaban })).data,
      kirim: async () => (await api.post<HasilKirimCbt>(`/cbt/publik/${token}/kirim`)).data,
      kejadian: async (type, detail) => {
        await api.post(`/cbt/publik/${token}/kejadian`, { type, ...(detail ? { detail } : {}) });
      },
      foto: async (dataUrl) => {
        await api.post(`/cbt/publik/${token}/foto`, { image: dataUrl });
      },
      gambarSoal: (questionId) => `/api/backend/cbt/publik/${token}/soal/${questionId}/gambar`,
    }),
    [token]
  );

  if (selesai) return <SelesaiUjian hasil={selesai} />;
  if (ruang) return <RuangUjianCbt ruang={ruang} api={alat} onSelesai={setSelesai} />;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <Logo className="mx-auto h-14 w-14" />
          <h1 className="mt-3 text-xl font-bold">Tes Seleksi</h1>
        </div>

        <Card className="space-y-4 p-6">
          {info.isLoading ? (
            <Skeleton className="h-40" />
          ) : info.isError || !info.data ? (
            <Alert tone="danger" title="Tautan tidak berlaku">
              Tautan ini tidak sah atau sudah diganti. Hubungi HR untuk meminta tautan baru.
            </Alert>
          ) : info.data.sudahDikirim ? (
            <Alert tone="info" title="Tes sudah dikerjakan">
              Jawaban Anda sudah terkirim. Hasilnya disampaikan HR.
            </Alert>
          ) : (
            <>
              <div>
                <p className="text-sm text-muted">Peserta</p>
                <p className="font-semibold">{info.data.peserta}</p>
              </div>
              <div>
                <p className="font-semibold">{info.data.test.title}</p>
                {(info.data.test.descriptionHtml || info.data.test.description) && (
                  <TeksKaya html={info.data.test.descriptionHtml} teks={info.data.test.description} className="mt-1 text-sm text-muted" />
                )}
              </div>
              <ul className="space-y-1.5 text-sm text-muted">
                <li className="flex items-center gap-2"><Clock className="h-4 w-4" aria-hidden /> {info.data.test.durationMinutes} menit, dihitung sejak tombol Mulai ditekan</li>
                <li className="flex items-center gap-2"><ListChecks className="h-4 w-4" aria-hidden /> {info.data.test.jumlahSoal} soal</li>
                {info.data.test.proctorPhotos && (
                  <li className="flex items-start gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Kamera diaktifkan untuk foto pengawasan berkala selama ujian</li>
                )}
                {info.data.availableUntil && <li>Batas akhir pengerjaan {formatTanggal(info.data.availableUntil, "d MMM yyyy HH:mm")}</li>}
              </ul>

              <Alert tone="warning" title="Sekali mulai, waktu berjalan terus">
                Menutup tab tidak menghentikan hitung mundur. Pastikan koneksi dan perangkat Anda siap.
              </Alert>

              {mulai.isError && <Alert tone="danger" title="Tidak bisa memulai">{(mulai.error as Error).message}</Alert>}

              <Button className="w-full" onClick={() => mulai.mutate()} loading={mulai.isPending}>
                {!mulai.isPending && <Play className="h-4 w-4" aria-hidden />} Mulai kerjakan
              </Button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
