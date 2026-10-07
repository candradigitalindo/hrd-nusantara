// src/services/cbt/kepribadian.ts
//
// Paket standar inventori kepribadian Big Five, dibangun di atas butir skala.
//
// Butirnya adalah terjemahan IPIP-50 (International Personality Item Pool,
// penanda Big Five Goldberg) yang berada di domain publik, sehingga boleh
// dipakai dan disesuaikan tanpa lisensi — berbeda dengan MBTI, DISC, atau
// 16PF yang berhak cipta. Sepuluh butir per dimensi, sebagian berbunyi
// terbalik supaya pola "setuju terus" tidak menaikkan semua dimensi.
//
// Hasilnya profil, bukan kelulusan: skor tiap dimensi dinormalkan 0–100 lalu
// diberi tingkat rendah / sedang / tinggi beserta keterangan untuk HR.
// Keterangan ditulis sebagai kecenderungan kerja, bukan vonis, dan HR
// diminta memakainya bersama wawancara.
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { generateULID } from '../../utils/generateULID';
import type { PilihanSoal } from '../../utils/cbt';

export const KODE_PAKET_BIG5 = 'KEPRIBADIAN-BIG5';

/** Lima jenjang kesesuaian, nilai 1–5. Urutannya tidak boleh diacak ke peserta. */
export const SKALA_5: readonly { kode: string; teks: string }[] = [
  { kode: '1', teks: 'Sangat tidak sesuai' },
  { kode: '2', teks: 'Tidak sesuai' },
  { kode: '3', teks: 'Netral' },
  { kode: '4', teks: 'Sesuai' },
  { kode: '5', teks: 'Sangat sesuai' },
];

/** Pilihan skala lima jenjang; butir terbalik memberi nilai 5 untuk "sangat tidak sesuai". */
export const pilihanSkalaLima = (terbalik: boolean): PilihanSoal[] =>
  SKALA_5.map((p, i) => ({ kode: p.kode, teks: p.teks, nilai: terbalik ? SKALA_5.length - i : i + 1 }));

export interface DimensiKepribadian {
  kategori: string;
  singkat: string;
  /** Apa yang diukur, untuk HR. */
  keterangan: string;
  tinggi: string;
  sedang: string;
  rendah: string;
}

export const DIMENSI_BIG5: readonly DimensiKepribadian[] = [
  {
    kategori: 'Ekstraversi',
    singkat: 'Energi dalam pergaulan',
    keterangan: 'Seberapa bersemangat dan nyaman seseorang berinteraksi dengan banyak orang.',
    tinggi: 'Mudah bergaul, aktif memulai percakapan, nyaman menjadi pusat perhatian. Cocok untuk peran yang banyak bertemu tamu atau tim besar; perlu dijaga agar tidak mendominasi.',
    sedang: 'Luwes: bisa ramai bersama orang, bisa pula bekerja tenang sendiri. Umumnya menyesuaikan diri dengan tuntutan peran.',
    rendah: 'Lebih tenang dan reflektif, lebih nyaman bekerja mandiri atau dalam kelompok kecil. Bukan berarti tidak mampu melayani, tetapi interaksi intens sepanjang hari bisa menguras energi.',
  },
  {
    kategori: 'Keramahan',
    singkat: 'Kepedulian pada orang lain',
    keterangan: 'Kecenderungan bersikap hangat, kooperatif, dan peka pada perasaan orang lain.',
    tinggi: 'Hangat, suka membantu, menghindari konflik. Kuat untuk pelayanan dan kerja tim; perlu didukung agar tetap tegas saat harus menolak atau menegur.',
    sedang: 'Seimbang antara menjaga hubungan dan menyampaikan ketidaksetujuan. Umumnya mudah diajak bekerja sama.',
    rendah: 'Lebih lugas dan kritis, tidak segan menyampaikan ketidaksetujuan. Bisa bagus untuk peran yang menuntut ketegasan; perlu diperhatikan cara penyampaiannya pada tamu dan rekan.',
  },
  {
    kategori: 'Kesungguhan',
    singkat: 'Keteraturan dan tanggung jawab',
    keterangan: 'Kecenderungan terorganisasi, teliti, disiplin, dan menyelesaikan tugas sampai tuntas.',
    tinggi: 'Teratur, teliti, dapat diandalkan mengikuti prosedur dan jadwal. Sangat sesuai untuk pekerjaan yang menuntut standar (higiene, kas, administrasi); kadang kurang luwes saat prosedur harus dilanggar demi keadaan.',
    sedang: 'Cukup disiplin, dengan ruang untuk spontan. Umumnya mampu menuntaskan tugas bila ada arahan yang jelas.',
    rendah: 'Lebih spontan dan santai terhadap aturan serta tenggat; barang dan pekerjaan bisa tercecer. Perlu struktur, daftar periksa, dan pengawasan yang lebih dekat.',
  },
  {
    kategori: 'Kestabilan Emosi',
    singkat: 'Ketenangan di bawah tekanan',
    keterangan: 'Seberapa tenang dan stabil seseorang menghadapi tekanan, kritik, dan perubahan.',
    tinggi: 'Tenang, jarang terpancing, cepat pulih dari kekecewaan. Cocok untuk jam sibuk, keluhan tamu, dan peran pengambil keputusan.',
    sedang: 'Umumnya stabil, dengan masa cemas atau mudah kesal pada tekanan tertentu. Dukungan dan jeda biasanya cukup.',
    rendah: 'Lebih mudah cemas, tersinggung, atau berubah suasana hati. Bukan halangan bekerja, tetapi lingkungan bertekanan tinggi tanpa dukungan atasan bisa berat; pertimbangkan penempatan dan pendampingan.',
  },
  {
    kategori: 'Keterbukaan',
    singkat: 'Rasa ingin tahu dan gagasan',
    keterangan: 'Kecenderungan menyukai gagasan baru, imajinasi, dan hal-hal yang membutuhkan pemikiran.',
    tinggi: 'Senang belajar hal baru, penuh ide, cepat menangkap konsep. Baik untuk peran yang berubah-ubah atau butuh perbaikan proses; kadang bosan pada pekerjaan yang sangat rutin.',
    sedang: 'Terbuka pada hal baru secukupnya, tetap nyaman dengan rutinitas. Umumnya mudah dilatih.',
    rendah: 'Lebih praktis dan menyukai cara yang sudah terbukti. Andal untuk pekerjaan rutin yang jelas; perubahan prosedur perlu dijelaskan dan dilatih, bukan sekadar diumumkan.',
  },
];

/** Butir IPIP-50 dalam bahasa Indonesia; `terbalik` = skor dibalik. */
export const BUTIR_BIG5: readonly { kategori: string; teks: string; terbalik: boolean }[] = [
  // Ekstraversi
  { kategori: 'Ekstraversi', teks: 'Saya menjadi pusat keramaian dalam sebuah acara.', terbalik: false },
  { kategori: 'Ekstraversi', teks: 'Saya tidak banyak bicara.', terbalik: true },
  { kategori: 'Ekstraversi', teks: 'Saya merasa nyaman berada di antara banyak orang.', terbalik: false },
  { kategori: 'Ekstraversi', teks: 'Saya lebih suka berada di belakang layar.', terbalik: true },
  { kategori: 'Ekstraversi', teks: 'Saya yang biasanya memulai percakapan.', terbalik: false },
  { kategori: 'Ekstraversi', teks: 'Saya hanya punya sedikit hal untuk dibicarakan.', terbalik: true },
  { kategori: 'Ekstraversi', teks: 'Saya mengobrol dengan banyak orang yang berbeda dalam sebuah acara.', terbalik: false },
  { kategori: 'Ekstraversi', teks: 'Saya tidak suka menarik perhatian ke diri saya.', terbalik: true },
  { kategori: 'Ekstraversi', teks: 'Saya tidak keberatan menjadi pusat perhatian.', terbalik: false },
  { kategori: 'Ekstraversi', teks: 'Saya pendiam di antara orang yang belum saya kenal.', terbalik: true },
  // Keramahan
  { kategori: 'Keramahan', teks: 'Saya sebenarnya tidak terlalu tertarik pada orang lain.', terbalik: true },
  { kategori: 'Keramahan', teks: 'Saya tertarik pada orang lain.', terbalik: false },
  { kategori: 'Keramahan', teks: 'Saya kerap menyinggung perasaan orang.', terbalik: true },
  { kategori: 'Keramahan', teks: 'Saya ikut merasakan perasaan orang lain.', terbalik: false },
  { kategori: 'Keramahan', teks: 'Saya tidak tertarik pada masalah orang lain.', terbalik: true },
  { kategori: 'Keramahan', teks: 'Saya berhati lembut.', terbalik: false },
  { kategori: 'Keramahan', teks: 'Saya tidak terlalu peduli pada orang lain.', terbalik: true },
  { kategori: 'Keramahan', teks: 'Saya meluangkan waktu untuk orang lain.', terbalik: false },
  { kategori: 'Keramahan', teks: 'Saya bisa merasakan emosi orang lain.', terbalik: false },
  { kategori: 'Keramahan', teks: 'Saya membuat orang lain merasa nyaman.', terbalik: false },
  // Kesungguhan
  { kategori: 'Kesungguhan', teks: 'Saya selalu siap.', terbalik: false },
  { kategori: 'Kesungguhan', teks: 'Saya membiarkan barang-barang saya berserakan.', terbalik: true },
  { kategori: 'Kesungguhan', teks: 'Saya memperhatikan detail.', terbalik: false },
  { kategori: 'Kesungguhan', teks: 'Saya sering membuat keadaan berantakan.', terbalik: true },
  { kategori: 'Kesungguhan', teks: 'Saya segera menyelesaikan tugas rutin.', terbalik: false },
  { kategori: 'Kesungguhan', teks: 'Saya sering lupa mengembalikan barang ke tempatnya.', terbalik: true },
  { kategori: 'Kesungguhan', teks: 'Saya menyukai keteraturan.', terbalik: false },
  { kategori: 'Kesungguhan', teks: 'Saya suka mengelak dari kewajiban.', terbalik: true },
  { kategori: 'Kesungguhan', teks: 'Saya mengikuti jadwal.', terbalik: false },
  { kategori: 'Kesungguhan', teks: 'Saya teliti dalam bekerja.', terbalik: false },
  // Kestabilan Emosi
  { kategori: 'Kestabilan Emosi', teks: 'Saya mudah stres.', terbalik: true },
  { kategori: 'Kestabilan Emosi', teks: 'Saya santai hampir sepanjang waktu.', terbalik: false },
  { kategori: 'Kestabilan Emosi', teks: 'Saya mengkhawatirkan banyak hal.', terbalik: true },
  { kategori: 'Kestabilan Emosi', teks: 'Saya jarang merasa murung.', terbalik: false },
  { kategori: 'Kestabilan Emosi', teks: 'Saya mudah terganggu.', terbalik: true },
  { kategori: 'Kestabilan Emosi', teks: 'Saya mudah kesal.', terbalik: true },
  { kategori: 'Kestabilan Emosi', teks: 'Suasana hati saya sering berubah.', terbalik: true },
  { kategori: 'Kestabilan Emosi', teks: 'Saya sering mengalami perubahan suasana hati yang mendadak.', terbalik: true },
  { kategori: 'Kestabilan Emosi', teks: 'Saya mudah tersinggung.', terbalik: true },
  { kategori: 'Kestabilan Emosi', teks: 'Saya sering merasa sedih.', terbalik: true },
  // Keterbukaan
  { kategori: 'Keterbukaan', teks: 'Saya memiliki perbendaharaan kata yang kaya.', terbalik: false },
  { kategori: 'Keterbukaan', teks: 'Saya kesulitan memahami gagasan abstrak.', terbalik: true },
  { kategori: 'Keterbukaan', teks: 'Saya memiliki imajinasi yang hidup.', terbalik: false },
  { kategori: 'Keterbukaan', teks: 'Saya tidak tertarik pada gagasan abstrak.', terbalik: true },
  { kategori: 'Keterbukaan', teks: 'Saya punya ide-ide yang bagus.', terbalik: false },
  { kategori: 'Keterbukaan', teks: 'Saya tidak memiliki imajinasi yang baik.', terbalik: true },
  { kategori: 'Keterbukaan', teks: 'Saya cepat memahami sesuatu.', terbalik: false },
  { kategori: 'Keterbukaan', teks: 'Saya menggunakan kata-kata yang sulit.', terbalik: false },
  { kategori: 'Keterbukaan', teks: 'Saya meluangkan waktu untuk merenungkan berbagai hal.', terbalik: false },
  { kategori: 'Keterbukaan', teks: 'Saya penuh dengan ide.', terbalik: false },
];

export type TingkatDimensi = 'rendah' | 'sedang' | 'tinggi';

/**
 * Tingkat dari skor ternormalisasi 0–100. Batasnya sengaja lebar di tengah:
 * tes laporan diri 10 butir tidak cukup tajam untuk membedakan 58 dari 62.
 */
export const tingkatDimensi = (persen: number): TingkatDimensi => (persen < 40 ? 'rendah' : persen > 60 ? 'tinggi' : 'sedang');

const LABEL_TINGKAT: Record<TingkatDimensi, string> = { rendah: 'Rendah', sedang: 'Sedang', tinggi: 'Tinggi' };

export interface InterpretasiDimensi {
  kategori: string;
  tingkat: TingkatDimensi;
  labelTingkat: string;
  /** null bila kategorinya bukan dimensi yang dikenal (paket buatan HR). */
  keterangan: string | null;
  singkat: string | null;
}

export const interpretasiDimensi = (kategori: string, persen: number): InterpretasiDimensi => {
  const tingkat = tingkatDimensi(persen);
  const dimensi = DIMENSI_BIG5.find((d) => d.kategori === kategori);
  return {
    kategori,
    tingkat,
    labelTingkat: LABEL_TINGKAT[tingkat],
    keterangan: dimensi ? dimensi[tingkat] : null,
    singkat: dimensi?.singkat ?? null,
  };
};

export const DESKRIPSI_PAKET_BIG5 =
  'Inventori kepribadian lima faktor (Big Five) berdasarkan IPIP-50, domain publik. ' +
  '50 pernyataan dijawab pada skala 1–5 sesuai diri peserta; tidak ada jawaban benar atau salah. ' +
  'Hasilnya profil per dimensi (Ekstraversi, Keramahan, Kesungguhan, Kestabilan Emosi, Keterbukaan) ' +
  'untuk bahan wawancara dan penempatan, bukan alat diagnosis.';

/**
 * Membuat paket standar sekali; pemanggilan berikutnya mengembalikan paket
 * yang sudah ada tanpa membuat soal ganda.
 */
export const buatPaketKepribadianBig5 = async (createdById: string): Promise<{ id: string; dibuat: boolean }> => {
  const ada = await prisma.cbtTest.findUnique({ where: { code: KODE_PAKET_BIG5 }, select: { id: true } });
  if (ada) return { id: ada.id, dibuat: false };

  const testId = generateULID();
  await prisma.$transaction(async (tx) => {
    const soal = BUTIR_BIG5.map((b) => ({
      id: generateULID(),
      category: b.kategori,
      difficulty: 'sedang',
      type: 'skala',
      text: b.teks,
      textHtml: null,
      imagePath: null,
      options: pilihanSkalaLima(b.terbalik) as unknown as Prisma.InputJsonValue,
      answerKey: [] as string[],
      rubric: null,
      points: SKALA_5.length,
      explanation: null,
      isActive: true,
      createdById,
    }));
    await tx.cbtQuestion.createMany({ data: soal });
    await tx.cbtTest.create({
      data: {
        id: testId,
        code: KODE_PAKET_BIG5,
        title: 'Inventori Kepribadian Big Five (IPIP-50)',
        description: DESKRIPSI_PAKET_BIG5,
        descriptionHtml: null,
        audience: 'keduanya',
        durationMinutes: 25,
        passingScore: null,
        shuffleQuestions: true,
        // Skala 1–5 harus tetap berurutan di layar peserta.
        shuffleOptions: false,
        showResultToTaker: false,
        recordProctorEvents: false,
        proctorPhotos: false,
        status: 'published',
        createdById,
      },
    });
    await tx.cbtTestQuestion.createMany({
      data: soal.map((s, i) => ({ id: generateULID(), testId, questionId: s.id, sortOrder: i, points: null })),
    });
  });

  return { id: testId, dibuat: true };
};
