"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Award, Clock, MonitorCheck, Play } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTanggal } from "@/lib/utils";
import type { TesSaya } from "@/lib/types";

const LABEL_STATUS_TES: Record<string, string> = {
  assigned: "Belum dikerjakan",
  in_progress: "Sedang dikerjakan",
  submitted: "Menunggu penilaian",
  graded: "Selesai dinilai",
  expired: "Kedaluwarsa",
};

/** Daftar tes yang ditugaskan kepada pengguna yang sedang login. */
export const TesSayaPanel = () => {
  const daftar = useQuery({
    queryKey: ["cbt", "saya"],
    queryFn: async () => (await api.get<{ data: TesSaya[] }>("/cbt/saya")).data.data,
  });

  if (daftar.isLoading) return <SkeletonBaris />;
  if (!daftar.data?.length) {
    return (
      <Card>
        <EmptyState icon={MonitorCheck} title="Belum ada tes untuk Anda" description="Tes yang ditugaskan HR akan muncul di sini beserta batas waktunya." />
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {daftar.data.map((t) => {
        const bisaDikerjakan = t.status === "assigned" || t.status === "in_progress";
        const belumWaktunya = t.availableFrom ? new Date(t.availableFrom) > new Date() : false;
        return (
          <Card key={t.id} className="animate-fade-up flex flex-col p-5">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold">{t.test.title}</p>
              <Badge tone={nadaStatus(t.status)} dot>{LABEL_STATUS_TES[t.status] ?? t.status}</Badge>
            </div>
            {t.test.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{t.test.description}</p>}

            <dl className="mt-3 space-y-1 text-xs text-muted">
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" aria-hidden /> {t.test.durationMinutes} menit · {t.test._count.questions} soal
              </div>
              {t.availableUntil && <div>Bisa dikerjakan sampai {formatTanggal(t.availableUntil, "d MMM yyyy HH:mm")}</div>}
              {t.note && <div className="italic">“{t.note}”</div>}
            </dl>

            {t.status === "graded" && t.test.showResultToTaker && t.attempt?.percent !== null && t.attempt && (
              <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium">
                <Award className="h-4 w-4 text-primary" aria-hidden /> Nilai {t.attempt.percent}%
                {t.attempt.passed !== null && (t.attempt.passed ? " · lulus" : " · belum lulus")}
              </p>
            )}

            <div className="mt-auto pt-4">
              {bisaDikerjakan && !belumWaktunya ? (
                <Link href={`/cbt/kerjakan/${t.id}`}>
                  <Button className="w-full">
                    <Play className="h-4 w-4" aria-hidden /> {t.status === "in_progress" ? "Lanjutkan" : "Mulai kerjakan"}
                  </Button>
                </Link>
              ) : belumWaktunya ? (
                <p className="text-xs text-muted">Bisa dimulai {formatTanggal(t.availableFrom, "d MMM yyyy HH:mm")}</p>
              ) : (
                <p className="text-xs text-muted">
                  {t.status === "submitted" ? "Jawaban Anda sedang dinilai." : t.status === "graded" ? "Tes sudah selesai." : "Masa pengerjaan sudah lewat."}
                </p>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
};
