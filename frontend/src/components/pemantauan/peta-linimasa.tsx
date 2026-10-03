"use client";

import * as React from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { AttributionControl, Circle, CircleMarker, MapContainer, Marker, Pane, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { ChevronDown, ChevronUp, FoldVertical, Loader2, LocateFixed, Maximize2, Minus, Plus, UnfoldVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatDurasi,
  formatJam,
  formatJarak,
  jarakM,
  LABEL_MODA,
  type Jeda,
  type Linimasa,
  type LokasiKerjaMasuk,
  type PeristiwaPresensi,
  type Perjalanan,
  type Segmen,
  type Singgah,
  type Tempat,
  type Terlihat,
} from "@/lib/linimasa";
import {
  ikonAkhir,
  ikonAwal,
  ikonDisaring,
  ikonLangsung,
  ikonPalsu,
  ikonPanah,
  ikonPasangan,
  ikonPresensi,
  ikonTempat,
  ikonTempatRingkas,
  ikonTerlihat,
  lebarPil,
} from "./penanda";
import { labelPeristiwa, rentangJam } from "./panel-linimasa";

/** Titik yang difokuskan dari "Perlu diperiksa" (mis. titik palsu atau lompatan janggal). */
export interface FokusPeta {
  lat: number;
  lng: number;
  alasan: "palsu" | "janggal" | "akurasi" | null;
  t: number | null;
  /** Posisi jejak sebenarnya pada waktu titik palsu itu (digaris putus-putus merah), bila ada. */
  pasangan: [number, number] | null;
  jarakM: number | null;
  /** Bertambah setiap klik, supaya klik ulang temuan yang sama tetap menerbangkan peta. */
  kunci: number;
}

export interface PropsPetaLinimasa {
  linimasa: Linimasa | null;
  /** `${employeeId}|${tanggal}` dari data yang sedang tampil; kamera dipaskan ulang setiap kunci ini berubah. */
  kunciData: string;
  lokasiKerja: LokasiKerjaMasuk[];
  dipilihId: string | null;
  sorotId: string | null;
  fokus: FokusPeta | null;
  /** Berubah = paskan ulang seluruh hari (pilihan dibatalkan dari daftar/pita/Esc). */
  paskanKunci: number;
  /** Pusat sebelum data datang (posisi terakhir karyawan). */
  pusatAwal: [number, number];
  memuat: boolean;
  labelMemuat: string;
  kurangiGerak: boolean;
  /** Ponsel: peta bisa ditinggikan; null = tombolnya tidak ditampilkan (layar lebar). */
  besar: boolean | null;
  onBesar: () => void;
  onPilih: (id: string | null) => void;
  onSorot: (id: string | null) => void;
}

const UBIN = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
// Tab baru: tautan atribusi di pojok peta mudah tersentuh dan tidak boleh membawa admin keluar dari aplikasi.
const PREFIKS_LEAFLET = '<a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a>';
const ATRIBUSI = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

// react-leaflet memanggil setStyle setiap identitas pathOptions berubah, jadi
// gaya garis adalah konstanta modul per (jenis × keadaan), bukan literal inline.
// Warna tidak diatur di sini: kelas CSS (globals.css) yang memberinya, mengikuti tema.
const GARIS = {
  casing: { className: "jejak jejak-casing", weight: 8, opacity: 1, lineCap: "round", lineJoin: "round", interactive: false },
  casingJalan: { className: "jejak jejak-casing", weight: 8, opacity: 1, lineCap: "round", dashArray: "1 9", interactive: false },
  kendaraan: { className: "jejak jejak-utama", weight: 4.5, opacity: 1, lineCap: "round", lineJoin: "round", interactive: false },
  tidakDiketahui: { className: "jejak jejak-utama", weight: 4, opacity: 0.8, lineCap: "round", lineJoin: "round", interactive: false },
  jalan: { className: "jejak jejak-utama", weight: 5, opacity: 1, lineCap: "round", dashArray: "1 9", interactive: false },
  tipis: { className: "jejak jejak-utama", weight: 4, opacity: 0.9, lineCap: "butt", dashArray: "8 8", interactive: false },
  jauh: { className: "jejak jejak-utama", weight: 4, opacity: 0.9, lineCap: "round", dashArray: "12 10", interactive: false },
  perkiraan: { className: "jejak jejak-perkiraan", weight: 3, opacity: 0.9, lineCap: "round", dashArray: "2 8", interactive: false },
  hit: { className: "jejak-hit", weight: 18, opacity: 0, bubblingMouseEvents: false },
  // Pane sorot: segmen terpilih/disorot digambar ulang lebih tebal di atas semua garis.
  halo: { className: "jejak-halo", weight: 14, opacity: 0.3, lineCap: "round", lineJoin: "round", interactive: false },
  sorot: { className: "jejak-utama", weight: 7, opacity: 1, lineCap: "round", lineJoin: "round", interactive: false },
  sorotJalan: { className: "jejak-utama", weight: 7, opacity: 1, lineCap: "round", dashArray: "1 11", interactive: false },
  alir: { className: "jejak-alir", weight: 2.5, opacity: 0.9, lineCap: "round", dashArray: "1 14", interactive: false },
  sorotPerkiraan: { className: "jejak-perkiraan", weight: 5, opacity: 1, lineCap: "round", dashArray: "2 9", interactive: false },
  geofence: { className: "jejak-geofence", weight: 1.5, opacity: 0.85, dashArray: "4 4", fillOpacity: 0.08 },
  sebaranKerja: { className: "jejak-sebaran-kerja", weight: 1.5, opacity: 0.7, fillOpacity: 0.12, interactive: false },
  sebaranLain: { className: "jejak-sebaran-lain", weight: 1.5, opacity: 0.8, fillOpacity: 0.14, interactive: false },
  titik: { className: "jejak-titik", weight: 1, opacity: 1, fillOpacity: 0.7, interactive: false },
  akurasi: { className: "jejak-akurasi", weight: 1, opacity: 0.5, fillOpacity: 0.08, interactive: false },
  palsu: { className: "jejak-palsu", weight: 2.5, opacity: 0.9, dashArray: "6 7", lineCap: "round", interactive: false },
} satisfies Record<string, L.PathOptions>;

/**
 * Leaflet hanya membaca `className` dan `interactive` saat path dibuat (_initPath); react-leaflet
 * menerapkan `pathOptions` belakangan lewat setStyle, yang mengabaikan keduanya. Maka keduanya
 * diteruskan sebagai prop tingkat atas (opsi konstruktor). Di dev, StrictMode memasang layer dua
 * kali sehingga kesalahan ini tertutupi — di build produksi garis kehilangan warna & jadi interaktif.
 * Objek gaya yang sama tetap jadi `pathOptions`, jadi identitasnya stabil (tanpa setStyle berulang).
 */
const gaya = (g: L.PathOptions) => ({ className: g.className, interactive: g.interactive ?? true, bubblingMouseEvents: g.bubblingMouseEvents ?? true, pathOptions: g });

const gayaPerjalanan = (s: Perjalanan) =>
  s.dataTipis ? GARIS.tipis : s.moda === "jalan" ? GARIS.jalan : s.moda === "jauh" ? GARIS.jauh : s.moda === "tidak_diketahui" ? GARIS.tidakDiketahui : GARIS.kendaraan;

/** Jeda yang layak digambar: ada dua ujung dan memang berpindah. */
const jedaBergaris = (s: Jeda) => s.jalurPerkiraan.length >= 2 && !(s.tempatSama && (s.perpindahanM ?? 0) < 150);

// Ruang untuk kontrol (kanan atas) dan tombol Keterangan (kiri bawah).
const BANTALAN_HARI = { paddingTopLeft: [36, 44] as L.PointTuple, paddingBottomRight: [64, 56] as L.PointTuple };

/** Paskan kamera ke seluruh jejak hari itu (tanpa titik disaring). */
const paskanHari = (peta: L.Map, l: Linimasa, animasi: boolean) => {
  // Semua titik tersaring (mis. palsu seharian): paskan ke titik disaring supaya penandanya terlihat —
  // lompatan janggal antarbenua hanya dipakai bila tidak ada yang lain.
  const cadangan = l.disaring.some((d) => d.alasan !== "janggal") ? l.disaring.filter((d) => d.alasan !== "janggal") : l.disaring;
  const kotak = l.batas ?? (cadangan.length ? (cadangan.map((d) => [d.lat, d.lng]) as [number, number][]) : null);
  if (!kotak) return;
  const b = L.latLngBounds(kotak);
  if (!b.isValid()) return;
  if (b.getNorthEast().distanceTo(b.getSouthWest()) < 30) peta.setView(b.getCenter(), 16, { animate: animasi });
  else peta.fitBounds(b, { ...BANTALAN_HARI, maxZoom: 16, animate: animasi });
};

/** Kotak yang dituju saat sebuah segmen dipilih. */
const batasSegmen = (s: Segmen): { b: L.LatLngBounds; maxZoom: number } | null => {
  if (s.jenis === "singgah") return { b: L.latLng(s.lat, s.lng).toBounds(Math.max(s.sebaranM * 3, 320)), maxZoom: 17 };
  if (s.jenis === "terlihat") return { b: L.latLng(s.lat, s.lng).toBounds(Math.max((s.akurasiM ?? 0) * 3, 320)), maxZoom: 17 };
  const titik = s.jenis === "perjalanan" ? s.jalur : s.jalurPerkiraan.length ? s.jalurPerkiraan : [s.dari, s.ke].filter((x): x is [number, number] => Boolean(x));
  if (!titik.length) return null;
  const b = L.latLngBounds(titik);
  if (!b.isValid()) return null;
  // Satu titik (jeda awal/akhir): beri kotak 600 m di sekitarnya.
  if (b.getNorthEast().distanceTo(b.getSouthWest()) < 30) return { b: b.getCenter().toBounds(600), maxZoom: 16 };
  return { b, maxZoom: 17 };
};

const terbangKe = (peta: L.Map, s: Segmen, kurangiGerak: boolean) => {
  const t = batasSegmen(s);
  if (!t) return;
  const opsi = { paddingTopLeft: [48, 56] as L.PointTuple, paddingBottomRight: [72, 56] as L.PointTuple, maxZoom: t.maxZoom };
  if (kurangiGerak) peta.fitBounds(t.b, { ...opsi, animate: false });
  else peta.flyToBounds(t.b, { ...opsi, duration: 0.6 });
};

/**
 * Kamera: MapContainer hanya memakai props awal, jadi semua gerak kamera
 * diatur di sini lewat useMap(). Peta dipaskan ulang saat data berganti, dan
 * setelah ukurannya berubah selama pengguna belum menggeser sendiri.
 */
function Kamera({
  linimasa,
  kunciData,
  dipilih,
  fokus,
  paskanKunci,
  kurangiGerak,
}: {
  linimasa: Linimasa | null;
  kunciData: string;
  dipilih: Segmen | null;
  fokus: FokusPeta | null;
  paskanKunci: number;
  kurangiGerak: boolean;
}) {
  const peta = useMap();
  const digeser = React.useRef(false);
  const kunciTerakhir = React.useRef<string | null>(null);
  const keadaan = React.useRef<{ linimasa: Linimasa | null; dipilih: Segmen | null }>({ linimasa: null, dipilih: null });

  React.useEffect(() => {
    keadaan.current = { linimasa, dipilih };
  }, [linimasa, dipilih]);

  // Interaksi pengguna mematikan pemaskan otomatis sampai data berikutnya. Didengar di wadah luar
  // supaya tombol +/− dan "Posisi terakhir" (di luar kontainer Leaflet) ikut terhitung; tombol yang
  // memang mengatur ulang kamera (Paskan) ditandai data-kamera-ulang.
  React.useEffect(() => {
    const el = peta.getContainer().parentElement ?? peta.getContainer();
    const tandai = (e: Event) => {
      if (e.target instanceof Element && e.target.closest("[data-kamera-ulang]")) return;
      digeser.current = true;
    };
    el.addEventListener("pointerdown", tandai);
    el.addEventListener("wheel", tandai, { passive: true });
    el.addEventListener("keydown", tandai);
    return () => {
      el.removeEventListener("pointerdown", tandai);
      el.removeEventListener("wheel", tandai);
      el.removeEventListener("keydown", tandai);
    };
  }, [peta]);

  // Data baru (tanggal/karyawan lain): selalu paskan. Kunci sama (hari ini disusun ulang tiap menit,
  // muat ulang): hanya bila belum digeser dan tidak ada segmen terpilih — kamera tidak boleh melompat.
  React.useEffect(() => {
    if (!linimasa) return;
    const baru = kunciTerakhir.current !== kunciData;
    kunciTerakhir.current = kunciData;
    if (baru) digeser.current = false;
    if (baru || (!digeser.current && !keadaan.current.dipilih)) {
      peta.invalidateSize({ pan: false });
      paskanHari(peta, linimasa, false);
    }
  }, [peta, linimasa, kunciData]);

  // Bergantung pada id, bukan objek: linimasa hari ini disusun ulang tiap menit dan objek segmennya baru.
  const dipilihId = dipilih?.id ?? null;
  React.useEffect(() => {
    const d = keadaan.current.dipilih;
    if (dipilihId && d) {
      digeser.current = false;
      terbangKe(peta, d, kurangiGerak);
    }
  }, [peta, dipilihId, kurangiGerak]);

  // Pilihan dibatalkan dari daftar/pita/Esc: kembali ke seluruh hari.
  const paskanTerakhir = React.useRef(paskanKunci);
  React.useEffect(() => {
    if (paskanKunci === paskanTerakhir.current) return;
    paskanTerakhir.current = paskanKunci;
    const l = keadaan.current.linimasa;
    if (!l) return;
    digeser.current = false;
    paskanHari(peta, l, !kurangiGerak);
  }, [peta, paskanKunci, kurangiGerak]);

  React.useEffect(() => {
    if (!fokus) return;
    const tujuan = L.latLng(fokus.lat, fokus.lng);
    // Titik palsu + posisi jejak sebenarnya: tampilkan keduanya sekaligus.
    if (fokus.pasangan && tujuan.distanceTo(fokus.pasangan) < 500_000) {
      const b = L.latLngBounds([tujuan, L.latLng(fokus.pasangan)]);
      // Bantalan lebar: pil tempat dan label titik palsu menjorok di kiri-kanan titiknya
      // (di peta sempit ponsel dikurangi supaya kedua titik tidak berimpitan).
      const sempit = peta.getSize().x < 600;
      const opsi = {
        paddingTopLeft: (sempit ? [72, 64] : [100, 80]) as L.PointTuple,
        paddingBottomRight: (sempit ? [116, 56] : [120, 72]) as L.PointTuple,
        maxZoom: 16,
      };
      if (kurangiGerak) peta.fitBounds(b, { ...opsi, animate: false });
      else peta.flyToBounds(b, { ...opsi, duration: 0.7 });
      return;
    }
    const zoom = Math.max(peta.getZoom(), 15);
    // Lompatan antarbenua (titik janggal) tidak perlu dianimasikan melintasi samudra.
    const jauh = peta.getCenter().distanceTo(tujuan) > 500_000;
    if (kurangiGerak || jauh) peta.setView(tujuan, jauh ? 13 : zoom, { animate: false });
    else peta.flyTo(tujuan, zoom, { duration: 0.6 });
  }, [peta, fokus, kurangiGerak]);

  // Ukuran wadah berubah (animasi buka, Perbesar peta, rotasi): ukur ulang lalu paskan bila belum digeser.
  React.useEffect(() => {
    let bingkai = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(bingkai);
      bingkai = requestAnimationFrame(() => {
        peta.invalidateSize({ pan: false });
        if (digeser.current) return;
        const { linimasa: l, dipilih: d } = keadaan.current;
        if (d) terbangKe(peta, d, true);
        else if (l) paskanHari(peta, l, false);
      });
    });
    ro.observe(peta.getContainer());
    return () => {
      cancelAnimationFrame(bingkai);
      ro.disconnect();
    };
  }, [peta]);

  return null;
}

/** Klik area kosong peta = batalkan pilihan. */
function KlikKosong({ onPilih }: { onPilih: (id: string | null) => void }) {
  useMapEvents(React.useMemo(() => ({ click: () => onPilih(null) }), [onPilih]));
  return null;
}

/** Garis dasar semua perjalanan dan jeda: casing dulu, lalu garis, lalu area klik. */
const LapisJejak = React.memo(function LapisJejak({ linimasa, onPilih, onSorot }: { linimasa: Linimasa; onPilih: (id: string | null) => void; onSorot: (id: string | null) => void }) {
  const perjalanan = React.useMemo(() => linimasa.segmen.filter((s): s is Perjalanan => s.jenis === "perjalanan" && s.jalur.length >= 2), [linimasa]);
  const jeda = React.useMemo(() => linimasa.segmen.filter((s): s is Jeda => s.jenis === "jeda" && jedaBergaris(s)), [linimasa]);
  const penangan = React.useMemo(() => {
    const m = new Map<string, L.LeafletEventHandlerFnMap>();
    for (const s of [...perjalanan, ...jeda]) {
      m.set(s.id, { click: () => onPilih(s.id), mouseover: () => onSorot(s.id), mouseout: () => onSorot(null) });
    }
    return m;
  }, [perjalanan, jeda, onPilih, onSorot]);

  return (
    <>
      {jeda.map((s) => (
        <Polyline key={`p-${s.id}`} positions={s.jalurPerkiraan} {...gaya(GARIS.perkiraan)} />
      ))}
      {perjalanan.map((s) => (
        <Polyline key={`c-${s.id}`} positions={s.jalur} {...gaya(s.moda === "jalan" && !s.dataTipis ? GARIS.casingJalan : GARIS.casing)} />
      ))}
      {perjalanan.map((s) => (
        <Polyline key={`u-${s.id}`} positions={s.jalur} {...gaya(gayaPerjalanan(s))} />
      ))}
      {[...jeda.map((s) => [s.id, s.jalurPerkiraan] as const), ...perjalanan.map((s) => [s.id, s.jalur] as const)].map(([id, jalur]) => (
        <Polyline key={`h-${id}`} positions={jalur} {...gaya(GARIS.hit)} eventHandlers={penangan.get(id)} />
      ))}
    </>
  );
});

/** Chevron arah setiap ±110 px sepanjang tiap perjalanan; dihitung ulang setelah zoom. */
function LapisPanah({ linimasa }: { linimasa: Linimasa }) {
  const peta = useMap();
  const [tampilan, setTampilan] = React.useState(() => ({ zoom: peta.getZoom(), batas: peta.getBounds() }));
  useMapEvents(React.useMemo(() => ({ moveend: () => setTampilan({ zoom: peta.getZoom(), batas: peta.getBounds() }) }), [peta]));

  const panah = React.useMemo(() => {
    const { zoom } = tampilan;
    // Hanya di sekitar area yang terlihat: pada zoom dekat jejak sehari bisa ribuan piksel panjangnya.
    const area = tampilan.batas.pad(0.25);
    const hasil: { kunci: string; posisi: [number, number]; sudut: number }[] = [];
    const JARAK = 110;
    for (const s of linimasa.segmen) {
      if (s.jenis !== "perjalanan" || s.jalur.length < 2 || s.moda === "jalan") continue;
      const px = s.jalur.map(([la, ln]) => peta.project([la, ln], zoom));
      const panjang: number[] = [0];
      for (let i = 1; i < px.length; i++) panjang.push(panjang[i - 1] + px[i].distanceTo(px[i - 1]));
      const total = panjang[panjang.length - 1];
      if (total < 70) continue;
      const n = Math.max(1, Math.floor(total / JARAK));
      let i = 1;
      for (let k = 0; k < n && hasil.length < 80; k++) {
        const d = ((k + 0.5) * total) / n;
        while (i < px.length - 1 && panjang[i] < d) i++;
        const a = px[i - 1];
        const b = px[i];
        const rentang = panjang[i] - panjang[i - 1] || 1;
        const f = Math.min(1, Math.max(0, (d - panjang[i - 1]) / rentang));
        const titik = L.point(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
        const ll = peta.unproject(titik, zoom);
        if (!area.contains(ll)) continue;
        hasil.push({ kunci: `${s.id}-${k}`, posisi: [ll.lat, ll.lng], sudut: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI });
      }
    }
    return hasil;
  }, [linimasa, peta, tampilan]);

  return (
    <>
      {panah.map((p) => (
        <Marker key={p.kunci} position={p.posisi} icon={ikonPanah(p.sudut)} interactive={false} keyboard={false} />
      ))}
    </>
  );
}

const ringkasPerjalanan = (s: Perjalanan) => `${LABEL_MODA[s.moda]} · ${formatJarak(s.jarakM)} · ${rentangJam(s)}`;

/** Segmen terpilih (dan yang sedang disorot) digambar ulang di atas semua garis. */
function LapisSorot({ segmen, utama }: { segmen: Segmen; utama: boolean }) {
  if (segmen.jenis === "perjalanan") {
    if (segmen.jalur.length < 2) return null;
    const jalan = segmen.moda === "jalan" && !segmen.dataTipis;
    return (
      <>
        <Polyline positions={segmen.jalur} {...gaya(GARIS.halo)} />
        <Polyline positions={segmen.jalur} {...gaya(jalan ? GARIS.sorotJalan : GARIS.sorot)}>
          {utama && (
            <Tooltip permanent direction="top" offset={[0, -8]} opacity={1} pane="tooltipPane">
              <span className="font-medium">{ringkasPerjalanan(segmen)}</span>
            </Tooltip>
          )}
        </Polyline>
        {utama && !jalan && <Polyline positions={segmen.jalur} {...gaya(GARIS.alir)} />}
      </>
    );
  }
  if (segmen.jenis === "jeda") {
    if (!jedaBergaris(segmen)) return null;
    return (
      <Polyline positions={segmen.jalurPerkiraan} {...gaya(GARIS.sorotPerkiraan)}>
        {utama && (
          <Tooltip permanent direction="top" offset={[0, -6]} opacity={1} pane="tooltipPane">
            <span className="font-medium">Tidak ada data · {formatDurasi(segmen.durasiMs)}</span>
            {segmen.perpindahanM != null && segmen.perpindahanM >= 150 && <span className="text-muted"> · berpindah ±{formatJarak(segmen.perpindahanM)}</span>}
          </Tooltip>
        )}
      </Polyline>
    );
  }
  if (segmen.jenis === "singgah") {
    if (!utama) return null;
    const kerja = segmen.tempat.jenis === "lokasi_kerja";
    // Titik mentah menjelaskan mengapa ini dianggap singgah; dibatasi supaya hari 1 menit tetap ringan.
    const langkah = Math.max(1, Math.ceil(segmen.titik.length / 300));
    return (
      <>
        <Circle center={[segmen.lat, segmen.lng]} radius={Math.max(segmen.sebaranM, 25)} {...gaya(kerja ? GARIS.sebaranKerja : GARIS.sebaranLain)} />
        {segmen.titik
          .filter((_, i) => i % langkah === 0)
          .map(([la, ln], i) => (
            <CircleMarker key={i} center={[la, ln]} radius={2.5} {...gaya(GARIS.titik)} />
          ))}
      </>
    );
  }
  if (!utama || !segmen.akurasiM) return null;
  return <Circle center={[segmen.lat, segmen.lng]} radius={segmen.akurasiM} {...gaya(GARIS.akurasi)} />;
}

/** Lingkaran batas lokasi kerja yang dikunjungi atau berada ≤ 2 km dari jejak. */
const LapisGeofence = React.memo(function LapisGeofence({ linimasa, lokasiKerja }: { linimasa: Linimasa; lokasiKerja: LokasiKerjaMasuk[] }) {
  const daftar = React.useMemo(() => {
    const dikunjungi = new Set(linimasa.tempat.flatMap((t) => (t.lokasiKerja ? [t.lokasiKerja.id] : [])));
    const b = linimasa.batas ? L.latLngBounds(linimasa.batas) : null;
    const kotak = b?.isValid() ? b : null;
    return lokasiKerja.flatMap((l) => {
      const lat = Number(l.latitude);
      const lng = Number(l.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
      const kunjung = dikunjungi.has(l.id);
      if (!kunjung && !l.isActive) return [];
      if (!kunjung) {
        if (!kotak) return [];
        // Jarak ke kotak batas jejak: 0 bila di dalamnya.
        const titik = L.latLng(lat, lng);
        const terdekat = L.latLng(
          Math.min(Math.max(lat, kotak.getSouth()), kotak.getNorth()),
          Math.min(Math.max(lng, kotak.getWest()), kotak.getEast()),
        );
        if (titik.distanceTo(terdekat) > 2000) return [];
      }
      return [{ id: l.id, nama: l.name, pusat: [lat, lng] as [number, number], radius: l.radiusMeters, nonaktif: !l.isActive }];
    });
  }, [linimasa, lokasiKerja]);

  return (
    <>
      {daftar.map((g) => (
        <Circle key={g.id} center={g.pusat} radius={g.radius} {...gaya(GARIS.geofence)}>
          <Tooltip direction="top" opacity={1} pane="tooltipPane" sticky>
            {g.nama} · radius {g.radius} m{g.nonaktif ? " · nonaktif" : ""}
          </Tooltip>
        </Circle>
      ))}
    </>
  );
});

interface DataTempat {
  tempat: Tempat;
  posisi: [number, number];
  nomor: number[];
  rentang: string[];
  presensi: PeristiwaPresensi[];
}

/** Penanda: satu pil per tempat, bendera presensi, titik palsu, ujung hari, dan posisi terkini. */
function LapisPenanda({
  linimasa,
  dipilih,
  sorotId,
  fokus,
  onPilih,
}: {
  linimasa: Linimasa;
  dipilih: Segmen | null;
  sorotId: string | null;
  fokus: FokusPeta | null;
  onPilih: (id: string | null) => void;
}) {
  const peta = useMap();
  const [zoom, setZoom] = React.useState(() => peta.getZoom());
  useMapEvents(React.useMemo(() => ({ zoomend: () => setZoom(peta.getZoom()) }), [peta]));

  const data = React.useMemo(() => {
    const singgahPerTempat = new Map<string, Singgah[]>();
    for (const s of linimasa.segmen) {
      if (s.jenis !== "singgah") continue;
      const arr = singgahPerTempat.get(s.tempat.id) ?? [];
      arr.push(s);
      singgahPerTempat.set(s.tempat.id, arr);
    }
    const segmenPerId = new Map(linimasa.segmen.map((s) => [s.id, s]));

    // Presensi yang jatuh di sebuah tempat menempel sebagai lencana di pilnya;
    // sisanya jadi bendera lepas, yang berdekatan (< 30 m) dipisah kiri/kanan.
    const berkoordinat = linimasa.presensi.filter((p): p is PeristiwaPresensi & { lat: number; lng: number } => p.lat != null && p.lng != null);
    const presensiDiTempat = new Map<string, PeristiwaPresensi[]>();
    const lepas: (PeristiwaPresensi & { lat: number; lng: number })[] = [];
    for (const p of berkoordinat) {
      let terdekat: Tempat | null = null;
      let dMin = Infinity;
      for (const t of linimasa.tempat) {
        const d = jarakM(p, t);
        if (d <= Math.max(60, t.lokasiKerja?.radiusM ?? 0) && d < dMin) {
          terdekat = t;
          dMin = d;
        }
      }
      if (terdekat) presensiDiTempat.set(terdekat.id, [...(presensiDiTempat.get(terdekat.id) ?? []), p]);
      else lepas.push(p);
    }
    const presensi = lepas.map((p, i) => {
      const dekat = lepas.findIndex((q, j) => j !== i && jarakM(p, q) < 30);
      const sisi: "kiri" | "kanan" = dekat >= 0 && dekat > i ? "kiri" : "kanan";
      const segmen = linimasa.segmen.find((s) => s.presensi.some((x) => x.id === p.id)) ?? null;
      return { p, posisi: [p.lat, p.lng] as [number, number], sisi, segmenId: segmen?.id ?? null };
    });

    const palsu = linimasa.disaring
      .filter((d) => d.alasan === "palsu")
      .slice(0, 100)
      .map((d) => ({
        d,
        posisi: [d.lat, d.lng] as [number, number],
        segmenId: linimasa.segmen.find((s) => s.mulai <= d.t && d.t <= s.selesai)?.id ?? null,
      }));

    // "Terlihat" yang jatuh di sebuah tempat sudah diwakili pil tempat itu.
    const terlihat = linimasa.segmen.filter((s): s is Terlihat => s.jenis === "terlihat" && !s.tempat).map((s) => ({ s, posisi: [s.lat, s.lng] as [number, number] }));

    // Titik awal/akhir hanya bila hari dibuka/ditutup oleh perjalanan atau "terlihat" (singgah sudah punya pil).
    const isi = linimasa.segmen.filter((s) => s.jenis !== "jeda");
    const pertama = isi[0];
    const terakhir = isi[isi.length - 1];
    const titikPertama = linimasa.titik[0];
    const titikTerakhir = linimasa.titik[linimasa.titik.length - 1];
    const awal = pertama && pertama.jenis === "perjalanan" && titikPertama ? ([titikPertama.lat, titikPertama.lng] as [number, number]) : null;
    const langsung = linimasa.posisiTerakhir?.segar ? linimasa.posisiTerakhir : null;
    // Sedang singgah di sebuah tempat: pil itulah yang berdenyut, titik biru terpisah tidak perlu.
    const segmenAkhir = isi[isi.length - 1];
    const tempatLangsung = langsung && segmenAkhir?.jenis === "singgah" && segmenAkhir.berlangsung ? segmenAkhir.tempat.id : null;
    const akhir =
      terakhir && terakhir.jenis === "perjalanan" && titikTerakhir && !langsung ? ([titikTerakhir.lat, titikTerakhir.lng] as [number, number]) : null;

    const tempat: DataTempat[] = linimasa.tempat.map((t) => {
      const singgah = singgahPerTempat.get(t.id) ?? [];
      return {
        tempat: t,
        posisi: [t.lat, t.lng],
        nomor: singgah.map((s) => s.urutan),
        rentang: t.kunjunganIds.flatMap((id) => {
          const s = segmenPerId.get(id);
          return s ? [rentangJam(s)] : [];
        }),
        presensi: presensiDiTempat.get(t.id) ?? [],
      };
    });

    return {
      tempat,
      presensi,
      palsu,
      terlihat,
      awal,
      akhir,
      tempatLangsung,
      langsung: langsung ? { ...langsung, posisi: [langsung.lat, langsung.lng] as [number, number] } : null,
    };
  }, [linimasa]);

  // Keadaan aktif: tempat/presensi milik segmen terpilih atau disorot tidak diredupkan.
  const aktif = new Set([dipilih?.id, sorotId].filter((x): x is string => Boolean(x)));
  const tempatAktif = data.tempat.find((t) => t.tempat.kunjunganIds.some((id) => aktif.has(id)))?.tempat.id ?? null;

  // Pil yang tertutup pil berprioritas lebih tinggi pada zoom ini diringkas jadi titik
  // (prioritas: terpilih, lokasi kerja, kunjungan terbanyak); diperbesar → muncul lagi.
  const ringkas = React.useMemo(() => {
    const hasil = new Set<string>();
    const kotak: { x1: number; x2: number; y1: number; y2: number }[] = [];
    const utama = (id: string) => Number(id === tempatAktif) * 2 + Number(id === data.tempatLangsung);
    const urut = [...data.tempat].sort(
      (a, b) =>
        utama(b.tempat.id) - utama(a.tempat.id) ||
        Number(b.tempat.jenis === "lokasi_kerja") - Number(a.tempat.jenis === "lokasi_kerja") ||
        b.nomor.length - a.nomor.length,
    );
    for (const t of urut) {
      const pt = peta.project(t.posisi, zoom);
      const w = lebarPil({ kerja: t.tempat.jenis === "lokasi_kerja", nomor: t.nomor, label: t.tempat.label }) / 2 + 3;
      const k = { x1: pt.x - w, x2: pt.x + w, y1: pt.y - 16, y2: pt.y + 16 };
      if (kotak.some((q) => q.x1 < k.x2 && k.x1 < q.x2 && q.y1 < k.y2 && k.y1 < q.y2)) hasil.add(t.tempat.id);
      else kotak.push(k);
    }
    return hasil;
  }, [data, peta, zoom, tempatAktif]);
  const terkaitTempat = new Set<string>();
  if (dipilih?.jenis === "perjalanan") {
    if (dipilih.dari) terkaitTempat.add(dipilih.dari.id);
    if (dipilih.ke) terkaitTempat.add(dipilih.ke.id);
  }
  const presensiAktif = new Set(dipilih ? dipilih.presensi.map((p) => p.id) : []);

  const penangan = React.useMemo(() => {
    const m = new Map<string, L.LeafletEventHandlerFnMap>();
    for (const t of data.tempat) {
      const ids = t.tempat.kunjunganIds;
      // Sengaja tanpa sorot saat penunjuk di atas pil: sorot mengganti ikon (setIcon) di bawah
      // penunjuk, dan pergantian elemen di antara mousedown–mouseup menelan klik (terutama ketukan).
      m.set(t.tempat.id, {
        // Klik berulang berputar ke kunjungan berikutnya di tempat yang sama.
        click: () => {
          const i = dipilih ? ids.indexOf(dipilih.id) : -1;
          onPilih(ids[(i + 1) % ids.length] ?? null);
        },
      });
    }
    return m;
  }, [data, dipilih, onPilih]);

  const pilihSegmen = React.useMemo(() => {
    const m = new Map<string, L.LeafletEventHandlerFnMap>();
    for (const x of [...data.presensi, ...data.palsu]) {
      if (x.segmenId && !m.has(x.segmenId)) {
        const id = x.segmenId;
        m.set(id, { click: () => onPilih(id) });
      }
    }
    for (const x of data.terlihat) m.set(x.s.id, { click: () => onPilih(x.s.id) });
    return m;
  }, [data, onPilih]);

  return (
    <>
      {data.awal && <Marker position={data.awal} icon={ikonAwal()} interactive={false} keyboard={false} />}
      {data.akhir && <Marker position={data.akhir} icon={ikonAkhir()} interactive={false} keyboard={false} />}
      {data.terlihat.map(({ s, posisi }) => (
        <React.Fragment key={s.id}>
          {/* Lingkaran akurasi: satu titik saja tidak menunjukkan posisi setepat penandanya. */}
          {s.akurasiM != null && s.akurasiM > 15 && <Circle center={posisi} radius={s.akurasiM} {...gaya(GARIS.akurasi)} />}
          <Marker position={posisi} icon={ikonTerlihat(aktif.has(s.id))} keyboard={false} eventHandlers={pilihSegmen.get(s.id)}>
            <Tooltip direction="top" offset={[0, -8]} opacity={1}>
              Terlihat · {rentangJam(s)}
              {s.akurasiM != null ? ` · ±${Math.round(s.akurasiM)} m` : ""}
            </Tooltip>
          </Marker>
        </React.Fragment>
      ))}
      {data.tempat.map(({ tempat: t, posisi, nomor, rentang, presensi }) => {
        const ini = t.kunjunganIds.some((id) => aktif.has(id));
        const kerja = t.jenis === "lokasi_kerja";
        const kecil = ringkas.has(t.id);
        return (
          <Marker
            key={t.id}
            position={posisi}
            icon={kecil ? ikonTempatRingkas({ kerja, terkait: terkaitTempat.has(t.id) }) : ikonTempat({
              kerja,
              nomor,
              label: t.label,
              aktif: ini,
              terkait: terkaitTempat.has(t.id),
              presensi: presensi.map((x) => x.jenis),
              presensiBahaya: presensi.some((x) => x.cocok === "tidak_sesuai"),
              langsung: data.tempatLangsung === t.id,
            })}
            zIndexOffset={ini ? 1000 : kecil ? 0 : kerja ? 200 : 100}
            keyboard={false}
            riseOnHover
            eventHandlers={penangan.get(t.id)}
          >
            <Tooltip direction="top" offset={[0, -16]} opacity={1}>
              <span className="block w-max max-w-[260px] whitespace-normal">
                <span className="block font-semibold">{t.nama}</span>
                <span className="block text-muted">{kerja ? (t.lokasiKerja?.nonaktif ? "Lokasi kerja · nonaktif" : "Lokasi kerja") : "Bukan lokasi kerja · huruf berlaku untuk tanggal ini"}</span>
                {rentang.length > 0 && (
                  <span className="mt-0.5 block tabular-nums">
                    {rentang.length > 1 ? `${rentang.length} kunjungan: ` : ""}
                    {rentang.join(", ")}
                  </span>
                )}
                {presensi.map((x) => (
                  <span key={x.id} className="mt-0.5 block text-jenis-violet">
                    {labelPeristiwa(x)}
                  </span>
                ))}
                {data.tempatLangsung === t.id && data.langsung && (
                  <span className="mt-0.5 block font-medium text-info">Sedang di sini · posisi terkini {formatJam(data.langsung.t)}</span>
                )}
              </span>
            </Tooltip>
          </Marker>
        );
      })}
      {data.presensi.map(({ p, posisi, sisi, segmenId }) => (
        <Marker
          key={p.id}
          position={posisi}
          icon={ikonPresensi({ jenis: p.jenis, sisi, cocok: p.cocok, aktif: presensiAktif.has(p.id) })}
          zIndexOffset={1500}
          keyboard={false}
          eventHandlers={segmenId ? pilihSegmen.get(segmenId) : undefined}
        >
          <Tooltip direction="top" offset={[sisi === "kanan" ? 8 : -8, -38]} opacity={1}>
            <span className="block w-max max-w-[260px] whitespace-normal">
              <span className="block font-semibold">{labelPeristiwa(p)}</span>
              {p.namaLokasi && <span className="block text-muted">{p.namaLokasi}</span>}
            </span>
          </Tooltip>
        </Marker>
      ))}
      {data.palsu.map(({ d, posisi, segmenId }) => {
        const difokus = Boolean(fokus && fokus.lat === d.lat && fokus.lng === d.lng);
        return (
        <Marker
          key={d.id}
          position={posisi}
          icon={ikonPalsu(difokus)}
          zIndexOffset={1200}
          keyboard={false}
          eventHandlers={segmenId ? pilihSegmen.get(segmenId) : undefined}
        >
          {/* Tooltip dibuat ulang (key) saat difokuskan: opsi permanent hanya berlaku saat dibuat. */}
          {difokus ? (
            <Tooltip key="tetap" permanent direction="top" offset={[0, -10]} opacity={1}>
              <span className="font-semibold text-danger">Lokasi palsu · {formatJam(d.t)}</span>
            </Tooltip>
          ) : (
          <Tooltip key="arah" direction="top" offset={[0, -10]} opacity={1}>
            <span className="block w-max max-w-[260px] whitespace-normal">
              <span className="block font-semibold text-danger">Lokasi palsu · {formatJam(d.t)}</span>
              <span className="block text-muted">
                Ditandai sistem ponsel sebagai lokasi tiruan
                {d.jarakDariJejakM != null ? ` · ${formatJarak(d.jarakDariJejakM)} dari jejak` : ""}
                {" · "}tidak dipakai untuk garis
              </span>
            </span>
          </Tooltip>
          )}
        </Marker>
        );
      })}
      {fokus?.pasangan && (
        <Marker position={fokus.pasangan} icon={ikonPasangan()} zIndexOffset={1100} keyboard={false}>
          <Tooltip permanent direction="bottom" offset={[0, 10]} opacity={1}>
            Posisi jejak
          </Tooltip>
        </Marker>
      )}
      {fokus && fokus.alasan && fokus.alasan !== "palsu" && (
        <Marker key={`fokus-${fokus.kunci}`} position={[fokus.lat, fokus.lng]} icon={ikonDisaring(fokus.alasan)} zIndexOffset={1300} keyboard={false}>
          <Tooltip permanent direction="top" offset={[0, -10]} opacity={1}>
            {fokus.alasan === "janggal" ? "Titik janggal" : "Akurasi buruk"}
            {fokus.t != null ? ` · ${formatJam(fokus.t)}` : ""} · tidak dipakai
          </Tooltip>
        </Marker>
      )}
      {data.langsung && !data.tempatLangsung && (
        <>
          {data.langsung.akurasiM != null && data.langsung.akurasiM > 15 && (
            <Circle center={data.langsung.posisi} radius={data.langsung.akurasiM} {...gaya(GARIS.akurasi)} />
          )}
          <Marker position={data.langsung.posisi} icon={ikonLangsung()} zIndexOffset={2000} keyboard={false}>
            <Tooltip direction="top" offset={[0, -12]} opacity={1}>
              Posisi terkini · {formatJam(data.langsung.t)}
            </Tooltip>
          </Marker>
        </>
      )}
    </>
  );
}

/** Keterangan simbol peta; hanya menampilkan yang memang ada pada hari itu. */
function Keterangan({ linimasa, terbuka, onUbah }: { linimasa: Linimasa; terbuka: boolean; onUbah: () => void }) {
  const ada = React.useMemo(() => {
    const per = linimasa.segmen.filter((s): s is Perjalanan => s.jenis === "perjalanan");
    return {
      kendaraan: per.some((s) => s.moda !== "jalan" && !s.dataTipis),
      jalan: per.some((s) => s.moda === "jalan" && !s.dataTipis),
      tipis: per.some((s) => s.dataTipis),
      perkiraan: linimasa.segmen.some((s) => s.jenis === "jeda" && jedaBergaris(s)),
      kerja: linimasa.tempat.some((t) => t.jenis === "lokasi_kerja"),
      lain: linimasa.tempat.some((t) => t.jenis === "lain"),
      presensi: linimasa.presensi.some((p) => p.lat != null),
      palsu: linimasa.disaring.some((d) => d.alasan === "palsu"),
      langsung: Boolean(linimasa.posisiTerakhir?.segar),
    };
  }, [linimasa]);

  const garis = (kelas: string, dash?: string, casing = true) => (
    <svg width="30" height="10" viewBox="0 0 30 10" aria-hidden className="shrink-0">
      {casing && <line x1="4" y1="5" x2="26" y2="5" className="jejak-casing" strokeWidth="7" strokeLinecap="round" strokeDasharray={dash} />}
      <line x1="4" y1="5" x2="26" y2="5" className={kelas} strokeWidth={kelas === "jejak-perkiraan" ? 2.5 : 4} strokeLinecap={dash === "8 8" ? "butt" : "round"} strokeDasharray={dash} />
    </svg>
  );
  const baris = "flex items-center gap-2";

  if (!terbuka) {
    return (
      <button
        type="button"
        onClick={onUbah}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface/95 px-3 text-xs font-medium text-foreground shadow-md backdrop-blur hover:bg-surface-2"
        aria-expanded={false}
      >
        Keterangan <ChevronUp className="h-3.5 w-3.5" aria-hidden />
      </button>
    );
  }
  return (
    <div className="w-[210px] rounded-xl border border-border bg-surface/95 p-3 text-[11px] text-foreground shadow-md backdrop-blur">
      <button type="button" onClick={onUbah} className="-mt-1 mb-1.5 flex w-full items-center justify-between text-xs font-semibold" aria-expanded>
        Keterangan <ChevronDown className="h-3.5 w-3.5 text-muted" aria-hidden />
      </button>
      <ul className="space-y-1.5">
        {ada.kendaraan && <li className={baris}>{garis("jejak-utama")}Berkendara / berpindah</li>}
        {ada.jalan && <li className={baris}>{garis("jejak-utama", "1 9")}Jalan kaki</li>}
        {ada.tipis && <li className={baris}>{garis("jejak-utama", "8 8")}Rute tidak terekam</li>}
        {ada.perkiraan && <li className={baris}>{garis("jejak-perkiraan", "2 6", false)}Tanpa data (perkiraan)</li>}
        {ada.kerja && (
          <li className={baris}>
            <span className="grid h-4 w-[30px] shrink-0 place-items-center"><span className="h-3.5 w-5 rounded-full border-[1.5px] border-surface bg-primary shadow-sm" /></span>Lokasi kerja
          </li>
        )}
        {ada.lain && (
          <li className={baris}>
            <span className="grid h-4 w-[30px] shrink-0 place-items-center"><span className="h-3.5 w-5 rounded-full border-[1.5px] border-surface bg-secondary shadow-sm" /></span>Tempat lain
          </li>
        )}
        {ada.presensi && (
          <li className={baris}>
            <span className="grid h-4 w-[30px] shrink-0 place-items-center"><span className="h-3 w-3 rounded-[3px] bg-jenis-violet" /></span>Presensi masuk/pulang
          </li>
        )}
        {ada.palsu && (
          <li className={baris}>
            <span className="grid h-4 w-[30px] shrink-0 place-items-center"><span className="h-2.5 w-2.5 rotate-45 rounded-[2px] bg-danger" /></span>Lokasi palsu
          </li>
        )}
        {ada.langsung && (
          <li className={baris}>
            <span className="grid h-4 w-[30px] shrink-0 place-items-center"><span className="h-3 w-3 rounded-full border-2 border-surface bg-info shadow-sm" /></span>Posisi terkini
          </li>
        )}
        {ada.kerja && (
          <li className={baris}>
            <span className="grid h-4 w-[30px] shrink-0 place-items-center"><span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-dashed border-primary bg-primary/10" /></span>Batas lokasi kerja
          </li>
        )}
      </ul>
    </div>
  );
}

const KUNCI_KETERANGAN = "pemantauan.keterangan";

const TOMBOL_KONTROL = "grid h-10 w-10 place-items-center text-foreground transition-colors hover:bg-surface-2 disabled:opacity-40 md:h-9 md:w-9";

/**
 * Peta linimasa: garis per perjalanan (biru, bercasing), garis perkiraan
 * putus-putus untuk jeda, pil nomor urut per tempat, bendera presensi, dan
 * belah ketupat untuk titik palsu. Dimuat lewat next/dynamic ssr:false.
 */
export default function PetaLinimasa(p: PropsPetaLinimasa) {
  const { linimasa, dipilihId, sorotId, onPilih, kurangiGerak } = p;
  const [peta, setPeta] = React.useState<L.Map | null>(null);
  // Keterangan bawaan terlipat supaya tidak menutupi jejak; pilihan pengguna diingat di peramban ini.
  const [keterangan, setKeterangan] = React.useState(() => {
    try {
      return localStorage.getItem(KUNCI_KETERANGAN) === "1";
    } catch {
      return false;
    }
  });
  const ubahKeterangan = () => {
    const baru = !keterangan;
    setKeterangan(baru);
    try {
      localStorage.setItem(KUNCI_KETERANGAN, baru ? "1" : "0");
    } catch {
      /* penyimpanan diblokir: cukup untuk sesi ini */
    }
  };

  const segmenPerId = React.useMemo(() => new Map((linimasa?.segmen ?? []).map((s) => [s.id, s])), [linimasa]);
  const dipilih = dipilihId ? (segmenPerId.get(dipilihId) ?? null) : null;
  const disorot = sorotId && sorotId !== dipilihId ? (segmenPerId.get(sorotId) ?? null) : null;
  const kosong = linimasa != null && !linimasa.batas && linimasa.disaring.length === 0;

  const paskan = () => {
    onPilih(null);
    if (peta && linimasa) paskanHari(peta, linimasa, !kurangiGerak);
  };
  const keTerkini = () => {
    const t = linimasa?.posisiTerakhir;
    if (!peta || !t) return;
    if (kurangiGerak) peta.setView([t.lat, t.lng], 17, { animate: false });
    else peta.flyTo([t.lat, t.lng], 17, { duration: 0.6 });
  };

  return (
    <div
      // Selama tanggal lain dimuat, jejak lama diredupkan dan tidak bisa dipilih (segmennya akan hilang).
      className={cn("peta-linimasa relative isolate h-full w-full overflow-hidden", p.memuat && "[&_.leaflet-map-pane]:pointer-events-none [&_.leaflet-overlay-pane]:opacity-50 [&_.leaflet-marker-pane]:opacity-50")}
      data-redup={dipilih ? "true" : undefined}
      role="region"
      aria-label="Peta jejak perjalanan"
      aria-busy={p.memuat}
    >
      <MapContainer
        ref={setPeta}
        center={p.pusatAwal}
        zoom={14}
        minZoom={4}
        maxZoom={19}
        zoomControl={false}
        attributionControl={false}
        scrollWheelZoom
        zoomAnimation={!kurangiGerak}
        markerZoomAnimation={!kurangiGerak}
        fadeAnimation={!kurangiGerak}
        className="peta-tema z-0 h-full w-full"
      >
        <TileLayer url={UBIN} attribution={ATRIBUSI} maxZoom={19} />
        <AttributionControl prefix={PREFIKS_LEAFLET} />
        {linimasa && (
          <>
            <Pane name="geofence" style={{ zIndex: 350 }}>
              <LapisGeofence linimasa={linimasa} lokasiKerja={p.lokasiKerja} />
            </Pane>
            <LapisJejak linimasa={linimasa} onPilih={onPilih} onSorot={p.onSorot} />
            <Pane name="panah" style={{ zIndex: 450, pointerEvents: "none" }}>
              <LapisPanah linimasa={linimasa} />
            </Pane>
            <Pane name="sorot" style={{ zIndex: 460, pointerEvents: "none" }}>
              {disorot && <LapisSorot key={`s-${disorot.id}`} segmen={disorot} utama={false} />}
              {dipilih && <LapisSorot key={`d-${dipilih.id}`} segmen={dipilih} utama />}
              {p.fokus?.pasangan && (
                <Polyline key={`f-${p.fokus.kunci}`} positions={[[p.fokus.lat, p.fokus.lng], p.fokus.pasangan]} {...gaya(GARIS.palsu)}>
                  {p.fokus.jarakM != null && (
                    <Tooltip permanent direction="center" opacity={1} pane="tooltipPane" className="!px-1.5 !py-0.5">
                      <span className="text-[11px] font-semibold text-danger">{formatJarak(p.fokus.jarakM)}</span>
                    </Tooltip>
                  )}
                </Polyline>
              )}
            </Pane>
            <LapisPenanda linimasa={linimasa} dipilih={dipilih} sorotId={sorotId} fokus={p.fokus} onPilih={onPilih} />
          </>
        )}
        <Kamera linimasa={linimasa} kunciData={p.kunciData} dipilih={dipilih} fokus={p.fokus} paskanKunci={p.paskanKunci} kurangiGerak={kurangiGerak} />
        <KlikKosong onPilih={onPilih} />
      </MapContainer>

      {p.memuat && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-14">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/95 px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden /> {p.labelMemuat}
          </span>
        </div>
      )}

      {kosong && !p.memuat && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-6">
          <span className="rounded-xl border border-border bg-surface/90 px-4 py-2.5 text-sm text-muted shadow-md backdrop-blur">Tidak ada titik lokasi pada tanggal ini</span>
        </div>
      )}

      <div className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-xl border border-border bg-surface/95 shadow-md backdrop-blur">
        <button type="button" className={cn(TOMBOL_KONTROL, "[@media(pointer:coarse)]:hidden")} onClick={() => peta?.zoomIn()} title="Perbesar" aria-label="Perbesar">
          <Plus className="h-[18px] w-[18px]" aria-hidden />
        </button>
        <button type="button" className={cn(TOMBOL_KONTROL, "border-t border-border [@media(pointer:coarse)]:hidden")} onClick={() => peta?.zoomOut()} title="Perkecil" aria-label="Perkecil">
          <Minus className="h-[18px] w-[18px]" aria-hidden />
        </button>
        <button type="button" className={cn(TOMBOL_KONTROL, "border-t border-border [@media(pointer:coarse)]:border-t-0")} onClick={paskan} data-kamera-ulang disabled={!linimasa?.batas && !linimasa?.disaring.length} title="Paskan seluruh jejak" aria-label="Paskan seluruh jejak">
          <Maximize2 className="h-[17px] w-[17px]" aria-hidden />
        </button>
        {linimasa?.hariIni && linimasa.posisiTerakhir && (
          <button type="button" className={cn(TOMBOL_KONTROL, "border-t border-border")} onClick={keTerkini} title="Ke posisi terakhir" aria-label="Ke posisi terakhir">
            <LocateFixed className="h-[18px] w-[18px]" aria-hidden />
          </button>
        )}
        {p.besar != null && (
          <button
            type="button"
            className={cn(TOMBOL_KONTROL, "border-t border-border")}
            onClick={p.onBesar}
            data-kamera-ulang
            title={p.besar ? "Kecilkan peta" : "Perbesar peta"}
            aria-label={p.besar ? "Kecilkan peta" : "Perbesar peta"}
            aria-pressed={p.besar}
          >
            {p.besar ? <FoldVertical className="h-[18px] w-[18px]" aria-hidden /> : <UnfoldVertical className="h-[18px] w-[18px]" aria-hidden />}
          </button>
        )}
      </div>

      {linimasa && !kosong && (
        <div className="absolute bottom-3 left-3 z-10" data-kamera-ulang>
          <Keterangan linimasa={linimasa} terbuka={keterangan} onUbah={ubahKeterangan} />
        </div>
      )}
    </div>
  );
}
