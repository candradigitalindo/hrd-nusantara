"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plug, RefreshCw, Send, X } from "lucide-react";
import { api, ambilSemua } from "@/lib/api";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { formatTanggal, labelStatus } from "@/lib/utils";
import type { Lowongan } from "@/lib/types";

type Platform = "jobstreet" | "linkedin";
type Integrasi = { platform: Platform; name: string; configured: boolean; missing: string[]; note: string; documentationUrl: string };
type Publikasi = { id: string; platform: Platform; operation: "CREATE" | "CLOSE"; status: string; remoteUrl: string | null; error: string | null; checkedAt: string | null };
type PilihanSeek = { locationId: string; categoryId: string; advertisementProductId: string; summary: string };
const STATUS: Record<string, string> = { sending: "Mengirim", pending: "Menunggu konfirmasi", published: "Tayang", closed: "Ditutup", failed: "Gagal", uncertain: "Perlu diperiksa", processed: "Diproses LinkedIn; belum dikonfirmasi tayang" };

export function PanelIntegrasi() {
  const { data: sesi } = useSesi();
  const bolehUbah = punyaIzin(sesi, "rekrutmen.ubah");
  const qc = useQueryClient();
  const [id, setId] = React.useState("");
  const [tujuan, setTujuan] = React.useState<Integrasi | null>(null);
  const [seek, setSeek] = React.useState<PilihanSeek>({ locationId: "", categoryId: "", advertisementProductId: "", summary: "" });
  const [teruji, setTeruji] = React.useState<Platform[]>([]);
  const integrasi = useQuery({ queryKey: ["integrasi-rekrutmen"], queryFn: async () => (await api.get<{ data: Integrasi[] }>("/recruitment/integrations")).data.data });
  const lowongan = useQuery({ queryKey: ["lowongan", "integrasi"], queryFn: () => ambilSemua<Lowongan>("/job-postings") });
  const publikasi = useQuery({ queryKey: ["publikasi-lowongan", id], enabled: Boolean(id), queryFn: async () => (await api.get<{ data: Publikasi[] }>(`/job-postings/${id}/publications`)).data.data });
  const pilihan = lowongan.data?.find((l) => l.id === id);
  const uji = useMutation({
    mutationFn: async (platform: Platform) => (await api.post<{ message: string }>(`/recruitment/integrations/${platform}/test`)).data,
    onSuccess: (hasil, platform) => { setTeruji((v) => [...new Set([...v, platform])]); notifikasi.sukses("Autentikasi API berhasil", hasil.message); },
    onError: (e, platform) => { setTeruji((v) => v.filter((p) => p !== platform)); notifikasi.galat(e, "Koneksi belum berhasil"); },
  });
  const kirim = useMutation({
    mutationFn: async ({ platform, action, seek: dataSeek }: { platform: Platform; action: "publish" | "close" | "refresh"; seek?: PilihanSeek }) => (await api.post<Publikasi>(`/job-postings/${id}/publications/${platform}`, { action, ...(dataSeek ? { seek: dataSeek } : {}) })).data,
    onSuccess: (hasil) => { setTujuan(null); notifikasi.sukses(STATUS[hasil.status] ?? hasil.status, hasil.status === "pending" ? "Periksa status untuk memastikan hasil dari platform." : undefined); },
    onError: (e) => notifikasi.galat(e, "Publikasi belum berhasil"),
    onSettled: () => { qc.invalidateQueries({ queryKey: ["publikasi-lowongan", id] }); },
  });

  if (integrasi.isLoading || lowongan.isLoading) return <SkeletonBaris />;
  if (integrasi.isError || lowongan.isError) return <Alert tone="danger" title="Integrasi belum dapat dimuat"><Button variant="outline" onClick={() => { integrasi.refetch(); lowongan.refetch(); }}>Coba lagi</Button></Alert>;

  return (
    <div className="space-y-5">
      <Alert tone="info" title="Publikasikan lowongan ke JobStreet dan LinkedIn">
        Setelah akses API resmi tersedia, uji koneksi lalu kirim lowongan terbuka. Pelamar mengisi lamaran di portal karier ini dan sumbernya tercatat di laporan rekrutmen.
      </Alert>
      <div className="grid gap-4 lg:grid-cols-2">
        {integrasi.data?.map((p) => (
          <Card key={p.platform}>
            <CardHeader>
              <div className="flex items-center justify-between gap-3"><CardTitle>{p.name}</CardTitle><Badge tone={teruji.includes(p.platform) ? "success" : p.configured ? "info" : "warning"} dot>{teruji.includes(p.platform) ? "Autentikasi teruji" : p.configured ? "Siap diuji" : "Menunggu akses API"}</Badge></div>
              <CardDescription>{p.note}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {p.missing.length > 0 && <details className="text-sm text-muted"><summary className="cursor-pointer">Pengaturan server yang perlu dilengkapi</summary><ul className="mt-2 list-disc space-y-1 pl-5">{p.missing.map((key) => <li key={key}><code className="break-all text-xs">{key}</code></li>)}</ul></details>}
              <div className="flex flex-wrap items-center gap-3">
                {bolehUbah && <Button variant="outline" disabled={!p.configured || uji.isPending} loading={uji.isPending && uji.variables === p.platform} onClick={() => uji.mutate(p.platform)}><Plug className="h-4 w-4" aria-hidden /> Uji koneksi</Button>}
                <a href={p.documentationUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">Panduan akses resmi <ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle>Publikasi lowongan</CardTitle><CardDescription>Status di setiap platform dikelola terpisah. Setelah menutup lowongan di sini, tutup juga publikasinya melalui tombol di bawah. Penyuntingan iklan yang sudah tayang dilakukan di platform.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <Field label="Pilih lowongan"><Select value={id} onChange={(e) => setId(e.target.value)}><option value="">— Pilih lowongan —</option>{lowongan.data?.map((l) => <option key={l.id} value={l.id}>{l.title} · {l.location ?? l.position.name} · {labelStatus(l.status)}</option>)}</Select></Field>
          {id && publikasi.isLoading && <SkeletonBaris />}
          {publikasi.isError && <Alert tone="danger" title="Status publikasi belum dapat dimuat"><Button variant="outline" onClick={() => publikasi.refetch()}>Coba lagi</Button></Alert>}
          {id && publikasi.isSuccess && integrasi.data?.map((p) => {
            const row = publikasi.data.find((r) => r.platform === p.platform);
            const bolehKirim = !row || row.status === "failed" && row.operation === "CREATE" || row.status === "uncertain" && p.platform === "jobstreet" && row.operation === "CREATE";
            const bolehTutup = row?.status === "published" || row?.status === "failed" && row.operation === "CLOSE";
            return (
              <div key={p.platform} className="space-y-3 rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-medium">{p.name}</p><Badge tone={row?.status === "uncertain" || row?.status === "processed" ? "warning" : nadaStatus(row?.status)}>{row ? STATUS[row.status] ?? row.status : "Belum dikirim"}</Badge></div>
                {row?.operation === "CLOSE" && row.status !== "closed" && <p className="text-sm text-muted">Permintaan penutupan {row.status === "failed" ? "gagal" : "belum dikonfirmasi"}; iklan mungkin masih tayang.</p>}
                {row?.error && <p className="text-sm text-danger" role="status">{row.error}</p>}
                {row?.checkedAt && <p className="text-xs text-muted">Terakhir diperiksa {formatTanggal(row.checkedAt, "d MMM yyyy HH:mm")}</p>}
                <div className="flex flex-wrap gap-2">
                  {bolehUbah && <>
                    {bolehKirim && <Button size="sm" disabled={!p.configured || pilihan?.status !== "open" || kirim.isPending} onClick={() => { setSeek({ locationId: "", categoryId: "", advertisementProductId: "", summary: pilihan?.description.slice(0, 150) ?? "" }); setTujuan(p); }}><Send className="h-4 w-4" aria-hidden />{row ? "Coba kirim ulang" : "Kirim lowongan"}</Button>}
                    {row && <Button size="sm" variant="outline" disabled={!p.configured || kirim.isPending} onClick={() => kirim.mutate({ platform: p.platform, action: "refresh" })}><RefreshCw className="h-4 w-4" aria-hidden /> Periksa status</Button>}
                    {bolehTutup && <Button size="sm" variant="outline" disabled={!p.configured || kirim.isPending} onClick={() => kirim.mutate({ platform: p.platform, action: "close" })}><X className="h-4 w-4" aria-hidden /> Tutup di platform</Button>}
                  </>}
                  {row?.remoteUrl && row.status !== "closed" && <a href={row.remoteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">Lihat publikasi <ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
      <Modal open={Boolean(tujuan)} onClose={() => { if (!kirim.isPending) setTujuan(null); }} title={`Kirim ke ${tujuan?.name ?? "platform"}`} description={pilihan?.title}
        footer={<><Button variant="outline" disabled={kirim.isPending} onClick={() => setTujuan(null)}>Batal</Button><Button type="submit" form="form-publikasi" loading={kirim.isPending}><Send className="h-4 w-4" aria-hidden /> Kirim lowongan</Button></>}>
        <form id="form-publikasi" className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (tujuan) kirim.mutate({ platform: tujuan.platform, action: "publish", ...(tujuan.platform === "jobstreet" ? { seek } : {}) }); }}>
          <p className="text-sm text-muted">Deskripsi, persyaratan, lokasi, dan jenis pekerjaan diambil dari lowongan. Tautan lamaran mengarah ke portal karier perusahaan.</p>
          {tujuan?.platform === "jobstreet" && <>
            <p className="text-sm text-muted">Gunakan pilihan resmi dari akun partner SEEK untuk lowongan ini. Produk iklan dapat dikenai biaya sesuai akun JobStreet Anda. Gaji di lowongan dibaca sebagai rentang bulanan dalam rupiah.</p>
            <Field label="ID lokasi JobStreet"><Input required maxLength={250} value={seek.locationId} onChange={(e) => setSeek({ ...seek, locationId: e.target.value })} /></Field>
            <Field label="ID kategori JobStreet"><Input required maxLength={250} value={seek.categoryId} onChange={(e) => setSeek({ ...seek, categoryId: e.target.value })} /></Field>
            <Field label="ID produk iklan JobStreet"><Input required maxLength={500} value={seek.advertisementProductId} onChange={(e) => setSeek({ ...seek, advertisementProductId: e.target.value })} /></Field>
            <Field label="Ringkasan pencarian" hint="Maksimal 150 karakter"><Input required maxLength={150} value={seek.summary} onChange={(e) => setSeek({ ...seek, summary: e.target.value })} /></Field>
          </>}
        </form>
      </Modal>
    </div>
  );
}
