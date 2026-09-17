// src/services/face/index.ts
import sharp from 'sharp';
import { env } from '../../config/env';
import { detectFaces, type DetectedFace } from './detect';
import { alignFace, computeEmbedding, cosineSimilarity } from './embed';
import { assessLiveness } from './liveness';
import { areModelsAvailable, isAntiSpoofModelAvailable, FaceModelError } from './session';

export * from './session';
export { cosineSimilarity, embeddingToBuffer, bufferToEmbedding } from './embed';
export type { DetectedFace } from './detect';

export type FaceFailureReason =
  | 'model_unavailable'
  | 'recognition_disabled'
  | 'image_too_large'
  | 'unreadable_image'
  | 'no_face'
  | 'multiple_faces'
  | 'face_too_small'
  | 'low_detection_score'
  | 'ambiguous_subject'
  // Dua kondisi berikut berbeda bagi pengguna: yang satu perlu ke HR untuk
  // mendaftar, yang satu perlu mencoba foto ulang. Aplikasi mobile bercabang
  // berdasarkan kode ini, jadi keduanya tidak boleh disamakan.
  | 'not_enrolled'
  | 'no_match'
  | 'spoof_detected';

export class FaceProcessingError extends Error {
  constructor(
    public readonly reason: FaceFailureReason,
    message: string
  ) {
    super(message);
    this.name = 'FaceProcessingError';
  }
}

const luas = (face: DetectedFace) =>
  (face.box.x2 - face.box.x1) * (face.box.y2 - face.box.y1);

const sisiTerpendek = (face: DetectedFace) =>
  Math.min(face.box.x2 - face.box.x1, face.box.y2 - face.box.y1);

export interface FaceExtraction {
  embedding: Float32Array;
  detectionScore: number;
  box: DetectedFace['box'];
  modelName: string;
  /** null bila pemeriksaan wajah hidup dimatikan atau modelnya tidak ada. */
  livenessScore: number | null;
}

const pastikanSiap = (imageBuffer: Buffer) => {
  if (!env.FACE_RECOGNITION_ENABLED) {
    throw new FaceProcessingError(
      'recognition_disabled',
      'Verifikasi wajah sedang dinonaktifkan'
    );
  }

  if (!areModelsAvailable()) {
    throw new FaceModelError(
      `Bobot model tidak ada di ${env.FACE_MODEL_DIR}. Jalankan: npm run models:download`
    );
  }

  if (imageBuffer.byteLength > env.FACE_MAX_IMAGE_BYTES) {
    throw new FaceProcessingError(
      'image_too_large',
      `Ukuran gambar melebihi batas ${Math.round(env.FACE_MAX_IMAGE_BYTES / 1_000_000)} MB`
    );
  }
};

const deteksi = async (imageBuffer: Buffer): Promise<DetectedFace[]> => {
  // Keterbacaan gambar diperiksa terpisah lebih dulu. Kalau seluruh pemanggilan
  // dibungkus try/catch, kegagalan memuat model atau bug di kode ikut tersamar
  // menjadi "gambar tidak bisa dibaca" — pesan yang menyesatkan dan menyulitkan
  // penelusuran.
  try {
    await sharp(imageBuffer).metadata();
  } catch {
    throw new FaceProcessingError('unreadable_image', 'Gambar tidak bisa dibaca');
  }

  return detectFaces(imageBuffer, { scoreThreshold: env.FACE_DETECTION_THRESHOLD });
};

const validasiUkuran = (face: DetectedFace) => {
  if (sisiTerpendek(face) < env.FACE_MIN_BOX_PX) {
    throw new FaceProcessingError(
      'face_too_small',
      'Wajah terlalu kecil di dalam foto. Dekatkan kamera.'
    );
  }
};

const ekstrak = async (
  imageBuffer: Buffer,
  face: DetectedFace,
  periksaHidup: boolean
): Promise<FaceExtraction> => {
  let livenessScore: number | null = null;

  if (periksaHidup && env.FACE_LIVENESS_ENABLED && isAntiSpoofModelAvailable()) {
    const hasil = await assessLiveness(imageBuffer, face);
    livenessScore = hasil.liveScore;

    if (hasil.liveScore < env.FACE_LIVENESS_THRESHOLD) {
      throw new FaceProcessingError(
        'spoof_detected',
        'Foto terdeteksi bukan wajah langsung. Arahkan kamera ke wajah Anda, bukan ke foto atau layar.'
      );
    }
  }

  const aligned = await alignFace(imageBuffer, face);
  const embedding = await computeEmbedding(aligned);

  return {
    embedding,
    detectionScore: face.score,
    box: face.box,
    modelName: env.FACE_MODEL_NAME,
    livenessScore,
  };
};

/**
 * Mengambil ciri wajah untuk pendaftaran.
 *
 * Sengaja menuntut tepat satu wajah: pendaftaran adalah proses terkendali yang
 * dilakukan HR, dan kalau ada dua orang di frame, tidak ada cara memastikan
 * ciri siapa yang tersimpan atas nama siapa.
 */
export const extractForEnrollment = async (imageBuffer: Buffer): Promise<FaceExtraction> => {
  pastikanSiap(imageBuffer);

  const wajah = await deteksi(imageBuffer);

  if (wajah.length === 0) {
    throw new FaceProcessingError('no_face', 'Tidak ada wajah terdeteksi pada foto');
  }
  if (wajah.length > 1) {
    throw new FaceProcessingError(
      'multiple_faces',
      `Terdeteksi ${wajah.length} wajah. Foto pendaftaran harus berisi satu orang saja.`
    );
  }

  validasiUkuran(wajah[0]);

  // Pendaftaran tidak diperiksa keaslian-hidupnya: prosesnya diawasi HR secara
  // langsung, dan foto resmi karyawan yang dipindai memang wajar gagal uji itu.
  // Pemeriksaan tetap berlaku penuh di sisi presensi, yang justru jadi sasaran.
  return ekstrak(imageBuffer, wajah[0], false);
};

/**
 * Mengambil ciri wajah untuk verifikasi saat presensi.
 *
 * Berbeda dari pendaftaran, di sini beberapa wajah masih bisa diterima —
 * di restoran yang ramai, rekan kerja lewat di belakang itu biasa. Yang dipakai
 * adalah wajah terbesar (paling dekat ke kamera), tapi hanya kalau ia jelas
 * mendominasi. Kalau ada dua wajah berukuran mirip, permintaan ditolak:
 * itu pola yang muncul saat seseorang menyodorkan foto rekannya ke kamera.
 */
export const extractForVerification = async (imageBuffer: Buffer): Promise<FaceExtraction> => {
  pastikanSiap(imageBuffer);

  const wajah = (await deteksi(imageBuffer)).sort((a, b) => luas(b) - luas(a));

  if (wajah.length === 0) {
    throw new FaceProcessingError('no_face', 'Tidak ada wajah terdeteksi pada foto');
  }

  if (wajah.length > 1 && luas(wajah[1]) > luas(wajah[0]) * 0.6) {
    throw new FaceProcessingError(
      'ambiguous_subject',
      'Ada lebih dari satu wajah berukuran serupa di frame. Pastikan hanya Anda yang terlihat.'
    );
  }

  validasiUkuran(wajah[0]);

  return ekstrak(imageBuffer, wajah[0], true);
};

export interface VerificationResult {
  matched: boolean;
  similarity: number;
  threshold: number;
  enrollmentId: string | null;
}

/**
 * Membandingkan wajah terhadap kumpulan pendaftaran milik SATU karyawan.
 *
 * Ini verifikasi 1:1 — identitas yang diklaim sudah diketahui dari token, jadi
 * sistem tidak perlu menebak di antara seluruh karyawan. Selain jauh lebih
 * cepat, galatnya juga jauh lebih kecil dibanding pencarian 1:N.
 */
export const verifyAgainstEnrollments = (
  probe: Float32Array,
  enrollments: { id: string; embedding: Float32Array }[]
): VerificationResult => {
  const threshold = env.FACE_MATCH_THRESHOLD;

  let terbaik = { similarity: -1, enrollmentId: null as string | null };

  for (const enrollment of enrollments) {
    if (enrollment.embedding.length !== probe.length) continue;

    const similarity = cosineSimilarity(probe, enrollment.embedding);
    if (similarity > terbaik.similarity) {
      terbaik = { similarity, enrollmentId: enrollment.id };
    }
  }

  return {
    matched: terbaik.similarity >= threshold,
    similarity: terbaik.similarity,
    threshold,
    enrollmentId: terbaik.enrollmentId,
  };
};
