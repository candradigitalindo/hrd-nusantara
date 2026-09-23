"use client";

import * as React from "react";
import { MonitorCheck } from "lucide-react";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { TesSayaPanel } from "@/components/cbt/tes-saya";
import { BankSoal } from "@/components/cbt/bank-soal";
import { PaketTes } from "@/components/cbt/paket-tes";
import { HasilTes } from "@/components/cbt/hasil-tes";

type Tab = "saya" | "paket" | "soal" | "hasil";

export default function HalamanCbt() {
  const { data: saya } = useSesi();

  const TABS: { id: Tab; label: string; tampil: boolean }[] = [
    { id: "saya", label: "Tes Saya", tampil: punyaIzin(saya, "cbt.lihat") },
    { id: "paket", label: "Paket Tes", tampil: punyaIzin(saya, "cbt.buat", "cbt.ubah", "cbt.hapus") },
    { id: "soal", label: "Bank Soal", tampil: punyaIzin(saya, "cbt_soal.lihat", "cbt_soal.buat", "cbt_soal.ubah", "cbt_soal.hapus") },
    { id: "hasil", label: "Hasil & Penilaian", tampil: punyaIzin(saya, "cbt_hasil.lihat") },
  ];
  const tersedia = TABS.filter((t) => t.tampil);
  const [tab, setTab] = React.useState<Tab>("saya");
  // Peran yang tidak punya "Tes Saya" tetap mendarat di tab pertama miliknya.
  const aktif = tersedia.some((t) => t.id === tab) ? tab : (tersedia[0]?.id ?? "saya");

  return (
    <>
      <PageHeader
        title="Tes CBT"
        description="Ujian daring untuk menguji kemampuan karyawan dan menyeleksi pelamar: bank soal dipakai bersama, soal objektif dinilai otomatis, esai dinilai penguji."
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

      {aktif === "saya" && <TesSayaPanel />}
      {aktif === "paket" && (
        <PaketTes
          bolehBuat={punyaIzin(saya, "cbt.buat")}
          bolehUbah={punyaIzin(saya, "cbt.ubah")}
          bolehHapus={punyaIzin(saya, "cbt.hapus")}
        />
      )}
      {aktif === "soal" && (
        <BankSoal
          bolehBuat={punyaIzin(saya, "cbt_soal.buat")}
          bolehUbah={punyaIzin(saya, "cbt_soal.ubah")}
          bolehHapus={punyaIzin(saya, "cbt_soal.hapus")}
        />
      )}
      {aktif === "hasil" && <HasilTes />}
      {tersedia.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <MonitorCheck className="h-4 w-4" aria-hidden /> Tidak ada bagian CBT yang terbuka untuk peran Anda.
        </p>
      )}
    </>
  );
}
