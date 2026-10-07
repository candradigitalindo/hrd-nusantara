import { acak, bacaPilihan, dinilaiOtomatis, hitungNilai, jenisPaket, nilaiButir, petaNilaiSkala, pilihanTanpaNilai, rentangSkala, sisaDetik } from '../src/utils/cbt';

describe('Penilaian butir soal', () => {
  const pg = { tipe: 'pilihan_ganda', kunci: ['b'], poin: 2 };

  it('pilihan ganda: benar penuh, salah nol, kosong nol', () => {
    expect(nilaiButir(pg, { dipilih: ['b'] })).toEqual({ benar: true, poin: 2 });
    expect(nilaiButir(pg, { dipilih: ['a'] })).toEqual({ benar: false, poin: 0 });
    expect(nilaiButir(pg, { dipilih: [] })).toEqual({ benar: false, poin: 0 });
    expect(nilaiButir(pg, null)).toEqual({ benar: false, poin: 0 });
  });

  it('banyak jawaban dinilai penuh atau nol, bukan sebagian', () => {
    const butir = { tipe: 'banyak_jawaban', kunci: ['a', 'c'], poin: 3 };
    expect(nilaiButir(butir, { dipilih: ['c', 'a'] })).toEqual({ benar: true, poin: 3 });
    // Satu benar satu kurang: nol. Kalau tidak, menebak semua pilihan jadi menguntungkan.
    expect(nilaiButir(butir, { dipilih: ['a'] })).toEqual({ benar: false, poin: 0 });
    expect(nilaiButir(butir, { dipilih: ['a', 'b', 'c'] })).toEqual({ benar: false, poin: 0 });
  });

  it('isian mengabaikan besar-kecil huruf dan spasi berlebih', () => {
    const butir = { tipe: 'isian', kunci: ['Food Safety', 'HACCP'], poin: 1 };
    expect(nilaiButir(butir, { dipilih: [], teks: '  food   safety ' })).toEqual({ benar: true, poin: 1 });
    expect(nilaiButir(butir, { dipilih: [], teks: 'haccp' })).toEqual({ benar: true, poin: 1 });
    expect(nilaiButir(butir, { dipilih: [], teks: 'entahlah' })).toEqual({ benar: false, poin: 0 });
    expect(nilaiButir(butir, { dipilih: [], teks: '   ' })).toEqual({ benar: false, poin: 0 });
  });

  it('esai tidak dinilai mesin', () => {
    expect(dinilaiOtomatis('esai')).toBe(false);
    expect(nilaiButir({ tipe: 'esai', kunci: [], poin: 10 }, { dipilih: [], teks: 'jawaban panjang' })).toEqual({
      benar: null,
      poin: null,
    });
  });
});

describe('Nilai akhir', () => {
  it('menahan kelulusan selama masih ada esai yang belum dinilai', () => {
    const hasil = hitungNilai(
      [
        { tipe: 'pilihan_ganda', poin: 2, poinDiperoleh: 2 },
        { tipe: 'pilihan_ganda', poin: 2, poinDiperoleh: 0 },
        { tipe: 'esai', poin: 6, poinDiperoleh: null },
      ],
      60
    );
    expect(hasil).toMatchObject({ objektif: 2, esai: 0, total: 2, maksimal: 10, menungguPenilaian: true, lulus: null });
  });

  it('menghitung persen dan kelulusan setelah semua dinilai', () => {
    const hasil = hitungNilai(
      [
        { tipe: 'pilihan_ganda', poin: 2, poinDiperoleh: 2 },
        { tipe: 'esai', poin: 8, poinDiperoleh: 5 },
      ],
      70
    );
    expect(hasil).toMatchObject({ objektif: 2, esai: 5, total: 7, maksimal: 10, persen: 70, lulus: true, menungguPenilaian: false });
  });

  it('tanpa ambang, kelulusan tidak diputuskan', () => {
    expect(hitungNilai([{ tipe: 'isian', poin: 1, poinDiperoleh: 1 }], null).lulus).toBeNull();
    expect(hitungNilai([{ tipe: 'isian', poin: 1, poinDiperoleh: 0 }], 50).lulus).toBe(false);
  });

  it('paket kosong tidak membagi dengan nol', () => {
    expect(hitungNilai([], 50)).toMatchObject({ total: 0, maksimal: 0, persen: 0 });
  });
});

describe('Bantuan lain', () => {
  it('pengacakan mempertahankan seluruh anggota', () => {
    const asal = ['a', 'b', 'c', 'd', 'e'];
    const hasil = acak(asal, () => 0.42);
    expect([...hasil].sort()).toEqual([...asal].sort());
    expect(asal).toEqual(['a', 'b', 'c', 'd', 'e']); // tidak mengubah asalnya
  });

  it('pilihan jawaban yang bentuknya tidak sah dibuang', () => {
    expect(bacaPilihan([{ kode: 'a', teks: 'Benar' }, { kode: 1, teks: 'x' }, null, 'bukan objek'])).toEqual([
      { kode: 'a', teks: 'Benar' },
    ]);
    expect(bacaPilihan(null)).toEqual([]);
  });

  it('sisa waktu tidak pernah negatif', () => {
    const sekarang = new Date('2026-09-23T10:00:00Z');
    expect(sisaDetik(new Date('2026-09-23T10:01:30Z'), sekarang)).toBe(90);
    expect(sisaDetik(new Date('2026-09-23T09:59:00Z'), sekarang)).toBe(0);
  });
});

describe('Butir skala (inventori kepribadian)', () => {
  const skala = { tipe: 'skala', kunci: [], poin: 5, nilaiPilihan: { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5 } };

  it('nilainya adalah nilai pilihan yang diambil, tanpa benar/salah', () => {
    expect(nilaiButir(skala, { dipilih: ['4'] })).toEqual({ benar: null, poin: 4 });
    expect(nilaiButir(skala, { dipilih: ['1'] })).toEqual({ benar: null, poin: 1 });
  });

  it('butir terbalik memberi nilai tinggi untuk "sangat tidak sesuai"', () => {
    const terbalik = { ...skala, nilaiPilihan: { '1': 5, '2': 4, '3': 3, '4': 2, '5': 1 } };
    expect(nilaiButir(terbalik, { dipilih: ['1'] })).toEqual({ benar: null, poin: 5 });
    expect(nilaiButir(terbalik, { dipilih: ['5'] })).toEqual({ benar: null, poin: 1 });
  });

  it('dilewati atau kode asing bernilai nol, bukan menunggu penilaian', () => {
    expect(nilaiButir(skala, null)).toEqual({ benar: null, poin: 0 });
    expect(nilaiButir(skala, { dipilih: [] })).toEqual({ benar: null, poin: 0 });
    expect(nilaiButir(skala, { dipilih: ['9'] })).toEqual({ benar: null, poin: 0 });
    const hasil = hitungNilai([{ tipe: 'skala', poin: 5, poinDiperoleh: 0 }, { tipe: 'skala', poin: 5, poinDiperoleh: 4 }], null);
    expect(hasil.menungguPenilaian).toBe(false);
    expect(hasil.lulus).toBeNull();
    expect(hasil.total).toBe(4);
  });

  it('bacaPilihan mempertahankan nilai, dan pilihanTanpaNilai membuangnya', () => {
    const pilihan = bacaPilihan([{ kode: '1', teks: 'Sangat tidak sesuai', nilai: 5 }, { kode: '2', teks: 'Tidak sesuai', nilai: '4' }]);
    expect(pilihan).toEqual([{ kode: '1', teks: 'Sangat tidak sesuai', nilai: 5 }, { kode: '2', teks: 'Tidak sesuai' }]);
    expect(pilihanTanpaNilai(pilihan)).toEqual([{ kode: '1', teks: 'Sangat tidak sesuai' }, { kode: '2', teks: 'Tidak sesuai' }]);
    expect(rentangSkala(pilihan)).toEqual({ min: 5, max: 5 });
    expect(petaNilaiSkala(pilihan)).toEqual({ '1': 5 });
  });

  it('paket yang seluruh butirnya skala adalah inventori kepribadian', () => {
    expect(jenisPaket(['skala', 'skala'])).toBe('kepribadian');
    expect(jenisPaket(['skala', 'pilihan_ganda'])).toBe('pengetahuan');
    expect(jenisPaket([])).toBe('pengetahuan');
  });
});
