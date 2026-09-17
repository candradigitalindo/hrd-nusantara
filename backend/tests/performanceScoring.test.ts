import {
  validateWeights,
  calculateReviewScore,
  summarize360,
  ScoringError,
  type CriterionInput,
} from '../src/utils/performanceScoring';

const kriteria = (ubah: Partial<CriterionInput> & { id: string }): CriterionInput => ({
  code: ubah.id.toUpperCase(),
  name: `Kriteria ${ubah.id}`,
  weight: 50,
  maxScore: 5,
  ...ubah,
});

describe('validateWeights', () => {
  it('menerima bobot yang berjumlah 100', () => {
    expect(validateWeights([{ weight: 60 }, { weight: 40 }]).valid).toBe(true);
  });

  it('menolak bobot yang kurang dari 100', () => {
    // Formulir berbobot 80 akan selalu memberi nilai lebih rendah untuk
    // kinerja yang sama persis — tidak bisa dibandingkan antar-jabatan.
    const h = validateWeights([{ weight: 50 }, { weight: 30 }]);
    expect(h.valid).toBe(false);
    expect(h.reason).toContain('100');
  });

  it('menolak bobot yang melebihi 100', () => {
    expect(validateWeights([{ weight: 70 }, { weight: 50 }]).valid).toBe(false);
  });

  it('menoleransi selisih pembulatan kecil', () => {
    // 33,33 × 3 = 99,99.
    expect(validateWeights([{ weight: 33.33 }, { weight: 33.33 }, { weight: 33.34 }]).valid).toBe(true);
  });

  it('menolak formulir tanpa kriteria', () => {
    expect(validateWeights([]).valid).toBe(false);
  });
});

describe('calculateReviewScore', () => {
  const dua: CriterionInput[] = [
    kriteria({ id: 'a', name: 'Kecepatan Pelayanan', weight: 60, maxScore: 5 }),
    kriteria({ id: 'b', name: 'Kerapian', weight: 40, maxScore: 5 }),
  ];

  it('menghitung nilai berbobot pada skala 0-100', () => {
    // Sempurna di kedua kriteria.
    const h = calculateReviewScore(dua, [
      { criterionId: 'a', score: 5 },
      { criterionId: 'b', score: 5 },
    ]);

    expect(h.totalScore).toBe(100);
    expect(h.rating).toBe(5);
  });

  it('memberi bobot lebih besar pada kriteria berbobot lebih besar', () => {
    // Sempurna di kriteria berbobot 60, nol di yang berbobot 40.
    const h = calculateReviewScore(dua, [
      { criterionId: 'a', score: 5 },
      { criterionId: 'b', score: 0 },
    ]);

    expect(h.totalScore).toBe(60);
  });

  it('menormalkan skala yang berbeda sebelum menimbang', () => {
    // Tanpa normalisasi, kriteria berskala 1-10 akan mendominasi yang 1-5
    // walaupun bobotnya sama.
    const campuran: CriterionInput[] = [
      kriteria({ id: 'a', weight: 50, maxScore: 5 }),
      kriteria({ id: 'b', weight: 50, maxScore: 10 }),
    ];

    const h = calculateReviewScore(campuran, [
      { criterionId: 'a', score: 5 }, // penuh
      { criterionId: 'b', score: 10 }, // penuh
    ]);

    expect(h.totalScore).toBe(100);

    const setengah = calculateReviewScore(campuran, [
      { criterionId: 'a', score: 5 },
      { criterionId: 'b', score: 5 }, // separuh dari 10
    ]);

    expect(setengah.totalScore).toBe(75);
  });

  it('memetakan nilai kembali ke skala formulir', () => {
    const h = calculateReviewScore(dua, [
      { criterionId: 'a', score: 4 },
      { criterionId: 'b', score: 3 },
    ]);

    // (4/5 × 60) + (3/5 × 40) = 48 + 24 = 72 dari 100, setara 3,6 dari 5.
    expect(h.totalScore).toBe(72);
    expect(h.rating).toBe(3.6);
  });

  it('memerinci sumbangan tiap kriteria', () => {
    const h = calculateReviewScore(dua, [
      { criterionId: 'a', score: 4 },
      { criterionId: 'b', score: 3 },
    ]);

    expect(h.breakdown).toHaveLength(2);
    expect(h.breakdown[0]).toMatchObject({ code: 'A', score: 4, weight: 60, weightedScore: 48 });
  });

  it('menolak bila ada kriteria yang belum dinilai', () => {
    expect(() => calculateReviewScore(dua, [{ criterionId: 'a', score: 5 }])).toThrow(ScoringError);
  });

  it('menolak nilai di luar rentang', () => {
    expect(() =>
      calculateReviewScore(dua, [
        { criterionId: 'a', score: 9 },
        { criterionId: 'b', score: 3 },
      ])
    ).toThrow(/antara 0 dan 5/);
  });

  it('menolak nilai negatif', () => {
    expect(() =>
      calculateReviewScore(dua, [
        { criterionId: 'a', score: -1 },
        { criterionId: 'b', score: 3 },
      ])
    ).toThrow(ScoringError);
  });

  it('menolak kriteria asing, karena menandakan formulirnya berubah', () => {
    expect(() =>
      calculateReviewScore(dua, [
        { criterionId: 'a', score: 5 },
        { criterionId: 'b', score: 5 },
        { criterionId: 'entah', score: 5 },
      ])
    ).toThrow(/tidak ada pada formulir/);
  });

  it('menolak formulir yang bobotnya tidak sah', () => {
    const rusak = [kriteria({ id: 'a', weight: 30 })];
    expect(() => calculateReviewScore(rusak, [{ criterionId: 'a', score: 5 }])).toThrow(
      /bobot/
    );
  });
});

describe('summarize360', () => {
  it('merata-ratakan per sudut pandang lebih dulu', () => {
    // Lima rekan sejawat dan satu atasan. Kalau dirata-ratakan langsung,
    // nilai akhirnya nyaris sepenuhnya ditentukan rekan sejawat.
    const h = summarize360([
      { reviewerType: 'peer', totalScore: 90 },
      { reviewerType: 'peer', totalScore: 90 },
      { reviewerType: 'peer', totalScore: 90 },
      { reviewerType: 'peer', totalScore: 90 },
      { reviewerType: 'peer', totalScore: 90 },
      { reviewerType: 'manager', totalScore: 50 },
    ]);

    // Rata-rata langsung akan 83,3. Dengan pembobotan per sudut pandang: 70.
    expect(h.overall).toBe(70);
  });

  it('memerinci jumlah penilai tiap sudut pandang', () => {
    const h = summarize360([
      { reviewerType: 'peer', totalScore: 80 },
      { reviewerType: 'peer', totalScore: 60 },
      { reviewerType: 'self', totalScore: 95 },
    ]);

    const peer = h.byReviewerType.find((k) => k.reviewerType === 'peer');
    expect(peer).toMatchObject({ count: 2, averageScore: 70 });
  });

  it('mengembalikan null bila belum ada penilaian', () => {
    expect(summarize360([]).overall).toBeNull();
  });

  it('bekerja dengan satu penilai saja', () => {
    expect(summarize360([{ reviewerType: 'manager', totalScore: 77 }]).overall).toBe(77);
  });
});
