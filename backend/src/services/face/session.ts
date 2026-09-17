// src/services/face/session.ts
import path from 'path';
import fs from 'fs';
import * as ort from 'onnxruntime-node';
import { env } from '../../config/env';

/**
 * Model dimuat malas dan dipakai ulang seumur proses.
 *
 * Memuat ONNX butuh ratusan milidetik dan puluhan megabyte memori, jadi tidak
 * boleh dilakukan per-request. Sengaja tidak dimuat saat boot supaya server
 * tetap bisa melayani modul lain walau bobot model belum diunduh.
 */
let detectionSession: Promise<ort.InferenceSession> | null = null;
let recognitionSession: Promise<ort.InferenceSession> | null = null;
let antiSpoofSession: Promise<ort.InferenceSession> | null = null;

export class FaceModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaceModelError';
  }
}

type ModelName = 'detection' | 'recognition' | 'antispoof';

const modelPath = (nama: ModelName) =>
  nama === 'antispoof'
    // Model anti-spoofing berdiri sendiri, tidak ikut paket buffalo_*.
    ? path.resolve(env.FACE_ANTISPOOF_MODEL, '')
    : path.resolve(env.FACE_MODEL_DIR, `${nama}.onnx`);

const load = async (nama: ModelName) => {
  const file = modelPath(nama);

  if (!fs.existsSync(file)) {
    throw new FaceModelError(
      `Bobot model "${nama}" tidak ada di ${file}. ` +
        'Jalankan: npm run models:download'
    );
  }

  return ort.InferenceSession.create(file, {
    // Presensi datang satu per satu, bukan berbondong-bondong. Membatasi
    // thread mencegah satu request memonopoli seluruh CPU container.
    intraOpNumThreads: env.FACE_ONNX_THREADS,
    graphOptimizationLevel: 'all',
  });
};

export const getDetectionSession = () => {
  detectionSession ??= load('detection');
  return detectionSession;
};

export const getRecognitionSession = () => {
  recognitionSession ??= load('recognition');
  return recognitionSession;
};

export const getAntiSpoofSession = () => {
  antiSpoofSession ??= load('antispoof');
  return antiSpoofSession;
};

export const isAntiSpoofModelAvailable = (): boolean => fs.existsSync(modelPath('antispoof'));

/** Apakah bobot model sudah tersedia di disk. */
export const areModelsAvailable = (): boolean =>
  fs.existsSync(modelPath('detection')) && fs.existsSync(modelPath('recognition'));

/** Dipakai test untuk memastikan tiap kasus mulai dari keadaan bersih. */
export const resetSessionsForTesting = () => {
  detectionSession = null;
  recognitionSession = null;
  antiSpoofSession = null;
};
