"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { History, MapPinOff, Radar, Save, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { useSesi } from "@/hooks/use-sesi";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input, Select, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { ResponsiveTable, type Kolom } from "@/components/ui/responsive-table";
import { formatRelatif } from "@/lib/utils";
import type { PengaturanPemantauan, PosisiKaryawan } from "@/lib/types";
import type { TitikPeta } from "@/components/peta-pemantauan";

// Leaflet butuh `window`: peta hanya dirender di peramban.
const Peta = dynamic(() => import("@/components/peta-pemantauan"), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-xl bg-surface-2" />,
});
// Dialog linimasa (beserta Leaflet-nya) baru dimuat saat Riwayat dibuka.
const DialogRiwayat = dynamic(() => import("@/components/pemantauan/dialog-riwayat"), { ssr: false });

type FormPengaturan = { enabled: boolean; mode: "always" | "while_working"; intervalMinutes: number; retentionDays: number };

/** Keadaan pemantauan seorang karyawan, dari yang paling perlu perhatian. */
const keadaan = (p: PosisiKaryawan, pengaturan?: PengaturanPemantauan): { label: string; nada: "success" | "warning" | "danger" | "neutral" } => {
  const s = p.status;
  if (!s || !s.consentAt) return { label: "Belum menyetujui", nada: "warning" };
  if (s.permission === "service_off") return { label: "Layanan lokasi mati", nada: "danger" };
  if (s.permission === "denied" || s.permission === "denied_forever") return { label: "Izin lokasi ditolak", nada: "danger" };
  if (!p.last) return { label: "Belum pernah mengirim", nada: "warning" };
  const menit = (Date.now() - new Date(p.last.recordedAt).getTime()) / 60_000;
  // Tiga interval terlewat berturut-turut: kemungkinan ponsel mati, offline, atau aplikasi ditutup paksa.
  if (pengaturan && pengaturan.mode === "always" && menit > pengaturan.intervalMinutes * 3) return { label: "Tidak melapor", nada: "warning" };
  return { label: "Aktif", nada: "success" };
};

export default function HalamanPemantauan() {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const superAdmin = saya?.role === "SUPER_ADMIN";
  // Simpan id, bukan objek: dialog selalu menerima `last` terbaru dari polling 60 detik.
  const [dipilihId, setDipilihId] = React.useState<string | null>(null);
  const tutupRiwayat = React.useCallback(() => setDipilihId(null), []);

  const posisi = useQuery({
    queryKey: ["pemantauan", "terakhir"],
    queryFn: async () => (await api.get<{ settings: PengaturanPemantauan; data: PosisiKaryawan[] }>("/location-tracking/latest")).data,
    enabled: superAdmin,
    refetchInterval: 60_000,
  });

  const pengaturan = posisi.data?.settings;
  const f = useForm<FormPengaturan>();
  React.useEffect(() => {
    if (pengaturan) f.reset({ enabled: pengaturan.enabled, mode: pengaturan.mode, intervalMinutes: pengaturan.intervalMinutes, retentionDays: pengaturan.retentionDays });
  }, [pengaturan, f]);

  const simpan = useMutation({
    mutationFn: async (v: FormPengaturan) =>
      api.put("/location-tracking/settings", { ...v, intervalMinutes: Number(v.intervalMinutes), retentionDays: Number(v.retentionDays) }),
    onSuccess: (_, v) => {
      // Hanya posisi terakhir: jejak yang sudah ter-cache jangan diambil ulang (tiap ambil = entri audit).
      qc.invalidateQueries({ queryKey: ["pemantauan", "terakhir"] });
      notifikasi.sukses(v.enabled ? "Pemantauan lokasi aktif" : "Pemantauan lokasi dimatikan", v.enabled ? `Ponsel karyawan mengirim lokasi tiap ${v.intervalMinutes} menit; riwayat disimpan ${v.retentionDays} hari.` : "Ponsel berhenti mengirim lokasi saat aplikasi berikutnya tersambung.");
    },
    onError: (e) => notifikasi.galat(e),
  });

  if (saya && !superAdmin) {
    return (
      <Card>
        <EmptyState icon={ShieldAlert} title="Hanya untuk Super Admin" description="Data lokasi karyawan hanya dapat dibuka oleh pemilik sistem." />
      </Card>
    );
  }

  const daftar = posisi.data?.data ?? [];
  const titikTerakhir: TitikPeta[] = daftar.flatMap((p) =>
    p.last
      ? [{
          id: p.employee.id,
          lat: p.last.latitude,
          lng: p.last.longitude,
          judul: p.employee.name,
          keterangan: `${formatRelatif(p.last.recordedAt)} · ±${Math.round(p.last.accuracyMeters ?? 0)} m${p.last.isMocked ? " · ditandai palsu" : ""}`,
          nada: keadaan(p, pengaturan).label === "Aktif" ? ("segar" as const) : ("lama" as const),
        }]
      : [],
  );
  const dipilih = dipilihId ? (daftar.find((p) => p.employee.id === dipilihId) ?? null) : null;

  const kolom: Kolom<PosisiKaryawan>[] = [
    {
      key: "karyawan",
      header: "Karyawan",
      primary: true,
      cell: (p) => (
        <div>
          <p className="font-medium">{p.employee.name}</p>
          <p className="text-xs text-muted">{p.employee.nik}{p.employee.department ? ` · ${p.employee.department}` : ""}</p>
        </div>
      ),
    },
    { key: "keadaan", header: "Keadaan", cell: (p) => { const k = keadaan(p, pengaturan); return <Badge tone={k.nada} dot>{k.label}</Badge>; } },
    {
      key: "terakhir",
      header: "Lokasi terakhir",
      cell: (p) =>
        p.last ? (
          <span className="inline-flex flex-col">
            <span>{formatRelatif(p.last.recordedAt)}</span>
            <a className="text-xs font-medium text-primary hover:underline" href={`https://www.google.com/maps?q=${p.last.latitude},${p.last.longitude}`} target="_blank" rel="noreferrer">
              {p.last.latitude.toFixed(5)}, {p.last.longitude.toFixed(5)}
            </a>
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "aksi",
      header: "",
      cell: (p) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDipilihId(p.employee.id)}
          disabled={!p.last}
          title={p.last ? "Lihat linimasa perjalanan" : "Belum pernah mengirim lokasi"}
          aria-haspopup="dialog"
        >
          <History className="h-4 w-4" aria-hidden /> Riwayat
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Pemantauan Lokasi" description="Lokasi karyawan dari aplikasi mobile — hanya dapat dibuka Super Admin, dan setiap pembukaan tercatat di jejak audit" />

      <Card>
        <CardHeader>
          <CardTitle>Pengaturan</CardTitle>
          <CardDescription>Karyawan melihat pemberitahuan di aplikasi sebelum pemantauan berjalan, dan notifikasi tetap selama berjalan.</CardDescription>
        </CardHeader>
        <form onSubmit={f.handleSubmit((v) => simpan.mutate(v))} className="grid gap-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-[auto_1fr_1fr_1fr_auto] lg:items-end" noValidate>
          <label className="flex items-center gap-2 text-sm font-medium lg:pb-2.5">
            <input type="checkbox" {...f.register("enabled")} className="h-4 w-4 accent-[var(--primary)]" /> Aktif
          </label>
          <Field label="Waktu pemantauan">
            <Select {...f.register("mode")}>
              <option value="always">24 jam</option>
              <option value="while_working">Hanya selama check-in</option>
            </Select>
          </Field>
          <Field label="Kirim lokasi tiap (menit)" error={f.formState.errors.intervalMinutes?.message}>
            <Input type="number" min={1} max={240} {...f.register("intervalMinutes", { valueAsNumber: true, min: { value: 1, message: "Minimal 1" }, max: { value: 240, message: "Maksimal 240" } })} />
          </Field>
          <Field label="Simpan riwayat (hari)" error={f.formState.errors.retentionDays?.message}>
            <Input type="number" min={1} max={365} {...f.register("retentionDays", { valueAsNumber: true, min: { value: 1, message: "Minimal 1" }, max: { value: 365, message: "Maksimal 365" } })} />
          </Field>
          <Button type="submit" loading={simpan.isPending} disabled={!pengaturan}>{!simpan.isPending && <Save className="h-4 w-4" aria-hidden />} Simpan</Button>
        </form>
        {pengaturan?.mode === "always" && pengaturan.enabled && (
          <div className="px-5 pb-5">
            <Alert tone="warning" title="Pemantauan 24 jam">
              Lokasi dikirim juga di luar jam kerja. Pastikan kebijakan perusahaan dan persetujuan karyawan sudah sesuai UU Pelindungan Data Pribadi; interval yang lebih jarang menghemat baterai ponsel.
            </Alert>
          </div>
        )}
      </Card>

      {posisi.isLoading ? (
        <SkeletonBaris />
      ) : !pengaturan?.enabled && titikTerakhir.length === 0 ? (
        <Card><EmptyState icon={Radar} title="Pemantauan lokasi belum aktif" description="Centang Aktif, atur intervalnya, lalu Simpan. Ponsel karyawan mulai mengirim setelah mereka membaca pemberitahuannya." /></Card>
      ) : (
        <>
          <Card className="p-3">
            {titikTerakhir.length ? <Peta titik={titikTerakhir} onRiwayat={setDipilihId} /> : <EmptyState icon={MapPinOff} title="Belum ada lokasi masuk" description="Ponsel karyawan belum mengirim lokasi. Periksa kolom Keadaan di bawah." />}
          </Card>
          <Card>
            <ResponsiveTable columns={kolom} rows={daftar} rowKey={(p) => p.employee.id} />
          </Card>
        </>
      )}

      {dipilih && (
        <DialogRiwayat key={dipilih.employee.id} karyawan={dipilih} keadaan={keadaan(dipilih, pengaturan)} pengaturan={pengaturan} onClose={tutupRiwayat} />
      )}
    </>
  );
}
