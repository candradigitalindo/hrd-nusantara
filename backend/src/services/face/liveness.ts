// src/services/face/liveness.ts
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import { getAntiSpoofSession } from './session';
import type { DetectedFace } from './detect';

const INPUT_SIZE = 80;

/**
 * Margin pemotongan yang dipakai saat model ini dilatih (nama berkas aslinya
 * "2.7_80x80"). Angkanya bukan pilihan bebas: model belajar membedakan wajah
 * hidup dari foto justru lewat konteks di sekitar wajah — tepi layar, bingkai
 * cetakan, pantulan. Potongan yang terlalu rapat membuang petunjuk itu.
 */
const CROP_SCALE = 2.7;

/** Indeks kelas "wajah hidup" pada keluaran model. Lihat catatan di assessLiveness. */
const LIVE_CLASS_INDEX = 1;

export interface LivenessResult {
  /** Peluang wajah ini berasal dari orang sungguhan di depan kamera. */
  liveScore: number;
  /** Gabungan peluang kedua kelas serangan. */
  spoofScore: number;
}

/**
 * Menghitung kotak potong bergaya upstream: diperbesar dari pusat wajah, lalu
 * digeser masuk bila keluar dari batas gambar (bukan dipotong), supaya rasio
 * wajah terhadap bingkai tetap seperti saat pelatihan.
 */
const hitungKotakPotong = (
  face: DetectedFace,
  srcWidth: number,
  srcHeight: number
): { left: number; top: number; width: number; height: number } => {
  const boxW = face.box.x2 - face.box.x1;
  const boxH = face.box.y2 - face.box.y1;

  const skala = Math.min((srcHeight - 1) / boxH, (srcWidth - 1) / boxW, CROP_SCALE);

  const lebarBaru = boxW * skala;
  const tinggiBaru = boxH * skala;
  const pusatX = face.box.x1 + boxW / 2;
  const pusatY = face.box.y1 + boxH / 2;

  let kiri = pusatX - lebarBaru / 2;
  let atas = pusatY - tinggiBaru / 2;
  let kanan = pusatX + lebarBaru / 2;
  let bawah = pusatY + tinggiBaru / 2;

  if (kiri < 0) {
    kanan -= kiri;
    kiri = 0;
  }
  if (atas < 0) {
    bawah -= atas;
    atas = 0;
  }
  if (kanan > srcWidth - 1) {
    kiri -= kanan - srcWidth + 1;
    kanan = srcWidth - 1;
  }
  if (bawah > srcHeight - 1) {
    atas -= bawah - srcHeight + 1;
    bawah = srcHeight - 1;
  }

  const left = Math.max(0, Math.floor(kiri));
  const top = Math.max(0, Math.floor(atas));

  return {
    left,
    top,
    width: Math.max(1, Math.min(Math.floor(kanan) - left, srcWidth - left)),
    height: Math.max(1, Math.min(Math.floor(bawah) - top, srcHeight - top)),
  };
};

const softmax = (nilai: Float32Array): number[] => {
  const maks = Math.max(...nilai);
  const eksp = Array.from(nilai, (v) => Math.exp(v - maks));
  const jumlah = eksp.reduce((s, v) => s + v, 0);
  return eksp.map((v) => v / jumlah);
};

export const assessLiveness = async (
  imageBuffer: Buffer,
  face: DetectedFace
): Promise<LivenessResult> => {
  const meta = await sharp(imageBuffer).metadata();
  const potong = hitungKotakPotong(face, meta.width ?? 0, meta.height ?? 0);

  const { data } = await sharp(imageBuffer)
    .removeAlpha()
    .extract(potong)
    .resize(INPUT_SIZE, INPUT_SIZE, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const piksel = INPUT_SIZE * INPUT_SIZE;
  const input = new Float32Array(3 * piksel);

  // Nilai piksel dipakai mentah 0-255, TIDAK dibagi 255.
  //
  // Kartu model menuliskan "pixel / 255", tapi hasil pengukuran menunjukkan
  // sebaliknya: dengan pembagian itu, model mengembalikan angka yang praktis
  // sama untuk semua masukan (p ~ 0,993 pada kelas yang sama, dan tidak
  // berubah walau margin potongan diubah dari 1,0 ke 4,0) — tersaturasi, tidak
  // membedakan apa pun. Tanpa pembagian, potret asli dan simulasi foto-di-layar
  // terpisah bersih. Skalanya kemungkinan sudah ikut terpanggang saat ekspor.
  //
  // Urutan kanal BGR, mengikuti konvensi OpenCV tempat model ini dilatih.
  // Terukur: wajah asli mendapat 0,9998 dengan BGR dan 0,9503 dengan RGB.
  // Pada fixture yang ada, keputusannya belum berbalik — tapi marginnya lebih
  // lebar dengan BGR, dan itu yang menentukan saat kondisi lapangan memburuk.
  for (let i = 0; i < piksel; i += 1) {
    input[i] = data[i * 3 + 2];
    input[piksel + i] = data[i * 3 + 1];
    input[2 * piksel + i] = data[i * 3];
  }

  const session = await getAntiSpoofSession();
  const keluaran = await session.run({
    [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, INPUT_SIZE, INPUT_SIZE]),
  });

  const peluang = softmax(keluaran[session.outputNames[0]].data as Float32Array);

  // Kelas HIDUP ada di indeks 1, bukan 0.
  //
  // Kartu model menyebut urutannya [live, print, replay], tapi kode acuan
  // upstream memutuskan "Real Face" saat argmax == 1 — dan pengukuran di sini
  // membenarkan upstream: ketiga potret asli jatuh di indeks 1.
  // Indeks 0 dan 2 sama-sama kelas serangan; keduanya dijumlahkan saja karena
  // membedakan jenis serangannya tidak bisa diverifikasi tanpa data asli.
  const liveScore = peluang[LIVE_CLASS_INDEX];

  return { liveScore, spoofScore: 1 - liveScore };
};
