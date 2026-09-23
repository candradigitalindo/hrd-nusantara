import {
  hitungRekapLibur,
  rentangBulan,
  jendelaRoster,
  BATAS_HARI_BERUNTUN,
} from '../src/utils/rosterRecap';

const tgl = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Daftar tanggal berurutan, memudahkan menyusun roster contoh. */
const deret = (mulai: string, jumlah: number): string[] => {
  const awal = tgl(mulai).getTime();
  return Array.from({ length: jumlah }, (_, i) =>
    new Date(awal + i * 86_400_000).toISOString().slice(0, 10)
  );
};

const rekap = (tanggal: string[], month = '2026-09') => {
  const { monthStart, monthEnd } = rentangBulan(month);
  return hitungRekapLibur({ scheduledDateKeys: new Set(tanggal), monthStart, monthEnd });
};

describe('Rentang bulan', () => {
  it('berakhir di hari terakhir bulan, termasuk Februari kabisat', () => {
    expect(rentangBulan('2026-09').monthEnd.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(rentangBulan('2024-02').monthEnd.toISOString().slice(0, 10)).toBe('2024-02-29');
    expect(rentangBulan('2026-02').monthEnd.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('jendela baca melebar seminggu ke kedua arah', () => {
    const { monthStart, monthEnd } = rentangBulan('2026-09');
    const jendela = jendelaRoster(monthStart, monthEnd);
    expect(jendela.gte.toISOString().slice(0, 10)).toBe('2026-08-25');
    expect(jendela.lte.toISOString().slice(0, 10)).toBe('2026-10-07');
  });
});

describe('Membedakan libur dari roster yang belum disusun', () => {
  it('tanggal kosong di pekan yang sudah ter-roster dihitung libur', () => {
    // Senin–Sabtu dijadwalkan, Minggu kosong: Minggu itu hari libur.
    const r = rekap(deret('2026-09-07', 6));
    expect(r.hariKerja).toBe(6);
    expect(r.hariLibur).toBe(1); // 2026-09-13, Minggu di pekan yang sama
    expect(r.pekanTersusun).toBe(1);
  });

  it('pekan yang sama sekali kosong dihitung belum disusun, bukan libur', () => {
    const r = rekap(deret('2026-09-07', 6));
    // September 2026 punya 30 hari; 7 di antaranya ada di pekan yang tersusun.
    expect(r.belumDisusun).toBe(30 - 7);
    expect(r.hariLibur + r.hariKerja + r.belumDisusun).toBe(30);
  });

  it('karyawan tanpa satu pun shift tidak dianggap libur sebulan penuh', () => {
    const r = rekap([]);
    expect(r).toMatchObject({ hariKerja: 0, hariLibur: 0, belumDisusun: 30, pekanTersusun: 0 });
    expect(r.kurangLibur).toBe(false);
  });
});

describe('Pekan tanpa libur', () => {
  it('ditandai ketika tujuh hari dalam satu pekan terisi semua', () => {
    const r = rekap(deret('2026-09-07', 7)); // Senin–Minggu penuh
    expect(r.kurangLibur).toBe(true);
    expect(r.hariLibur).toBe(0);
  });

  it('tidak ditandai bila hari liburnya jatuh di bulan berikutnya', () => {
    // Pekan 28 Sep–4 Okt: bekerja 28 Sep–3 Okt, libur Minggu 4 Oktober.
    // Hari liburnya ada di luar bulan, tapi pekannya tetap punya libur.
    const r = rekap(deret('2026-09-28', 6));
    expect(r.kurangLibur).toBe(false);
  });
});

describe('Deret hari kerja berturut-turut', () => {
  it('menandai tujuh hari beruntun sebagai melewati batas', () => {
    const r = rekap(deret('2026-09-07', 7));
    expect(r.beruntunMaks).toBe(7);
    expect(r.beruntunLewatBatas).toBe(true);
    expect(BATAS_HARI_BERUNTUN).toBe(6);
  });

  it('enam hari beruntun masih di dalam batas', () => {
    const r = rekap(deret('2026-09-07', 6));
    expect(r.beruntunMaks).toBe(6);
    expect(r.beruntunLewatBatas).toBe(false);
  });

  it('menyambung deret yang menyeberang pergantian bulan', () => {
    // Enam hari terakhir Agustus disambung tiga hari pertama September.
    const r = rekap([...deret('2026-08-26', 6), ...deret('2026-09-01', 3)]);
    expect(r.beruntunMaks).toBe(9);
    expect(r.beruntunLewatBatas).toBe(true);
  });

  it('mengabaikan deret yang sama sekali tidak menyentuh bulan ini', () => {
    // Berhenti 30 Agustus: tidak ada kaitannya dengan rekap September.
    const r = rekap(deret('2026-08-24', 7));
    expect(r.beruntunMaks).toBe(0);
    expect(r.beruntunLewatBatas).toBe(false);
  });

  it('split shift di satu tanggal tetap satu hari kerja', () => {
    // Kuncinya tanggal, jadi dua shift sehari tidak menggandakan apa pun.
    const r = rekap(['2026-09-07', '2026-09-07', '2026-09-08']);
    expect(r.hariKerja).toBe(2);
    expect(r.beruntunMaks).toBe(2);
  });
});
