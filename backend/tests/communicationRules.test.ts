import {
  isTargeted,
  validateAnswers,
  aggregateAnswers,
  SurveyAnswerError,
  type QuestionSpec,
} from '../src/utils/communicationRules';

const soal = (ubah: Partial<QuestionSpec> & { id: string }): QuestionSpec => ({
  code: ubah.id.toUpperCase(),
  text: `Pertanyaan ${ubah.id}`,
  type: 'scale',
  options: null,
  minScale: 1,
  maxScale: 5,
  isRequired: true,
  ...ubah,
});

describe('isTargeted', () => {
  it('menyasar semua orang bila tanpa departemen', () => {
    expect(isTargeted({ targetDepartmentId: null }, { departmentId: 'dapur' })).toBe(true);
    expect(isTargeted({ targetDepartmentId: null }, { departmentId: null })).toBe(true);
  });

  it('hanya menyasar departemen yang disebut', () => {
    expect(isTargeted({ targetDepartmentId: 'dapur' }, { departmentId: 'dapur' })).toBe(true);
    expect(isTargeted({ targetDepartmentId: 'dapur' }, { departmentId: 'fo' })).toBe(false);
  });

  it('tidak menyasar karyawan tanpa departemen', () => {
    // Memasukkannya akan menghasilkan daftar penerima yang keliru.
    expect(isTargeted({ targetDepartmentId: 'dapur' }, { departmentId: null })).toBe(false);
  });
});

describe('validateAnswers', () => {
  it('menerima jawaban yang sesuai', () => {
    expect(() =>
      validateAnswers([soal({ id: 'a' })], [{ questionId: 'a', scaleValue: 4 }])
    ).not.toThrow();
  });

  it('menolak pertanyaan wajib yang dilewati', () => {
    expect(() => validateAnswers([soal({ id: 'a' })], [])).toThrow(/wajib dijawab/);
  });

  it('mengizinkan pertanyaan tidak wajib dilewati', () => {
    expect(() => validateAnswers([soal({ id: 'a', isRequired: false })], [])).not.toThrow();
  });

  it('menolak nilai skala di luar rentang', () => {
    // Tidak mungkin dicegah saat pertanyaan disimpan sebagai Json bebas.
    expect(() =>
      validateAnswers([soal({ id: 'a', minScale: 1, maxScale: 5 })], [{ questionId: 'a', scaleValue: 9 }])
    ).toThrow(/antara 1 dan 5/);
  });

  it('menolak jenis jawaban yang keliru', () => {
    expect(() =>
      validateAnswers([soal({ id: 'a' })], [{ questionId: 'a', textValue: 'empat' }])
    ).toThrow(SurveyAnswerError);
  });

  it('menolak pilihan di luar daftar', () => {
    const pilihan = soal({ id: 'a', type: 'choice', options: ['Ya', 'Tidak'] });

    expect(() =>
      validateAnswers([pilihan], [{ questionId: 'a', choiceValue: 'Mungkin' }])
    ).toThrow(/bukan pilihan/);

    expect(() =>
      validateAnswers([pilihan], [{ questionId: 'a', choiceValue: 'Ya' }])
    ).not.toThrow();
  });

  it('menolak jawaban teks kosong', () => {
    const teks = soal({ id: 'a', type: 'text' });
    expect(() => validateAnswers([teks], [{ questionId: 'a', textValue: '   ' }])).toThrow();
  });

  it('menolak jawaban untuk pertanyaan yang bukan milik survei ini', () => {
    expect(() =>
      validateAnswers([soal({ id: 'a' })], [
        { questionId: 'a', scaleValue: 3 },
        { questionId: 'entah', scaleValue: 3 },
      ])
    ).toThrow(/bukan bagian dari survei/);
  });
});

describe('aggregateAnswers', () => {
  it('merata-ratakan pertanyaan berskala', () => {
    const hasil = aggregateAnswers(
      [soal({ id: 'a' })],
      [
        { questionId: 'a', scaleValue: 5, choiceValue: null, textValue: null },
        { questionId: 'a', scaleValue: 3, choiceValue: null, textValue: null },
      ]
    );

    expect(hasil[0].average).toBe(4);
    expect(hasil[0].responseCount).toBe(2);
    expect(hasil[0].distribution).toEqual({ '5': 1, '3': 1 });
  });

  it('tidak merata-ratakan pertanyaan pilihan', () => {
    // Rata-rata pilihan akan terlihat sah tapi tidak berarti apa-apa.
    const hasil = aggregateAnswers(
      [soal({ id: 'a', type: 'choice', options: ['Ya', 'Tidak'] })],
      [
        { questionId: 'a', scaleValue: null, choiceValue: 'Ya', textValue: null },
        { questionId: 'a', scaleValue: null, choiceValue: 'Ya', textValue: null },
        { questionId: 'a', scaleValue: null, choiceValue: 'Tidak', textValue: null },
      ]
    );

    expect(hasil[0].average).toBeNull();
    expect(hasil[0].distribution).toEqual({ Ya: 2, Tidak: 1 });
  });

  it('hanya menghitung jumlah untuk pertanyaan teks', () => {
    const hasil = aggregateAnswers(
      [soal({ id: 'a', type: 'text' })],
      [{ questionId: 'a', scaleValue: null, choiceValue: null, textValue: 'Bagus' }]
    );

    expect(hasil[0].average).toBeNull();
    expect(hasil[0].responseCount).toBe(1);
    expect(hasil[0].distribution).toEqual({});
  });

  it('mengembalikan null bila belum ada jawaban', () => {
    const hasil = aggregateAnswers([soal({ id: 'a' })], []);
    expect(hasil[0].average).toBeNull();
    expect(hasil[0].responseCount).toBe(0);
  });
});
