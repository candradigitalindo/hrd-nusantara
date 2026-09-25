"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { Crosshair, ExternalLink, MapPin, Pencil, Plus, Power, Printer, QrCode, RefreshCw, Save, X } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { PageHeader } from "@/components/ui/page-header";
import { Button, TombolAksi } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import type { Halaman, LokasiKerja } from "@/lib/types";

type FormLokasi = { name: string; address: string; koordinat: string; radiusMeters: number };

/**
 * "-6.2088, 106.8456" — bentuk yang disalin dari Google Maps (klik kanan
 * pada peta). Koma desimal ("-6,2088; 106,8456") juga diterima.
 */
const bacaKoordinat = (teks: string): { lat: number; lng: number } | null => {
  const m = teks.trim().match(/^(-?\d{1,3}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1].replace(",", "."));
  const lng = Number(m[2].replace(",", "."));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
};

const tautanPeta = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;

export default function HalamanLokasiKerja() {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const bolehBuat = punyaIzin(saya, "lokasi.buat");
  const bolehUbah = punyaIzin(saya, "lokasi.ubah");
  const [form, setForm] = React.useState<{ open: boolean; item: LokasiKerja | null }>({ open: false, item: null });
  const [qr, setQr] = React.useState<LokasiKerja | null>(null);
  const [putarQr, setPutarQr] = React.useState(false);
  const [mencari, setMencari] = React.useState(false);
  const [akurasi, setAkurasi] = React.useState<number | null>(null);

  const daftar = useQuery({
    queryKey: ["lokasi-kerja", "semua"],
    queryFn: async () => (await api.get<Halaman<LokasiKerja>>("/work-locations?limit=100&includeInactive=true")).data.data,
  });
  const gambarQr = useQuery({
    queryKey: ["lokasi-kerja", "qr", qr?.id],
    queryFn: async () => (await api.get<{ name: string; dataUrl: string }>(`/work-locations/${qr!.id}/qr`)).data,
    enabled: Boolean(qr),
  });

  const f = useForm<FormLokasi>();
  const koordinat = bacaKoordinat(useWatch({ control: f.control, name: "koordinat" }) ?? "");
  React.useEffect(() => {
    if (!form.open) return;
    const l = form.item;
    f.reset({ name: l?.name ?? "", address: l?.address ?? "", koordinat: l ? `${l.latitude}, ${l.longitude}` : "", radiusMeters: l?.radiusMeters ?? 100 });
  }, [form, f]);

  const bukaForm = (item: LokasiKerja | null) => {
    setAkurasi(null);
    setForm({ open: true, item });
  };

  const segarkan = () => qc.invalidateQueries({ queryKey: ["lokasi-kerja"] });

  const simpan = useMutation({
    mutationFn: async (v: FormLokasi) => {
      const k = bacaKoordinat(v.koordinat)!;
      const body = { name: v.name.trim(), address: v.address.trim() || undefined, latitude: k.lat, longitude: k.lng, radiusMeters: Number(v.radiusMeters) };
      return form.item ? api.put(`/work-locations/${form.item.id}`, body) : api.post("/work-locations", body);
    },
    onSuccess: () => {
      segarkan();
      notifikasi.sukses(form.item ? "Lokasi diperbarui" : "Lokasi ditambahkan", "Karyawan kini bisa presensi di lokasi ini.");
      setForm({ open: false, item: null });
    },
    onError: (e) => notifikasi.galat(e),
  });

  const ubahAktif = useMutation({
    mutationFn: async (l: LokasiKerja) => api.put(`/work-locations/${l.id}`, { isActive: !l.isActive }),
    onSuccess: (_, l) => { segarkan(); notifikasi.sukses(l.isActive ? "Lokasi dinonaktifkan" : "Lokasi diaktifkan", l.name); },
    onError: (e) => notifikasi.galat(e),
  });

  const putarUlang = useMutation({
    mutationFn: async (l: LokasiKerja) => api.post(`/work-locations/${l.id}/rotate-qr`, {}),
    onSuccess: () => {
      segarkan();
      setPutarQr(false);
      notifikasi.sukses("QR diperbarui", "Cetak dan tempel ulang di lokasi — QR lama tidak berlaku lagi.");
    },
    onError: (e) => notifikasi.galat(e),
  });

  const pakaiLokasiSaya = () => {
    if (!navigator.geolocation) return notifikasi.galat(new Error("Peramban ini tidak bisa membaca lokasi."));
    setMencari(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        f.setValue("koordinat", `${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`, { shouldValidate: true });
        setAkurasi(Math.round(p.coords.accuracy));
        setMencari(false);
      },
      (e) => {
        setMencari(false);
        notifikasi.galat(new Error(e.code === e.PERMISSION_DENIED ? "Izin lokasi ditolak peramban." : "Lokasi tidak bisa dibaca. Coba lagi di luar ruangan."));
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  };

  const cetak = () => {
    const g = gambarQr.data;
    if (!g) return;
    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) return;
    // Nama lokasi dimasukkan sebagai teks, bukan HTML.
    w.document.title = `QR Presensi · ${g.name}`;
    w.document.body.style.cssText = "font-family:sans-serif;text-align:center;padding:32px";
    const judul = w.document.createElement("h1");
    judul.textContent = g.name;
    const img = w.document.createElement("img");
    img.src = g.dataUrl;
    img.style.cssText = "width:360px;height:360px";
    const catatan = w.document.createElement("p");
    catatan.textContent = "Presensi HRD Nusantara — buka aplikasi, pilih Check-in, lalu Pindai QR.";
    w.document.body.append(judul, img, catatan);
    img.onload = () => w.print();
  };

  const tombolTambah = bolehBuat && (
    <Button onClick={() => bukaForm(null)}><Plus className="h-4 w-4" aria-hidden /> Lokasi</Button>
  );

  return (
    <>
      <PageHeader title="Lokasi Kerja" description="Titik presensi: karyawan hanya bisa check-in di dalam radius salah satu lokasi aktif" actions={tombolTambah} />

      {daftar.isLoading ? (
        <SkeletonBaris />
      ) : !daftar.data?.length ? (
        <Card>
          <EmptyState
            icon={MapPin}
            title="Belum ada lokasi kerja"
            description="Selama kosong, presensi GPS, wajah, maupun QR di aplikasi mobile selalu gagal. Tambahkan setiap outlet/kantor beserta koordinat dan radiusnya."
            action={tombolTambah}
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {daftar.data.map((l) => (
            <Card key={l.id} className="animate-fade-up">
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <CardTitle className="truncate">{l.name}</CardTitle>
                    {!l.isActive && <Badge tone="neutral">Nonaktif</Badge>}
                  </div>
                  <CardDescription className="line-clamp-2">{l.address ?? "Tanpa alamat"}</CardDescription>
                  <p className="mt-2 text-xs tabular-nums text-muted">{l.latitude}, {l.longitude} · radius {l.radiusMeters} m</p>
                  <a href={tautanPeta(l.latitude, l.longitude)} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Lihat di Google Maps
                  </a>
                </div>
                <div className="flex shrink-0 gap-1">
                  {l.qrSecret !== undefined && <TombolAksi icon={QrCode} label={`QR presensi ${l.name}`} onClick={() => setQr(l)} />}
                  {bolehUbah && <TombolAksi icon={Pencil} label={`Sunting ${l.name}`} onClick={() => bukaForm(l)} />}
                  {bolehUbah && <TombolAksi icon={Power} label={l.isActive ? `Nonaktifkan ${l.name}` : `Aktifkan ${l.name}`} tone={l.isActive ? "bahaya" : "netral"} onClick={() => ubahAktif.mutate(l)} />}
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={form.open}
        onClose={() => setForm({ open: false, item: null })}
        title={form.item ? "Sunting Lokasi Kerja" : "Tambah Lokasi Kerja"}
        footer={
          <>
            <Button variant="outline" onClick={() => setForm({ open: false, item: null })}><X className="h-4 w-4" aria-hidden /> Batal</Button>
            <Button form="form-lokasi" type="submit" loading={simpan.isPending}>{!simpan.isPending && <Save className="h-4 w-4" aria-hidden />} Simpan</Button>
          </>
        }
      >
        <form id="form-lokasi" onSubmit={f.handleSubmit((v) => simpan.mutate(v))} className="space-y-4" noValidate>
          <Field label="Nama lokasi" error={f.formState.errors.name?.message}>
            <Input {...f.register("name", { required: "Nama wajib diisi" })} placeholder="Outlet Sudirman" />
          </Field>
          <Field label="Alamat"><Input {...f.register("address")} placeholder="Jl. Jend. Sudirman No. 1, Jakarta" /></Field>
          <Field
            label="Koordinat (lintang, bujur)"
            error={f.formState.errors.koordinat?.message}
            hint="Di Google Maps: klik kanan titik lokasi, klik angka koordinatnya untuk menyalin, lalu tempel di sini."
          >
            <div className="flex gap-2">
              <Input
                {...f.register("koordinat", { validate: (v) => (bacaKoordinat(v) ? true : "Isi seperti -6.2088, 106.8456") })}
                placeholder="-6.2088, 106.8456"
                inputMode="decimal"
                className="tabular-nums"
              />
              <Button type="button" variant="outline" onClick={pakaiLokasiSaya} loading={mencari} className="shrink-0">
                {!mencari && <Crosshair className="h-4 w-4" aria-hidden />} Lokasi saya
              </Button>
            </div>
          </Field>
          {koordinat && (
            <p className="-mt-2 text-xs text-muted">
              {akurasi !== null && <>Terbaca dengan ketelitian ±{akurasi} m. </>}
              <a href={tautanPeta(koordinat.lat, koordinat.lng)} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                Periksa titiknya di Google Maps
              </a>
            </p>
          )}
          {akurasi !== null && akurasi > 50 && (
            <Alert tone="warning" title="Ketelitian lokasi rendah">
              Pembacaan dari perangkat ini meleset sampai ±{akurasi} m. Lebih baik salin koordinat dari Google Maps, atau baca ulang dari ponsel di lokasi.
            </Alert>
          )}
          <Field label="Radius presensi (meter)" error={f.formState.errors.radiusMeters?.message} hint="Karyawan harus berada dalam jarak ini dari titik di atas. 50–150 m wajar untuk satu gedung; GPS di dalam ruangan bisa meleset belasan meter.">
            <Input type="number" min={25} max={5000} {...f.register("radiusMeters", { valueAsNumber: true, min: { value: 25, message: "Minimal 25 m" }, max: { value: 5000, message: "Maksimal 5.000 m" } })} />
          </Field>
        </form>
      </Modal>

      <Modal
        open={Boolean(qr)}
        onClose={() => setQr(null)}
        title={`QR Presensi · ${qr?.name ?? ""}`}
        description="Cetak lalu tempel di titik presensi. Karyawan memindainya dari menu Check-in → Pindai QR; koordinatnya tetap diperiksa."
        footer={
          <>
            {bolehUbah && <Button variant="outline" onClick={() => setPutarQr(true)}><RefreshCw className="h-4 w-4" aria-hidden /> Buat QR baru</Button>}
            <Button onClick={cetak} disabled={!gambarQr.data}><Printer className="h-4 w-4" aria-hidden /> Cetak</Button>
          </>
        }
      >
        <div className="flex justify-center">
          {gambarQr.data ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL dari server, bukan aset statis
            <img src={gambarQr.data.dataUrl} alt={`QR presensi ${qr?.name}`} className="h-64 w-64" />
          ) : (
            <div className="h-64 w-64 animate-pulse rounded-lg bg-surface-2" />
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={putarQr}
        onClose={() => setPutarQr(false)}
        onConfirm={() => qr && putarUlang.mutate(qr)}
        loading={putarUlang.isPending}
        danger
        title="Buat QR baru?"
        description="QR yang sudah ditempel tidak berlaku lagi — pakai ini bila QR lama bocor atau difoto orang. Cetak dan tempel ulang setelahnya."
        confirmLabel="Buat QR baru"
        confirmIcon={RefreshCw}
      />
    </>
  );
}
