"use client";

import * as React from "react";
import {
  Building2,
  Car,
  Check,
  CircleDashed,
  Copy,
  ExternalLink,
  Footprints,
  Info,
  LogIn,
  LogOut,
  MapPinned,
  Navigation,
  Plane,
  Route,
  ShieldAlert,
  ShieldCheck,
  Signal,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { BLOKIR_INTEGRITAS, LABEL_INTEGRITAS, cn } from "@/lib/utils";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatDurasi,
  formatDurasiPanjang,
  formatJam,
  formatJarak,
  formatKecepatan,
  LABEL_MODA,
  type Jeda,
  type Linimasa,
  type Moda,
  type NadaTemuan,
  type PeristiwaPresensi,
  type Perjalanan,
  type Segmen,
  type Singgah,
  type Temuan,
  type Terlihat,
} from "@/lib/linimasa";
import PitaHari from "./pita-hari";

// ---------------------------------------------------------------- label bersama (juga dipakai peta)

const IKON_MODA: Record<Moda, LucideIcon> = { jalan: Footprints, kendaraan: Car, tidak_diketahui: Navigation, jauh: Plane };

const LABEL_METODE: Record<string, string> = { gps: "GPS", qr: "QR", face: "Wajah" };

/** Jam selesai; batas akhir hari ditulis "24:00", bukan "00:00". */
export const jamAkhir = (s: { selesai: number }) => formatJam(s.selesai, true);

export const rentangJam = (s: { mulai: number; selesai: number; berlangsung?: boolean }) =>
  s.selesai - s.mulai < 60_000 ? formatJam(s.mulai) : `${formatJam(s.mulai)}–${s.berlangsung ? "sekarang" : jamAkhir(s)}`;

const teksCocok = (p: PeristiwaPresensi): string => {
  if (p.cocok === "sesuai") return `posisi sesuai${p.jarakKeJejakM != null ? ` (${formatJarak(p.jarakKeJejakM)})` : ""}`;
  if (p.cocok === "tidak_sesuai") return `${p.jarakKeJejakM != null ? formatJarak(p.jarakKeJejakM) : "jauh"} dari jejak`;
  if (p.cocok === "tanpa_titik") return "tanpa titik pemantauan di sekitarnya";
  return "presensi tanpa koordinat";
};

/** "Masuk 07:42 · GPS · posisi sesuai (15 m)" — untuk tooltip peta dan detail. */
export const labelPeristiwa = (p: PeristiwaPresensi) =>
  [`${p.jenis === "masuk" ? "Masuk" : "Pulang"} ${formatJam(p.t)}`, p.metode ? (LABEL_METODE[p.metode] ?? p.metode) : null, teksCocok(p)].filter(Boolean).join(" · ");

// ---------------------------------------------------------------- temuan

/** Temuan modul + tanda integritas presensi yang dibaca UI dari LABEL_INTEGRITAS. */
export interface TemuanTampil extends Omit<Temuan, "kode"> {
  kode: Temuan["kode"] | "integritas";
  /** Alasan saring titik yang difokuskan peta saat temuan diklik. */
  alasanTitik: "palsu" | "janggal" | "akurasi" | null;
  t: number | null;
  /** Titik palsu: posisi jejak sebenarnya pada waktu itu, dan jaraknya. */
  pasangan: [number, number] | null;
  jarakM: number | null;
}

const PERINGKAT: Record<NadaTemuan, number> = { danger: 0, warning: 1, info: 2 };

export const susunTemuan = (l: Linimasa): TemuanTampil[] => {
  const segmenDari = (id: string) => l.segmen.find((s) => s.presensi.some((p) => p.id === id))?.id ?? null;
  // Jejak terdekat (dalam ±30 mnt) dari waktu titik palsu: "ponsel mengaku di sini, jejaknya di sana".
  const posisiJejak = (t: number): [number, number] | null => {
    let terbaik: [number, number] | null = null;
    let selisih = 30 * 60_000;
    for (const x of l.titik) {
      const d = Math.abs(x.t - t);
      if (d <= selisih) {
        selisih = d;
        terbaik = [x.lat, x.lng];
      }
    }
    return terbaik;
  };
  const dariModul: TemuanTampil[] = l.temuan.map((t) => {
    const alasanTitik = t.kode === "palsu" || t.kode === "janggal" || t.kode === "akurasi" ? t.kode : null;
    const titik = alasanTitik && t.lat != null ? l.disaring.find((d) => d.lat === t.lat && d.lng === t.lng) : undefined;
    const pasangan = titik && alasanTitik === "palsu" ? posisiJejak(titik.t) : null;
    return { ...t, alasanTitik, t: titik?.t ?? null, pasangan, jarakM: pasangan ? (titik?.jarakDariJejakM ?? null) : null };
  });
  // Tanda integritas melekat pada catatan presensi (gabungan masuk & pulang), jadi satu temuan per
  // catatan — bukan per peristiwa, yang menggandakannya dan bisa salah menyebut "masuk".
  const perCatatan = new Map<string, PeristiwaPresensi[]>();
  for (const p of l.presensi) if (p.tandaIntegritas.length > 0) perCatatan.set(p.presensiId, [...(perCatatan.get(p.presensiId) ?? []), p]);
  const integritas: TemuanTampil[] = [...perCatatan.values()].map((ps) => {
    const p = ps[0];
    const berkoordinat = ps.find((x) => x.lat != null && x.lng != null);
    return {
      id: `integritas-${p.presensiId}`,
      kode: "integritas" as const,
      nada: p.tandaIntegritas.some((k) => BLOKIR_INTEGRITAS.has(k)) ? ("danger" as const) : ("warning" as const),
      judul: ps.length > 1 ? `Presensi ${formatJam(ps[0].t)}–${formatJam(ps[ps.length - 1].t)} ditandai` : `Presensi ${p.jenis} ${formatJam(p.t)} ditandai`,
      rincian: p.tandaIntegritas.map((k) => LABEL_INTEGRITAS[k] ?? k).join(" · "),
      segmenId: segmenDari(p.id),
      lat: berkoordinat?.lat ?? null,
      lng: berkoordinat?.lng ?? null,
      alasanTitik: null,
      t: p.t,
      pasangan: null,
      jarakM: null,
    };
  });
  // Urutan modul (nada lalu waktu) dipertahankan; sort stabil hanya menyisipkan per nada.
  return [...dariModul, ...integritas].sort((a, b) => PERINGKAT[a.nada] - PERINGKAT[b.nada]);
};

const GAYA_TEMUAN: Record<NadaTemuan, { kelas: string; ikon: LucideIcon }> = {
  danger: { kelas: "bg-danger-soft text-danger", ikon: ShieldAlert },
  warning: { kelas: "bg-warning-soft text-warning", ikon: TriangleAlert },
  info: { kelas: "bg-info-soft text-info", ikon: Info },
};

// ---------------------------------------------------------------- potongan kecil

const JudulBagian = ({ children, id, aksi }: { children: React.ReactNode; id?: string; aksi?: React.ReactNode }) => (
  <div className="mb-2 flex items-center justify-between gap-2">
    <h3 id={id} className="text-[11px] font-semibold tracking-wider text-muted uppercase">
      {children}
    </h3>
    {aksi}
  </div>
);

type NadaChip = "netral" | "kerja" | "presensi" | "bahaya" | "peringatan" | "info" | "sukses";

const KELAS_CHIP: Record<NadaChip, string> = {
  netral: "bg-surface-2 text-muted group-data-[terpilih=true]/baris:bg-surface",
  kerja: "bg-primary-soft text-primary group-data-[terpilih=true]/baris:bg-surface",
  presensi: "bg-jenis-violet-soft text-jenis-violet",
  bahaya: "bg-danger-soft text-danger",
  peringatan: "bg-warning-soft text-warning",
  info: "bg-info-soft text-info",
  sukses: "bg-success-soft text-success",
};

const Chip = ({ nada = "netral", ikon: Ikon, children, title }: { nada?: NadaChip; ikon?: LucideIcon; children: React.ReactNode; title?: string }) => (
  <span className={cn("inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium", KELAS_CHIP[nada])} title={title}>
    {Ikon && <Ikon className="h-3 w-3 shrink-0" aria-hidden />}
    <span className="truncate">{children}</span>
  </span>
);

/**
 * Satu chip per presensi: jam + tanda kecocokan (✓ sesuai, "tanpa titik") +
 * perisai bila ditandai. Hanya "tidak sesuai" yang mendapat chip merah sendiri;
 * rincian lengkapnya ada di detail baris dan "Perlu diperiksa".
 */
const ChipPresensi = ({ p }: { p: PeristiwaPresensi }) => {
  const tanda = p.tandaIntegritas.map((k) => LABEL_INTEGRITAS[k] ?? k);
  const berat = p.tandaIntegritas.some((k) => BLOKIR_INTEGRITAS.has(k));
  return (
    <>
      <Chip nada="presensi" ikon={p.jenis === "masuk" ? LogIn : LogOut} title={[labelPeristiwa(p), ...tanda].join(" · ")}>
        {p.jenis === "masuk" ? "Masuk" : "Pulang"} {formatJam(p.t)}
        {p.cocok === "sesuai" && <Check className="ml-0.5 inline h-3 w-3 align-[-2px]" aria-label="posisi sesuai" />}
        {p.cocok === "tanpa_titik" && <span className="font-normal"> · tanpa titik</span>}
        {tanda.length > 0 && <ShieldAlert className={cn("ml-1 inline h-3 w-3 align-[-2px]", berat ? "text-danger" : "text-warning")} aria-label="ditandai" />}
      </Chip>
      {p.cocok === "tidak_sesuai" && (
        <Chip nada="bahaya" ikon={TriangleAlert}>
          {p.jarakKeJejakM != null ? formatJarak(p.jarakKeJejakM) : "Jauh"} dari jejak
        </Chip>
      )}
    </>
  );
};

const ChipPalsu = ({ s }: { s: Segmen }) => {
  const palsu = s.disaring.filter((d) => d.alasan === "palsu");
  if (!palsu.length) return null;
  const teks = palsu.length === 1 ? `Lokasi palsu ${formatJam(palsu[0].t)}` : `Lokasi palsu ×${palsu.length} · ${formatJam(palsu[0].t)}–${formatJam(palsu[palsu.length - 1].t)}`;
  return (
    <Chip nada="bahaya" ikon={ShieldAlert}>
      {teks}
    </Chip>
  );
};

// ---------------------------------------------------------------- rel (garis vertikal linimasa)

type GayaRel = "jalan" | "kendaraan" | "jeda" | "polos";

const gayaPerjalanan = (s: Perjalanan): GayaRel => (s.moda === "jalan" && !s.dataTipis ? "jalan" : "kendaraan");

/**
 * Gaya rel satu baris ke arah tetangganya, mengikuti gaya garis di peta
 * (titik-titik = jalan, penuh = kendaraan, putus = tanpa data). Perjalanan dan
 * jeda memakai gayanya sendiri; singgah mengikuti sambungan di sisi itu.
 */
const gayaRel = (s: Segmen, tetangga: Segmen | undefined): GayaRel | null => {
  if (!tetangga) return null;
  if (s.jenis === "perjalanan") return gayaPerjalanan(s);
  if (s.jenis === "jeda") return "jeda";
  if (tetangga.jenis === "perjalanan") return gayaPerjalanan(tetangga);
  if (tetangga.jenis === "jeda") return "jeda";
  return "polos";
};

const KELAS_REL: Record<GayaRel, string> = {
  jalan: "-ml-[1.5px] w-0 border-l-[3px] border-dotted border-peta-jalur",
  kendaraan: "-ml-[1.5px] w-[3px] bg-peta-jalur",
  jeda: "-ml-px w-0 border-l-2 border-dashed border-muted/45",
  polos: "-ml-px w-0.5 bg-border",
};

/** Potongan rel; `left-[80px]` = tengah kolom simpul (px-2 + 44 + gap 12 + 16). */
const Rel = ({ gaya, className, style }: { gaya: GayaRel | null; className: string; style?: React.CSSProperties }) =>
  gaya ? <span className={cn("pointer-events-none absolute left-[80px]", KELAS_REL[gaya], className)} style={style} aria-hidden /> : null;

// ---------------------------------------------------------------- baris

interface PropsBaris {
  s: Segmen;
  atas: GayaRel | null;
  bawah: GayaRel | null;
  indeks: number;
  terpilih: boolean;
  disorot: boolean;
  jumlahKunjungan: number;
  onPilih: (id: string | null) => void;
  onSorot: (id: string | null) => void;
  daftarkan: (id: string, el: HTMLElement | null) => void;
}

const judulJeda = (s: Jeda) => {
  if (s.luarJamPantau) return "Di luar jam presensi · pemantauan tidak berjalan";
  if (s.posisi === "akhir" && s.berlangsung) return `Belum ada data baru sejak ${formatJam(s.mulai)}`;
  if (s.posisi === "awal") return `Belum ada data · ${formatJam(s.mulai)}–${jamAkhir(s)}`;
  if (s.posisi === "akhir") return `Tidak ada data lagi · ${formatJam(s.mulai)}–${jamAkhir(s)}`;
  return `Tidak ada data · ${formatDurasi(s.durasiMs)}`;
};

const labelAria = (s: Segmen) => {
  const sampai = `${formatJam(s.mulai)} sampai ${s.berlangsung ? "sekarang" : jamAkhir(s)}, ${formatDurasiPanjang(s.durasiMs)}`;
  const presensi = s.presensi.map((p) => `${p.jenis} ${formatJam(p.t)}`).join(", ");
  if (s.jenis === "singgah") return `Singgah ${s.urutan} di ${s.tempat.nama}, ${sampai}${presensi ? `, presensi ${presensi}` : ""}`;
  if (s.jenis === "perjalanan") return `${LABEL_MODA[s.moda]} ${formatJarak(s.jarakM)}, ${sampai}`;
  if (s.jenis === "jeda") return `Tidak ada data, ${sampai}${presensi ? `, presensi ${presensi}` : ""}`;
  return `Terlihat ${formatJam(s.mulai)}${s.sekitar ? ` di sekitar ${s.sekitar}` : ""}`;
};

const KolomJam = ({ s, sembunyi }: { s: Segmen; sembunyi?: boolean }) =>
  sembunyi ? (
    <span aria-hidden />
  ) : (
    <span className="pt-[7px] text-right leading-tight whitespace-nowrap tabular-nums" aria-hidden>
      <span className="block text-[13px] font-semibold">{formatJam(s.mulai)}</span>
      {s.selesai - s.mulai >= 60_000 && <span className="block text-[11px] text-muted">{s.berlangsung ? "sekarang" : jamAkhir(s)}</span>}
    </span>
  );

const IsiSinggah = ({ s }: { s: Singgah }) => {
  const kerja = s.tempat.jenis === "lokasi_kerja";
  return (
    <span className="block min-w-0 pt-[5px]">
      <span className="flex items-start gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {kerja && <Building2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />}
          <span className="truncate text-sm font-semibold group-data-[terpilih=true]/baris:text-primary" title={s.tempat.nama}>
            {s.tempat.nama}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted tabular-nums group-data-[terpilih=true]/baris:bg-surface">
          {formatDurasi(s.durasiMs)}
        </span>
      </span>
      {s.tempat.keterangan && <span className="mt-0.5 block truncate text-xs text-muted">{s.tempat.keterangan}</span>}
      <span className="mt-1.5 flex flex-wrap gap-1 empty:hidden">
        {s.berlangsung && (
          <Chip nada="info">
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle" />
            Sedang di sini
          </Chip>
        )}
        {kerja && <Chip nada="kerja">Lokasi kerja</Chip>}
        {s.presensi.map((p) => (
          <ChipPresensi key={p.id} p={p} />
        ))}
        <ChipPalsu s={s} />
        {s.jedaDalamMs > 0 && (
          <Chip ikon={CircleDashed} title="Ponsel tidak mengirim lokasi selama bagian ini, tetapi sebelum dan sesudahnya di tempat yang sama">
            Tanpa data {formatDurasi(s.jedaDalamMs)}
          </Chip>
        )}
        {s.kunjunganKe > 1 && <Chip>Kunjungan ke-{s.kunjunganKe}</Chip>}
        {s.berlanjutDariKemarin && <Chip>Berlanjut dari kemarin</Chip>}
        {s.berlanjutKeBesok && <Chip>Berlanjut ke besok</Chip>}
      </span>
    </span>
  );
};

const IsiPerjalanan = ({ s }: { s: Perjalanan }) => {
  const ujung = !s.dari && !s.ke && (s.dariSekitar || s.keSekitar) ? [s.dariSekitar && `dari sekitar ${s.dariSekitar}`, s.keSekitar && `ke sekitar ${s.keSekitar}`].filter(Boolean).join(" → ") : null;
  const adaChip = s.presensi.length > 0 || s.disaring.some((d) => d.alasan === "palsu");
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="block min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium group-data-[terpilih=true]/baris:text-primary">
          {s.berlangsung ? `Sedang bergerak · sejak ${formatJam(s.mulai)}` : `${LABEL_MODA[s.moda]} · ${formatDurasi(s.durasiMs)}`}
        </span>
        <span className="block truncate text-xs text-muted tabular-nums">
          {s.dataTipis ? `${formatJarak(s.jarakM)} garis lurus · rute tidak terekam` : `${formatJarak(s.jarakM)}${s.berlangsung ? " sejauh ini" : ""} · ${formatKecepatan(s.kecepatanRataKmj)}`}
        </span>
        {ujung && <span className="block truncate text-xs text-muted">{ujung}</span>}
        {adaChip && (
          <span className="mt-1 flex flex-wrap gap-1">
            {s.presensi.map((p) => (
              <ChipPresensi key={p.id} p={p} />
            ))}
            <ChipPalsu s={s} />
          </span>
        )}
      </span>
      {!s.berlangsung && <span className="shrink-0 self-start pt-0.5 text-[11px] text-muted tabular-nums">{rentangJam(s)}</span>}
    </span>
  );
};

const IsiJeda = ({ s }: { s: Jeda }) => (
  <span className={cn("arsir-jeda block min-w-0 rounded-lg border border-border/70 px-2.5 py-1.5", s.luarJamPantau && "opacity-75")}>
    <span className="block text-[13px] font-medium text-foreground/85 group-data-[terpilih=true]/baris:text-primary">{judulJeda(s)}</span>
    {s.posisi === "tengah" && !s.luarJamPantau && (
      <span className="block text-xs text-muted tabular-nums">
        {formatJam(s.mulai)}–{jamAkhir(s)}
        {s.perpindahanM != null && s.perpindahanM >= 150 && !s.tempatSama
          ? ` · berpindah ±${formatJarak(s.perpindahanM)} (rute tidak diketahui)`
          : s.tempatSama
            ? " · sebelum dan sesudahnya di tempat yang sama"
            : ""}
      </span>
    )}
    {s.posisi !== "tengah" && !s.berlangsung && <span className="block text-xs text-muted">{formatDurasi(s.durasiMs)}</span>}
    {(s.presensi.length > 0 || s.disaring.some((d) => d.alasan === "palsu")) && (
      <span className="mt-1 flex flex-wrap gap-1">
        {s.presensi.map((p) => (
          <ChipPresensi key={p.id} p={p} />
        ))}
        <ChipPalsu s={s} />
      </span>
    )}
  </span>
);

const IsiTerlihat = ({ s }: { s: Terlihat }) => (
  <span className="block min-w-0 pt-[5px]">
    <span className="block truncate text-[13px] font-medium group-data-[terpilih=true]/baris:text-primary">Terlihat · {formatJam(s.mulai)}</span>
    <span className="block truncate text-xs text-muted">
      {s.sekitar ? `Sekitar ${s.sekitar}` : `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`}
      {s.akurasiM != null ? ` · ±${Math.round(s.akurasiM)} m` : ""}
    </span>
    {(s.presensi.length > 0 || s.disaring.length > 0) && (
      <span className="mt-1 flex flex-wrap gap-1">
        {s.presensi.map((p) => (
          <ChipPresensi key={p.id} p={p} />
        ))}
        <ChipPalsu s={s} />
      </span>
    )}
  </span>
);

const salinKoordinat = async (lat: number, lng: number) => {
  try {
    await navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    notifikasi.sukses("Koordinat disalin", `${lat.toFixed(6)}, ${lng.toFixed(6)}`);
  } catch {
    notifikasi.peringatan("Koordinat tidak dapat disalin", "Peramban menolak akses papan klip.");
  }
};

const AksiKoordinat = ({ lat, lng }: { lat: number; lng: number }) => (
  <span className="-ml-3 flex flex-wrap gap-1 pt-0.5">
    <Button type="button" size="sm" variant="ghost" className="text-xs" onClick={() => salinKoordinat(lat, lng)}>
      <Copy className="h-3.5 w-3.5" aria-hidden /> Salin koordinat
    </Button>
    <a
      href={`https://www.google.com/maps?q=${lat},${lng}`}
      target="_blank"
      rel="noreferrer"
      title="Membuka Google Maps (koordinat dikirim ke Google)"
      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Buka di Google Maps
    </a>
  </span>
);

const BarisPresensiLengkap = ({ p, tampilkanTanda }: { p: PeristiwaPresensi; tampilkanTanda: boolean }) => (
  <p className="flex items-start gap-1.5">
    {p.jenis === "masuk" ? <LogIn className="mt-0.5 h-3.5 w-3.5 shrink-0 text-jenis-violet" aria-hidden /> : <LogOut className="mt-0.5 h-3.5 w-3.5 shrink-0 text-jenis-violet" aria-hidden />}
    <span>
      <span className="font-medium text-foreground tabular-nums">{formatJam(p.t)}</span> · {p.jenis === "masuk" ? "Masuk" : "Pulang"}
      {p.metode ? ` · ${LABEL_METODE[p.metode] ?? p.metode}` : ""}
      {p.namaLokasi ? ` · ${p.namaLokasi}` : ""}
      {" · "}
      <span className={cn(p.cocok === "sesuai" ? "text-success" : p.cocok === "tidak_sesuai" ? "text-danger" : p.cocok === "tanpa_titik" ? "text-warning" : "")}>{teksCocok(p)}</span>
      {p.wajahTerverifikasi ? " · wajah terverifikasi" : ""}
      {p.terlambatMenit > 0 ? ` · terlambat ${p.terlambatMenit} mnt` : ""}
      {p.pulangCepatMenit > 0 ? ` · pulang cepat ${p.pulangCepatMenit} mnt` : ""}
      {p.offline ? " · diambil offline, dikirim belakangan" : ""}
      {tampilkanTanda && p.tandaIntegritas.length > 0 && (
        <span className="block text-danger">Presensi ditandai: {p.tandaIntegritas.map((k) => LABEL_INTEGRITAS[k] ?? k).join(" · ")}</span>
      )}
    </span>
  </p>
);

const DetailSegmen = ({ s, jumlahKunjungan }: { s: Segmen; jumlahKunjungan: number }) => {
  const akurasi = s.disaring.filter((d) => d.alasan === "akurasi");
  const janggal = s.disaring.filter((d) => d.alasan === "janggal");
  return (
    // Nama/alamat lokasi diketik admin dan bisa panjang tanpa spasi: boleh patah di mana saja.
    <div className="space-y-1.5 text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">
      {s.jenis === "singgah" && (
        <>
          <p>
            {s.jumlahTitik} titik{s.akurasiMedianM != null ? ` · akurasi median ±${Math.round(s.akurasiMedianM)} m` : ""} · sebaran ±{Math.round(s.sebaranM)} m
          </p>
          {jumlahKunjungan > 1 && (
            <p>
              Kunjungan ke-{s.kunjunganKe} dari {jumlahKunjungan} ke tempat ini hari ini
            </p>
          )}
          {s.tempat.jenis === "lain" && <p>Tempat tanpa nama (bukan lokasi kerja); huruf {s.tempat.label} hanya berlaku untuk tanggal ini.</p>}
          {s.jedaDalam.map((j) => (
            <p key={j.mulai} className="flex items-start gap-1.5">
              <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Tanpa data {formatJam(j.mulai)}–{formatJam(j.selesai)} ({formatDurasi(j.selesai - j.mulai)}); sebelum dan sesudahnya di tempat yang sama.
            </p>
          ))}
        </>
      )}
      {s.jenis === "perjalanan" && (
        <>
          <p>
            Dari <span className="text-foreground">{s.dari?.nama ?? s.dariSekitar ?? "titik pertama"}</span> ke <span className="text-foreground">{s.ke?.nama ?? s.keSekitar ?? "titik terakhir"}</span>
          </p>
          <p className="tabular-nums">
            {s.jumlahTitik} titik · rata-rata {formatKecepatan(s.kecepatanRataKmj)} · tertinggi {formatKecepatan(s.kecepatanPuncakKmj)}
          </p>
          <p>Moda diperkirakan dari kecepatan; ponsel tidak merekam jenis kendaraan. Jarak dihitung lurus antartitik.</p>
        </>
      )}
      {s.jenis === "jeda" &&
        (s.luarJamPantau ? (
          <p>Mode &ldquo;Hanya selama check-in&rdquo;: lokasi memang tidak dikirim di luar jam presensi.</p>
        ) : (
          <>
            <p>Ponsel tidak mengirim lokasi. Penyebab umum: aplikasi dihentikan sistem, ponsel mati/mode pesawat, penghemat baterai, atau izin lokasi.</p>
            {s.berlangsung && <p>Titik yang tercatat saat ponsel offline akan menyusul setelah tersambung.</p>}
            {s.jalurPerkiraan.length >= 2 && !s.tempatSama && <p>Garis putus-putus abu di peta hanya perkiraan lurus, bukan rute sebenarnya.</p>}
          </>
        ))}
      {s.jenis === "terlihat" && (
        <p>
          {s.jumlahTitik} titik{s.akurasiM != null ? ` · akurasi ±${Math.round(s.akurasiM)} m` : ""}; terlalu singkat untuk dihitung sebagai singgah.
        </p>
      )}
      {s.presensi.map((p, i) => (
        // Masuk & pulang satu catatan membawa tanda yang sama: cukup ditulis sekali.
        <BarisPresensiLengkap key={p.id} p={p} tampilkanTanda={s.presensi.findIndex((x) => x.presensiId === p.presensiId) === i} />
      ))}
      {akurasi.length > 0 && (
        <p>
          {akurasi.length} titik akurasi buruk disaring ({akurasi.map((d) => `${formatJam(d.t)}${d.akurasiM != null ? ` ±${Math.round(d.akurasiM)} m` : ""}`).join(", ")}).
        </p>
      )}
      {janggal.length > 0 && <p>{janggal.length} titik janggal diabaikan ({janggal.map((d) => formatJam(d.t)).join(", ")}).</p>}
      {(s.jenis === "singgah" || s.jenis === "terlihat") && <AksiKoordinat lat={s.lat} lng={s.lng} />}
    </div>
  );
};

/** Pusat simpul baris rata-atas: padding atas 10 px + setengah kotak simpul 32 px. */
const PUSAT_SIMPUL = 26;

const BarisSegmen = React.memo(function BarisSegmen({ s, atas, bawah, indeks, terpilih, disorot, jumlahKunjungan, onPilih, onSorot, daftarkan }: PropsBaris) {
  const tengah = s.jenis === "perjalanan";
  // Rel berhenti 3 px sebelum dan sesudah simpul supaya simpul tampak "memotong" garis.
  const ukuran = s.jenis === "singgah" ? 32 : s.jenis === "jeda" ? 24 : 12;
  const ref = React.useCallback((el: HTMLLIElement | null) => daftarkan(s.id, el), [daftarkan, s.id]);
  const IkonModa = s.jenis === "perjalanan" ? IKON_MODA[s.moda] : null;

  return (
    <li ref={ref} className={cn(indeks < 12 && "animate-fade-up")} style={indeks < 12 ? { animationDelay: `${indeks * 25}ms` } : undefined}>
      <div
        data-terpilih={terpilih ? "true" : undefined}
        className={cn(
          "group/baris rounded-xl transition-colors",
          terpilih ? "bg-primary-soft" : disorot ? "bg-surface-2" : "[@media(hover:hover)]:hover:bg-surface-2",
        )}
      >
        <button
          type="button"
          onClick={() => onPilih(terpilih ? null : s.id)}
          onPointerEnter={(e) => e.pointerType === "mouse" && onSorot(s.id)}
          onPointerLeave={(e) => e.pointerType === "mouse" && onSorot(null)}
          aria-current={terpilih ? "true" : undefined}
          aria-expanded={terpilih}
          aria-label={labelAria(s)}
          className={cn(
            "relative grid w-full grid-cols-[44px_32px_minmax(0,1fr)] gap-x-3 rounded-xl px-2 text-left",
            tengah ? "min-h-[52px] items-center py-2" : "items-start py-2.5",
          )}
        >
          {tengah ? (
            <>
              <Rel gaya={atas} className="top-0 bottom-[calc(50%+15px)]" />
              <Rel gaya={bawah} className="top-[calc(50%+15px)] bottom-0" />
            </>
          ) : (
            <>
              <Rel gaya={atas} className="top-0" style={{ height: PUSAT_SIMPUL - ukuran / 2 - 3 }} />
              <Rel gaya={bawah} className="bottom-0" style={{ top: PUSAT_SIMPUL + ukuran / 2 + 3 }} />
            </>
          )}
          <KolomJam s={s} sembunyi={tengah} />
          {s.jenis === "singgah" ? (
            <span
              className={cn(
                "relative grid h-8 w-8 place-items-center rounded-full text-xs font-bold shadow-[0_1px_3px_rgb(0_0_0/.25)] tabular-nums",
                s.tempat.jenis === "lokasi_kerja" ? "bg-primary text-on-primary" : "bg-secondary text-on-secondary",
              )}
              aria-hidden
            >
              {s.urutan}
            </span>
          ) : s.jenis === "perjalanan" && IkonModa ? (
            <span className="relative mx-auto grid h-6 w-6 place-items-center rounded-full border border-border bg-surface text-peta-jalur shadow-sm" aria-hidden>
              <IkonModa className="h-3.5 w-3.5" />
            </span>
          ) : s.jenis === "jeda" ? (
            <span className="relative grid h-8 w-8 place-items-center" aria-hidden>
              <span className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-muted/60 bg-surface text-muted">
                <CircleDashed className="h-3.5 w-3.5" />
              </span>
            </span>
          ) : (
            <span className="relative grid h-8 w-8 place-items-center" aria-hidden>
              <span className="h-3 w-3 rounded-full bg-foreground ring-2 ring-surface" />
            </span>
          )}
          {s.jenis === "singgah" ? <IsiSinggah s={s} /> : s.jenis === "perjalanan" ? <IsiPerjalanan s={s} /> : s.jenis === "jeda" ? <IsiJeda s={s} /> : <IsiTerlihat s={s} />}
        </button>
        {terpilih && (
          <div className="relative pr-3 pb-3 pl-[108px]">
            <Rel gaya={bawah} className="top-0 bottom-0" />
            <DetailSegmen s={s} jumlahKunjungan={jumlahKunjungan} />
          </div>
        )}
      </div>
    </li>
  );
});

// ---------------------------------------------------------------- ringkasan

const Ubin = ({ ikon: Ikon, warnaIkon, label, nilai, hint, nada }: { ikon: LucideIcon; warnaIkon: string; label: string; nilai: string; hint: string; nada?: "peringatan" }) => (
  <div className={cn("min-w-0 rounded-xl px-3 py-2.5", nada === "peringatan" ? "bg-warning-soft" : "bg-surface-2")}>
    <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
      <Ikon className={cn("h-3.5 w-3.5 shrink-0", nada === "peringatan" ? "text-warning" : warnaIkon)} aria-hidden />
      <span className="truncate">{label}</span>
    </p>
    <p className={cn("mt-1 truncate text-[17px] leading-tight font-semibold tabular-nums", nada === "peringatan" && "text-warning")}>{nilai}</p>
    <p className="mt-0.5 truncate text-[11px] text-muted" title={hint}>
      {hint}
    </p>
  </div>
);

const persenBulat = (x: number) => `${Math.round(x * 100)}%`;

const KpiHari = ({ l, mode }: { l: Linimasa; mode: "always" | "while_working" }) => {
  const r = l.ringkasan;
  const jamPresensiMs = r.jamPresensi ? r.jamPresensi.selesai - r.jamPresensi.mulai : 0;
  const hintKerja =
    r.jamPresensi && r.diLokasiKerjaSaatPresensiMs != null && jamPresensiMs > 0
      ? `${persenBulat(Math.min(1, r.diLokasiKerjaSaatPresensiMs / jamPresensiMs))} jam presensi`
      : r.jumlahLokasiKerja > 0
        ? `${r.jumlahLokasiKerja} lokasi`
        : "tidak tercatat";
  const cakupanRendah = r.cakupan != null && r.cakupan < 0.5 && mode === "always";
  return (
    <div className="grid grid-cols-2 gap-2">
      <Ubin ikon={Building2} warnaIkon="text-primary" label="Di lokasi kerja" nilai={r.diLokasiKerjaMs > 0 ? formatDurasi(r.diLokasiKerjaMs) : "—"} hint={hintKerja} />
      <Ubin ikon={Route} warnaIkon="text-peta-jalur" label="Jarak" nilai={formatJarak(r.jarakM)} hint={`${r.jumlahPerjalanan} perjalanan`} />
      <Ubin ikon={MapPinned} warnaIkon="text-secondary" label="Tempat" nilai={String(r.jumlahTempat)} hint={`${r.jumlahSinggah} kunjungan`} />
      <Ubin
        ikon={Signal}
        warnaIkon="text-muted"
        label="Cakupan data"
        nilai={r.cakupan == null ? "—" : persenBulat(r.cakupan)}
        hint={r.tanpaDataMs >= 60_000 ? `tanpa data ${formatDurasi(r.tanpaDataMs)}` : "data lengkap"}
        nada={cakupanRendah ? "peringatan" : undefined}
      />
    </div>
  );
};

const TombolTemuan = ({ t, onTemuan }: { t: TemuanTampil; onTemuan: (t: TemuanTampil) => void }) => {
  const g = GAYA_TEMUAN[t.nada];
  const bisa = Boolean(t.segmenId || t.lat != null);
  return (
    <button
      type="button"
      onClick={() => onTemuan(t)}
      disabled={!bisa}
      className={cn("flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left transition-[filter] enabled:hover:brightness-[.97] disabled:cursor-default dark:enabled:hover:brightness-110", g.kelas)}
    >
      <g.ikon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="block text-[13px] leading-snug font-semibold">{t.judul}</span>
        <span className="block text-xs leading-snug text-foreground/75">{t.rincian}</span>
      </span>
    </button>
  );
};

// ---------------------------------------------------------------- panel

export interface PropsPanelLinimasa {
  linimasa: Linimasa;
  temuan: TemuanTampil[];
  labelTanggal: string;
  mode: "always" | "while_working";
  dipilihId: string | null;
  sorotId: string | null;
  onPilih: (id: string | null) => void;
  onSorot: (id: string | null) => void;
  onTemuan: (t: TemuanTampil) => void;
  daftarkan: (id: string, el: HTMLElement | null) => void;
  refPerluDiperiksa: React.Ref<HTMLElement>;
  onKePerluDiperiksa: () => void;
  /** Banner keadaan (memuat ulang, posisi baru, presensi gagal, …) di atas kesimpulan. */
  banner?: React.ReactNode;
}

/** Ringkasan hari (kesimpulan, KPI, pita 24 jam, Perlu diperiksa) lalu daftar linimasa. */
export default function PanelLinimasa({
  linimasa: l,
  temuan,
  labelTanggal,
  mode,
  dipilihId,
  sorotId,
  onPilih,
  onSorot,
  onTemuan,
  daftarkan,
  refPerluDiperiksa,
  onKePerluDiperiksa,
  banner,
}: PropsPanelLinimasa) {
  const [semua, setSemua] = React.useState(false);
  const id = React.useId();
  const serius = temuan.filter((t) => t.nada !== "info").length;
  const tampil = semua ? temuan : temuan.slice(0, 3);
  const jumlahKunjungan = React.useMemo(() => new Map(l.tempat.map((t) => [t.id, t.kunjunganIds.length])), [l]);

  return (
    <div className="space-y-5 px-4 pt-4 pb-5">
      {banner}

      <section aria-label="Ringkasan hari" className="space-y-3">
        <p className="text-sm leading-relaxed text-foreground">{l.ringkasan.kesimpulan}</p>
        {serius > 0 && (
          <button
            type="button"
            onClick={onKePerluDiperiksa}
            className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-2.5 py-1 text-xs font-semibold text-danger transition-[filter] hover:brightness-[.97]"
          >
            <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> {serius} perlu diperiksa
          </button>
        )}
        <KpiHari l={l} mode={mode} />
      </section>

      <section aria-labelledby={`${id}-pita`}>
        <JudulBagian id={`${id}-pita`} aksi={<span className="text-[11px] text-muted">WIB</span>}>
          Sepanjang hari
        </JudulBagian>
        <PitaHari linimasa={l} dipilihId={dipilihId} onPilih={(segmenId) => onPilih(segmenId === dipilihId ? null : segmenId)} onSorot={onSorot} />
      </section>

      <section ref={refPerluDiperiksa} aria-labelledby={`${id}-perlu`} className="scroll-mt-4">
        <JudulBagian id={`${id}-perlu`}>Perlu diperiksa</JudulBagian>
        <div className="space-y-1.5">
          {serius === 0 && (
            <p className="flex items-center gap-2 rounded-xl bg-success-soft px-3 py-2 text-[13px] font-medium text-success">
              <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden /> Tidak ada kejanggalan terdeteksi
            </p>
          )}
          {tampil.map((t) => (
            <TombolTemuan key={t.id} t={t} onTemuan={onTemuan} />
          ))}
          {temuan.length > 3 && (
            <button type="button" onClick={() => setSemua((v) => !v)} className="px-1 text-xs font-medium text-primary hover:underline">
              {semua ? "Tampilkan lebih sedikit" : `Lihat semua (${temuan.length})`}
            </button>
          )}
        </div>
      </section>

      <section aria-labelledby={`${id}-linimasa`}>
        <JudulBagian id={`${id}-linimasa`} aksi={<span className="text-[11px] text-muted tabular-nums">{l.segmen.length} butir</span>}>
          Linimasa
        </JudulBagian>
        <ol aria-label={`Linimasa ${labelTanggal}`} className="-mx-2">
          {l.segmen.map((s, i) => (
            <BarisSegmen
              key={s.id}
              s={s}
              atas={gayaRel(s, l.segmen[i - 1])}
              bawah={gayaRel(s, l.segmen[i + 1])}
              indeks={i}
              terpilih={s.id === dipilihId}
              disorot={s.id === sorotId && s.id !== dipilihId}
              jumlahKunjungan={s.jenis === "singgah" ? (jumlahKunjungan.get(s.tempat.id) ?? 1) : 1}
              onPilih={onPilih}
              onSorot={onSorot}
              daftarkan={daftarkan}
            />
          ))}
        </ol>
      </section>
    </div>
  );
}

/** Kerangka saat riwayat pertama kali dimuat. */
export const KerangkaPanel = () => (
  <div className="space-y-5 px-4 pt-4 pb-5" aria-hidden>
    <div className="space-y-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
    <div className="grid grid-cols-2 gap-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-[74px] rounded-xl" />
      ))}
    </div>
    <Skeleton className="h-3 w-full rounded-full" />
    <div className="space-y-4 pt-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3">
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

/** Kaki panel: zona waktu dan pengingat audit. */
export const KakiPanel = ({ className }: { className?: string }) => (
  <p className={cn("flex items-start gap-1.5 text-[11px] leading-snug text-muted", className)}>
    <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
    Jam dalam WIB · Setiap tanggal yang dibuka tercatat di jejak audit atas nama Anda.
  </p>
);
