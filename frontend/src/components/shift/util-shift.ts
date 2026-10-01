import { addMonths } from "date-fns";
import { formatTanggal } from "@/lib/utils";
import type { DurasiPenugasan, Shift, WarnaJenisShift } from "@/lib/types";

/** "YYYY-MM-DD" dari komponen tanggal lokal — tanpa pergeseran zona waktu. */
export const tanggalISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * "YYYY-MM-DD" sebagai tengah malam waktu lokal. `new Date("2026-10-01")`
 * dibaca sebagai UTC, dan di zona barat UTC tanggalnya mundur sehari.
 */
export const dariISO = (s: string) => {
  const [t, b, h] = s.slice(0, 10).split("-").map(Number);
  return new Date(t, b - 1, h);
};

export const tambahHari = (d: Date, n: number) => {
  const t = new Date(d);
  t.setDate(t.getDate() + n);
  return t;
};

/** Geser tanggal "YYYY-MM-DD" sebanyak n hari. */
export const geserISO = (s: string, n: number) => tanggalISO(tambahHari(dariISO(s), n));

/** Senin pada minggu tanggal ini. Minggu kerja di sini Senin–Minggu. */
export const seninDari = (d: Date) => {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  return t;
};

/** "YYYY-MM" dari sebuah tanggal — parameter rekap libur bulanan. */
export const bulanISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** Tanggal shift dari server ("2026-09-22T00:00:00.000Z") sebagai "YYYY-MM-DD". */
export const tanggalShift = (s: Pick<Shift, "date">) => s.date.slice(0, 10);

/** Shift yang berakhir pada atau sebelum jam mulainya melewati tengah malam (aturan yang sama dengan server). */
export const lintasMalam = (mulai: string, selesai: string) => selesai <= mulai;

/** Panjang shift dalam menit, termasuk yang melewati tengah malam. */
export const menitShift = (mulai: string, selesai: string) => {
  const [jm, mm] = mulai.split(":").map(Number);
  const [js, ms] = selesai.split(":").map(Number);
  const awal = jm * 60 + mm;
  const akhir = js * 60 + ms;
  return akhir > awal ? akhir - awal : akhir + 24 * 60 - awal;
};

export const jamTerjadwal = (daftar: Shift[]) =>
  daftar
    .filter((s) => s.status !== "cancelled")
    .reduce((total, s) => total + menitShift(s.startTime, s.endTime) / 60 - s.breakDuration, 0);

/** "1 jam", "1,5 jam", atau "—" bila tanpa istirahat. */
export const formatIstirahat = (jam: number) =>
  jam > 0 ? `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(jam)} jam` : "—";

/**
 * Kelas warna per kunci palet. Ditulis lengkap (bukan dirangkai dari kunci)
 * karena Tailwind hanya membangkitkan kelas yang muncul utuh di kode sumber.
 */
export const WARNA_JENIS: Record<WarnaJenisShift, { label: string; chip: string; titik: string }> = {
  teal: { label: "Hijau toska", chip: "bg-jenis-teal-soft text-jenis-teal", titik: "bg-jenis-teal" },
  blue: { label: "Biru", chip: "bg-jenis-blue-soft text-jenis-blue", titik: "bg-jenis-blue" },
  amber: { label: "Kuning", chip: "bg-jenis-amber-soft text-jenis-amber", titik: "bg-jenis-amber" },
  violet: { label: "Ungu", chip: "bg-jenis-violet-soft text-jenis-violet", titik: "bg-jenis-violet" },
  rose: { label: "Merah muda", chip: "bg-jenis-rose-soft text-jenis-rose", titik: "bg-jenis-rose" },
  slate: { label: "Abu-abu", chip: "bg-jenis-slate-soft text-jenis-slate", titik: "bg-jenis-slate" },
  green: { label: "Hijau", chip: "bg-jenis-green-soft text-jenis-green", titik: "bg-jenis-green" },
  orange: { label: "Jingga", chip: "bg-jenis-orange-soft text-jenis-orange", titik: "bg-jenis-orange" },
};

export const KUNCI_WARNA = Object.keys(WARNA_JENIS) as WarnaJenisShift[];

/** Warna yang tidak dikenal (data lama, palet berubah) jatuh ke toska, bukan ke chip tanpa warna. */
export const warnaJenis = (kunci: string | null | undefined) => WARNA_JENIS[(kunci ?? "") as WarnaJenisShift] ?? WARNA_JENIS.teal;

/** Hari dalam urutan Senin dulu; `nilai` mengikuti server: 0 = Minggu … 6 = Sabtu. */
export const HARI_PEKAN = [
  { nilai: 1, pendek: "Sen", panjang: "Senin" },
  { nilai: 2, pendek: "Sel", panjang: "Selasa" },
  { nilai: 3, pendek: "Rab", panjang: "Rabu" },
  { nilai: 4, pendek: "Kam", panjang: "Kamis" },
  { nilai: 5, pendek: "Jum", panjang: "Jumat" },
  { nilai: 6, pendek: "Sab", panjang: "Sabtu" },
  { nilai: 0, pendek: "Min", panjang: "Minggu" },
] as const;

/** "Setiap hari", "Sen–Sab", atau "Sen Rab Jum" — ringkas untuk kolom tabel. */
export const formatHariPekan = (weekdays: number[]) => {
  const ada = new Set(weekdays);
  const urut = HARI_PEKAN.filter((h) => ada.has(h.nilai));
  if (urut.length === 7) return "Setiap hari";
  if (urut.length === 0) return "—";
  const posisi = urut.map((h) => HARI_PEKAN.indexOf(h));
  const beruntun = posisi.every((p, i) => i === 0 || p === posisi[i - 1] + 1);
  if (beruntun && urut.length >= 3) return `${urut[0].pendek}–${urut[urut.length - 1].pendek}`;
  return urut.map((h) => h.pendek).join(" ");
};

/** "1 Okt 2026 – seterusnya", "1–31 Okt 2026", "28 Sep – 4 Okt 2026", atau satu tanggal. */
export const formatPeriode = (mulai: string, akhir: string | null) => {
  const a = dariISO(mulai);
  if (!akhir) return `${formatTanggal(a)} – seterusnya`;
  const b = dariISO(akhir);
  if (mulai === akhir) return formatTanggal(a);
  if (a.getFullYear() !== b.getFullYear()) return `${formatTanggal(a)} – ${formatTanggal(b)}`;
  if (a.getMonth() !== b.getMonth()) return `${formatTanggal(a, "d MMM")} – ${formatTanggal(b)}`;
  return `${a.getDate()}–${formatTanggal(b)}`;
};

/**
 * Tanggal akhir yang akan dipakai server untuk tiap pilihan "Berlaku" —
 * hanya untuk ditampilkan; server tetap yang menghitung. Satu bulan berarti
 * tanggal yang sama bulan depan dikurangi sehari. Bila tanggal itu tidak ada
 * (31 Jan → 31 Feb), hasil pangkasannya (28/29 Feb) sudah hari terakhirnya
 * dan tidak dikurangi lagi — aturan yang sama dengan luxon di server, supaya
 * teks "Berlaku …" tidak selisih sehari dari yang benar-benar dibuat.
 */
export const akhirEfektif = (mulai: string, durasi: DurasiPenugasan, sampai: string): string | null => {
  if (!mulai) return null;
  switch (durasi) {
    case "hari":
      return mulai;
    case "minggu":
      return geserISO(mulai, 6);
    case "bulan": {
      const awal = dariISO(mulai);
      const sebulan = addMonths(awal, 1);
      return tanggalISO(sebulan.getDate() === awal.getDate() ? tambahHari(sebulan, -1) : sebulan);
    }
    case "seterusnya":
      return null;
    case "sampai":
      return sampai || null;
  }
};

/** Alasan tanggal dilewati, dari kode server. */
export const LABEL_ALASAN: Record<string, string> = {
  bentrok: "bentrok",
  libur_nasional: "libur nasional",
  karyawan_keluar: "karyawan sudah keluar",
  fleksibel: "jam fleksibel",
};

export const labelAlasan = (kode: string) => LABEL_ALASAN[kode] ?? kode.replace(/_/g, " ");

/** Penugasan masih berlaku bila belum punya tanggal akhir atau akhirnya belum lewat. */
export const penugasanAktif = (p: { endDate: string | null }, hariIni: string) => p.endDate === null || p.endDate.slice(0, 10) >= hariIni;
