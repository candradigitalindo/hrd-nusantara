// src/services/face/detect.ts
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import { getDetectionSession } from './session';
import type { Point } from './geometry';

export interface DetectedFace {
  box: { x1: number; y1: number; x2: number; y2: number };
  score: number;
  /** 5 titik: mata kiri, mata kanan, hidung, sudut mulut kiri, sudut mulut kanan. */
  landmarks: Point[];
}

// SCRFD memakai 3 tingkat piramida fitur, masing-masing 2 anchor per lokasi.
const STRIDES = [8, 16, 32];
const ANCHORS_PER_LOCATION = 2;
const INPUT_SIZE = 640;

const iou = (a: DetectedFace['box'], b: DetectedFace['box']): number => {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);

  const irisan = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (irisan === 0) return 0;

  const luasA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const luasB = (b.x2 - b.x1) * (b.y2 - b.y1);

  return irisan / (luasA + luasB - irisan);
};

/** Menyingkirkan kotak yang saling menumpuk untuk wajah yang sama. */
const nonMaxSuppression = (faces: DetectedFace[], threshold: number): DetectedFace[] => {
  const urut = [...faces].sort((a, b) => b.score - a.score);
  const hasil: DetectedFace[] = [];

  for (const kandidat of urut) {
    if (hasil.every((tersimpan) => iou(kandidat.box, tersimpan.box) < threshold)) {
      hasil.push(kandidat);
    }
  }

  return hasil;
};

export const detectFaces = async (
  imageBuffer: Buffer,
  options: { scoreThreshold: number; nmsThreshold?: number } = { scoreThreshold: 0.5 }
): Promise<DetectedFace[]> => {
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  if (width === 0 || height === 0) {
    throw new Error('Gambar tidak bisa dibaca');
  }

  // Skala dipertahankan lalu disisipkan ke kanvas persegi di pojok kiri atas,
  // sama seperti praktik InsightFace. Kalau rasionya diubah, posisi landmark
  // ikut melenceng dan penjajaran wajah jadi salah.
  const skala = Math.min(INPUT_SIZE / width, INPUT_SIZE / height);
  const lebarBaru = Math.round(width * skala);
  const tinggiBaru = Math.round(height * skala);

  const { data } = await sharp(imageBuffer)
    .resize(lebarBaru, tinggiBaru, { fit: 'fill' })
    .removeAlpha()
    .extend({
      top: 0,
      left: 0,
      bottom: INPUT_SIZE - tinggiBaru,
      right: INPUT_SIZE - lebarBaru,
      background: { r: 0, g: 0, b: 0 },
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const piksel = INPUT_SIZE * INPUT_SIZE;
  const input = new Float32Array(3 * piksel);

  for (let i = 0; i < piksel; i += 1) {
    input[i] = (data[i * 3] - 127.5) / 128;
    input[piksel + i] = (data[i * 3 + 1] - 127.5) / 128;
    input[2 * piksel + i] = (data[i * 3 + 2] - 127.5) / 128;
  }

  const session = await getDetectionSession();
  const keluaran = await session.run({
    [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, INPUT_SIZE, INPUT_SIZE]),
  });

  // Urutan keluaran SCRFD: 3 skor, lalu 3 bbox, lalu 3 keypoint.
  const nama = session.outputNames;
  const kandidat: DetectedFace[] = [];

  STRIDES.forEach((stride, idx) => {
    const skor = keluaran[nama[idx]].data as Float32Array;
    const bbox = keluaran[nama[idx + STRIDES.length]].data as Float32Array;
    const kps = keluaran[nama[idx + STRIDES.length * 2]].data as Float32Array;

    const sisi = INPUT_SIZE / stride;

    for (let i = 0; i < skor.length; i += 1) {
      if (skor[i] < options.scoreThreshold) continue;

      // Anchor disusun berurutan per lokasi: dua anchor berbagi pusat sama.
      const lokasi = Math.floor(i / ANCHORS_PER_LOCATION);
      const cx = (lokasi % sisi) * stride;
      const cy = Math.floor(lokasi / sisi) * stride;

      // Keluaran bbox adalah jarak dari pusat anchor, dalam satuan stride.
      const x1 = cx - bbox[i * 4] * stride;
      const y1 = cy - bbox[i * 4 + 1] * stride;
      const x2 = cx + bbox[i * 4 + 2] * stride;
      const y2 = cy + bbox[i * 4 + 3] * stride;

      const landmarks: Point[] = [];
      for (let k = 0; k < 5; k += 1) {
        landmarks.push({
          x: (cx + kps[i * 10 + k * 2] * stride) / skala,
          y: (cy + kps[i * 10 + k * 2 + 1] * stride) / skala,
        });
      }

      kandidat.push({
        // Dikembalikan ke koordinat gambar asli.
        box: { x1: x1 / skala, y1: y1 / skala, x2: x2 / skala, y2: y2 / skala },
        score: skor[i],
        landmarks,
      });
    }
  });

  return nonMaxSuppression(kandidat, options.nmsThreshold ?? 0.4);
};
