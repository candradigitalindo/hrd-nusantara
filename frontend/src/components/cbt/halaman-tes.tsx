"use client";

import * as React from "react";
import Link from "next/link";
import type { LingkupCbt } from "@/lib/types";
import { MonitorCheck } from "lucide-react";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { TesSayaPanel } from "@/components/cbt/tes-saya";
import { BankSoal } from "@/components/cbt/bank-soal";
import { PaketTes } from "@/components/cbt/paket-tes";
import { HasilTes } from "@/components/cbt/hasil-tes";

type Tab = "saya" | "paket" | "soal" | "hasil";

export function HalamanTes({ scope }: { scope: LingkupCbt }) {
  const { data: saya } = useSesi();

  const TABS: { id: Tab; label: string; tampil: boolean }[] = [
    { id: "saya", label: "Tes Saya", tampil: scope === "development" && punyaIzin(saya, "cbt.lihat") },
    { id: "paket", label: "Paket Tes", tampil: punyaIzin(saya, "cbt.buat", "cbt.ubah", "cbt.hapus") },
    { id: "soal", label: "Bank Soal", tampil: punyaIzin(saya, "cbt_soal.lihat", "cbt_soal.buat", "cbt_soal.ubah", "cbt_soal.hapus") },
    { id: "hasil", label: "Hasil & Penilaian", tampil: punyaIzin(saya, "cbt_hasil.lihat") },
  ];
  const bolehRekrutmen = punyaIzin(saya, "rekrutmen.lihat", "rekrutmen.buat", "rekrutmen.ubah", "rekrutmen.hapus");
  const tersedia = TABS.filter((t) => t.tampil && (scope === "development" || bolehRekrutmen));
  const [tab, setTab] = React.useState<Tab>(scope === "recruitment" ? "paket" : "saya");
  // Peran yang tidak punya "Tes Saya" tetap mendarat di tab pertama miliknya.
  const aktif = tersedia.some((t) => t.id === tab) ? tab : (tersedia[0]?.id ?? "saya");

  return (
    <>
      {scope === "recruitment" && <Link href="/rekrutmen" className="text-sm text-muted hover:text-foreground">← Kembali ke Rekrutmen</Link>}
      <PageHeader
        title={scope === "recruitment" ? "Tes Seleksi" : "Tes Karyawan"}
        description={scope === "recruitment" ? "Paket, bank soal, dan hasil seleksi pelamar. Tes wajib diselesaikan dan ditinjau HR sebelum kandidat diterima." : "Tes kemampuan dan pengembangan karyawan, termasuk tes yang ditugaskan kepada Anda."}
      />

      {tersedia.length > 1 && (
        <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1" role="tablist">
          {tersedia.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={aktif === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                aktif === t.id ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tersedia.length > 0 && aktif === "saya" && <TesSayaPanel />}
      {aktif === "paket" && (
        <PaketTes
          scope={scope}
          bolehBuat={punyaIzin(saya, "cbt.buat")}
          bolehUbah={punyaIzin(saya, "cbt.ubah")}
          bolehHapus={punyaIzin(saya, "cbt.hapus")}
        />
      )}
      {aktif === "soal" && (
        <BankSoal
          scope={scope}
          bolehBuat={punyaIzin(saya, "cbt_soal.buat")}
          bolehUbah={punyaIzin(saya, "cbt_soal.ubah")}
          bolehHapus={punyaIzin(saya, "cbt_soal.hapus")}
        />
      )}
      {aktif === "hasil" && <HasilTes scope={scope} />}
      {tersedia.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <MonitorCheck className="h-4 w-4" aria-hidden /> Tidak ada bagian CBT yang terbuka untuk peran Anda.
        </p>
      )}
    </>
  );
}
