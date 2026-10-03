// Linimasa riwayat lokasi: mengubah titik mentah Pemantauan Lokasi menjadi
// rangkaian singgah, perjalanan, dan jeda seperti linimasa Google Maps.
//
// Modul ini MURNI: tanpa import runtime (hanya `import type`), tanpa React,
// Leaflet, date-fns, atau alias path — supaya bisa diuji langsung dengan
// `node --experimental-strip-types` dan hasilnya sama di peramban dan tes.
//
// KONTRAK: nama tipe dan field di bawah dipakai komponen
// components/pemantauan/*. Field boleh ditambah; jangan mengganti nama atau
// menghapus tanpa memperbarui komponennya.

// ---------------------------------------------------------------- masukan

/** Sama dengan TitikPantauan dari /location-tracking/employees/:id/trail. */
export interface TitikMasuk {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  isMocked: boolean;
  recordedAt: string;
  receivedAt?: string | null;
}

/** Lokasi kerja dari /work-locations (koordinat bisa string bila Decimal). */
export interface LokasiKerjaMasuk {
  id: string;
  name: string;
  address: string | null;
  latitude: number | string;
  longitude: number | string;
  radiusMeters: number;
  isActive: boolean;
}

/** Presensi dari /attendance (koordinat sudah didekripsi backend). */
export interface PresensiMasuk {
  id: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  checkInLatitude?: number | null;
  checkInLongitude?: number | null;
  checkOutLatitude?: number | null;
  checkOutLongitude?: number | null;
  checkInMethod?: string | null;
  checkOutMethod?: string | null;
  status?: string | null;
  lateMinutes?: number | null;
  earlyLeaveMinutes?: number | null;
  integrityFlags?: string[] | null;
  faceVerified?: boolean | null;
  checkInSyncedAt?: string | null;
  checkOutSyncedAt?: string | null;
  workLocation?: { id: string; name: string; address?: string | null } | null;
}

export interface MasukanLinimasa {
  titik: TitikMasuk[];
  lokasiKerja: LokasiKerjaMasuk[];
  /** Presensi tanggal D-1..D; peristiwa di luar tanggal D diabaikan. */
  presensi: PresensiMasuk[];
  /** "YYYY-MM-DD" dalam zona operasional (WIB). */
  tanggal: string;
  /** Date.now() saat dihitung; menentukan "hari ini" dan segmen yang masih berlangsung. */
  sekarang: number;
  /** Pengaturan pemantauan saat ini. */
  intervalMenit: number;
  mode: "always" | "while_working";
}

// ---------------------------------------------------------------- keluaran

export type JenisTempat = "lokasi_kerja" | "lain";

/** Satu tempat yang dikunjungi (bisa beberapa kali) pada hari itu. */
export interface Tempat {
  /** "lk:<workLocationId>" | "t:<n>" — stabil dalam satu hasil. */
  id: string;
  jenis: JenisTempat;
  /** "Outlet Sudirman (uji)" | "Tempat A" (huruf urut kemunculan; sengaja tidak menebak "rumah"). */
  nama: string;
  /** Huruf untuk jenis "lain" ("A", "B", …); "" untuk lokasi kerja. */
  label: string;
  /** Alamat lokasi kerja, atau "±510 m barat daya Outlet Sudirman (uji)", atau null. */
  keterangan: string | null;
  /** Pusat (median) semua kunjungan — tempat penanda digambar. */
  lat: number;
  lng: number;
  lokasiKerja: { id: string; nama: string; lat: number; lng: number; radiusM: number; nonaktif: boolean } | null;
  /** id segmen singgah/terlihat di tempat ini, urut waktu. */
  kunjunganIds: string[];
}

export type CocokPresensi = "sesuai" | "tidak_sesuai" | "tanpa_titik" | "tanpa_koordinat";

export interface PeristiwaPresensi {
  /** "<presensiId>:masuk" | "<presensiId>:pulang". */
  id: string;
  jenis: "masuk" | "pulang";
  t: number;
  lat: number | null;
  lng: number | null;
  presensiId: string;
  namaLokasi: string | null;
  /** gps | qr | face | … apa adanya dari backend. */
  metode: string | null;
  status: string | null;
  terlambatMenit: number;
  pulangCepatMenit: number;
  tandaIntegritas: string[];
  wajahTerverifikasi: boolean;
  /** Diambil offline dan dikirim belakangan (checkInSyncedAt/checkOutSyncedAt terisi). */
  offline: boolean;
  /** Posisi presensi dibanding posisi jejak terdekat pada waktunya. */
  cocok: CocokPresensi;
  jarakKeJejakM: number | null;
  /** Waktu titik jejak pembanding (untuk "jejak 07:40 berjarak 3,1 km"); null bila tidak ada. */
  waktuJejak: number | null;
}

export type AlasanSaring = "palsu" | "akurasi" | "janggal";

/** Titik yang tidak dipakai untuk garis, singgah, maupun jarak — tetap ditampilkan sebagai temuan. */
export interface TitikDisaring {
  id: string;
  alasan: AlasanSaring;
  t: number;
  lat: number;
  lng: number;
  akurasiM: number | null;
  /** Jarak dari posisi jejak terdekat pada waktunya (m), bila ada. */
  jarakDariJejakM: number | null;
}

/** Titik yang dipakai (sudah disaring), urut waktu. */
export interface TitikJejak {
  t: number;
  lat: number;
  lng: number;
  akurasiM: number | null;
  /** Diterima server jauh setelah dicatat (antrean offline). */
  tertunda: boolean;
}

interface SegmenDasar {
  /** Unik dalam satu hasil, stabil untuk data yang sama (mis. "singgah-<ms>"). */
  id: string;
  mulai: number;
  selesai: number;
  /** floor(selesai per menit) − floor(mulai per menit): "07:40–12:01" selalu "4 j 21 mnt". */
  durasiMs: number;
  /** Hari ini dan masih berlangsung sampai `sekarang`. */
  berlangsung: boolean;
  /** Segmen pertama dimulai ≤ ambang jeda setelah 00:00: kemungkinan berlanjut dari hari sebelumnya. */
  berlanjutDariKemarin: boolean;
  /** Hari lalu, segmen terakhir berakhir ≤ ambang jeda sebelum 24:00: kemungkinan berlanjut ke hari berikutnya. */
  berlanjutKeBesok: boolean;
  presensi: PeristiwaPresensi[];
  disaring: TitikDisaring[];
}

export interface Singgah extends SegmenDasar {
  jenis: "singgah";
  /** Nomor urut singgah hari itu (1, 2, 3, …) — sama dengan nomor di penanda peta. */
  urutan: number;
  tempat: Tempat;
  /** Kunjungan ke-n ke tempat ini hari itu (mulai 1). */
  kunjunganKe: number;
  /** Pusat (median) titik singgah ini. */
  lat: number;
  lng: number;
  /** Persentil-90 jarak titik ke pusat (min 25 m) — lingkaran sebaran. */
  sebaranM: number;
  akurasiMedianM: number | null;
  jumlahTitik: number;
  /** Bagian tanpa data di dalam singgah (mis. ponsel Doze malam hari). */
  jedaDalam: { mulai: number; selesai: number }[];
  jedaDalamMs: number;
  /** Titik mentah singgah ini [lat, lng] — digambar saat dipilih. */
  titik: [number, number][];
}

export type Moda = "jalan" | "kendaraan" | "tidak_diketahui" | "jauh";

export interface Perjalanan extends SegmenDasar {
  jenis: "perjalanan";
  moda: Moda;
  /** Jarak sepanjang titik (getaran GPS kecil tidak dihitung). */
  jarakM: number;
  kecepatanRataKmj: number;
  kecepatanPuncakKmj: number;
  /** Garis yang digambar: berawal/berakhir di pusat singgah tetangga bila ada. */
  jalur: [number, number][];
  jumlahTitik: number;
  /** Kurang dari 2 titik di tengah perjalanan: rute sebenarnya tidak terekam (garis lurus). */
  dataTipis: boolean;
  dari: Tempat | null;
  ke: Tempat | null;
  /** Ujung tanpa singgah yang jatuh di/dekat lokasi kerja atau tempat: "Outlet Monas 4090". */
  dariSekitar: string | null;
  keSekitar: string | null;
}

/** Satu titik saja (atau beberapa titik rapat < durasi singgah) tanpa perjalanan. */
export interface Terlihat extends SegmenDasar {
  jenis: "terlihat";
  lat: number;
  lng: number;
  akurasiM: number | null;
  jumlahTitik: number;
  tempat: Tempat | null;
  /** Nama lokasi kerja/tempat di sekitar titik ini, bila ada. */
  sekitar: string | null;
}

export interface Jeda extends SegmenDasar {
  jenis: "jeda";
  /** awal = sebelum titik pertama hari itu; akhir = setelah titik terakhir. */
  posisi: "awal" | "tengah" | "akhir";
  dari: [number, number] | null;
  ke: [number, number] | null;
  /** Garis lurus dari posisi sebelum ke sesudah jeda. */
  perpindahanM: number | null;
  /** Sebelum dan sesudah jeda di tempat yang sama. */
  tempatSama: boolean;
  /** Garis perkiraan: dari → koordinat presensi di dalam jeda → ke. */
  jalurPerkiraan: [number, number][];
  /** Mode while_working dan jeda di luar jam presensi: pemantauan memang tidak berjalan. */
  luarJamPantau: boolean;
}

export type Segmen = Singgah | Perjalanan | Terlihat | Jeda;

export type NadaTemuan = "danger" | "warning" | "info";

export type KodeTemuan =
  | "palsu"
  | "presensi_tidak_sesuai"
  | "presensi_tanpa_titik"
  | "jeda_jam_presensi"
  | "tidak_melapor"
  | "data_jarang"
  | "akurasi"
  | "janggal"
  | "tertunda";

/** Hal yang perlu diperiksa Super Admin, sudah berupa kalimat bahasa Indonesia. */
export interface Temuan {
  id: string;
  kode: KodeTemuan;
  nada: NadaTemuan;
  judul: string;
  rincian: string;
  /** Segmen yang dipilih saat temuan diklik (bisa null). */
  segmenId: string | null;
  /** Titik yang difokuskan di peta (mis. titik palsu), bila ada. */
  lat: number | null;
  lng: number | null;
}

export interface RingkasanHari {
  jarakM: number;
  jumlahPerjalanan: number;
  jumlahSinggah: number;
  jumlahTempat: number;
  diLokasiKerjaMs: number;
  jumlahLokasiKerja: number;
  diamMs: number;
  bergerakMs: number;
  tanpaDataMs: number;
  /** Bagian waktu (0..1) yang terekam dari 00:00 sampai 24:00 (atau sampai sekarang untuk hari ini); null bila tidak ada waktu berlalu. */
  cakupan: number | null;
  pertama: number | null;
  terakhir: number | null;
  /** Interval titik dari data (median, menit). */
  intervalMenit: number | null;
  ambangJedaMenit: number;
  titik: { total: number; dipakai: number; palsu: number; akurasi: number; janggal: number; tertunda: number };
  /** Akurasi buruk sepanjang hari: ambang akurasi dilonggarkan, hasil hanya perkiraan. */
  akurasiLonggar: boolean;
  /** Rentang presensi pada hari itu (masuk pertama → pulang terakhir / sekarang / akhir hari). */
  jamPresensi: { mulai: number; selesai: number; terbuka: boolean } | null;
  /** Waktu di lokasi kerja yang beririsan dengan jam presensi. */
  diLokasiKerjaSaatPresensiMs: number | null;
  /** Kalimat ringkas, mis. "Presensi 07:42–17:33 di Outlet Sudirman (uji) · 76% jam presensi di lokasi kerja." */
  kesimpulan: string;
}

export interface Linimasa {
  tanggal: string;
  awalHari: number;
  akhirHari: number;
  hariIni: boolean;
  sekarang: number;
  segmen: Segmen[];
  tempat: Tempat[];
  /** Semua peristiwa presensi pada tanggal ini, urut waktu. */
  presensi: PeristiwaPresensi[];
  titik: TitikJejak[];
  disaring: TitikDisaring[];
  temuan: Temuan[];
  ringkasan: RingkasanHari;
  /** [[latMin, lngMin], [latMax, lngMax]] dari titik dipakai + koordinat presensi; tanpa titik disaring. */
  batas: [[number, number], [number, number]] | null;
  /** Titik dipakai terakhir; segar = hari ini dan belum melewati ambang jeda. */
  posisiTerakhir: { t: number; lat: number; lng: number; akurasiM: number | null; segar: boolean } | null;
}

// ---------------------------------------------------------------- konstanta

/** Zona operasional = APP_TIMEZONE backend (Asia/Jakarta, tanpa DST). */
export const ZONA_OFFSET_MENIT = 420;

export const KONSTANTA_LINIMASA = {
  /** Akurasi lebih buruk = fix jaringan/BTS; geofence 80–100 m tidak bisa dinilai dengannya. */
  akurasiMaksM: 150,
  /** Dipakai bila > porsiLonggar titik non-palsu melampaui akurasiMaksM (hasil hanya perkiraan). */
  akurasiLonggarM: 500,
  porsiLonggar: 0.7,
  /** Pulau lompatan: potongan kecil yang dipisah loncatan mustahil (≥ 2 km, > 250 km/j) dari sisa titik. */
  lompatanMinM: 2000,
  lompatanKmj: 250,
  /** Di atas kecepatan pesawat komersial: potongan kecil selalu janggal, berapa pun jedanya. */
  mustahilKmj: 1000,
  pulauMaksTitik: 3,
  pulauMaksMenit: 30,
  pulauMaksPorsi: 0.2,
  /** Lonjakan satu titik pergi-pulang di kota (multipath / Wi-Fi). */
  lonjakanMinM: 500,
  lonjakanRasio: 0.35,
  lonjakanKmj: 60,
  /** Ambang jeda G = max(30 mnt, 3 × interval): sama dengan aturan "Tidak melapor", lantai 30 mnt untuk Doze. */
  jedaMinMenit: 30,
  jedaKaliInterval: 3,
  radiusSinggahM: 100,
  goyangMaksM: 250,
  goyangMaksTitik: 2,
  minSinggahMenit: 8,
  /** Tidur/Doze ≤ 4 jam di tempat sama tetap satu singgah ("termasuk 3 j 31 mnt tanpa data"). */
  gabungJedaMaksMenit: 240,
  langkahKeluarMaksMenit: 10,
  tempatSamaM: 150,
  /** Presensi/titik kasar sejauh ini dari tempat di dalam jeda = bukti sempat ke tempat lain. */
  buktiLainM: 250,
  toleransiLokasiKerjaM: 50,
  rujukanMaksM: 5000,
  tertundaMinMenit: 30,
  cocokPresensiM: 200,
  jendelaPresensiMinMenit: 20,
  jendelaPresensiKali: 1.5,
  /** Laju tertinggi yang masih wajar di kota: posisi presensi yang lebih jauh dari jangkauannya = mustahil. */
  presensiMaksKmj: 60,
  /** Jalan memutar yang masih wajar di antara dua titik bersambung (bagian dari jarak keduanya). */
  presensiSimpangRasio: 0.5,
  penipisanM: 15,
  jauhM: 100_000,
  jauhKmj: 150,
  kendaraanRataKmj: 8,
  kendaraanPuncakKmj: 15,
  jalanMaksKmj: 6.5,
  jalanRapatMenit: 10,
  dataJarangCakupan: 0.5,
} as const;

/** Label moda untuk teks UI. */
export const LABEL_MODA: Record<Moda, string> = {
  jalan: "Jalan kaki",
  kendaraan: "Berkendara",
  tidak_diketahui: "Berpindah",
  jauh: "Perpindahan jauh",
};

// ---------------------------------------------------------------- fungsi

const MENIT = 60_000;
const JAM = 3_600_000;
const HARI = 86_400_000;
const OFFSET_MS = ZONA_OFFSET_MENIT * MENIT;
const K = KONSTANTA_LINIMASA;

type LatLng = { lat: number; lng: number };
type Rentang = { mulai: number; selesai: number };

interface TitikOlah extends LatLng {
  t: number;
  akurasi: number | null;
  palsu: boolean;
  tertunda: boolean;
  terlambatMs: number | null;
}

interface LokasiOlah extends LatLng {
  id: string;
  nama: string;
  alamat: string | null;
  radiusM: number;
  aktif: boolean;
}

type BlokDiam = { jenis: "singgah"; titik: TitikOlah[]; jedaDalam: Rentang[] } | { jenis: "terlihat"; titik: TitikOlah[] };
type BlokGerak = { jenis: "gerak"; titik: TitikOlah[]; sebelum: TitikOlah | null; sesudah: TitikOlah | null };
type Blok = BlokDiam | BlokGerak | { jenis: "jeda"; mulai: number; selesai: number };

interface InfoDiam {
  pusat: LatLng;
  akurasiMedian: number | null;
  lokasi: LokasiOlah | null;
}

const median = (xs: number[]): number => {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const persentil = (xs: number[], p: number): number => {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
};
const pusatMedian = (ps: LatLng[]): LatLng => ({ lat: median(ps.map((p) => p.lat)), lng: median(ps.map((p) => p.lng)) });
const akurasiMedian = (ps: TitikOlah[]): number | null => {
  const a = ps.filter((p) => p.akurasi !== null).map((p) => p.akurasi as number);
  return a.length ? median(a) : null;
};
/** Durasi yang konsisten dengan jam tampil: "07:40–12:01" selalu 4 j 21 mnt. */
const durasiTampil = (mulai: number, selesai: number) => Math.max(0, Math.floor(selesai / MENIT) - Math.floor(mulai / MENIT)) * MENIT;
const irisan = (a: Rentang, b: Rentang) => Math.max(0, Math.min(a.selesai, b.selesai) - Math.max(a.mulai, b.mulai));
const kmj = (m: number, ms: number) => (ms > 0 ? m / 1000 / (ms / JAM) : 0);
const bulat1 = (x: number) => Math.round(x * 10) / 10;
const angkaAtauNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const persen = (x: number) => (x > 0 && x < 0.005 ? "< 1%" : `${Math.round(x * 100)}%`);
/** Keterlambatan kirim bisa berhari-hari (antrean offline): "2 hari 17 j". */
const durasiKasar = (ms: number) => {
  if (ms < HARI) return formatDurasi(ms);
  const hari = Math.floor(ms / HARI);
  const j = Math.floor((ms % HARI) / JAM);
  return j ? `${hari} hari ${j} j` : `${hari} hari`;
};

const LABEL_ALASAN: Record<AlasanSaring, string> = { palsu: "lokasi palsu", akurasi: "akurasi rendah", janggal: "janggal" };
/** "21 titik lokasi palsu" · "24 titik (lokasi palsu, akurasi rendah)". */
const ringkasDisaring = (xs: { alasan: AlasanSaring }[]) => {
  const jenis = [...new Set(xs.map((x) => x.alasan))];
  return jenis.length === 1 ? `${xs.length} titik ${LABEL_ALASAN[jenis[0]]}` : `${xs.length} titik (${jenis.map((a) => LABEL_ALASAN[a]).join(", ")})`;
};

const MATA_ANGIN = ["utara", "timur laut", "timur", "tenggara", "selatan", "barat daya", "barat", "barat laut"];
function arahDerajat(a: LatLng, b: LatLng): number {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dl = rad(b.lng - a.lng);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Kecepatan setelah dikurangi galat kedua titik (maks 100 m) — getaran GPS tidak jadi "kecepatan mustahil". */
function kecepatanEfektif(a: TitikOlah, b: TitikOlah): number {
  const d = Math.max(0, jarakM(a, b) - Math.min(a.akurasi ?? 0, 100) - Math.min(b.akurasi ?? 0, 100));
  return kmj(d, Math.max(Math.abs(b.t - a.t), MENIT));
}

/** Jarak (m) dari p ke ruas a–b, dengan proyeksi datar di sekitar p (cukup teliti untuk beberapa km). */
function jarakKeRuas(p: LatLng, a: LatLng, b: LatLng): number {
  const ky = (R_BUMI * Math.PI) / 180;
  const kx = ky * Math.cos(rad(p.lat));
  const ax = (a.lng - p.lng) * kx;
  const ay = (a.lat - p.lat) * ky;
  const dx = (b.lng - a.lng) * kx;
  const dy = (b.lat - a.lat) * ky;
  const L2 = dx * dx + dy * dy;
  const f = L2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
  return Math.hypot(ax + f * dx, ay + f * dy);
}

function olahLokasi(daftar: LokasiKerjaMasuk[]): LokasiOlah[] {
  const hasil: LokasiOlah[] = [];
  for (const l of daftar ?? []) {
    const lat = angkaAtauNull(l.latitude);
    const lng = angkaAtauNull(l.longitude);
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const r = angkaAtauNull(l.radiusMeters);
    hasil.push({ id: l.id, nama: l.name, alamat: l.address ?? null, lat, lng, radiusM: r !== null && r > 0 ? r : 100, aktif: l.isActive !== false });
  }
  return hasil;
}

/**
 * Lokasi kerja yang memuat p (radius + toleransi); bila tumpang tindih, d/radius terkecil menang.
 * Lokasi aktif selalu didahulukan: outlet yang dipindah/dibuat ulang meninggalkan versi nonaktif di titik yang sama.
 */
function lokasiMemuat(p: LatLng, lokasi: LokasiOlah[], toleransiM: number): LokasiOlah | null {
  let terbaik: LokasiOlah | null = null;
  let skorTerbaik = Infinity;
  for (const l of lokasi) {
    const batas = l.radiusM + toleransiM;
    // Saringan murah sebelum haversine: selisih lintang saja sudah melewati batas.
    if (Math.abs(p.lat - l.lat) * 111_000 > batas) continue;
    const d = jarakM(p, l);
    if (d > batas) continue;
    const skor = d / l.radiusM + (l.aktif ? 0 : 1e6);
    if (skor < skorTerbaik) {
      skorTerbaik = skor;
      terbaik = l;
    }
  }
  return terbaik;
}

function lokasiTerdekat(p: LatLng, lokasi: LokasiOlah[], maksM: number): { l: LokasiOlah; d: number } | null {
  let terbaik: { l: LokasiOlah; d: number } | null = null;
  for (const l of lokasi) {
    const d = jarakM(p, l);
    if (d <= maksM && (!terbaik || d < terbaik.d)) terbaik = { l, d };
  }
  return terbaik;
}

/** "±510 m barat daya Outlet Sudirman (uji)" — rujukan ke lokasi kerja terdekat (≤ 5 km), tanpa geocoding. */
function keteranganRelatif(p: LatLng, lokasi: LokasiOlah[]): string | null {
  const t = lokasiTerdekat(p, lokasi, K.rujukanMaksM);
  if (!t) return null;
  const arah = MATA_ANGIN[Math.round(arahDerajat(t.l, p) / 45) % 8];
  return `±${formatJarak(t.d)} ${arah} ${t.l.nama}`;
}

function normalisasi(titik: TitikMasuk[], awal: number, akhir: number, ambangTertundaMs: number): TitikOlah[] {
  const ok: TitikOlah[] = [];
  for (const p of titik ?? []) {
    if (!p) continue;
    const t = Date.parse(p.recordedAt);
    const lat = angkaAtauNull(p.latitude);
    const lng = angkaAtauNull(p.longitude);
    if (!Number.isFinite(t) || lat === null || lng === null) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) continue;
    if (t < awal || t >= akhir) continue;
    const a = angkaAtauNull(p.accuracyMeters);
    const diterima = p.receivedAt ? Date.parse(p.receivedAt) : NaN;
    const terlambatMs = Number.isFinite(diterima) ? diterima - t : null;
    ok.push({
      t,
      lat,
      lng,
      // Akurasi kosong/0 = tidak diketahui (aplikasi lama) → tetap dipakai.
      akurasi: a !== null && a > 0 ? a : null,
      palsu: Boolean(p.isMocked),
      terlambatMs,
      tertunda: terlambatMs !== null && terlambatMs > ambangTertundaMs,
    });
  }
  // Waktu kembar: simpan yang bukan palsu lalu yang paling akurat.
  const skor = (p: TitikOlah) => (p.palsu ? 1e9 : 0) + (p.akurasi ?? 1e6);
  ok.sort((a, b) => a.t - b.t || skor(a) - skor(b));
  const unik: TitikOlah[] = [];
  for (const p of ok) if (!unik.length || unik[unik.length - 1].t !== p.t) unik.push(p);
  return unik;
}

/**
 * Titik janggal tanpa isMocked: (a) pulau kecil yang dipisah lompatan mustahil dari sisa titik
 * (2 titik California 1 menit sebelum Jakarta), (b) lonjakan satu titik pergi-pulang.
 * Penerbangan sungguhan tetap utuh: pulaunya besar, atau jedanya lama dan tidak kembali.
 */
function saringJanggal(titik: TitikOlah[]): { bersih: TitikOlah[]; janggal: TitikOlah[] } {
  let arr = titik;
  const janggal: TitikOlah[] = [];
  const lompatan = (a: TitikOlah, b: TitikOlah) => jarakM(a, b) >= K.lompatanMinM && kecepatanEfektif(a, b) > K.lompatanKmj;
  for (let putaran = 0; putaran < 10; putaran++) {
    let berubah = false;

    if (arr.length > 1) {
      const pulau: TitikOlah[][] = [[arr[0]]];
      for (let i = 1; i < arr.length; i++) {
        if (lompatan(arr[i - 1], arr[i])) pulau.push([arr[i]]);
        else pulau[pulau.length - 1].push(arr[i]);
      }
      if (pulau.length > 1) {
        const kecil = (X: TitikOlah[]) =>
          X.length <= K.pulauMaksTitik && X[X.length - 1].t - X[0].t <= K.pulauMaksMenit * MENIT && X.length <= K.pulauMaksPorsi * arr.length;
        // Pulau kecil yang berdampingan dinilai sebagai satu kelompok terhadap pulau besar di kiri-kanannya;
        // tanpa pulau besar sama sekali (mis. titik bolak-balik tiap menit) tidak ada yang dibuang di sini.
        const buang = new Set<TitikOlah[]>();
        for (let k = 0; k < pulau.length; ) {
          if (!kecil(pulau[k])) {
            k++;
            continue;
          }
          let akhirK = k;
          while (akhirK + 1 < pulau.length && kecil(pulau[akhirK + 1])) akhirK++;
          const kelompok = pulau.slice(k, akhirK + 1);
          const X = kelompok.flat();
          const P = k > 0 ? pulau[k - 1] : null;
          const Q = akhirK < pulau.length - 1 ? pulau[akhirK + 1] : null;
          k = akhirK + 1;
          if ((!P && !Q) || !kecil(X)) continue;
          const x0 = X[0];
          const xn = X[X.length - 1];
          const a = P ? P[P.length - 1] : null;
          const c = Q ? Q[0] : null;
          let ya: boolean;
          if (a && c) {
            // Di tengah: pergi lalu kembali ke dekat asal, atau kedua loncatannya melebihi pesawat.
            ya = jarakM(a, c) < 0.5 * Math.min(jarakM(a, x0), jarakM(xn, c)) || (kecepatanEfektif(a, x0) > K.mustahilKmj && kecepatanEfektif(xn, c) > K.mustahilKmj);
          } else {
            // Di tepi hari: loncatannya mendadak (≤ 30 mnt) atau melebihi pesawat.
            const [p, q] = a ? [a, x0] : [xn, c as TitikOlah];
            ya = q.t - p.t <= K.pulauMaksMenit * MENIT || kecepatanEfektif(p, q) > K.mustahilKmj;
          }
          if (ya) for (const g of kelompok) buang.add(g);
        }
        if (buang.size) {
          const sisa: TitikOlah[] = [];
          for (const X of pulau) (buang.has(X) ? janggal : sisa).push(...X);
          arr = sisa;
          berubah = true;
        }
      }
    }

    if (arr.length >= 3) {
      const sisa: TitikOlah[] = [arr[0]];
      for (let i = 1; i < arr.length - 1; i++) {
        const a = sisa[sisa.length - 1];
        const b = arr[i];
        const c = arr[i + 1];
        const dab = jarakM(a, b);
        const dbc = jarakM(b, c);
        if (
          dab >= K.lonjakanMinM &&
          dbc >= K.lonjakanMinM &&
          jarakM(a, c) < K.lonjakanRasio * Math.min(dab, dbc) &&
          kecepatanEfektif(a, b) > K.lonjakanKmj &&
          kecepatanEfektif(b, c) > K.lonjakanKmj
        ) {
          janggal.push(b);
          berubah = true;
          continue;
        }
        sisa.push(b);
      }
      sisa.push(arr[arr.length - 1]);
      arr = sisa;
    }

    if (!berubah) break;
  }
  janggal.sort((a, b) => a.t - b.t);
  return { bersih: arr, janggal };
}

/**
 * Gugus singgah dalam satu rangkaian (pusat rata-rata berjalan). Titik masuk bila dekat pusat
 * atau berada di geofence lokasi kerja yang sama dengan titik awal gugus (pabrik/gudang besar);
 * 1–2 titik "goyang" ≤ 250 m yang lalu kembali tidak memecah singgah.
 */
function cariSinggah(run: TitikOlah[], geofence: (string | null)[], capAkurasi: number): { awal: number; akhir: number }[] {
  const hasil: { awal: number; akhir: number }[] = [];
  const radius = (p: TitikOlah) => Math.max(K.radiusSinggahM, Math.min(p.akurasi ?? 0, capAkurasi));
  let i = 0;
  while (i < run.length) {
    let sLat = run[i].lat;
    let sLng = run[i].lng;
    let n = 1;
    let akhir = i;
    let j = i + 1;
    const masuk = (k: number, c: LatLng) => (geofence[k] !== null && geofence[k] === geofence[i]) || jarakM(c, run[k]) <= radius(run[k]);
    while (j < run.length) {
      const c = { lat: sLat / n, lng: sLng / n };
      if (masuk(j, c)) {
        sLat += run[j].lat;
        sLng += run[j].lng;
        n++;
        akhir = j;
        j++;
        continue;
      }
      let kembali = -1;
      for (let k = j; k < Math.min(run.length - 1, j + K.goyangMaksTitik); k++) {
        if (jarakM(c, run[k]) > K.goyangMaksM) break;
        if (masuk(k + 1, c)) {
          kembali = k + 1;
          break;
        }
      }
      if (kembali < 0) break;
      j = kembali;
    }
    if (akhir > i && run[akhir].t - run[i].t >= K.minSinggahMenit * MENIT) {
      hasil.push({ awal: i, akhir });
      i = akhir + 1;
    } else i++;
  }
  return hasil;
}

const NADA_URUT: Record<NadaTemuan, number> = { danger: 0, warning: 1, info: 2 };

export function susunLinimasa(m: MasukanLinimasa): Linimasa {
  const awalHari = awalHariWIB(m.tanggal);
  // Batas hari NaN membuat semua perbandingan waktu diam-diam salah: lebih baik gagal jelas.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.tanggal) || !Number.isFinite(awalHari)) throw new Error(`Tanggal tidak valid: ${m.tanggal}`);
  const akhirHari = awalHari + HARI;
  const sekarang = m.sekarang;
  const hariIni = sekarang >= awalHari && sekarang < akhirHari;
  const hariLalu = sekarang >= akhirHari;
  // Waktu yang sudah berlalu pada tanggal itu: hari ini sampai sekarang, hari lalu sampai 24:00.
  const batasAkhir = Math.min(akhirHari, Math.max(awalHari, sekarang));
  const intervalSetel = Number.isFinite(m.intervalMenit) && m.intervalMenit > 0 ? m.intervalMenit : 15;
  const lokasi = olahLokasi(m.lokasiKerja);
  const jam = (ms: number) => formatJam(ms);

  // 1. Normalisasi
  const semua = normalisasi(m.titik, awalHari, akhirHari, Math.max(K.tertundaMinMenit, 2 * intervalSetel) * MENIT);

  // 2. Saring: palsu → akurasi → janggal. Disaring tidak dipakai untuk garis, singgah, maupun jarak.
  const nonPalsu = semua.filter((p) => !p.palsu);
  const jumlahKasar = nonPalsu.filter((p) => p.akurasi !== null && p.akurasi > K.akurasiMaksM).length;
  const akurasiLonggar = jumlahKasar > 0 && jumlahKasar > K.porsiLonggar * nonPalsu.length;
  const ambangAkurasi = akurasiLonggar ? K.akurasiLonggarM : K.akurasiMaksM;
  const disaringOlah: { p: TitikOlah; alasan: AlasanSaring }[] = [];
  const kandidat: TitikOlah[] = [];
  for (const p of semua) {
    if (p.palsu) disaringOlah.push({ p, alasan: "palsu" });
    else if (p.akurasi !== null && p.akurasi > ambangAkurasi) disaringOlah.push({ p, alasan: "akurasi" });
    else kandidat.push(p);
  }
  const { bersih, janggal } = saringJanggal(kandidat);
  for (const p of janggal) disaringOlah.push({ p, alasan: "janggal" });
  disaringOlah.sort((a, b) => a.p.t - b.p.t);

  // 3. Interval & ambang jeda. Data yang jarang adalah gejala jeda, bukan interval:
  //    perkiraan dari data hanya boleh lebih rapat dari pengaturan.
  const selisih: number[] = [];
  for (let i = 1; i < bersih.length; i++) {
    const d = (bersih[i].t - bersih[i - 1].t) / MENIT;
    if (d >= 0.5 && d <= 240) selisih.push(d);
  }
  const intervalData = selisih.length >= 4 ? median(selisih) : null;
  const I = Math.min(intervalData ?? intervalSetel, intervalSetel);
  const G = Math.max(K.jedaMinMenit, K.jedaKaliInterval * I) * MENIT;

  // Presensi: jendela kerja (untuk jam presensi & luarJamPantau) dan peristiwa pada tanggal ini.
  const jendelaPresensi: (Rentang & { terbuka: boolean; masukAsli: number; pulangAsli: number | null; nama: string | null })[] = [];
  const peristiwa: PeristiwaPresensi[] = [];
  for (const r of m.presensi ?? []) {
    if (!r) continue;
    const masuk = r.checkInTime ? Date.parse(r.checkInTime) : NaN;
    const pulang = r.checkOutTime ? Date.parse(r.checkOutTime) : NaN;
    const nama = r.workLocation?.name ?? null;
    if (Number.isFinite(masuk)) {
      if (Number.isFinite(pulang) && pulang > masuk) {
        const rentang = { mulai: Math.max(masuk, awalHari), selesai: Math.min(pulang, batasAkhir) };
        if (rentang.selesai > rentang.mulai) jendelaPresensi.push({ ...rentang, terbuka: false, masukAsli: masuk, pulangAsli: pulang, nama });
      } else if (masuk >= awalHari && masuk < batasAkhir) {
        // Tanpa check-out: hanya presensi yang masuk pada tanggal ini yang dianggap masih berjalan.
        jendelaPresensi.push({ mulai: masuk, selesai: batasAkhir, terbuka: true, masukAsli: masuk, pulangAsli: null, nama });
      }
    }
    for (const jenis of ["masuk", "pulang"] as const) {
      const t = jenis === "masuk" ? masuk : pulang;
      if (!Number.isFinite(t) || t < awalHari || t >= akhirHari || t > sekarang) continue;
      const lat = angkaAtauNull(jenis === "masuk" ? r.checkInLatitude : r.checkOutLatitude);
      const lng = angkaAtauNull(jenis === "masuk" ? r.checkInLongitude : r.checkOutLongitude);
      const adaKoordinat = lat !== null && lng !== null && !(lat === 0 && lng === 0) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
      peristiwa.push({
        id: `${r.id}:${jenis}`,
        jenis,
        t,
        lat: adaKoordinat ? lat : null,
        lng: adaKoordinat ? lng : null,
        presensiId: r.id,
        namaLokasi: nama,
        metode: (jenis === "masuk" ? r.checkInMethod : r.checkOutMethod) ?? null,
        status: r.status ?? null,
        terlambatMenit: jenis === "masuk" ? (r.lateMinutes ?? 0) : 0,
        pulangCepatMenit: jenis === "pulang" ? (r.earlyLeaveMinutes ?? 0) : 0,
        tandaIntegritas: r.integrityFlags ?? [],
        // faceVerified hanya diisi backend saat check-in; pulang tidak diverifikasi wajah.
        wajahTerverifikasi: jenis === "masuk" && r.faceVerified === true,
        offline: (jenis === "masuk" ? r.checkInSyncedAt : r.checkOutSyncedAt) != null,
        cocok: "tanpa_koordinat",
        jarakKeJejakM: null,
        waktuJejak: null,
      });
    }
  }
  peristiwa.sort((a, b) => a.t - b.t);
  jendelaPresensi.sort((a, b) => a.mulai - b.mulai);

  // 4–5. Rangkaian (dipotong di setiap Δt > G) lalu singgah per rangkaian.
  const rangkaian: TitikOlah[][] = [];
  for (const p of bersih) {
    const r = rangkaian[rangkaian.length - 1];
    if (r && p.t - r[r.length - 1].t <= G) r.push(p);
    else rangkaian.push([p]);
  }
  const radiusSinggah = (p: TitikOlah) => Math.max(K.radiusSinggahM, Math.min(p.akurasi ?? 0, ambangAkurasi));
  /**
   * Titik masih "di sekitar" tempat berpusat c: ≤ 250 m (dilonggarkan sebesar akurasinya) atau di dalam
   * geofence lokasi kerja tempat itu. Getaran GPS di dalam gedung jarang keluar dari sini.
   */
  const diSekitar = (p: TitikOlah, c: LatLng, lk: LokasiOlah | null) => {
    const longgar = Math.min(p.akurasi ?? 0, K.akurasiMaksM);
    if (lk && jarakM(lk, p) - longgar <= lk.radiusM + K.toleransiLokasiKerjaM) return true;
    return jarakM(c, p) - longgar <= K.goyangMaksM;
  };
  const dekatGugus = (gugus: TitikOlah[]) => {
    const c = pusatMedian(gugus);
    const lk = lokasiMemuat(c, lokasi, Math.min(akurasiMedian(gugus) ?? K.toleransiLokasiKerjaM, K.toleransiLokasiKerjaM));
    return (p: TitikOlah) => diSekitar(p, c, lk);
  };
  const blok: Blok[] = [];
  rangkaian.forEach((run, ri) => {
    if (ri > 0) blok.push({ jenis: "jeda", mulai: rangkaian[ri - 1][rangkaian[ri - 1].length - 1].t, selesai: run[0].t });
    if (run.length === 1) {
      blok.push({ jenis: "terlihat", titik: run });
      return;
    }
    const gf = run.map((p) => lokasiMemuat(p, lokasi, 0)?.id ?? null);
    const gugus = cariSinggah(run, gf, ambangAkurasi);
    if (!gugus.length) {
      const c = pusatMedian(run);
      if (run.every((p) => jarakM(c, p) <= radiusSinggah(p))) blok.push({ jenis: "terlihat", titik: run });
      else blok.push({ jenis: "gerak", titik: run, sebelum: null, sesudah: null });
      return;
    }
    // Ekor di tepi rangkaian yang tidak pernah keluar dari sekitar singgahnya ikut singgah itu
    // (bukan "perjalanan 120 m" dari getaran GPS sebelum ponsel tidur).
    // Ekor rangkaian terakhir hari ini dibiarkan: bisa jadi orangnya memang baru berangkat.
    const g0 = gugus[0];
    if (g0.awal > 0 && run.slice(0, g0.awal).every(dekatGugus(run.slice(g0.awal, g0.akhir + 1)))) g0.awal = 0;
    const gn = gugus[gugus.length - 1];
    if (gn.akhir < run.length - 1 && !(hariIni && ri === rangkaian.length - 1) && run.slice(gn.akhir + 1).every(dekatGugus(run.slice(gn.awal, gn.akhir + 1)))) {
      gn.akhir = run.length - 1;
    }
    let kursor = 0;
    for (const g of gugus) {
      if (g.awal > kursor || kursor > 0) {
        blok.push({ jenis: "gerak", titik: run.slice(kursor, g.awal), sebelum: kursor > 0 ? run[kursor - 1] : null, sesudah: run[g.awal] });
      }
      blok.push({ jenis: "singgah", titik: run.slice(g.awal, g.akhir + 1), jedaDalam: [] });
      kursor = g.akhir + 1;
    }
    if (kursor < run.length) blok.push({ jenis: "gerak", titik: run.slice(kursor), sebelum: run[kursor - 1], sesudah: null });
  });

  // 6. Rapikan: singgah–jeda(≤ 4 j)–singgah dan singgah–perjalanan singkat–singgah di tempat sama.
  const cacheInfo = new WeakMap<BlokDiam, InfoDiam>();
  const infoDiam = (b: BlokDiam): InfoDiam => {
    let info = cacheInfo.get(b);
    if (!info) {
      const pusat = pusatMedian(b.titik);
      const akurasi = akurasiMedian(b.titik);
      info = { pusat, akurasiMedian: akurasi, lokasi: lokasiMemuat(pusat, lokasi, Math.min(akurasi ?? K.toleransiLokasiKerjaM, K.toleransiLokasiKerjaM)) };
      cacheInfo.set(b, info);
    }
    return info;
  };
  const tempatSamaBlok = (x: BlokDiam, y: BlokDiam) => {
    const a = infoDiam(x);
    const b = infoDiam(y);
    if (a.lokasi || b.lokasi) return a.lokasi?.id === b.lokasi?.id;
    return jarakM(a.pusat, b.pusat) <= K.tempatSamaM;
  };
  const buktiTempatLain = (j: Rentang, c: LatLng) =>
    peristiwa.some((e) => e.t > j.mulai && e.t < j.selesai && e.lat !== null && e.lng !== null && jarakM({ lat: e.lat, lng: e.lng }, c) > K.buktiLainM) ||
    disaringOlah.some(({ p, alasan }) => alasan === "akurasi" && p.t > j.mulai && p.t < j.selesai && jarakM(p, c) - (p.akurasi ?? 0) > K.buktiLainM);
  const gerakSingkat = (g: BlokGerak) => {
    if (!g.sebelum || !g.sesudah) return false;
    const lama = g.sesudah.t - g.sebelum.t;
    // Satu titik melenceng pada sampling teratur (≈ 2 interval) = drift, bukan kepergian.
    return !g.titik.length || lama < K.langkahKeluarMaksMenit * MENIT || (g.titik.length === 1 && lama <= (2 * I + 2) * MENIT);
  };
  // Pergi-pulang yang tidak pernah keluar dari sekitar tempatnya = getaran GPS, bukan perjalanan
  // "Kantor → Kantor 1,9 km" (satu titik melenceng sudah ditangani gerakSingkat).
  const gerakDiSekitar = (g: BlokGerak, x: BlokDiam, y: BlokDiam) => {
    const a = infoDiam(x);
    const b = infoDiam(y);
    const lk = a.lokasi ?? b.lokasi;
    return g.titik.every((p) => diSekitar(p, a.pusat, lk) || diSekitar(p, b.pusat, lk));
  };
  const rapi: Blok[] = [];
  for (const b of blok) {
    rapi.push(b);
    for (;;) {
      const n = rapi.length;
      if (n < 3) break;
      const x = rapi[n - 3];
      const tengah = rapi[n - 2];
      const y = rapi[n - 1];
      if (x.jenis === "gerak" || x.jenis === "jeda" || y.jenis === "gerak" || y.jenis === "jeda") break;
      let gabung: BlokDiam | null = null;
      const dalam = (d: BlokDiam) => (d.jenis === "singgah" ? d.jedaDalam : []);
      if (
        tengah.jenis === "jeda" &&
        tengah.selesai - tengah.mulai <= K.gabungJedaMaksMenit * MENIT &&
        tempatSamaBlok(x, y) &&
        !buktiTempatLain(tengah, infoDiam(x).pusat)
      ) {
        gabung = { jenis: "singgah", titik: [...x.titik, ...y.titik], jedaDalam: [...dalam(x), { mulai: tengah.mulai, selesai: tengah.selesai }, ...dalam(y)] };
      } else if (tengah.jenis === "gerak" && x.jenis === "singgah" && y.jenis === "singgah" && tempatSamaBlok(x, y) && (gerakSingkat(tengah) || gerakDiSekitar(tengah, x, y))) {
        gabung = { jenis: "singgah", titik: [...x.titik, ...tengah.titik, ...y.titik], jedaDalam: [...x.jedaDalam, ...y.jedaDalam] };
      }
      if (!gabung) break;
      rapi.splice(n - 3, 3, gabung);
    }
  }

  // 9. Tempat: singgah lebih dulu (huruf urut kemunculan), lalu titik "terlihat" dicocokkan ke tempat yang ada.
  const tempat: Tempat[] = [];
  const pusatKunjungan = new Map<Tempat, LatLng[]>();
  const tempatLK = new Map<string, Tempat>();
  const tempatLain: Tempat[] = [];
  const pusatTempat = (tp: Tempat) => pusatMedian(pusatKunjungan.get(tp) ?? [tp]);
  const tempatLainTerdekat = (p: LatLng): Tempat | null => {
    let terbaik: Tempat | null = null;
    let dTerbaik = Infinity;
    for (const tp of tempatLain) {
      const d = jarakM(pusatTempat(tp), p);
      if (d <= K.tempatSamaM && d < dTerbaik) {
        dTerbaik = d;
        terbaik = tp;
      }
    }
    return terbaik;
  };
  const tempatUntukLokasi = (l: LokasiOlah): Tempat => {
    let tp = tempatLK.get(l.id);
    if (!tp) {
      tp = {
        id: `lk:${l.id}`,
        jenis: "lokasi_kerja",
        nama: l.nama,
        label: "",
        keterangan: l.alamat,
        lat: l.lat,
        lng: l.lng,
        lokasiKerja: { id: l.id, nama: l.nama, lat: l.lat, lng: l.lng, radiusM: l.radiusM, nonaktif: !l.aktif },
        kunjunganIds: [],
      };
      tempatLK.set(l.id, tp);
      tempat.push(tp);
      pusatKunjungan.set(tp, []);
    }
    return tp;
  };
  const tempatBlok = new Map<BlokDiam, Tempat | null>();
  for (const b of rapi) {
    if (b.jenis !== "singgah") continue;
    const info = infoDiam(b);
    let tp: Tempat | null = info.lokasi ? tempatUntukLokasi(info.lokasi) : tempatLainTerdekat(info.pusat);
    if (!tp) {
      const n = tempatLain.length;
      // A–Z lalu AA, AB, … (jarang terjadi, tetapi nama harus tetap unik).
      const label = n < 26 ? String.fromCharCode(65 + n) : String.fromCharCode(64 + Math.floor(n / 26)) + String.fromCharCode(65 + (n % 26));
      tp = { id: `t:${n + 1}`, jenis: "lain", nama: `Tempat ${label}`, label, keterangan: null, lat: info.pusat.lat, lng: info.pusat.lng, lokasiKerja: null, kunjunganIds: [] };
      tempatLain.push(tp);
      tempat.push(tp);
      pusatKunjungan.set(tp, []);
    }
    pusatKunjungan.get(tp)!.push(info.pusat);
    tempatBlok.set(b, tp);
  }
  for (const b of rapi) {
    if (b.jenis !== "terlihat") continue;
    const info = infoDiam(b);
    const tp = info.lokasi ? tempatUntukLokasi(info.lokasi) : tempatLainTerdekat(info.pusat);
    if (tp) pusatKunjungan.get(tp)!.push(info.pusat);
    tempatBlok.set(b, tp);
  }
  for (const tp of tempat) {
    const c = pusatTempat(tp);
    tp.lat = c.lat;
    tp.lng = c.lng;
    if (tp.jenis === "lain") tp.keterangan = keteranganRelatif(c, lokasi);
  }
  const namaSekitar = (p: LatLng, akurasi: number | null): string | null => {
    const l = lokasiMemuat(p, lokasi, Math.min(akurasi ?? K.toleransiLokasiKerjaM, K.toleransiLokasiKerjaM));
    if (l) return l.nama;
    return tempatLainTerdekat(p)?.nama ?? null;
  };

  // 7–8. Segmen.
  const idDipakai = new Set<string>();
  const dasar = (jenis: Segmen["jenis"], mulai: number, selesai: number): SegmenDasar => {
    let id = `${jenis}-${mulai}`;
    for (let k = 2; idDipakai.has(id); k++) id = `${jenis}-${mulai}-${k}`;
    idDipakai.add(id);
    return { id, mulai, selesai, durasiMs: durasiTampil(mulai, selesai), berlangsung: false, berlanjutDariKemarin: false, berlanjutKeBesok: false, presensi: [], disaring: [] };
  };
  const posAwal = (s: Segmen): [number, number] | null => (s.jenis === "perjalanan" ? s.jalur[0] : s.jenis === "jeda" ? s.ke : [s.lat, s.lng]);
  const posAkhir = (s: Segmen): [number, number] | null => (s.jenis === "perjalanan" ? s.jalur[s.jalur.length - 1] : s.jenis === "jeda" ? s.dari : [s.lat, s.lng]);
  // Irisan < G bukan jeda saat bekerja: titik pertama memang datang beberapa menit setelah masuk
  // (dan terakhir sebelum pulang), jadi jeda awal/akhir mode while_working selalu sedikit beririsan.
  const luarJamPantau = (r: Rentang) => m.mode === "while_working" && jendelaPresensi.reduce((n, w) => n + irisan(w, r), 0) < G;
  const buatJeda = (posisi: Jeda["posisi"], mulai: number, selesai: number, dari: [number, number] | null, ke: [number, number] | null, tempatSama: boolean): Jeda => {
    const perpindahanM = dari && ke ? Math.round(jarakM({ lat: dari[0], lng: dari[1] }, { lat: ke[0], lng: ke[1] })) : null;
    // Garis perkiraan melewati posisi presensi di dalam jeda: posisi nyata dari sumber lain.
    const jalurPerkiraan: [number, number][] = [];
    if (dari) jalurPerkiraan.push(dari);
    for (const e of peristiwa) if (e.t > mulai && e.t < selesai && e.lat !== null && e.lng !== null) jalurPerkiraan.push([e.lat, e.lng]);
    if (ke) jalurPerkiraan.push(ke);
    if (jalurPerkiraan.length < 2) jalurPerkiraan.length = 0;
    return {
      ...dasar("jeda", mulai, selesai),
      jenis: "jeda",
      posisi,
      dari,
      ke,
      perpindahanM,
      tempatSama,
      jalurPerkiraan,
      luarJamPantau: luarJamPantau({ mulai, selesai }),
    };
  };

  let urutan = 0;
  const kunjunganKe = new Map<Tempat, number>();
  const segBlok: (Segmen | null)[] = rapi.map((b, i) => {
    if (b.jenis === "jeda") return null;
    if (b.jenis === "singgah" || b.jenis === "terlihat") {
      const info = infoDiam(b);
      const tp = tempatBlok.get(b) ?? null;
      const ke = tp ? (kunjunganKe.get(tp) ?? 0) + 1 : 0;
      if (tp) kunjunganKe.set(tp, ke);
      const mulai = b.titik[0].t;
      const selesai = b.titik[b.titik.length - 1].t;
      if (b.jenis === "terlihat") {
        const s: Terlihat = {
          ...dasar("terlihat", mulai, selesai),
          jenis: "terlihat",
          lat: info.pusat.lat,
          lng: info.pusat.lng,
          akurasiM: info.akurasiMedian === null ? null : Math.round(info.akurasiMedian),
          jumlahTitik: b.titik.length,
          tempat: tp,
          sekitar: tp?.nama ?? keteranganRelatif(info.pusat, lokasi),
        };
        tp?.kunjunganIds.push(s.id);
        return s;
      }
      const jedaDalam = b.jedaDalam.slice().sort((x, y) => x.mulai - y.mulai);
      const s: Singgah = {
        ...dasar("singgah", mulai, selesai),
        jenis: "singgah",
        urutan: ++urutan,
        tempat: tp as Tempat,
        kunjunganKe: ke,
        lat: info.pusat.lat,
        lng: info.pusat.lng,
        sebaranM: Math.max(25, Math.round(persentil(b.titik.map((p) => jarakM(info.pusat, p)), 0.9))),
        akurasiMedianM: info.akurasiMedian === null ? null : Math.round(info.akurasiMedian),
        jumlahTitik: b.titik.length,
        jedaDalam,
        jedaDalamMs: jedaDalam.reduce((n, r) => n + durasiTampil(r.mulai, r.selesai), 0),
        titik: b.titik.map((p) => [p.lat, p.lng] as [number, number]),
      };
      (tp as Tempat).kunjunganIds.push(s.id);
      return s;
    }
    // Perjalanan: garis berawal/berakhir di pusat singgah tetangga supaya menyambung ke penandanya.
    const sebelum = b.sebelum ? (rapi[i - 1] as BlokDiam) : null;
    const sesudah = b.sesudah ? (rapi[i + 1] as BlokDiam) : null;
    const cSebelum = sebelum ? infoDiam(sebelum).pusat : null;
    const cSesudah = sesudah ? infoDiam(sesudah).pusat : null;
    const mulai = b.sebelum?.t ?? b.titik[0].t;
    const selesai = b.sesudah?.t ?? b.titik[b.titik.length - 1].t;
    const jalurTitik: (LatLng & { akurasi: number | null })[] = [
      ...(cSebelum ? [{ ...cSebelum, akurasi: null }] : []),
      ...b.titik,
      ...(cSesudah ? [{ ...cSesudah, akurasi: null }] : []),
    ];
    // Jarak dari jalur yang ditipiskan: getaran kecil (< max(15 m, ½ akurasi)) tidak menambah km.
    let jarak = 0;
    let acuan = jalurTitik[0];
    for (let k = 1; k < jalurTitik.length; k++) {
      const p = jalurTitik[k];
      const d = jarakM(acuan, p);
      if (d >= Math.max(K.penipisanM, 0.5 * Math.max(acuan.akurasi ?? 0, p.akurasi ?? 0)) || k === jalurTitik.length - 1) {
        jarak += d;
        acuan = p;
      }
    }
    const runtut = [...(b.sebelum ? [b.sebelum] : []), ...b.titik, ...(b.sesudah ? [b.sesudah] : [])];
    const laju: number[] = [];
    let rapat = 0;
    for (let k = 1; k < runtut.length; k++) {
      const dt = runtut[k].t - runtut[k - 1].t;
      if (dt <= K.jalanRapatMenit * MENIT) rapat++;
      if (dt >= MENIT) laju.push(kmj(jarakM(runtut[k - 1], runtut[k]), dt));
    }
    const rata = kmj(jarak, selesai - mulai);
    const puncak = laju.length ? persentil(laju, 0.85) : rata;
    let moda: Moda;
    if (jarak >= K.jauhM && rata >= K.jauhKmj) moda = "jauh";
    else if (rata >= K.kendaraanRataKmj || puncak >= K.kendaraanPuncakKmj) moda = "kendaraan";
    // Jalan kaki hanya disimpulkan dari data rapat: data jarang bisa menyembunyikan laju kendaraan.
    else if (rata < K.jalanMaksKmj && puncak < K.jalanMaksKmj && rapat >= 2) moda = "jalan";
    else moda = "tidak_diketahui";
    const dari = sebelum ? (tempatBlok.get(sebelum) ?? null) : null;
    const ke = sesudah ? (tempatBlok.get(sesudah) ?? null) : null;
    const awal = jalurTitik[0];
    const akhir = jalurTitik[jalurTitik.length - 1];
    const s: Perjalanan = {
      ...dasar("perjalanan", mulai, selesai),
      jenis: "perjalanan",
      moda,
      jarakM: Math.round(jarak),
      kecepatanRataKmj: bulat1(rata),
      kecepatanPuncakKmj: bulat1(puncak),
      jalur: jalurTitik.map((p) => [p.lat, p.lng] as [number, number]),
      jumlahTitik: b.titik.length,
      dataTipis: jalurTitik.length - 2 < 2,
      dari,
      ke,
      dariSekitar: dari ? null : namaSekitar(awal, awal.akurasi),
      keSekitar: ke ? null : namaSekitar(akhir, akhir.akurasi),
    };
    return s;
  });

  const segmen: Segmen[] = [];
  const pertamaData = segBlok.find((s): s is Segmen => s !== null) ?? null;
  const terakhirData = [...segBlok].reverse().find((s): s is Segmen => s !== null) ?? null;
  if (pertamaData && bersih[0].t - awalHari > G) segmen.push(buatJeda("awal", awalHari, bersih[0].t, null, posAwal(pertamaData), false));
  rapi.forEach((b, i) => {
    const s = segBlok[i];
    if (s) {
      segmen.push(s);
      return;
    }
    if (b.jenis !== "jeda") return;
    const sebelum = segBlok[i - 1] as Segmen;
    const sesudah = segBlok[i + 1] as Segmen;
    const dari = posAkhir(sebelum);
    const ke = posAwal(sesudah);
    const tpA = sebelum.jenis === "singgah" || sebelum.jenis === "terlihat" ? sebelum.tempat : null;
    const tpB = sesudah.jenis === "singgah" || sesudah.jenis === "terlihat" ? sesudah.tempat : null;
    const sama = tpA && tpB ? tpA.id === tpB.id : !!dari && !!ke && jarakM({ lat: dari[0], lng: dari[1] }, { lat: ke[0], lng: ke[1] }) <= K.tempatSamaM;
    segmen.push(buatJeda("tengah", b.mulai, b.selesai, dari, ke, sama));
  });

  const terakhir = bersih.length ? bersih[bersih.length - 1] : null;
  const segar = !!terakhir && hariIni && sekarang - terakhir.t <= G;
  if (terakhir && terakhirData) {
    if (hariIni) {
      if (segar) {
        terakhirData.berlangsung = true;
        if (sekarang > terakhirData.selesai) {
          terakhirData.selesai = sekarang;
          terakhirData.durasiMs = durasiTampil(terakhirData.mulai, sekarang);
        }
      } else {
        const j = buatJeda("akhir", terakhir.t, sekarang, posAkhir(terakhirData), null, false);
        j.berlangsung = true;
        segmen.push(j);
      }
    } else if (hariLalu && akhirHari - terakhir.t > G) {
      segmen.push(buatJeda("akhir", terakhir.t, akhirHari, posAkhir(terakhirData), null, false));
    }
  } else if (!bersih.length && (peristiwa.length || disaringOlah.length) && batasAkhir > awalHari) {
    // Tanpa titik dipakai tetapi ada presensi/titik disaring: satu jeda sepanjang hari sebagai wadahnya.
    const j = buatJeda(hariIni ? "awal" : "tengah", awalHari, batasAkhir, null, null, false);
    j.berlangsung = hariIni;
    segmen.push(j);
  }
  if (pertamaData && segmen[0] === pertamaData && pertamaData.mulai - awalHari <= G) pertamaData.berlanjutDariKemarin = true;
  if (terakhirData && hariLalu && segmen[segmen.length - 1] === terakhirData && akhirHari - terakhirData.selesai <= G) terakhirData.berlanjutKeBesok = true;

  // Posisi jejak pada waktu t (interpolasi; di dalam jeda hanya titik ujung yang masih ≤ G).
  const posisiPada = (t: number): LatLng | null => {
    if (!bersih.length) return null;
    let lo = 0;
    let hi = bersih.length - 1;
    if (t <= bersih[0].t) return bersih[0].t - t <= G ? bersih[0] : null;
    if (t >= bersih[hi].t) return t - bersih[hi].t <= G ? bersih[hi] : null;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (bersih[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = bersih[lo];
    const b = bersih[hi];
    if (b.t - a.t > G) {
      const da = t - a.t;
      const db = b.t - t;
      if (Math.min(da, db) > G) return null;
      return da <= db ? a : b;
    }
    const f = (t - a.t) / (b.t - a.t);
    return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
  };
  /** Titik dipakai terakhir ≤ t dan pertama ≥ t (sama bila ada titik tepat pada t). */
  const titikApit = (t: number): [TitikOlah | null, TitikOlah | null] => {
    let lo = 0;
    let hi = bersih.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bersih[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    const sesudah = lo < bersih.length ? bersih[lo] : null;
    const sebelum = sesudah && sesudah.t === t ? sesudah : lo > 0 ? bersih[lo - 1] : null;
    return [sebelum, sesudah];
  };
  const segmenPada = (t: number): Segmen | null => {
    if (!segmen.length) return null;
    let lo = 0;
    let hi = segmen.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = segmen[mid];
      if (t < s.mulai) hi = mid - 1;
      else if (t > s.selesai) lo = mid + 1;
      else return s;
    }
    // Di sela segmen (mis. sebelum titik pertama yang < G dari 00:00): tempel ke yang terdekat.
    const kandidatSeg = [segmen[Math.max(0, hi)], segmen[Math.min(segmen.length - 1, lo)]];
    return kandidatSeg.reduce((a, b) => (Math.min(Math.abs(t - b.mulai), Math.abs(t - b.selesai)) < Math.min(Math.abs(t - a.mulai), Math.abs(t - a.selesai)) ? b : a));
  };

  const disaring: TitikDisaring[] = disaringOlah.map(({ p, alasan }) => {
    const pos = posisiPada(p.t);
    return { id: `titik-${p.t}`, alasan, t: p.t, lat: p.lat, lng: p.lng, akurasiM: p.akurasi, jarakDariJejakM: pos ? Math.round(jarakM(pos, p)) : null };
  });
  for (const d of disaring) segmenPada(d.t)?.disaring.push(d);

  // 10. Cocokkan presensi dengan jejak pada waktunya. Orang yang bergerak bisa jauh dari titik terdekat
  //     (titik terakhir 2 mnt sebelum presensi masih di jalan, atau ponsel diam selama perjalanan), jadi
  //     "tidak sesuai" hanya bila jejak membantahnya: menyimpang dari ruas dua titik bersambung, atau
  //     mustahil dijangkau dari titik terdekat dalam selisih waktunya.
  const jendelaCocok = Math.max(K.jendelaPresensiKali * I, K.jendelaPresensiMinMenit) * MENIT;
  const jangkauan = (ms: number) => K.cocokPresensiM + (K.presensiMaksKmj * 1000 * ms) / JAM;
  /** Presensi "tanpa titik" yang sebenarnya punya titik di jendelanya, tetapi titik itu tidak bisa memastikan. */
  const takPasti = new Map<PeristiwaPresensi, { t: number; d: number }>();
  /** Hari ini, jendela presensi belum lewat dan belum ada titik sesudahnya: terlalu dini untuk menilai. */
  const terlaluDini = new Set<PeristiwaPresensi>();
  for (const e of peristiwa) {
    if (e.lat !== null && e.lng !== null) {
      const P = { lat: e.lat, lng: e.lng };
      const [a, b] = titikApit(e.t);
      const tetapkan = (cocok: CocokPresensi, d: number, q: TitikOlah) => {
        e.cocok = cocok;
        e.jarakKeJejakM = Math.round(d);
        e.waktuJejak = q.t;
      };
      if (a && b && b.t - a.t <= G) {
        // Rangkaian bersambung: orangnya ada di sekitar ruas a–b (garis yang juga digambar di peta).
        const dA = jarakM(a, P);
        const dB = jarakM(b, P);
        const dekat = e.t - a.t <= b.t - e.t ? a : b;
        const mustahil = [
          { q: a, d: dA, dt: e.t - a.t },
          { q: b, d: dB, dt: b.t - e.t },
        ]
          .filter((u) => u.d > jangkauan(u.dt))
          .sort((x, y) => x.dt - y.dt)[0];
        const simpang = dA + dB - jarakM(a, b);
        if (mustahil) tetapkan("tidak_sesuai", mustahil.d, mustahil.q);
        else if (simpang > 2 * K.cocokPresensiM + K.presensiSimpangRasio * jarakM(a, b)) tetapkan("tidak_sesuai", jarakM(dekat, P), dekat);
        else tetapkan("sesuai", jarakKeRuas(P, a, b), dekat);
      } else {
        // Di tepi rangkaian atau di dalam jeda: posisinya bisa sudah berubah selama celah.
        const ukur = [a, b]
          .filter((q): q is TitikOlah => !!q && Math.abs(q.t - e.t) <= jendelaCocok)
          .map((q) => ({ q, d: jarakM(q, P), dt: Math.abs(q.t - e.t) }))
          .sort((x, y) => x.dt - y.dt);
        const mustahil = ukur.find((u) => u.d > jangkauan(u.dt));
        const sesuai = ukur.find((u) => u.d <= K.cocokPresensiM);
        if (mustahil) tetapkan("tidak_sesuai", mustahil.d, mustahil.q);
        else if (sesuai) tetapkan("sesuai", sesuai.d, sesuai.q);
        else {
          e.cocok = "tanpa_titik";
          if (ukur.length) takPasti.set(e, { t: ukur[0].q.t, d: ukur[0].d });
          if (hariIni && !b && e.t + jendelaCocok > sekarang) terlaluDini.add(e);
        }
      }
    }
    segmenPada(e.t)?.presensi.push(e);
  }

  // 12. Ringkasan.
  const wAwal = jendelaPresensi[0] ?? null;
  const wAkhir = jendelaPresensi.length ? jendelaPresensi.reduce((a, w) => (w.selesai > a.selesai || (w.selesai === a.selesai && w.terbuka) ? w : a)) : null;
  const jamPresensi = wAwal && wAkhir ? { mulai: wAwal.mulai, selesai: wAkhir.selesai, terbuka: wAkhir.terbuka } : null;
  let jarakTotal = 0;
  let diLokasiKerjaMs = 0;
  let diamMs = 0;
  let bergerakMs = 0;
  let tanpaDataMs = 0;
  let diLKSaatPresensi = 0;
  const lkDikunjungi = new Set<string>();
  const rentangTanpaData: (Rentang & { segmenId: string })[] = [];
  for (const s of segmen) {
    if (s.jenis === "perjalanan") {
      jarakTotal += s.jarakM;
      bergerakMs += s.durasiMs;
    } else if (s.jenis === "singgah") {
      const efektif = Math.max(0, s.durasiMs - s.jedaDalamMs);
      diamMs += efektif;
      tanpaDataMs += s.jedaDalamMs;
      for (const r of s.jedaDalam) rentangTanpaData.push({ ...r, segmenId: s.id });
      if (s.tempat.jenis === "lokasi_kerja") {
        diLokasiKerjaMs += efektif;
        lkDikunjungi.add(s.tempat.id);
        if (jamPresensi) diLKSaatPresensi += Math.max(0, irisan(s, jamPresensi) - s.jedaDalam.reduce((n, r) => n + irisan(r, jamPresensi), 0));
      }
    } else if (s.jenis === "terlihat") diamMs += s.durasiMs;
    else {
      tanpaDataMs += s.durasiMs;
      rentangTanpaData.push({ mulai: s.mulai, selesai: s.selesai, segmenId: s.id });
    }
  }
  const jendelaMs = batasAkhir - awalHari;
  const cakupan = jendelaMs > 0 ? Math.min(1, (diamMs + bergerakMs) / jendelaMs) : null;
  const hitung = (a: AlasanSaring) => disaringOlah.filter((d) => d.alasan === a).length;
  const jumlahSinggah = segmen.filter((s) => s.jenis === "singgah").length;
  const jumlahPerjalanan = segmen.filter((s) => s.jenis === "perjalanan").length;

  // Kesimpulan: kalimat netral berbasis templat.
  let kesimpulan: string;
  if (jamPresensi && wAwal && wAkhir) {
    const nama = wAwal.nama ?? wAkhir.nama;
    const di = nama ? ` di ${nama}` : "";
    const adaTitik = bersih.some((p) => p.t >= jamPresensi.mulai && p.t <= jamPresensi.selesai);
    // Titik yang ada tetapi disaring (mis. palsu sepanjang jam kerja) bukan "tidak ada titik".
    const abaikan = disaringOlah.filter(({ p }) => p.t >= jamPresensi.mulai && p.t <= jamPresensi.selesai);
    const lamaPresensi = jamPresensi.selesai - jamPresensi.mulai;
    const porsi = lamaPresensi > 0 ? persen(diLKSaatPresensi / lamaPresensi) : null;
    // Shift malam: masuk kemarin / pulang besok tetap ditulis jam aslinya.
    const awalTeks = wAwal.masukAsli < awalHari ? `${jam(wAwal.masukAsli)} kemarin` : jam(wAwal.masukAsli);
    const akhirTeks = wAkhir.pulangAsli === null ? "" : wAkhir.pulangAsli >= akhirHari ? `${jam(wAkhir.pulangAsli)} besok` : jam(wAkhir.pulangAsli);
    if (jamPresensi.terbuka && hariIni) {
      kesimpulan = `Presensi masuk ${awalTeks}${di}, belum check-out.`;
    } else if (jamPresensi.terbuka) {
      kesimpulan = adaTitik
        ? `Presensi masuk ${awalTeks}${di} tanpa check-out · ${porsi} sejak masuk di lokasi kerja.`
        : abaikan.length
          ? `Presensi masuk ${awalTeks}${di} tanpa check-out, tetapi titik sesudahnya diabaikan: ${ringkasDisaring(abaikan)}.`
          : `Presensi masuk ${awalTeks}${di} tanpa check-out, tetapi tidak ada titik pemantauan sesudahnya.`;
    } else {
      const rentang = `${awalTeks}–${akhirTeks}`;
      kesimpulan = adaTitik
        ? `Presensi ${rentang}${di} · ${porsi} jam presensi di lokasi kerja.`
        : abaikan.length
          ? `Presensi ${rentang}${di}, tetapi titik selama jam presensi diabaikan: ${ringkasDisaring(abaikan)}.`
          : `Presensi ${rentang}${di}, tetapi tidak ada titik pemantauan selama jam presensi.`;
    }
  } else if (bersih.length) {
    kesimpulan = `Tidak ada presensi. Lokasi terekam ${jam(bersih[0].t)}–${jam(bersih[bersih.length - 1].t)} (${persen(cakupan ?? 0)} ${hariIni ? "sejauh ini" : "hari"}).`;
  } else if (disaringOlah.length) {
    kesimpulan = `Tidak ada lokasi yang dapat dipakai; ${disaringOlah.length} titik diabaikan.`;
  } else {
    kesimpulan = m.mode === "while_working" ? "Tidak ada lokasi tercatat; pemantauan hanya berjalan selama jam presensi." : "Tidak ada lokasi tercatat.";
  }

  // 11. Temuan untuk "Perlu diperiksa" (kalimat netral: "terdeteksi", bukan vonis).
  const temuan: (Temuan & { t: number })[] = [];
  const rentangJam = (ts: number[]) => (ts.length === 1 || jam(ts[0]) === jam(ts[ts.length - 1]) ? jam(ts[0]) : `${jam(ts[0])}–${jam(ts[ts.length - 1])}`);
  const terjauh = (ds: TitikDisaring[]) => ds.reduce((a, b) => ((b.jarakDariJejakM ?? -1) > (a.jarakDariJejakM ?? -1) ? b : a));

  const palsu = disaring.filter((d) => d.alasan === "palsu");
  if (palsu.length) {
    const fokus = terjauh(palsu);
    const jauh = fokus.jarakDariJejakM !== null ? ` · ${palsu.length > 1 ? "terjauh " : ""}${formatJarak(fokus.jarakDariJejakM)} dari jejak` : "";
    temuan.push({
      id: "palsu",
      kode: "palsu",
      nada: "danger",
      judul: `${palsu.length} titik lokasi palsu`,
      rincian: `Ditandai sistem ponsel sebagai lokasi tiruan · ${rentangJam(palsu.map((d) => d.t))}${jauh}`,
      segmenId: segmenPada(fokus.t)?.id ?? null,
      lat: fokus.lat,
      lng: fokus.lng,
      t: palsu[0].t,
    });
  }
  for (const e of peristiwa) {
    if (e.cocok !== "tidak_sesuai") continue;
    temuan.push({
      id: `presensi_tidak_sesuai:${e.id}`,
      kode: "presensi_tidak_sesuai",
      nada: "danger",
      judul: `Posisi saat presensi ${e.jenis} tidak sesuai`,
      rincian: `Presensi ${jam(e.t)}${e.namaLokasi ? ` di ${e.namaLokasi}` : ""}; jejak ${jam(e.waktuJejak ?? e.t)} berjarak ${formatJarak(e.jarakKeJejakM ?? 0)}`,
      segmenId: segmenPada(e.t)?.id ?? null,
      lat: e.lat,
      lng: e.lng,
      t: e.t,
    });
  }
  const tanpaTitik = peristiwa.filter((e) => e.cocok === "tanpa_titik" && !terlaluDini.has(e));
  if (tanpaTitik.length) {
    const e0 = tanpaTitik[0];
    const lokasiNama = [...new Set(tanpaTitik.map((e) => e.namaLokasi).filter(Boolean))].join(", ");
    const bagian: string[] = [];
    if (tanpaTitik.some((e) => !takPasti.has(e))) bagian.push(`Tidak ada titik dalam ±${formatDurasi(jendelaCocok)} dari waktu presensi${lokasiNama ? ` di ${lokasiNama}` : ""}.`);
    // Ada titik, tetapi selisih waktunya cukup untuk berpindah: sebutkan apa adanya tanpa menyimpulkan.
    const takPastiTeks = tanpaTitik.flatMap((e) => {
      const z = takPasti.get(e);
      if (!z) return [];
      const teks = `titik terdekat ${jam(z.t)} (${formatDurasi(Math.abs(e.t - z.t))} ${z.t < e.t ? "sebelumnya" : "sesudahnya"}) berjarak ${formatJarak(z.d)}`;
      return [tanpaTitik.length > 1 ? `${e.jenis === "masuk" ? "Masuk" : "Pulang"}: ${teks}` : teks.charAt(0).toUpperCase() + teks.slice(1)];
    });
    if (takPastiTeks.length) bagian.push(`${takPastiTeks.join("; ")}. Posisi saat presensi tidak dapat dipastikan.`);
    temuan.push({
      id: "presensi_tanpa_titik",
      kode: "presensi_tanpa_titik",
      nada: "warning",
      judul: `Presensi ${tanpaTitik.map((e) => `${e.jenis} ${jam(e.t)}`).join(" & ")} tanpa titik pemantauan`,
      rincian: bagian.join(" "),
      segmenId: segmenPada(e0.t)?.id ?? null,
      lat: e0.lat,
      lng: e0.lng,
      t: e0.t,
    });
  }
  if (jamPresensi) {
    // Potongan < G di tepi jam presensi (titik pertama 3 mnt setelah masuk) bukan jeda: lebih rapat dari ambang "Tidak melapor".
    const potong = rentangTanpaData
      .map((r) => ({ mulai: Math.max(r.mulai, jamPresensi.mulai), selesai: Math.min(r.selesai, jamPresensi.selesai), segmenId: r.segmenId }))
      .filter((r) => r.selesai - r.mulai >= G)
      .sort((a, b) => a.mulai - b.mulai);
    const total = potong.reduce((n, r) => n + (r.selesai - r.mulai), 0);
    if (total >= MENIT) {
      const terpanjang = potong.reduce((a, b) => (b.selesai - b.mulai > a.selesai - a.mulai ? b : a));
      const daftar = potong.slice(0, 3).map((r) => `${jam(r.mulai)}–${formatJam(r.selesai, true)}`);
      const abaikan = disaringOlah.filter(({ p }) => potong.some((r) => p.t >= r.mulai && p.t <= r.selesai));
      temuan.push({
        id: "jeda_jam_presensi",
        kode: "jeda_jam_presensi",
        nada: "warning",
        judul: `${abaikan.length ? "Tidak ada titik yang dapat dipakai" : "Tidak ada data"} ${formatDurasi(total)} selama jam presensi`,
        rincian: daftar.join(", ") + (potong.length > 3 ? ` +${potong.length - 3}` : "") + (abaikan.length ? ` · ${ringkasDisaring(abaikan)} diabaikan` : ""),
        segmenId: terpanjang.segmenId,
        lat: null,
        lng: null,
        t: potong[0].mulai,
      });
    }
  }
  if (hariIni && (m.mode === "always" || jamPresensi?.terbuka)) {
    const sebab = "Ponsel mungkin mati, offline, atau aplikasi dihentikan sistem; titik yang tertahan di ponsel akan menyusul saat tersambung.";
    // Mode while_working baru memantau sejak masuk: "sejak 00:00" di sana menyesatkan.
    const sejakMasuk = m.mode === "while_working" && jamPresensi ? jamPresensi.mulai : null;
    const acuan = terakhir?.t ?? sejakMasuk ?? awalHari;
    // Ponsel yang terus mengirim titik palsu/janggal tidak sedang mati: sebutkan apa yang diterimanya.
    const abaikan = disaringOlah.filter(({ p }) => p.t > acuan);
    const alasan = abaikan.length ? `Ponsel masih mengirim lokasi, tetapi ${ringkasDisaring(abaikan)} sesudahnya diabaikan.` : sebab;
    if (terakhir && !segar) {
      temuan.push({
        id: "tidak_melapor",
        kode: "tidak_melapor",
        nada: "warning",
        judul: abaikan.length ? `Tidak ada lokasi yang dapat dipakai sejak ${jam(terakhir.t)}` : `Tidak melapor sejak ${jam(terakhir.t)}`,
        rincian: `Sudah ${formatDurasi(durasiTampil(terakhir.t, sekarang))} tanpa lokasi baru${abaikan.length ? " yang dapat dipakai" : ""}. ${alasan}`,
        segmenId: segmen[segmen.length - 1]?.id ?? null,
        lat: terakhir.lat,
        lng: terakhir.lng,
        t: terakhir.t,
      });
    } else if (!terakhir && sekarang - acuan > G) {
      const dapatDipakai = abaikan.length ? " yang dapat dipakai" : "";
      temuan.push({
        id: "tidak_melapor",
        kode: "tidak_melapor",
        nada: "warning",
        judul: sejakMasuk !== null ? `Belum ada lokasi${dapatDipakai} sejak masuk ${jam(sejakMasuk)}` : `Belum ada lokasi${dapatDipakai} hari ini`,
        rincian: `${sejakMasuk !== null ? `Sudah ${formatDurasi(durasiTampil(sejakMasuk, sekarang))} sejak masuk tanpa titik${dapatDipakai}` : `Tidak ada titik${dapatDipakai} sejak 00:00`}. ${alasan}`,
        segmenId: segmen[0]?.id ?? null,
        lat: null,
        lng: null,
        t: acuan,
      });
    }
  }
  if (m.mode === "always" && hariLalu && bersih.length && cakupan !== null && cakupan < K.dataJarangCakupan) {
    const terpanjang = rentangTanpaData.length ? rentangTanpaData.reduce((a, b) => (b.selesai - b.mulai > a.selesai - a.mulai ? b : a)) : null;
    temuan.push({
      id: "data_jarang",
      kode: "data_jarang",
      nada: "info",
      judul: `Hanya ${persen(cakupan)} hari terekam`,
      rincian: terpanjang
        ? `Jeda terpanjang ${formatDurasi(durasiTampil(terpanjang.mulai, terpanjang.selesai))} (${jam(terpanjang.mulai)}–${formatJam(terpanjang.selesai, true)}).`
        : "Sebagian besar hari tanpa titik lokasi.",
      segmenId: terpanjang?.segmenId ?? null,
      lat: null,
      lng: null,
      t: akhirHari + 1,
    });
  }
  const kasar = disaring.filter((d) => d.alasan === "akurasi");
  if (akurasiLonggar || kasar.length) {
    const akurasiKasar = kasar.map((d) => d.akurasiM ?? 0);
    const rentangAkurasi = kasar.length
      ? Math.min(...akurasiKasar) === Math.max(...akurasiKasar)
        ? `±${formatJarak(akurasiKasar[0])}`
        : `±${formatJarak(Math.min(...akurasiKasar))}–${formatJarak(Math.max(...akurasiKasar))}`
      : "";
    temuan.push({
      id: "akurasi",
      kode: "akurasi",
      nada: "info",
      judul: akurasiLonggar ? "Akurasi lokasi rendah sepanjang hari" : `${kasar.length} titik akurasi rendah (${rentangAkurasi})`,
      rincian: akurasiLonggar
        ? `Ambang dilonggarkan ke ${formatJarak(K.akurasiLonggarM)}; singgah dan jarak hanya perkiraan.${kasar.length ? ` ${kasar.length} titik di atas itu tetap diabaikan.` : ""}`
        : `Tidak dipakai untuk garis, singgah, dan jarak · ${rentangJam(kasar.map((d) => d.t))}`,
      segmenId: kasar.length ? (segmenPada(kasar[0].t)?.id ?? null) : null,
      lat: kasar[0]?.lat ?? null,
      lng: kasar[0]?.lng ?? null,
      t: kasar[0]?.t ?? awalHari,
    });
  }
  const aneh = disaring.filter((d) => d.alasan === "janggal");
  if (aneh.length) {
    const fokus = terjauh(aneh);
    temuan.push({
      id: "janggal",
      kode: "janggal",
      nada: "info",
      judul: `${aneh.length} titik janggal diabaikan`,
      rincian: `${fokus.jarakDariJejakM !== null ? `Melompat ±${formatJarak(fokus.jarakDariJejakM)} dari jejak` : "Melompat terlalu jauh dari jejak"} · ${rentangJam(aneh.map((d) => d.t))}`,
      segmenId: segmenPada(fokus.t)?.id ?? null,
      lat: fokus.lat,
      lng: fokus.lng,
      t: aneh[0].t,
    });
  }
  const tertunda = semua.filter((p) => p.tertunda);
  if (tertunda.length) {
    const maks = Math.max(...tertunda.map((p) => p.terlambatMs ?? 0));
    temuan.push({
      id: "tertunda",
      kode: "tertunda",
      nada: "info",
      judul: `${tertunda.length} titik terkirim tertunda`,
      rincian: `Dicatat saat ponsel offline, diterima hingga ${durasiKasar(maks)} kemudian. Posisi tetap dipakai.`,
      segmenId: null,
      lat: null,
      lng: null,
      t: akhirHari + 2,
    });
  }
  // Urut nada lalu waktu; temuan tingkat hari (data jarang, tertunda) di akhir nadanya.
  temuan.sort((a, b) => NADA_URUT[a.nada] - NADA_URUT[b.nada] || a.t - b.t);

  // Batas peta: titik dipakai + koordinat presensi; titik disaring tidak pernah ikut (peta tidak terlempar ke California).
  let batas: Linimasa["batas"] = null;
  const ikut: LatLng[] = [...bersih];
  for (const e of peristiwa) if (e.lat !== null && e.lng !== null) ikut.push({ lat: e.lat, lng: e.lng });
  if (ikut.length) {
    let latMin = Infinity;
    let lngMin = Infinity;
    let latMax = -Infinity;
    let lngMax = -Infinity;
    for (const p of ikut) {
      latMin = Math.min(latMin, p.lat);
      lngMin = Math.min(lngMin, p.lng);
      latMax = Math.max(latMax, p.lat);
      lngMax = Math.max(lngMax, p.lng);
    }
    batas = [
      [latMin, lngMin],
      [latMax, lngMax],
    ];
  }

  return {
    tanggal: m.tanggal,
    awalHari,
    akhirHari,
    hariIni,
    sekarang,
    segmen,
    tempat,
    presensi: peristiwa,
    titik: bersih.map((p) => ({ t: p.t, lat: p.lat, lng: p.lng, akurasiM: p.akurasi, tertunda: p.tertunda })),
    disaring,
    temuan: temuan.map(({ t, ...x }) => {
      void t;
      return x;
    }),
    ringkasan: {
      jarakM: jarakTotal,
      jumlahPerjalanan,
      jumlahSinggah,
      jumlahTempat: tempat.length,
      diLokasiKerjaMs,
      jumlahLokasiKerja: lkDikunjungi.size,
      diamMs,
      bergerakMs,
      tanpaDataMs,
      cakupan,
      pertama: bersih.length ? bersih[0].t : null,
      terakhir: terakhir?.t ?? null,
      intervalMenit: intervalData === null ? null : bulat1(intervalData),
      ambangJedaMenit: G / MENIT,
      titik: { total: (m.titik ?? []).length, dipakai: bersih.length, palsu: hitung("palsu"), akurasi: hitung("akurasi"), janggal: hitung("janggal"), tertunda: tertunda.length },
      akurasiLonggar,
      jamPresensi,
      diLokasiKerjaSaatPresensiMs: jamPresensi ? diLKSaatPresensi : null,
      kesimpulan,
    },
    batas,
    posisiTerakhir: terakhir ? { t: terakhir.t, lat: terakhir.lat, lng: terakhir.lng, akurasiM: terakhir.akurasi, segar } : null,
  };
}

// ---------------------------------------------------------------- format & tanggal (murni)

// Nama hari/bulan ditulis tetap (bukan Intl) supaya hasil identik di semua peramban dan zona mesin.
const NAMA_HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const HARI_RINGKAS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const NAMA_BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const BULAN_RINGKAS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const dua = (n: number) => String(n).padStart(2, "0");
/** 13821 -> "13.821" (pemisah ribuan id-ID). */
const ribuan = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

function uraiTanggal(tanggal: string): [number, number, number] {
  const [y, mo, d] = tanggal.split("-").map(Number);
  return [y, mo, d];
}

/** Epoch ms pukul 00:00 WIB pada tanggal "YYYY-MM-DD". */
export function awalHariWIB(tanggal: string): number {
  const [y, mo, d] = uraiTanggal(tanggal);
  return Date.UTC(y, mo - 1, d) - OFFSET_MS;
}

/**
 * "HH:mm" dalam WIB. `akhir` = ms adalah batas akhir rentang, sehingga tengah
 * malam ditulis "24:00" (mis. "17:51–24:00"), bukan "00:00".
 */
export function formatJam(ms: number, akhir = false): string {
  if (!Number.isFinite(ms)) return "--:--";
  const d = new Date(ms + OFFSET_MS);
  const j = d.getUTCHours();
  const m = d.getUTCMinutes();
  if (akhir && j === 0 && m === 0) return "24:00";
  return `${dua(j)}:${dua(m)}`;
}

/** "0 mnt" · "< 1 mnt" · "47 mnt" · "2 j" · "4 j 21 mnt". */
export function formatDurasi(ms: number): string {
  if (!(ms > 0)) return "0 mnt";
  const menit = Math.floor(ms / MENIT);
  if (!Number.isFinite(menit) || menit < 1) return "< 1 mnt";
  const j = Math.floor(menit / 60);
  const m = menit % 60;
  if (!j) return `${m} mnt`;
  return m ? `${j} j ${m} mnt` : `${j} j`;
}

/** Untuk pembaca layar: "4 jam 21 menit". */
export function formatDurasiPanjang(ms: number): string {
  if (!(ms > 0)) return "0 menit";
  const menit = Math.floor(ms / MENIT);
  if (!Number.isFinite(menit) || menit < 1) return "kurang dari 1 menit";
  const j = Math.floor(menit / 60);
  const m = menit % 60;
  if (!j) return `${m} menit`;
  return m ? `${j} jam ${m} menit` : `${j} jam`;
}

/** "15 m" · "520 m" (per 10 m) · "16,5 km" · "13.821 km". */
export function formatJarak(m: number): string {
  const v = Number.isFinite(m) ? Math.max(0, m) : 0;
  // Di bawah 100 m per meter (selisih posisi presensi), lalu per 10 m: presisi GPS tidak lebih baik.
  if (v < 99.5) return `${Math.round(v)} m`;
  const per10 = Math.round(v / 10) * 10;
  if (per10 < 1000) return `${per10} m`;
  const km1 = Math.round(v / 100) / 10;
  if (km1 < 100) return `${String(km1).replace(".", ",")} km`;
  return `${ribuan(Math.round(v / 1000))} km`;
}

/** "≈9 km/j". */
export function formatKecepatan(kmj: number): string {
  const v = Number.isFinite(kmj) ? Math.max(0, kmj) : 0;
  return `≈${ribuan(Math.round(v))} km/j`;
}

/** Tanggal "YYYY-MM-DD" (WIB) dari epoch ms. */
export function tanggalWIB(ms: number): string {
  const d = new Date(ms + OFFSET_MS);
  return `${d.getUTCFullYear()}-${dua(d.getUTCMonth() + 1)}-${dua(d.getUTCDate())}`;
}

/** Geser tanggal "YYYY-MM-DD" sebanyak n hari. */
export function geserTanggal(tanggal: string, n: number): string {
  const [y, mo, d] = uraiTanggal(tanggal);
  const x = new Date(Date.UTC(y, mo - 1, d + n));
  return `${x.getUTCFullYear()}-${dua(x.getUTCMonth() + 1)}-${dua(x.getUTCDate())}`;
}

/**
 * "Rabu, 30 September 2026" (panjang) · "Rab, 30 Sep 2026" (ringkas) ·
 * "Rab 30 Sep" (pendek, untuk "Hari ini, Sab 3 Okt").
 */
export function labelTanggal(tanggal: string, bentuk: "panjang" | "ringkas" | "pendek" = "panjang"): string {
  const [y, mo, d] = uraiTanggal(tanggal);
  const hari = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  if (bentuk === "pendek") return `${HARI_RINGKAS[hari]} ${d} ${BULAN_RINGKAS[mo - 1]}`;
  if (bentuk === "ringkas") return `${HARI_RINGKAS[hari]}, ${d} ${BULAN_RINGKAS[mo - 1]} ${y}`;
  return `${NAMA_HARI[hari]}, ${d} ${NAMA_BULAN[mo - 1]} ${y}`;
}

const R_BUMI = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** "-6.20880, 106.84560" — format yang diterima Google Maps, mudah disalin. */
export function formatKoordinat(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** Jarak haversine (m). */
export function jarakM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(rad(a.lat)) * Math.cos(rad(b.lat));
  return 2 * R_BUMI * Math.asin(Math.min(1, Math.sqrt(h)));
}
