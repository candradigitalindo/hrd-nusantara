import fs from 'fs';
import path from 'path';
import { detectFaces } from '../src/services/face/detect';
import { assessLiveness } from '../src/services/face/liveness';
import { extractForVerification, extractForEnrollment, areModelsAvailable } from '../src/services/face';
import { isAntiSpoofModelAvailable } from '../src/services/face/session';
import { simulateScreenReplay } from './helpers/spoof';

const FIXTURES = path.resolve(__dirname, 'fixtures/faces');
const foto = (nama: string) => fs.readFileSync(path.join(FIXTURES, nama));

const siap = areModelsAvailable() && isAntiSpoofModelAvailable();
const describeModel = siap ? describe : describe.skip;

if (!siap) {
  console.warn('\n  Model anti-spoofing tidak ada — test dilewati. Jalankan: npm run models:download\n');
}

const wajahUtama = async (buf: Buffer) => {
  const semua = await detectFaces(buf, { scoreThreshold: 0.5 });
  return semua.sort(
    (a, b) => b.box.x2 - b.box.x1 - (a.box.x2 - a.box.x1)
  )[0];
};

const skorHidup = async (buf: Buffer) => (await assessLiveness(buf, await wajahUtama(buf))).liveScore;

describeModel('assessLiveness', () => {
  it('menilai potret langsung sebagai wajah hidup', async () => {
    for (const nama of ['personA_1.jpg', 'personA_2.jpg', 'personB_1.jpg']) {
      const skor = await skorHidup(foto(nama));
      // Terukur >= 0,9998 untuk ketiganya.
      expect(skor).toBeGreaterThan(0.9);
    }
  });

  it('menilai foto yang ditampilkan di layar sebagai serangan', async () => {
    const palsu = await simulateScreenReplay(foto('personA_1.jpg'), { bezel: 30 });
    expect(await skorHidup(palsu)).toBeLessThan(0.1);
  });

  it('tetap mendeteksi serangan pada berbagai ukuran bingkai', async () => {
    for (const bezel of [20, 45, 70]) {
      const palsu = await simulateScreenReplay(foto('personA_1.jpg'), { bezel });
      expect(await skorHidup(palsu)).toBeLessThan(0.1);
    }
  });

  it('memakai urutan kanal BGR', async () => {
    // Penjaga urutan kanal: BGR menghasilkan >= 0,9998 pada fixture ini,
    // sedangkan RGB turun ke ~0,95. Keduanya sama-sama lolos ambang, jadi
    // hanya ambang ketat seperti ini yang bisa menangkap kalau urutannya
    // tertukar — dan margin itulah yang menipis lebih dulu saat cahaya buruk.
    expect(await skorHidup(foto('personA_1.jpg'))).toBeGreaterThan(0.99);
    expect(await skorHidup(foto('personB_1.jpg'))).toBeGreaterThan(0.99);
  });

  it('memberi skor hidup dan skor serangan yang saling melengkapi', async () => {
    const hasil = await assessLiveness(foto('personA_1.jpg'), await wajahUtama(foto('personA_1.jpg')));
    expect(hasil.liveScore + hasil.spoofScore).toBeCloseTo(1, 5);
  });

  it('peka terhadap masukan — bukan mengeluarkan angka yang sama untuk semua', async () => {
    // Penjaga terhadap regresi preprocessing: dengan normalisasi yang keliru,
    // model mengembalikan nilai praktis identik untuk apa pun, dan seluruh
    // pemeriksaan ini jadi teater belaka.
    const asli = await skorHidup(foto('personA_1.jpg'));
    const palsu = await skorHidup(await simulateScreenReplay(foto('personA_1.jpg'), { bezel: 30 }));

    expect(Math.abs(asli - palsu)).toBeGreaterThan(0.5);
  });
});

describeModel('Integrasi ke alur verifikasi', () => {
  it('menolak foto layar saat verifikasi presensi', async () => {
    const palsu = await simulateScreenReplay(foto('personA_1.jpg'), { bezel: 30 });

    await expect(extractForVerification(palsu)).rejects.toMatchObject({
      reason: 'spoof_detected',
    });
  });

  it('meneruskan wajah asli beserta skor hidupnya', async () => {
    const hasil = await extractForVerification(foto('personA_1.jpg'));

    expect(hasil.livenessScore).not.toBeNull();
    expect(hasil.livenessScore!).toBeGreaterThan(0.9);
  });

  it('tidak memeriksa keaslian-hidup saat pendaftaran', async () => {
    // Pendaftaran diawasi HR langsung, dan foto resmi yang dipindai memang
    // wajar gagal uji ini. Pemeriksaan tetap penuh di sisi presensi.
    const palsu = await simulateScreenReplay(foto('personA_1.jpg'), { bezel: 30 });

    const hasil = await extractForEnrollment(palsu);
    expect(hasil.embedding).toHaveLength(512);
    expect(hasil.livenessScore).toBeNull();
  });
});
