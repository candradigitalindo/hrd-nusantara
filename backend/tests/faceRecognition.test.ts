import fs from 'fs';
import path from 'path';
import { detectFaces } from '../src/services/face/detect';
import {
  alignFace,
  computeEmbedding,
  cosineSimilarity,
  embeddingToBuffer,
  bufferToEmbedding,
  FACE_SIZE,
} from '../src/services/face/embed';
import {
  extractForEnrollment,
  extractForVerification,
  verifyAgainstEnrollments,
  areModelsAvailable,
  FaceProcessingError,
} from '../src/services/face';
import { decodeBase64Image, InvalidImageError } from '../src/utils/imageUpload';

const FIXTURES = path.resolve(__dirname, 'fixtures/faces');
const foto = (nama: string) => fs.readFileSync(path.join(FIXTURES, nama));

// Bobot model tidak ikut di-commit (berkas biner besar). Tanpa model, test ini
// dilewati dengan jelas alih-alih gagal membingungkan.
const describeModel = areModelsAvailable() ? describe : describe.skip;

if (!areModelsAvailable()) {
  console.warn('\n  Bobot model tidak ada — test pengenalan wajah dilewati.');
  console.warn('  Jalankan: npm run models:download\n');
}

describe('decodeBase64Image', () => {
  it('mengenali JPEG dari angka ajaibnya, bukan dari prefiks data URI', () => {
    const jpeg = foto('personA_1.jpg');
    const { extension } = decodeBase64Image(jpeg.toString('base64'));
    expect(extension).toBe('jpg');
  });

  it('menerima bentuk data URI', () => {
    const jpeg = foto('personA_1.jpg');
    const { extension, buffer } = decodeBase64Image(
      `data:image/jpeg;base64,${jpeg.toString('base64')}`
    );
    expect(extension).toBe('jpg');
    expect(buffer.length).toBe(jpeg.length);
  });

  it('tidak percaya prefiks yang berbohong tentang jenis berkas', () => {
    // Mengaku PNG, isinya JPEG. Yang menentukan adalah isinya.
    const jpeg = foto('personA_1.jpg');
    const { extension } = decodeBase64Image(
      `data:image/png;base64,${jpeg.toString('base64')}`
    );
    expect(extension).toBe('jpg');
  });

  it('menolak data yang bukan gambar', () => {
    const teks = Buffer.from('ini bukan gambar sama sekali, hanya teks biasa').toString('base64');
    expect(() => decodeBase64Image(teks)).toThrow(InvalidImageError);
  });

  it('menolak data yang terlalu pendek', () => {
    expect(() => decodeBase64Image(Buffer.from('abc').toString('base64'))).toThrow(
      InvalidImageError
    );
  });
});

describe('embedding <-> buffer', () => {
  it('bolak-balik tanpa kehilangan presisi', () => {
    const asli = new Float32Array([0.1, -0.25, 0.7, 1, -1, 0]);
    const kembali = bufferToEmbedding(embeddingToBuffer(asli));

    expect(Array.from(kembali)).toEqual(Array.from(asli));
  });

  it('memakai 4 byte per dimensi', () => {
    const emb = new Float32Array(512);
    expect(embeddingToBuffer(emb).length).toBe(2048);
  });
});

describe('cosineSimilarity', () => {
  it('bernilai 1 untuk vektor identik', () => {
    const v = new Float32Array([0.6, 0.8]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6);
  });

  it('bernilai 0 untuk vektor tegak lurus', () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0, 6);
  });

  it('bernilai -1 untuk vektor berlawanan', () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([-1, 0]))).toBeCloseTo(-1, 6);
  });

  it('menolak dimensi yang berbeda', () => {
    expect(() => cosineSimilarity(new Float32Array(2), new Float32Array(3))).toThrow();
  });
});

describeModel('Deteksi wajah (SCRFD)', () => {
  it('menemukan tepat satu wajah pada foto potret', async () => {
    const wajah = await detectFaces(foto('personA_1.jpg'), { scoreThreshold: 0.5 });

    expect(wajah).toHaveLength(1);
    expect(wajah[0].score).toBeGreaterThan(0.5);
  });

  it('mengembalikan lima titik penanda di dalam kotak wajah', async () => {
    const [wajah] = await detectFaces(foto('personA_1.jpg'), { scoreThreshold: 0.5 });

    expect(wajah.landmarks).toHaveLength(5);

    // Longgar: hidung dan mulut boleh sedikit melewati kotak pada wajah miring.
    const margin = (wajah.box.x2 - wajah.box.x1) * 0.3;
    for (const titik of wajah.landmarks) {
      expect(titik.x).toBeGreaterThan(wajah.box.x1 - margin);
      expect(titik.x).toBeLessThan(wajah.box.x2 + margin);
    }
  });

  it('menempatkan mata di atas mulut', async () => {
    const [wajah] = await detectFaces(foto('personA_1.jpg'), { scoreThreshold: 0.5 });
    const [mataKiri, mataKanan, , mulutKiri, mulutKanan] = wajah.landmarks;

    expect(mataKiri.y).toBeLessThan(mulutKiri.y);
    expect(mataKanan.y).toBeLessThan(mulutKanan.y);
  });

  it('tidak menemukan wajah pada gambar polos', async () => {
    const sharp = (await import('sharp')).default;
    const polos = await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 128, g: 128, b: 128 } },
    })
      .jpeg()
      .toBuffer();

    expect(await detectFaces(polos, { scoreThreshold: 0.5 })).toHaveLength(0);
  });
});

describeModel('Penjajaran dan embedding', () => {
  it('menghasilkan kanvas 112x112 tiga kanal', async () => {
    const buf = foto('personA_1.jpg');
    const [wajah] = await detectFaces(buf, { scoreThreshold: 0.5 });
    const aligned = await alignFace(buf, wajah);

    expect(aligned.width).toBe(FACE_SIZE);
    expect(aligned.height).toBe(FACE_SIZE);
    expect(aligned.data.length).toBe(FACE_SIZE * FACE_SIZE * 3);
  });

  it('menghasilkan vektor 512 dimensi yang ternormalisasi', async () => {
    const buf = foto('personA_1.jpg');
    const [wajah] = await detectFaces(buf, { scoreThreshold: 0.5 });
    const emb = await computeEmbedding(await alignFace(buf, wajah));

    expect(emb).toHaveLength(512);

    let norma = 0;
    for (const v of emb) norma += v * v;
    expect(Math.sqrt(norma)).toBeCloseTo(1, 5);
  });

  it('menghasilkan embedding yang sama untuk gambar yang sama', async () => {
    const a = await extractForEnrollment(foto('personA_1.jpg'));
    const b = await extractForEnrollment(foto('personA_1.jpg'));

    expect(cosineSimilarity(a.embedding, b.embedding)).toBeCloseTo(1, 5);
  });
});

describeModel('Pencocokan identitas — inti dari fitur ini', () => {
  it('mengenali orang yang sama dari dua pemotretan berbeda', async () => {
    const a1 = await extractForEnrollment(foto('personA_1.jpg'));
    const a2 = await extractForEnrollment(foto('personA_2.jpg'));

    const kemiripan = cosineSimilarity(a1.embedding, a2.embedding);

    // Terukur 0,970 dengan buffalo_s.
    expect(kemiripan).toBeGreaterThan(0.85);
  });

  it('membedakan dua orang yang berlainan', async () => {
    const a1 = await extractForEnrollment(foto('personA_1.jpg'));
    const b1 = await extractForEnrollment(foto('personB_1.jpg'));

    const kemiripan = cosineSimilarity(a1.embedding, b1.embedding);

    // Terukur -0,013. Ambang diperketat sampai 0,12 bukan tanpa alasan:
    // kerusakan pada titik acuan penjajaran hampir tidak menggeser skor
    // orang-sama, tapi menaikkan skor orang-beda ke ~0,16. Ambang longgar
    // tidak akan menangkapnya.
    expect(kemiripan).toBeLessThan(0.12);
  });

  it('memisahkan orang sama dan orang beda dengan jarak yang lebar', async () => {
    const a1 = await extractForEnrollment(foto('personA_1.jpg'));
    const a2 = await extractForEnrollment(foto('personA_2.jpg'));
    const b1 = await extractForEnrollment(foto('personB_1.jpg'));

    const sama = cosineSimilarity(a1.embedding, a2.embedding);
    const beda = cosineSimilarity(a1.embedding, b1.embedding);

    // Jarak inilah yang membuat ambang tunggal bisa dipakai dengan aman.
    // Terukur 0,983; menyempit ke ~0,80 kalau penjajaran wajah rusak.
    expect(sama - beda).toBeGreaterThan(0.85);
  });
});

describeModel('verifyAgainstEnrollments', () => {
  it('cocok terhadap pendaftaran orang yang sama', async () => {
    const terdaftar = await extractForEnrollment(foto('personA_1.jpg'));
    const probe = await extractForVerification(foto('personA_2.jpg'));

    const hasil = verifyAgainstEnrollments(probe.embedding, [
      { id: 'daftar-1', embedding: terdaftar.embedding },
    ]);

    expect(hasil.matched).toBe(true);
    expect(hasil.enrollmentId).toBe('daftar-1');
  });

  it('menolak orang lain', async () => {
    const terdaftar = await extractForEnrollment(foto('personA_1.jpg'));
    const probe = await extractForVerification(foto('personB_1.jpg'));

    const hasil = verifyAgainstEnrollments(probe.embedding, [
      { id: 'daftar-1', embedding: terdaftar.embedding },
    ]);

    expect(hasil.matched).toBe(false);
  });

  it('memilih pendaftaran yang paling mirip di antara beberapa', async () => {
    const benar = await extractForEnrollment(foto('personA_1.jpg'));
    const lain = await extractForEnrollment(foto('personB_1.jpg'));
    const probe = await extractForVerification(foto('personA_2.jpg'));

    const hasil = verifyAgainstEnrollments(probe.embedding, [
      { id: 'orang-lain', embedding: lain.embedding },
      { id: 'orang-benar', embedding: benar.embedding },
    ]);

    expect(hasil.enrollmentId).toBe('orang-benar');
    expect(hasil.matched).toBe(true);
  });

  it('tidak cocok kalau tidak ada pendaftaran sama sekali', async () => {
    const probe = await extractForVerification(foto('personA_1.jpg'));
    const hasil = verifyAgainstEnrollments(probe.embedding, []);

    expect(hasil.matched).toBe(false);
    expect(hasil.enrollmentId).toBeNull();
  });

  it('mengabaikan pendaftaran yang dimensinya tidak sepadan', async () => {
    const probe = await extractForVerification(foto('personA_1.jpg'));
    const hasil = verifyAgainstEnrollments(probe.embedding, [
      { id: 'model-lama', embedding: new Float32Array(128) },
    ]);

    expect(hasil.matched).toBe(false);
  });
});

describeModel('Gerbang kualitas', () => {
  it('menolak pendaftaran tanpa wajah', async () => {
    const sharp = (await import('sharp')).default;
    const polos = await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 200, g: 180, b: 160 } },
    })
      .jpeg()
      .toBuffer();

    await expect(extractForEnrollment(polos)).rejects.toMatchObject({ reason: 'no_face' });
  });

  it('menolak wajah yang terlalu kecil di frame', async () => {
    const sharp = (await import('sharp')).default;
    // Wajah diperkecil sampai di bawah FACE_MIN_BOX_PX.
    const kecil = await sharp(foto('personA_1.jpg')).resize(110, null, { fit: 'inside' }).jpeg().toBuffer();

    await expect(extractForEnrollment(kecil)).rejects.toBeInstanceOf(FaceProcessingError);
  });

  it('menolak gambar yang melebihi batas ukuran', async () => {
    const besar = Buffer.concat([foto('personA_1.jpg'), Buffer.alloc(9_000_000)]);
    await expect(extractForEnrollment(besar)).rejects.toMatchObject({
      reason: 'image_too_large',
    });
  });
});
