/**
 * Pengurai kalender libur yang ditempel HR ke kotak teks: satu tanggal per
 * baris, tanggal lalu nama (atau sebaliknya), dipisah titik koma, koma, tab,
 * atau spasi. Modul murni tanpa React supaya mudah diuji.
 *
 * Contoh baris yang diterima:
 *   2026-01-01; Tahun Baru Masehi
 *   17/08/2026, Proklamasi Kemerdekaan RI
 *   2026-12-24 Cuti Bersama Natal        ← otomatis cuti bersama
 *   2026-05-15 Libur HUT Perusahaan *    ← tanda * = cuti bersama
 */
export interface BarisLibur {
  nomor: number;
  date: string; // YYYY-MM-DD
  name: string;
  isCollectiveLeave: boolean;
}

export interface GalatBaris {
  nomor: number;
  teks: string;
  alasan: string;
}

/** "2026-1-5", "05/01/2026", atau "05-01-2026" → "2026-01-05"; null bila bukan tanggal sah. */
export const normalkanTanggal = (teks: string): string | null => {
  const t = teks.trim();
  let y: string | undefined, m: string | undefined, d: string | undefined;
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const lokal = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (iso) [, y, m, d] = iso;
  else if (lokal) [, d, m, y] = lokal;
  else return null;
  const hasil = `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  // Date.parse menerima 2026-02-31 lalu menggesernya ke Maret; tanggal hanya
  // sah bila kembali utuh setelah diurai — aturan yang sama dengan backend.
  const waktu = Date.parse(`${hasil}T00:00:00.000Z`);
  if (Number.isNaN(waktu) || new Date(waktu).toISOString().slice(0, 10) !== hasil) return null;
  return hasil;
};

const PEMISAH_DEPAN = /^([^\s;,\t]+)\s*[;,\t]?\s*(.*)$/;
const PEMISAH_BELAKANG = /^(.*?)\s*[;,\t]?\s*([^\s;,\t]+)$/;

export const parseKalenderLibur = (teks: string): { baris: BarisLibur[]; galat: GalatBaris[] } => {
  const baris: BarisLibur[] = [];
  const galat: GalatBaris[] = [];
  const terlihat = new Map<string, number>();

  teks.split(/\r?\n/).forEach((asli, i) => {
    const nomor = i + 1;
    const t = asli.trim();
    if (!t || t.startsWith("#")) return;

    let date: string | null = null;
    let nama = "";
    const depan = t.match(PEMISAH_DEPAN);
    if (depan) {
      date = normalkanTanggal(depan[1]);
      nama = depan[2];
    }
    if (!date) {
      const belakang = t.match(PEMISAH_BELAKANG);
      if (belakang && normalkanTanggal(belakang[2])) {
        date = normalkanTanggal(belakang[2]);
        nama = belakang[1];
      }
    }
    if (!date) {
      galat.push({ nomor, teks: t, alasan: "Tanggal tidak dikenali — pakai 2026-01-01 atau 01/01/2026" });
      return;
    }

    nama = nama.replace(/^[;,\s]+|[;,\s]+$/g, "");
    let isCollectiveLeave = false;
    if (/\*+$/.test(nama)) {
      isCollectiveLeave = true;
      nama = nama.replace(/\s*\*+$/, "").trim();
    }
    if (/cuti\s*bersama/i.test(nama)) isCollectiveLeave = true;

    if (!nama) {
      galat.push({ nomor, teks: t, alasan: "Nama hari libur kosong" });
      return;
    }
    if (nama.length > 150) {
      galat.push({ nomor, teks: t, alasan: "Nama lebih dari 150 karakter" });
      return;
    }
    const sebelumnya = terlihat.get(date);
    if (sebelumnya !== undefined) {
      galat.push({ nomor, teks: t, alasan: `Tanggal sama dengan baris ${sebelumnya}` });
      return;
    }
    terlihat.set(date, nomor);
    baris.push({ nomor, date, name: nama, isCollectiveLeave });
  });

  return { baris, galat };
};
