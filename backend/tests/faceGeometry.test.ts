import {
  estimateSimilarityTransform,
  applyTransform,
  invertTransform,
  warpImage,
  type Point,
  type RawImage,
} from '../src/services/face/geometry';

const dekat = (a: Point, b: Point, presisi = 6) => {
  expect(a.x).toBeCloseTo(b.x, presisi);
  expect(a.y).toBeCloseTo(b.y, presisi);
};

describe('estimateSimilarityTransform', () => {
  const sumber: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('menemukan translasi murni', () => {
    const tujuan = sumber.map((p) => ({ x: p.x + 5, y: p.y - 3 }));
    const t = estimateSimilarityTransform(sumber, tujuan);

    expect(t.a).toBeCloseTo(1, 6);
    expect(t.b).toBeCloseTo(0, 6);
    sumber.forEach((p, i) => dekat(applyTransform(t, p), tujuan[i]));
  });

  it('menemukan penskalaan murni', () => {
    const tujuan = sumber.map((p) => ({ x: p.x * 2.5, y: p.y * 2.5 }));
    const t = estimateSimilarityTransform(sumber, tujuan);

    expect(t.a).toBeCloseTo(2.5, 6);
    expect(t.b).toBeCloseTo(0, 6);
  });

  it('menemukan rotasi 90 derajat', () => {
    const tujuan = sumber.map((p) => ({ x: -p.y, y: p.x }));
    const t = estimateSimilarityTransform(sumber, tujuan);

    expect(t.a).toBeCloseTo(0, 6);
    expect(t.b).toBeCloseTo(1, 6);
    sumber.forEach((p, i) => dekat(applyTransform(t, p), tujuan[i]));
  });

  it('menemukan gabungan rotasi, skala, dan translasi', () => {
    const sudut = Math.PI / 6;
    const skala = 1.8;
    const tujuan = sumber.map((p) => ({
      x: skala * (p.x * Math.cos(sudut) - p.y * Math.sin(sudut)) + 12,
      y: skala * (p.x * Math.sin(sudut) + p.y * Math.cos(sudut)) - 7,
    }));

    const t = estimateSimilarityTransform(sumber, tujuan);
    sumber.forEach((p, i) => dekat(applyTransform(t, p), tujuan[i], 5));
  });

  it('mencari kompromi terbaik saat titik tidak bisa dipetakan sempurna', () => {
    // Satu titik digeser; transformasi kemiripan tidak akan cocok sempurna,
    // tapi harus tetap menghasilkan jawaban yang masuk akal, bukan melempar error.
    const tujuan = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 3, y: 14 },
    ];

    const t = estimateSimilarityTransform(sumber, tujuan);
    expect(Number.isFinite(t.a)).toBe(true);
    expect(Number.isFinite(t.b)).toBe(true);
  });

  it('menolak titik sumber yang berimpit semua', () => {
    const sama = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ];
    expect(() => estimateSimilarityTransform(sama, sama)).toThrow();
  });

  it('menolak jumlah titik yang tidak sepadan', () => {
    expect(() => estimateSimilarityTransform(sumber, sumber.slice(0, 3))).toThrow();
  });
});

describe('invertTransform', () => {
  it('mengembalikan titik ke posisi semula', () => {
    const t = { a: 1.7, b: -0.9, tx: 23, ty: -11 };
    const inv = invertTransform(t);

    for (const p of [
      { x: 0, y: 0 },
      { x: 13, y: -4 },
      { x: -8, y: 25 },
    ]) {
      dekat(applyTransform(inv, applyTransform(t, p)), p, 5);
    }
  });
});

describe('warpImage', () => {
  /** Gambar 4x4 dengan gradasi mendatar, supaya nilai pikselnya terprediksi. */
  const gambar = (): RawImage => {
    const data = Buffer.alloc(4 * 4 * 3);
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const i = (y * 4 + x) * 3;
        data[i] = x * 60;
        data[i + 1] = x * 60;
        data[i + 2] = x * 60;
      }
    }
    return { data, width: 4, height: 4, channels: 3 };
  };

  it('menghasilkan kanvas berukuran yang diminta', () => {
    const hasil = warpImage(gambar(), { a: 1, b: 0, tx: 0, ty: 0 }, 8, 8);

    expect(hasil.width).toBe(8);
    expect(hasil.height).toBe(8);
    expect(hasil.data.length).toBe(8 * 8 * 3);
  });

  it('menyalin piksel apa adanya saat transformasinya identitas', () => {
    const asli = gambar();
    const hasil = warpImage(asli, { a: 1, b: 0, tx: 0, ty: 0 }, 3, 3);

    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 3; x += 1) {
        expect(hasil.data[(y * 3 + x) * 3]).toBe(x * 60);
      }
    }
  });

  it('mengisi hitam untuk bagian di luar gambar sumber', () => {
    // Digeser jauh sehingga seluruh kanvas jatuh di luar gambar 4x4.
    const hasil = warpImage(gambar(), { a: 1, b: 0, tx: 100, ty: 100 }, 4, 4);

    expect(Array.from(hasil.data).every((v) => v === 0)).toBe(true);
  });

  it('mencuplik secara bilinear saat diperbesar', () => {
    // Diperbesar 2x: piksel di antaranya harus bernilai tengah, bukan meloncat.
    const hasil = warpImage(gambar(), { a: 2, b: 0, tx: 0, ty: 0 }, 6, 6);

    const p0 = hasil.data[0];
    const p1 = hasil.data[3];
    const p2 = hasil.data[6];

    expect(p1).toBeGreaterThan(p0);
    expect(p1).toBeLessThan(p2);
  });
});
