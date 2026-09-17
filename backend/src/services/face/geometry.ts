// src/services/face/geometry.ts

export interface Point {
  x: number;
  y: number;
}

export interface SimilarityTransform {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

/**
 * Transformasi kemiripan (rotasi + skala seragam + translasi) yang paling pas
 * memetakan sekumpulan titik ke titik lain, dengan galat kuadrat terkecil.
 *
 * Bentuknya x' = a·x − b·y + tx dan y' = b·x + a·y + ty. Karena linier
 * terhadap (a, b, tx, ty), solusinya tertutup — tidak perlu SVD seperti
 * rumusan Umeyama pada umumnya, dan untuk kasus similarity hasilnya sama.
 */
export const estimateSimilarityTransform = (
  from: Point[],
  to: Point[]
): SimilarityTransform => {
  if (from.length !== to.length || from.length < 2) {
    throw new Error('Butuh minimal 2 pasang titik yang jumlahnya sama');
  }

  const n = from.length;
  const mean = (points: Point[]) => ({
    x: points.reduce((s, p) => s + p.x, 0) / n,
    y: points.reduce((s, p) => s + p.y, 0) / n,
  });

  const mFrom = mean(from);
  const mTo = mean(to);

  let sumAtas = 0;
  let sumSilang = 0;
  let sumKuadrat = 0;

  for (let i = 0; i < n; i += 1) {
    const dx = from[i].x - mFrom.x;
    const dy = from[i].y - mFrom.y;
    const DX = to[i].x - mTo.x;
    const DY = to[i].y - mTo.y;

    sumAtas += dx * DX + dy * DY;
    sumSilang += dx * DY - dy * DX;
    sumKuadrat += dx * dx + dy * dy;
  }

  if (sumKuadrat === 0) {
    throw new Error('Titik sumber berimpit semua, transformasi tidak terdefinisi');
  }

  const a = sumAtas / sumKuadrat;
  const b = sumSilang / sumKuadrat;

  return {
    a,
    b,
    tx: mTo.x - (a * mFrom.x - b * mFrom.y),
    ty: mTo.y - (b * mFrom.x + a * mFrom.y),
  };
};

export const applyTransform = (t: SimilarityTransform, p: Point): Point => ({
  x: t.a * p.x - t.b * p.y + t.tx,
  y: t.b * p.x + t.a * p.y + t.ty,
});

export const invertTransform = (t: SimilarityTransform): SimilarityTransform => {
  const det = t.a * t.a + t.b * t.b;
  if (det === 0) throw new Error('Transformasi tidak bisa dibalik');

  const a = t.a / det;
  const b = -t.b / det;

  return {
    a,
    b,
    tx: -(a * t.tx - b * t.ty),
    ty: -(b * t.tx + a * t.ty),
  };
};

export interface RawImage {
  data: Buffer | Uint8Array;
  width: number;
  height: number;
  channels: number;
}

/**
 * Memetakan gambar sumber ke kanvas berukuran tetap memakai transformasi
 * kemiripan, dengan pencuplikan bilinear.
 *
 * Arahnya dibalik (untuk tiap piksel tujuan dicari asalnya) supaya kanvas
 * hasil tidak berlubang — pemetaan maju akan meninggalkan celah saat gambar
 * diperbesar.
 */
export const warpImage = (
  source: RawImage,
  transform: SimilarityTransform,
  outWidth: number,
  outHeight: number
): RawImage => {
  const inverse = invertTransform(transform);
  const out = Buffer.alloc(outWidth * outHeight * 3);
  const { data, width, height, channels } = source;

  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const src = applyTransform(inverse, { x, y });

      const x0 = Math.floor(src.x);
      const y0 = Math.floor(src.y);
      const fx = src.x - x0;
      const fy = src.y - y0;

      const target = (y * outWidth + x) * 3;

      // Di luar batas gambar diisi hitam, sama seperti perilaku warpAffine
      // dengan border konstan.
      if (x0 < 0 || y0 < 0 || x0 + 1 >= width || y0 + 1 >= height) {
        out[target] = 0;
        out[target + 1] = 0;
        out[target + 2] = 0;
        continue;
      }

      for (let c = 0; c < 3; c += 1) {
        const p00 = data[(y0 * width + x0) * channels + c];
        const p01 = data[(y0 * width + x0 + 1) * channels + c];
        const p10 = data[((y0 + 1) * width + x0) * channels + c];
        const p11 = data[((y0 + 1) * width + x0 + 1) * channels + c];

        const atas = p00 + (p01 - p00) * fx;
        const bawah = p10 + (p11 - p10) * fx;

        out[target + c] = Math.round(atas + (bawah - atas) * fy);
      }
    }
  }

  return { data: out, width: outWidth, height: outHeight, channels: 3 };
};
