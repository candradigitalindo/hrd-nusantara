"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Info, Loader2, MapPinOff, RefreshCw, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { api, ambilGalat } from "@/lib/api";
import { cn, inisial } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatJam, formatJarak, geserTanggal, labelTanggal, susunLinimasa, tanggalWIB, type Linimasa } from "@/lib/linimasa";
import type { Halaman, LokasiKerja, PengaturanPemantauan, PosisiKaryawan, PresensiBerlokasi, TitikPantauan } from "@/lib/types";
import PanelLinimasa, { KakiPanel, KerangkaPanel, susunTemuan, type TemuanTampil } from "./panel-linimasa";
import type { FokusPeta } from "./peta-linimasa";
import { NavigasiTanggal, tanpaTahun } from "./navigasi-tanggal";

// Leaflet butuh `window`: peta hanya dirender di peramban.
const PetaLinimasa = dynamic(() => import("./peta-linimasa"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-surface-2" />,
});

export interface PropsDialogRiwayat {
  karyawan: PosisiKaryawan;
  /** Label dan nada keadaan yang sama dengan kolom Keadaan di tabel. */
  keadaan: { label: string; nada: "success" | "warning" | "danger" | "neutral" };
  pengaturan: PengaturanPemantauan | undefined;
  /** Tanggal yang dibuka pertama ("YYYY-MM-DD" WIB) — tanggal yang sedang dilihat di halaman; bawaan hari ini. */
  tanggalAwal?: string;
  onClose: () => void;
}

const JAKARTA: [number, number] = [-6.2, 106.816];

/** Langganan media query tanpa state + effect. */
const useMedia = (kueri: string) =>
  React.useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(kueri);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(kueri).matches,
    () => false,
  );

type NadaBanner = "info" | "peringatan";
const Banner = ({ nada, ikon: Ikon, children, aksi, putar }: { nada: NadaBanner; ikon: LucideIcon; children: React.ReactNode; aksi?: React.ReactNode; putar?: boolean }) => (
  <div
    role="status"
    className={cn(
      "flex items-start gap-2 rounded-xl border px-3 py-2 text-xs leading-snug",
      nada === "info" ? "border-info/30 bg-info-soft text-info" : "border-warning/30 bg-warning-soft text-warning",
    )}
  >
    <Ikon className={cn("mt-px h-3.5 w-3.5 shrink-0", putar && "animate-spin motion-reduce:animate-none")} aria-hidden />
    <span className="min-w-0 flex-1">{children}</span>
    {aksi}
  </div>
);

const SELEKTOR_FOKUS = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Riwayat lokasi seorang karyawan dalam bentuk linimasa ala Google Maps:
 * peta (garis + titik) dan daftar singgah/perjalanan/jeda yang saling
 * tersinkron. Layar penuh di ponsel, kotak dua kolom di layar lebar.
 *
 * Setiap pengambilan /trail tercatat sebagai satu entri audit, jadi: tanpa
 * prefetch hari lain, tanpa polling, tanggal di-debounce 400 ms, dan hasilnya
 * di-cache selama sesi. Hari ini hanya diperbarui lewat tombol Muat ulang.
 */
export default function DialogRiwayatLokasi({ karyawan, keadaan, pengaturan, tanggalAwal, onClose }: PropsDialogRiwayat) {
  const id = karyawan.employee.id;
  const idJudul = React.useId();
  const idTanggal = React.useId();
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const judulRef = React.useRef<HTMLHeadingElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const perluRef = React.useRef<HTMLElement>(null);
  const barisRef = React.useRef(new Map<string, HTMLElement>());

  const kurangiGerak = useMedia("(prefers-reduced-motion: reduce)");
  const layarLebar = useMedia("(min-width: 768px), (orientation: landscape) and (max-height: 520px)");

  // "Sekarang" hanya maju per menit (dan hanya saat melihat hari ini), supaya linimasa tidak dihitung ulang tiap render.
  const [sekarang, setSekarang] = React.useState(() => Date.now());
  const [hariIni, setHariIni] = React.useState(() => tanggalWIB(Date.now()));
  React.useEffect(() => {
    // String yang sama tidak memicu render: praktis hanya berganti sekali, saat tengah malam WIB.
    const t = window.setInterval(() => setHariIni(tanggalWIB(Date.now())), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const retensi = pengaturan?.retentionDays ?? 30;
  const minTanggal = geserTanggal(hariIni, -retensi);
  const batasi = React.useCallback((t: string) => (t < minTanggal ? minTanggal : t > hariIni ? hariIni : t), [minTanggal, hariIni]);

  // Bawaan: tanggal yang sedang dilihat di halaman (yang bawaannya hari ini).
  const [tanggal, setTanggal] = React.useState(() => {
    const awal = tanggalAwal ?? hariIni;
    return awal < minTanggal ? minTanggal : awal > hariIni ? hariIni : awal;
  });
  const [tanggalTertunda, setTanggalTertunda] = React.useState(tanggal);
  React.useEffect(() => {
    if (tanggal === tanggalTertunda) return;
    const t = window.setTimeout(() => setTanggalTertunda(tanggal), 400);
    return () => window.clearTimeout(t);
  }, [tanggal, tanggalTertunda]);

  const [dipilihId, setDipilihId] = React.useState<string | null>(null);
  const [sorotId, setSorotId] = React.useState<string | null>(null);
  const [fokus, setFokus] = React.useState<FokusPeta | null>(null);
  const [petaBesar, setPetaBesar] = React.useState(false);
  /** Bertambah setiap pilihan dibatalkan dari daftar/pita/Esc: peta kembali memaskan seluruh hari. */
  const [paskanKunci, setPaskanKunci] = React.useState(0);

  const jejak = useQuery({
    queryKey: ["pemantauan", "jejak", id, tanggalTertunda],
    // Sengaja tanpa `signal`: membatalkan permintaan yang sudah sampai server tetap meninggalkan entri
    // audit, lalu React Query mengirim ulang (pasang–lepas StrictMode, dialog ditutup–dibuka cepat)
    // = audit ganda. Tombol muat ulang dinonaktifkan selama mengambil, jadi tidak perlu dibatalkan.
    queryFn: async ({ queryKey }) => {
      const tgl = String(queryKey[3]);
      const r = await api.get<{ data: TitikPantauan[] }>(`/location-tracking/employees/${id}/trail?date=${tgl}`);
      return { tanggal: tgl, titik: r.data.data };
    },
    // Setiap fetch = satu entri audit: jangan pernah mengambil ulang diam-diam.
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // Data lama hanya boleh tampil sementara untuk karyawan yang sama.
    placeholderData: (sebelum, kueri) => (kueri?.queryKey[2] === id ? sebelum : undefined),
  });

  const presensi = useQuery({
    queryKey: ["presensi", "linimasa", id, tanggalTertunda],
    queryFn: async ({ queryKey, signal }) => {
      const tgl = String(queryKey[3]);
      // D−1..D: pulang shift malam yang terjadi pada tanggal D ikut terambil.
      const r = await api.get<Halaman<PresensiBerlokasi>>(`/attendance?employeeId=${id}&startDate=${geserTanggal(tgl, -1)}&endDate=${tgl}&limit=20`, { signal });
      return { tanggal: tgl, data: r.data.data };
    },
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    placeholderData: (sebelum, kueri) => (kueri?.queryKey[2] === id ? sebelum : undefined),
  });

  const lokasi = useQuery({
    queryKey: ["lokasi-kerja", "semua"],
    queryFn: async () => (await api.get<Halaman<LokasiKerja>>("/work-locations?limit=100&includeInactive=true")).data.data,
    staleTime: 5 * 60_000,
  });

  const dataJejak = jejak.data;
  const tanggalData = dataJejak?.tanggal ?? null;
  const hariIniData = tanggalData === hariIni;
  const presensiData = presensi.data && presensi.data.tanggal === tanggalData ? presensi.data.data : null;
  // Titik mentah terakhir (termasuk yang nanti disaring) — pembanding yang adil untuk `last` dari /latest.
  const terakhirMentah = React.useMemo(() => (dataJejak ? dataJejak.titik.reduce((m, t) => Math.max(m, Date.parse(t.recordedAt)), 0) : 0), [dataJejak]);
  const tLast = karyawan.last ? Date.parse(karyawan.last.recordedAt) : null;
  const tanggalLast = tLast != null ? tanggalWIB(tLast) : null;
  const posisiBaru = hariIniData && tLast != null && tLast > terakhirMentah + 30_000 && tanggalLast === hariIni ? tLast : null;
  // Data hari ini adalah potret saat diambil. Bila ponsel ternyata sudah melapor lagi sesudahnya,
  // susun per waktu pengambilan supaya tidak muncul "Belum ada data baru"/"Tidak melapor" yang keliru.
  const sekarangEfektif = posisiBaru != null ? jejak.dataUpdatedAt : Math.max(sekarang, jejak.dataUpdatedAt);
  const intervalMenit = pengaturan?.intervalMinutes ?? 5;
  const mode = pengaturan?.mode ?? "always";

  React.useEffect(() => {
    if (!hariIniData) return;
    const t = window.setInterval(() => setSekarang(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, [hariIniData]);

  const hasil = React.useMemo((): { linimasa: Linimasa | null; galat: string | null } => {
    if (!dataJejak) return { linimasa: null, galat: null };
    try {
      return {
        linimasa: susunLinimasa({
          titik: dataJejak.titik,
          lokasiKerja: lokasi.data ?? [],
          presensi: presensiData ?? [],
          tanggal: dataJejak.tanggal,
          sekarang: sekarangEfektif,
          intervalMenit,
          mode,
        }),
        galat: null,
      };
    } catch (e) {
      return { linimasa: null, galat: e instanceof Error ? e.message : String(e) };
    }
  }, [dataJejak, lokasi.data, presensiData, sekarangEfektif, intervalMenit, mode]);
  const linimasa = hasil.linimasa;
  const temuan = React.useMemo(() => (linimasa ? susunTemuan(linimasa) : []), [linimasa]);

  // ---------------------------------------------------------------- aksi

  const gantiTanggal = React.useCallback(
    (t: string) => {
      setTanggal(batasi(t));
      setDipilihId(null);
      setSorotId(null);
      setFokus(null);
    },
    [batasi],
  );
  const geser = React.useCallback((n: number) => gantiTanggal(geserTanggal(tanggal, n)), [gantiTanggal, tanggal]);

  const onPilih = React.useCallback((segmenId: string | null) => {
    setDipilihId(segmenId);
    setFokus(null);
  }, []);
  // Batal pilih dari daftar, pita, atau Esc mengembalikan peta ke seluruh hari (seperti Google Timeline).
  // Klik area kosong peta (onPilih(null) dari peta) sengaja tidak: pengguna sedang menjelajah peta.
  const batalPilih = React.useCallback(() => {
    setDipilihId(null);
    setFokus(null);
    setPaskanKunci((n) => n + 1);
  }, []);
  const onPilihDaftar = React.useCallback((segmenId: string | null) => (segmenId ? onPilih(segmenId) : batalPilih()), [onPilih, batalPilih]);
  const onSorot = React.useCallback((segmenId: string | null) => setSorotId(segmenId), []);
  const onTemuan = React.useCallback((t: TemuanTampil) => {
    setDipilihId(t.segmenId);
    if (t.lat != null && t.lng != null) {
      const { lat, lng } = t;
      setFokus((f) => ({ lat, lng, alasan: t.alasanTitik, t: t.t, pasangan: t.pasangan, jarakM: t.jarakM, kunci: (f?.kunci ?? 0) + 1 }));
    } else setFokus(null);
  }, []);
  const daftarkan = React.useCallback((segmenId: string, el: HTMLElement | null) => {
    if (el) barisRef.current.set(segmenId, el);
    else barisRef.current.delete(segmenId);
  }, []);
  const muatUlang = () => {
    void jejak.refetch();
    void presensi.refetch();
  };
  const kePerluDiperiksa = () => perluRef.current?.scrollIntoView({ block: "start", behavior: kurangiGerak ? "auto" : "smooth" });

  // Baris terpilih (mis. dari klik penanda peta) digulir ke dalam pandangan. Hanya panel daftar yang
  // digeser (scrollIntoView ikut menggeser leluhur), dan baru setelah dua frame: guliran halus yang
  // dimulai bersamaan dengan rincian baris yang baru mengembang dibatalkan Chrome (terbukti di ponsel).
  React.useEffect(() => {
    if (!dipilihId) return;
    let f2 = 0;
    const f1 = window.requestAnimationFrame(() => {
      f2 = window.requestAnimationFrame(() => {
        const el = barisRef.current.get(dipilihId);
        const panel = panelRef.current;
        if (!el || !panel) return;
        const r = el.getBoundingClientRect();
        const p = panel.getBoundingClientRect();
        const sela = 8;
        let geser = 0;
        if (r.top < p.top + sela) geser = r.top - p.top - sela;
        // Baris lebih tinggi dari panel: utamakan bagian atasnya.
        else if (r.bottom > p.bottom - sela) geser = Math.min(r.bottom - p.bottom + sela, r.top - p.top - sela);
        if (geser) panel.scrollBy({ top: geser, behavior: kurangiGerak ? "auto" : "smooth" });
      });
    });
    return () => {
      window.cancelAnimationFrame(f1);
      window.cancelAnimationFrame(f2);
    };
  }, [dipilihId, kurangiGerak]);

  // Data tanggal baru: daftar kembali ke atas (hari ini: ke bagian terbaru).
  React.useEffect(() => {
    const el = panelRef.current;
    if (!el || !tanggalData) return;
    el.scrollTop = 0;
  }, [tanggalData]);

  // Fokus awal ke judul, kunci gulir body, dan kembalikan fokus ke pemicu saat ditutup.
  React.useEffect(() => {
    const pemicu = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    judulRef.current?.focus({ preventScroll: true });
    const sebelumnya = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = sebelumnya;
      if (pemicu && document.contains(pemicu)) pemicu.focus({ preventScroll: true });
    };
  }, []);

  // Keyboard: Esc berlapis (batal pilih → tutup), ←/→ ganti hari, Tab dibungkus lunak di tepi dialog.
  React.useEffect(() => {
    const tangani = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const aktif = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (e.key === "Escape") {
        e.preventDefault();
        if (dipilihId || fokus) batalPilih();
        else onClose();
        return;
      }
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (aktif?.closest("input, select, textarea, [contenteditable='true'], .leaflet-container")) return;
        e.preventDefault();
        if (aktif && panelRef.current?.contains(aktif)) judulRef.current?.focus({ preventScroll: true });
        geser(e.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const semua = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(SELEKTOR_FOKUS)).filter((el) => el.getClientRects().length > 0);
        if (!semua.length) return;
        const pertama = semua[0];
        const terakhir = semua[semua.length - 1];
        if (!aktif || !dialogRef.current.contains(aktif)) {
          e.preventDefault();
          pertama.focus();
        } else if (e.shiftKey && (aktif === pertama || aktif === judulRef.current)) {
          e.preventDefault();
          terakhir.focus();
        } else if (!e.shiftKey && aktif === terakhir) {
          e.preventDefault();
          pertama.focus();
        }
      }
    };
    document.addEventListener("keydown", tangani);
    return () => document.removeEventListener("keydown", tangani);
  }, [dipilihId, fokus, geser, onClose, batalPilih]);

  // ---------------------------------------------------------------- turunan tampilan

  const nama = karyawan.employee.name;
  const menunggu = tanggal !== tanggalData;
  const memuatUlang = !menunggu && (jejak.isFetching || (presensi.isFetching && !presensiData));
  const galatJejak = jejak.isError && !dataJejak;
  const kosong = linimasa != null && linimasa.ringkasan.titik.total === 0 && linimasa.presensi.length === 0;
  const labelMemuat = memuatUlang ? "Memuat ulang…" : `Memuat ${tanpaTahun(tanggal)}…`;

  const pengumuman = menunggu
    ? `Memuat riwayat ${labelTanggal(tanggal, "panjang")}…`
    : linimasa
      ? `${linimasa.ringkasan.jumlahSinggah} singgah, ${linimasa.ringkasan.jumlahPerjalanan} perjalanan, ${formatJarak(linimasa.ringkasan.jarakM)}`
      : "";

  const banner = (
    <>
      {memuatUlang && (
        <Banner nada="info" ikon={Loader2} putar>
          {hariIniData ? "Memuat ulang riwayat hari ini…" : "Memuat presensi…"}
        </Banner>
      )}
      {posisiBaru != null && !memuatUlang && (
        <Banner
          nada="info"
          ikon={Info}
          aksi={
            <button type="button" onClick={muatUlang} disabled={jejak.isFetching} className="shrink-0 font-semibold underline-offset-2 hover:underline disabled:opacity-60">
              Muat ulang
            </button>
          }
        >
          Ada posisi baru {formatJam(posisiBaru)} yang belum masuk linimasa.
        </Banner>
      )}
      {linimasa?.ringkasan.akurasiLonggar && (
        <Banner nada="peringatan" ikon={TriangleAlert}>
          Akurasi lokasi rendah sepanjang hari — tempat dan jarak hanya perkiraan.
        </Banner>
      )}
      {presensi.isError && (
        <Banner
          nada="peringatan"
          ikon={TriangleAlert}
          aksi={
            <button type="button" onClick={() => void presensi.refetch()} className="shrink-0 font-semibold underline-offset-2 hover:underline">
              Coba lagi
            </button>
          }
        >
          Presensi tidak dapat dimuat — linimasa ditampilkan tanpa presensi.
        </Banner>
      )}
      {lokasi.isError && (
        <Banner nada="peringatan" ikon={TriangleAlert}>
          Lokasi kerja tidak dapat dimuat — tempat tidak dicocokkan dengan lokasi kerja.
        </Banner>
      )}
      {pengaturan && !pengaturan.enabled && (
        <Banner nada="info" ikon={Info}>
          Pemantauan sedang nonaktif — riwayat lama tetap bisa dilihat sampai masa simpannya habis.
        </Banner>
      )}
      {tanggal === minTanggal && (
        <Banner nada="info" ikon={Info}>
          Riwayat sebelum {labelTanggal(minTanggal, "ringkas")} sudah terhapus otomatis (masa simpan {retensi} hari).
        </Banner>
      )}
    </>
  );

  const deskripsiKosong = !pengaturan?.enabled
    ? "Pemantauan lokasi sedang nonaktif."
    : karyawan.status?.permission === "denied" || karyawan.status?.permission === "denied_forever"
      ? "Izin lokasi di ponsel karyawan saat ini ditolak."
      : karyawan.status?.permission === "service_off"
        ? "Layanan lokasi di ponsel karyawan saat ini mati."
        : mode === "while_working"
          ? "Mode “Hanya selama check-in”: lokasi hanya dikirim saat presensi terbuka, dan tidak ada presensi pada tanggal ini."
          : "Ponsel tidak mengirim lokasi pada tanggal ini. Penyebab umum: aplikasi dihentikan sistem, ponsel mati, atau izin lokasi.";

  let isi: React.ReactNode;
  if (galatJejak) {
    isi = (
      <div className="space-y-3 p-4">
        <Alert
          tone="danger"
          title="Riwayat lokasi tidak dapat dimuat"
          action={
            <Button size="sm" variant="outline" onClick={() => void jejak.refetch()} loading={jejak.isFetching}>
              <RefreshCw className="h-4 w-4" aria-hidden /> Coba lagi
            </Button>
          }
        >
          {ambilGalat(jejak.error).pesan}
        </Alert>
      </div>
    );
  } else if (hasil.galat) {
    isi = (
      <div className="p-4">
        <Alert tone="danger" title="Linimasa tidak dapat disusun">
          {hasil.galat}
        </Alert>
      </div>
    );
  } else if (!linimasa) {
    isi = <KerangkaPanel />;
  } else if (kosong) {
    isi = (
      <div className={cn("space-y-3 px-4 pt-4 transition-opacity", menunggu && "opacity-60")}>
        {banner}
        <EmptyState
          icon={MapPinOff}
          title={`Tidak ada lokasi pada ${labelTanggal(tanggalData ?? tanggal, "panjang")}`}
          description={deskripsiKosong}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" variant="outline" onClick={() => geser(-1)} disabled={tanggal <= minTanggal}>
                <ChevronLeft className="h-4 w-4" aria-hidden /> Hari sebelumnya
              </Button>
              {tanggalLast && tanggalLast !== tanggal && tanggalLast >= minTanggal && (
                <Button size="sm" variant="outline" onClick={() => gantiTanggal(tanggalLast)}>
                  Ke data terakhir ({tanpaTahun(tanggalLast)})
                </Button>
              )}
            </div>
          }
        />
      </div>
    );
  } else {
    isi = (
      <div className={cn("transition-opacity", menunggu && "pointer-events-none opacity-60")}>
        <PanelLinimasa
          linimasa={linimasa}
          temuan={temuan}
          labelTanggal={labelTanggal(linimasa.tanggal, "panjang")}
          mode={mode}
          dipilihId={dipilihId}
          sorotId={sorotId}
          onPilih={onPilihDaftar}
          onSorot={onSorot}
          onTemuan={onTemuan}
          daftarkan={daftarkan}
          refPerluDiperiksa={perluRef}
          onKePerluDiperiksa={kePerluDiperiksa}
          banner={banner}
        />
      </div>
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="presentation">
      <div className="absolute inset-0 hidden bg-black/50 backdrop-blur-[2px] md:block pendek:hidden" onClick={onClose} aria-hidden />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idJudul}
        aria-describedby={idTanggal}
        className={cn(
          "relative flex h-dvh w-full flex-col overflow-hidden bg-surface animate-fade-up",
          "md:h-[min(900px,calc(100dvh-32px))] md:w-[min(1320px,calc(100vw-32px))] md:rounded-2xl md:border md:border-border md:shadow-2xl",
          "pendek:h-dvh pendek:w-full pendek:rounded-none pendek:border-0",
        )}
      >
        <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 md:flex-nowrap md:gap-x-4 md:px-5 md:py-3 pendek:flex-nowrap pendek:py-1.5">
          <div className="order-1 flex min-w-0 flex-1 items-center gap-3 md:order-none pendek:order-none">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary pendek:hidden" aria-hidden>
              {inisial(nama)}
            </span>
            <div className="min-w-0">
              <h2 id={idJudul} ref={judulRef} tabIndex={-1} className="truncate text-[15px] leading-tight font-semibold outline-none md:text-base">
                <span className="sr-only">Riwayat lokasi · </span>
                {nama}
              </h2>
              <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
                <span className="truncate">
                  {karyawan.employee.nik}
                  {karyawan.employee.department ? ` · ${karyawan.employee.department}` : ""}
                </span>
                <Badge tone={keadaan.nada} dot className="shrink-0 px-2 py-0 text-[11px]">
                  {keadaan.label}
                </Badge>
              </p>
            </div>
          </div>

          <NavigasiTanggal
            tanggal={tanggal}
            hariIni={hariIni}
            min={minTanggal}
            onGanti={gantiTanggal}
            labelInput="Tanggal riwayat"
            judulMin={`Riwayat sebelum ${labelTanggal(minTanggal, "ringkas")} sudah terhapus (masa simpan ${retensi} hari)`}
            idLabel={idTanggal}
            className="order-3 w-full md:order-none md:w-auto pendek:order-none pendek:w-auto"
          />
          <div className="order-2 flex shrink-0 items-center gap-1 md:order-none pendek:order-none">
            {tanggal === hariIni && tanggalTertunda === hariIni && hariIniData && (
              <Button
                variant="ghost"
                size="icon"
                onClick={muatUlang}
                disabled={jejak.isFetching}
                title="Ambil ulang riwayat hari ini — tercatat di jejak audit"
                aria-label="Muat ulang riwayat hari ini"
              >
                <RefreshCw className={cn("h-[18px] w-[18px]", jejak.isFetching && "animate-spin motion-reduce:animate-none")} aria-hidden />
              </Button>
            )}
            <span className="mx-1 hidden h-6 w-px bg-border md:block" aria-hidden />
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Tutup">
              <X className="h-5 w-5" aria-hidden />
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[340px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] lg:grid-cols-[380px_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)] pendek:grid pendek:grid-cols-[300px_minmax(0,1fr)] pendek:grid-rows-[minmax(0,1fr)]">
          <div
            className={cn(
              "relative isolate order-first shrink-0 border-b border-border transition-[height] duration-300 motion-reduce:transition-none",
              "md:order-last md:h-auto md:border-b-0 pendek:order-last pendek:h-auto pendek:border-b-0",
              petaBesar ? "h-[min(72dvh,640px)]" : "h-[clamp(220px,42dvh,380px)]",
            )}
          >
            <PetaLinimasa
              linimasa={linimasa}
              kunciData={`${id}|${tanggalData ?? ""}`}
              lokasiKerja={lokasi.data ?? []}
              dipilihId={dipilihId}
              sorotId={sorotId}
              fokus={fokus}
              paskanKunci={paskanKunci}
              pusatAwal={karyawan.last ? [karyawan.last.latitude, karyawan.last.longitude] : JAKARTA}
              memuat={menunggu || memuatUlang}
              labelMemuat={labelMemuat}
              kurangiGerak={kurangiGerak}
              besar={layarLebar ? null : petaBesar}
              onBesar={() => setPetaBesar((v) => !v)}
              onPilih={onPilih}
              onSorot={onSorot}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col md:border-r md:border-border pendek:border-r pendek:border-border">
            <div ref={panelRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-busy={menunggu || memuatUlang}>
              {isi}
              {/* Ponsel (dan lanskap pendek): kaki ikut bergulir supaya tidak memakan tinggi layar. */}
              <KakiPanel className="px-4 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))] md:hidden pendek:flex" />
            </div>
            <div className="hidden shrink-0 border-t border-border px-4 py-2.5 md:block pendek:hidden">
              <KakiPanel />
            </div>
          </div>
        </div>

        <p className="sr-only" aria-live="polite">
          {pengumuman}
        </p>
      </div>
    </div>,
    document.body,
  );
}
