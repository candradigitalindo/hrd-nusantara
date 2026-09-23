"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Download, ShieldCheck, ArrowLeft, Copy } from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { notifikasi } from "@/hooks/use-notifikasi";
import { formatTanggal, formatUkuran } from "@/lib/utils";
import { Logo } from "@/components/ui/logo";
import type { RilisMobile } from "@/lib/types";

/** Halaman publik: karyawan mengunduh aplikasi Android sebelum punya sesi di ponselnya. */
export default function HalamanUnduh() {
  const rilis = useQuery({ queryKey: ["mobile", "terbaru"], queryFn: async () => (await api.get<RilisMobile>("/mobile/releases/latest")).data, retry: false });
  const r = rilis.data;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <Logo className="mx-auto h-16 w-16" />
          <h1 className="mt-3 text-2xl font-bold">HRD Nusantara untuk Android</h1>
          <p className="text-sm text-muted">Presensi, cuti, slip gaji, dan jadwal di ponsel Anda</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          {rilis.isLoading ? <Skeleton className="h-40" /> : rilis.isError || !r ? (
            <p className="text-center text-sm text-muted">Belum ada rilis aplikasi yang tersedia. Hubungi HR.</p>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-lg font-semibold">Versi {r.versionName}</p>
                <p className="text-xs text-muted tabular-nums">{formatUkuran(r.sizeBytes)} · {formatTanggal(r.createdAt)}</p>
              </div>
              {r.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{r.notes}</p>}
              <a href="/api/backend/mobile/apk/latest" download={r.fileName} className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-on-primary shadow-sm hover:bg-primary-hover">
                <Download className="h-5 w-5" aria-hidden /> Unduh APK ({formatUkuran(r.sizeBytes)})
              </a>
              <button type="button" onClick={() => { navigator.clipboard.writeText(r.sha256).then(() => notifikasi.sukses("Checksum disalin")); }} className="mt-3 flex w-full items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-left text-xs text-muted hover:text-foreground">
                <ShieldCheck className="h-4 w-4 shrink-0 text-success" aria-hidden /><span className="min-w-0 flex-1 truncate font-mono">SHA-256 {r.sha256}</span><Copy className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </button>
            </>
          )}
        </div>

        <ol className="space-y-2 rounded-2xl border border-border bg-surface p-5 text-sm shadow-sm">
          <li className="font-semibold">Cara memasang</li>
          {["Buka berkas APK yang terunduh dari notifikasi atau folder Download.", "Bila diminta, izinkan pemasangan dari sumber ini (Pengaturan → Pasang aplikasi tidak dikenal).", "Buka aplikasi, masuk dengan email dan kata sandi akun HRD Anda."].map((l, i) => (
            <li key={i} className="flex gap-3 text-muted"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary">{i + 1}</span><span>{l}</span></li>
          ))}
        </ol>

        <p className="text-center text-xs text-muted"><Link href="/" className="inline-flex items-center gap-1 hover:underline"><ArrowLeft className="h-3 w-3" aria-hidden /> Ke halaman utama</Link></p>
      </div>
    </div>
  );
}
