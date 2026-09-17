// src/services/face/embed.ts
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import { getRecognitionSession } from './session';
import { estimateSimilarityTransform, warpImage, type Point, type RawImage } from './geometry';
import type { DetectedFace } from './detect';

export const FACE_SIZE = 112;

/**
 * Posisi baku lima titik wajah pada kanvas 112x112 yang dipakai ArcFace saat
 * dilatih. Wajah harus diputar dan diskalakan ke posisi ini sebelum dijadikan
 * embedding — tanpa penjajaran, wajah miring akan terbaca sebagai orang lain.
 */
const ARCFACE_TEMPLATE: Point[] = [
  { x: 38.2946, y: 51.6963 }, // mata kiri
  { x: 73.5318, y: 51.5014 }, // mata kanan
  { x: 56.0252, y: 71.7366 }, // hidung
  { x: 41.5493, y: 92.3655 }, // sudut mulut kiri
  { x: 70.7299, y: 92.2041 }, // sudut mulut kanan
];

/** Memotong dan meluruskan wajah menjadi kanvas 112x112 siap-embedding. */
export const alignFace = async (
  imageBuffer: Buffer,
  face: DetectedFace
): Promise<RawImage> => {
  const { data, info } = await sharp(imageBuffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const source: RawImage = {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  };

  const transform = estimateSimilarityTransform(face.landmarks, ARCFACE_TEMPLATE);

  return warpImage(source, transform, FACE_SIZE, FACE_SIZE);
};

/**
 * Mengubah wajah yang sudah dijajarkan menjadi vektor 512 dimensi.
 * Vektornya dinormalisasi L2, sehingga kemiripan kosinus cukup dihitung
 * sebagai hasil kali titik.
 */
export const computeEmbedding = async (aligned: RawImage): Promise<Float32Array> => {
  const piksel = FACE_SIZE * FACE_SIZE;
  const input = new Float32Array(3 * piksel);

  for (let i = 0; i < piksel; i += 1) {
    input[i] = (aligned.data[i * 3] - 127.5) / 127.5;
    input[piksel + i] = (aligned.data[i * 3 + 1] - 127.5) / 127.5;
    input[2 * piksel + i] = (aligned.data[i * 3 + 2] - 127.5) / 127.5;
  }

  const session = await getRecognitionSession();
  const keluaran = await session.run({
    [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, FACE_SIZE, FACE_SIZE]),
  });

  const mentah = keluaran[session.outputNames[0]].data as Float32Array;

  let norma = 0;
  for (const v of mentah) norma += v * v;
  norma = Math.sqrt(norma);

  if (norma === 0) throw new Error('Embedding wajah kosong');

  const hasil = new Float32Array(mentah.length);
  for (let i = 0; i < mentah.length; i += 1) hasil[i] = mentah[i] / norma;

  return hasil;
};

/**
 * Kemiripan dua embedding, rentang -1 sampai 1. Keduanya sudah dinormalisasi,
 * jadi kemiripan kosinus sama dengan hasil kali titik.
 */
export const cosineSimilarity = (a: Float32Array, b: Float32Array): number => {
  if (a.length !== b.length) {
    throw new Error(`Dimensi embedding berbeda: ${a.length} vs ${b.length}`);
  }

  let hasil = 0;
  for (let i = 0; i < a.length; i += 1) hasil += a[i] * b[i];

  return hasil;
};

export const embeddingToBuffer = (embedding: Float32Array): Buffer =>
  Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);

export const bufferToEmbedding = (buffer: Buffer): Float32Array =>
  new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
