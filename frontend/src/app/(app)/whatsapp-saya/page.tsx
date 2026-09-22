"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QrCode, Link2, Link2Off, History, RefreshCw, Users, Camera } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Skeleton, SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { tautanWhatsAppQuery } from "@/components/whatsapp/peringatan-tautan";
import { formatTanggal, formatRelatif, labelStatus } from "@/lib/utils";
import type { Halaman, TautanWhatsApp, GrupWhatsApp } from "@/lib/types";

interface KejadianSesi { id: string; eventType: string; occurredAt: string; note: string | null; account: { label: string; phoneNumber: string | null } }

const JUDUL: Record<TautanWhatsApp["status"], string> = {
  never_linked: "WhatsApp belum ditautkan",
  connecting: "Menyiapkan kode QR…",
  pending_scan: "Pindai kode QR dengan WhatsApp di ponsel Anda",
  connected: "WhatsApp tersambung",
  disconnected: "Tautan WhatsApp terputus",
  inactive: "Tautan dinonaktifkan HR",
};

export default function HalamanWhatsAppSaya() {
  const qc = useQueryClient();
  const tautan = useQuery({
    ...tautanWhatsAppQuery,
    // QR berganti tiap ±20 detik dan status berubah begitu ponsel memindai.
    refetchInterval: (q) => (q.state.data?.status === "connecting" || q.state.data?.status === "pending_scan" ? 3000 : 15_000),
  });
  const kejadian = useQuery({ queryKey: ["wa", "kejadian-saya"], queryFn: async () => (await api.get<Halaman<KejadianSesi>>("/whatsapp/session-events?limit=20")).data.data });
  const sambungkan = useMutation({
    mutationFn: async () => (await api.post<TautanWhatsApp>("/whatsapp/me/connect", {})).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["wa", "saya"] }); qc.invalidateQueries({ queryKey: ["wa", "kejadian-saya"] }); notifikasi.info("Menyiapkan kode QR", "Siapkan WhatsApp di ponsel Anda; kode muncul beberapa detik lagi."); },
    onError: (e) => notifikasi.galat(e, "Belum bisa menautkan"),
  });

  const grup = useQuery({
    queryKey: ["wa", "grup-saya"],
    queryFn: async () => (await api.get<{ data: GrupWhatsApp[]; terpilih: string | null }>("/whatsapp/me/groups")).data,
    enabled: tautan.data?.status === "connected",
    retry: false,
  });
  const pilihGrup = useMutation({
    mutationFn: async (jid: string | null) => (await api.put<TautanWhatsApp>("/whatsapp/me/attendance-group", { jid })).data,
    onSuccess: (r, jid) => { qc.invalidateQueries({ queryKey: ["wa", "saya"] }); qc.invalidateQueries({ queryKey: ["wa", "grup-saya"] }); notifikasi.sukses(jid ? `Foto absensi akan dikirim ke "${r.account?.attendanceGroup?.name}"` : "Pengiriman foto absensi dihentikan", jid ? "Setiap check-in dan check-out mengirim foto ber-stempel dari WhatsApp Anda." : undefined); },
    onError: (e) => notifikasi.galat(e, "Grup gagal dipilih"),
  });

  const t = tautan.data;
  return (
    <>
      <PageHeader title="WhatsApp Saya" description="Setiap karyawan wajib menautkan WhatsApp-nya agar pesan tersinkron ke sistem perusahaan. Pemindaian QR hanya dilakukan dari halaman ini." />
      {tautan.isLoading || !t ? <Skeleton className="h-56" /> : !t.driverAktif ? (
        <Alert tone="warning" title="Layanan WhatsApp sedang tidak aktif di server">Coba lagi nanti. Bila berlanjut, hubungi HR.</Alert>
      ) : (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${t.status === "connected" ? "bg-success-soft text-success" : t.status === "pending_scan" || t.status === "connecting" ? "bg-info-soft text-info" : "bg-danger-soft text-danger"}`} aria-hidden>
                {t.status === "connected" ? <Link2 className="h-5 w-5" /> : t.status === "pending_scan" || t.status === "connecting" ? <QrCode className="h-5 w-5" /> : <Link2Off className="h-5 w-5" />}
              </span>
              <div>
                <CardTitle>{JUDUL[t.status]}</CardTitle>
                <CardDescription className="tabular-nums">{t.account?.phoneNumber ? `+${t.account.phoneNumber}` : "Nomor terisi otomatis setelah dipindai"}{t.account?.lastConnectedAt && t.status === "connected" ? ` · tersambung ${formatRelatif(t.account.lastConnectedAt)}` : ""}</CardDescription>
              </div>
            </div>
            <Badge tone={t.status === "connected" ? "success" : t.status === "pending_scan" || t.status === "connecting" ? "info" : "danger"} dot>{t.status === "never_linked" ? "Wajib" : t.status === "inactive" ? "Nonaktif" : labelStatus(t.status)}</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {t.status === "connected" && (
              <p className="text-sm text-muted">Pesan Anda tersinkron ke sistem perusahaan. Jangan hapus perangkat tertaut &ldquo;HRD Nusantara&rdquo; di WhatsApp, atau tautan akan terputus dan Anda harus memindai ulang.</p>
            )}
            {t.status === "connecting" && <Skeleton className="mx-auto h-64 w-64 rounded-xl" />}
            {t.status === "pending_scan" && (
              <div className="grid gap-4 md:grid-cols-[16rem_1fr] md:items-start">
                {t.qr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.qr} alt="Kode QR untuk menautkan WhatsApp" className="h-64 w-64 rounded-xl border border-border bg-white p-2" />
                ) : <Skeleton className="h-64 w-64 rounded-xl" />}
                <ol className="space-y-2 text-sm">
                  {["Buka WhatsApp di ponsel Anda, ketuk menu ⋮ (Android) atau Pengaturan (iPhone).", "Pilih Perangkat Tertaut → Tautkan perangkat.", "Arahkan kamera ponsel ke kode di samping. Kode berganti otomatis; halaman ini memperbarui sendiri."].map((l, i) => (
                    <li key={i} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-on-primary">{i + 1}</span><span>{l}</span></li>
                  ))}
                </ol>
              </div>
            )}
            {t.catatan && t.status !== "connected" && (
              // Judulnya mengikuti keadaan, bukan tetap: pesan "menyambung
              // ulang dalam sekian detik" dulu tampil di bawah judul merah
              // "Tautan terakhir dibatalkan", padahal tidak ada yang
              // dibatalkan dan sistemnya sedang memulihkan diri sendiri.
              <Alert
                tone={t.session?.sedangSambungUlang ? "info" : "warning"}
                title={t.session?.sedangSambungUlang ? "Sedang menyambung ulang sendiri" : "Tautan terputus"}
              >
                {t.catatan}
              </Alert>
            )}
            {(t.status === "never_linked" || t.status === "disconnected") && (
              <>
                <p className="text-sm text-muted">{t.status === "never_linked" ? "Prosesnya satu menit: tekan tombol, lalu pindai kode QR dengan WhatsApp di ponsel Anda." : `Sesi terputus${t.account?.lastDisconnectedAt ? ` ${formatRelatif(t.account.lastDisconnectedAt)}` : ""}. Sistem mencoba menyambung kembali; bila tidak berhasil, pindai ulang di sini.`}</p>
                <Button onClick={() => sambungkan.mutate()} loading={sambungkan.isPending}><QrCode className="h-4 w-4" aria-hidden /> {t.status === "never_linked" ? "Tautkan WhatsApp" : "Pindai Ulang"}</Button>
              </>
            )}
            {t.status === "inactive" && <p className="text-sm text-muted">HR menonaktifkan tautan WhatsApp Anda. Hubungi HR untuk mengaktifkannya kembali.</p>}
            {(t.status === "pending_scan" || t.status === "connecting") && <Button variant="ghost" size="sm" onClick={() => sambungkan.mutate()} loading={sambungkan.isPending}><RefreshCw className="h-4 w-4" aria-hidden /> Minta kode baru</Button>}
          </CardContent>
        </Card>
      )}

      {t?.status === "connected" && (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div><CardTitle className="flex items-center gap-2"><Camera className="h-4 w-4 text-primary" aria-hidden /> Grup tujuan foto absensi</CardTitle><CardDescription>Setiap check-in dan check-out, WhatsApp Anda mengirim foto ber-stempel (nama, jam, lokasi, metode) ke grup ini</CardDescription></div>
            <Button variant="ghost" size="sm" onClick={() => grup.refetch()} loading={grup.isFetching}><RefreshCw className="h-4 w-4" aria-hidden /> Muat ulang</Button>
          </CardHeader>
          <CardContent>
            {t.account?.attendanceGroup ? (
              <Alert tone="success" title={`Terpilih: ${t.account.attendanceGroup.name ?? t.account.attendanceGroup.jid}`} action={<Button size="sm" variant="outline" onClick={() => pilihGrup.mutate(null)} loading={pilihGrup.isPending && pilihGrup.variables === null}>Berhenti mengirim</Button>}>Pilih grup lain di bawah untuk mengganti.</Alert>
            ) : (
              <Alert tone="warning" title="Belum ada grup tujuan">Pilih grup outlet atau tim Anda; tanpa ini foto absensi tidak dikirim.</Alert>
            )}
            {grup.isLoading ? <SkeletonBaris jumlah={3} /> : grup.isError ? <p className="mt-3 text-sm text-muted">Daftar grup belum bisa dimuat. Pastikan sesi tersambung, lalu muat ulang.</p> : !grup.data?.data.length ? <p className="mt-3 text-sm text-muted">WhatsApp ini belum bergabung ke grup mana pun.</p> : (
              <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
                {grup.data.data.map((g) => (
                  <li key={g.jid}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-surface-2">
                      <input type="radio" name="grup-absensi" className="h-4 w-4 accent-[var(--color-primary)]" checked={t.account?.attendanceGroup?.jid === g.jid} onChange={() => pilihGrup.mutate(g.jid)} disabled={pilihGrup.isPending} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{g.nama}</span>
                      <span className="inline-flex items-center gap-1 text-xs text-muted"><Users className="h-3.5 w-3.5" aria-hidden /> {g.jumlahAnggota}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><History className="h-4 w-4 text-primary" aria-hidden /> Riwayat sesi</CardTitle></CardHeader>
        {kejadian.isLoading ? <SkeletonBaris jumlah={3} /> : !kejadian.data?.length ? <EmptyState icon={History} title="Belum ada riwayat" description="Sambungan dan pemutusan sesi akan tercatat di sini." /> : (
          <ul className="divide-y divide-border">
            {kejadian.data.map((k) => (
              <li key={k.id} className="flex items-center gap-3 p-4">
                <Badge tone={nadaStatus(k.eventType)} dot>{labelStatus(k.eventType)}</Badge>
                <div className="min-w-0 flex-1"><p className="text-sm">{k.note ?? labelStatus(k.eventType)}</p><p className="text-xs text-muted">{formatTanggal(k.occurredAt, "d MMM yyyy HH:mm")}</p></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
