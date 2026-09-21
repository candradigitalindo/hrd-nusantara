"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Upload, Download, TabletSmartphone, Copy, QrCode, Link2 } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Skeleton, SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTanggal, formatRelatif, formatUkuran, formatAngka } from "@/lib/utils";
import type { Halaman, RilisMobile } from "@/lib/types";

type FormRilis = { versionName: string; versionCode: string; notes: string };

/** Unggah berkas mentah lewat XHR supaya ada persentase kemajuan; fetch tidak menyediakannya. */
const unggahApk = (url: string, berkas: File, onProgress: (persen: number) => void) =>
  new Promise<RilisMobile>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", "application/vnd.android.package-archive");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300) resolve(data as RilisMobile);
        else reject(Object.assign(new Error(data.error ?? `HTTP ${xhr.status}`), { response: { status: xhr.status, data } }));
      } catch { reject(new Error(`HTTP ${xhr.status}`)); }
    };
    xhr.onerror = () => reject(new Error("Koneksi terputus saat mengunggah"));
    xhr.send(berkas);
  });

export default function HalamanAplikasi() {
  const qc = useQueryClient();
  const [berkas, setBerkas] = React.useState<File | null>(null);
  const [progres, setProgres] = React.useState<number | null>(null);
  // Origin hanya ada di browser; snapshot server kosong supaya hidrasi cocok.
  const origin = React.useSyncExternalStore(() => () => {}, () => window.location.origin, () => "");
  const tautanPublik = origin ? `${origin}/unduh` : "";

  const rilis = useQuery({ queryKey: ["mobile", "rilis"], queryFn: async () => (await api.get<Halaman<RilisMobile>>("/mobile/releases?limit=50")).data.data });
  const qr = useQuery({ queryKey: ["mobile", "qr", tautanPublik], queryFn: async () => (await api.get<{ dataUrl: string }>(`/mobile/qr?text=${encodeURIComponent(tautanPublik)}`)).data.dataUrl, enabled: Boolean(tautanPublik) });
  const f = useForm<FormRilis>({ defaultValues: { versionName: "", versionCode: "", notes: "" } });

  const unggah = useMutation({
    mutationFn: async (v: FormRilis) => {
      if (!berkas) throw new Error("Pilih berkas APK dulu");
      const q = new URLSearchParams({ versionName: v.versionName.trim(), versionCode: v.versionCode.trim() }); if (v.notes.trim()) q.set("notes", v.notes.trim());
      setProgres(0);
      return unggahApk(`/api/backend/mobile/releases?${q}`, berkas, setProgres);
    },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["mobile"] }); notifikasi.sukses(`Versi ${r.versionName} dirilis`, `${formatUkuran(r.sizeBytes)} · kini ditawarkan di halaman unduh sebagai versi terbaru.`); setBerkas(null); f.reset(); setProgres(null); },
    onError: (e) => { setProgres(null); notifikasi.galat(e, "Unggahan gagal"); },
  });
  const ubah = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => (await api.patch<RilisMobile>(`/mobile/releases/${id}`, { isActive })).data,
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["mobile"] }); notifikasi.sukses(r.isActive ? `Versi ${r.versionName} diaktifkan` : `Versi ${r.versionName} dinonaktifkan`, r.isActive ? undefined : "Tidak lagi ditawarkan sebagai versi terbaru; tautan langsungnya tetap berfungsi."); },
    onError: (e) => notifikasi.galat(e),
  });

  const salin = (teks: string, judul: string) => navigator.clipboard.writeText(teks).then(() => notifikasi.sukses(judul));
  const terbaru = (rilis.data ?? []).find((r) => r.isActive);

  return (
    <>
      <PageHeader title="Aplikasi Mobile" description="Unggah APK hasil build; karyawan mengunduh versi terbaru dari halaman publik tanpa perlu masuk" />

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Upload className="h-4 w-4 text-primary" aria-hidden /> Rilis versi baru</CardTitle><CardDescription>Bangun dengan <code className="rounded bg-surface-2 px-1">flutter build apk --release</code>, lalu unggah berkas <code className="rounded bg-surface-2 px-1">app-release.apk</code>. versionCode harus lebih besar dari rilis sebelumnya.</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={f.handleSubmit((v) => unggah.mutate(v))} className="space-y-4" noValidate>
              <Field label="Berkas APK">
                <input type="file" accept=".apk,application/vnd.android.package-archive" onChange={(e) => setBerkas(e.target.files?.[0] ?? null)} className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary hover:file:bg-primary-soft/80" />
                {berkas && <p className="mt-1 text-xs text-muted">{berkas.name} · {formatUkuran(berkas.size)}</p>}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nama versi" error={f.formState.errors.versionName?.message} hint="mis. 1.2.0"><Input {...f.register("versionName", { required: "Wajib diisi", pattern: { value: /^\d+\.\d+\.\d+([+-][A-Za-z0-9.]+)?$/, message: "Format 1.2.0" } })} placeholder={terbaru ? `lebih baru dari ${terbaru.versionName}` : "1.0.0"} /></Field>
                <Field label="versionCode" error={f.formState.errors.versionCode?.message} hint={terbaru ? `terakhir ${terbaru.versionCode}` : "bilangan bulat naik"}><Input type="number" min={1} {...f.register("versionCode", { required: "Wajib diisi", min: { value: 1, message: "Minimal 1" } })} placeholder={terbaru ? String(terbaru.versionCode + 1) : "1"} /></Field>
              </div>
              <Field label="Catatan rilis"><Textarea rows={3} {...f.register("notes")} placeholder="Apa yang berubah untuk karyawan, mis. presensi wajah lebih cepat" /></Field>
              {progres !== null && (
                <div><div className="h-2 rounded-full bg-surface-2"><div className="h-2 rounded-full bg-primary transition-[width]" style={{ width: `${progres}%` }} /></div><p className="mt-1 text-xs text-muted">{progres < 100 ? `Mengunggah ${progres}%` : "Memverifikasi berkas…"}</p></div>
              )}
              <Button type="submit" loading={unggah.isPending} disabled={!berkas}><Upload className="h-4 w-4" aria-hidden /> Unggah & Rilis</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><QrCode className="h-4 w-4 text-primary" aria-hidden /> Tautan unduh untuk karyawan</CardTitle><CardDescription>Pajang QR ini di outlet atau kirim tautannya ke grup</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {qr.data ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr.data} alt={`QR tautan ${tautanPublik}`} className="mx-auto h-56 w-56 rounded-xl border border-border bg-white p-2" />
            ) : <Skeleton className="mx-auto h-56 w-56 rounded-xl" />}
            <button type="button" onClick={() => salin(tautanPublik, "Tautan disalin")} className="flex w-full items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-left text-sm hover:bg-border"><Link2 className="h-4 w-4 shrink-0 text-muted" aria-hidden /><span className="min-w-0 flex-1 truncate">{tautanPublik}</span><Copy className="h-4 w-4 shrink-0 text-muted" aria-hidden /></button>
            {!terbaru && <Alert tone="warning" title="Belum ada rilis aktif">Halaman unduh masih menampilkan &ldquo;belum ada rilis&rdquo; sampai Anda mengunggah APK.</Alert>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Riwayat rilis</CardTitle><CardDescription>Versi aktif dengan versionCode tertinggi yang ditawarkan sebagai terbaru. Menonaktifkan versi bermasalah otomatis mengembalikan ke versi aktif sebelumnya.</CardDescription></CardHeader>
        {rilis.isLoading ? <SkeletonBaris /> : !rilis.data?.length ? <EmptyState icon={TabletSmartphone} title="Belum ada rilis" description="Unggah APK pertama di panel atas." /> : (
          <ul className="divide-y divide-border">
            {rilis.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4 animate-fade-up">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">Versi {r.versionName} <span className="text-xs font-normal text-muted">code {r.versionCode}</span></p>{r.id === terbaru?.id ? <Badge tone="success" dot>Terbaru</Badge> : <Badge tone={r.isActive ? "info" : "neutral"}>{r.isActive ? "Aktif" : "Nonaktif"}</Badge>}</div>
                  <p className="text-xs text-muted">{formatUkuran(r.sizeBytes)} · {formatAngka(r.downloadCount)} unduhan · {r.uploadedBy?.name ?? "—"} · {formatRelatif(r.createdAt)} ({formatTanggal(r.createdAt, "d MMM yyyy HH:mm")})</p>
                  {r.notes && <p className="mt-1 whitespace-pre-wrap text-sm">{r.notes}</p>}
                  <button type="button" onClick={() => salin(r.sha256, "SHA-256 disalin")} className="mt-1 font-mono text-[11px] text-muted hover:text-foreground">sha256 {r.sha256.slice(0, 16)}… <Copy className="inline h-3 w-3" aria-hidden /></button>
                </div>
                <div className="flex shrink-0 gap-2">
                  <a href={`/api/backend/mobile/releases/${r.id}/apk`} download={r.fileName} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2"><Download className="h-4 w-4" aria-hidden /> Unduh</a>
                  <Button size="sm" variant="ghost" className={r.isActive ? "text-danger" : ""} onClick={() => ubah.mutate({ id: r.id, isActive: !r.isActive })} loading={ubah.isPending && ubah.variables?.id === r.id}>{r.isActive ? "Nonaktifkan" : "Aktifkan"}</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
