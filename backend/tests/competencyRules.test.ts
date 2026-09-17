import {
  certificationState,
  analyzeCompetencyGap,
  validateLevel,
  type StandardInput,
} from '../src/utils/competencyRules';

const tgl = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const KINI = tgl('2026-09-15');
const PERINGATAN = 30;

describe('certificationState', () => {
  const cek = (expiryDate: Date | null, revokedAt: Date | null = null) =>
    certificationState({ expiryDate, revokedAt }, KINI, PERINGATAN);

  it('berlaku bila tanggalnya masih jauh', () => {
    expect(cek(tgl('2027-01-01'))).toBe('valid');
  });

  it('berlaku selamanya bila tanpa tanggal kedaluwarsa', () => {
    expect(cek(null)).toBe('valid');
  });

  it('kedaluwarsa bila tanggalnya sudah lewat', () => {
    expect(cek(tgl('2026-09-01'))).toBe('expired');
  });

  it('kedaluwarsa tepat pada tanggalnya', () => {
    expect(cek(KINI)).toBe('expired');
  });

  it('memperingatkan sebelum kedaluwarsa', () => {
    // Tinggal 10 hari; ambang peringatan 30 hari.
    expect(cek(tgl('2026-09-25'))).toBe('expiring_soon');
  });

  it('belum memperingatkan bila masih di luar ambang', () => {
    expect(cek(tgl('2026-11-01'))).toBe('valid');
  });

  it('pencabutan mengalahkan tanggal yang masih berlaku', () => {
    // Sertifikat dicabut tidak berlaku walau tanggalnya masih jauh.
    expect(cek(tgl('2030-01-01'), tgl('2026-08-01'))).toBe('revoked');
  });

  it('pencabutan juga mengalahkan status kedaluwarsa', () => {
    expect(cek(tgl('2020-01-01'), tgl('2026-08-01'))).toBe('revoked');
  });
});

describe('analyzeCompetencyGap', () => {
  const standar = (id: string, requiredLevel: number): StandardInput => ({
    competencyId: id,
    competencyCode: id.toUpperCase(),
    competencyName: `Kompetensi ${id}`,
    requiredLevel,
    maxLevel: 4,
  });

  it('menandai syarat yang terpenuhi', () => {
    const h = analyzeCompetencyGap([standar('a', 2)], [{ competencyId: 'a', currentLevel: 3 }]);

    expect(h.gaps[0]).toMatchObject({ meets: true, gap: 0, currentLevel: 3 });
    expect(h.readinessPercent).toBe(100);
  });

  it('menghitung kekurangan tingkat', () => {
    const h = analyzeCompetencyGap([standar('a', 4)], [{ competencyId: 'a', currentLevel: 1 }]);

    expect(h.gaps[0]).toMatchObject({ meets: false, gap: 3 });
  });

  it('memperlakukan yang belum dinilai sebagai tingkat nol, bukan diabaikan', () => {
    // Kalau dilewati, karyawan yang belum pernah dinilai akan tampak
    // seratus persen siap.
    const h = analyzeCompetencyGap([standar('a', 3)], []);

    expect(h.gaps[0]).toMatchObject({ notAssessed: true, currentLevel: null, gap: 3, meets: false });
    expect(h.readinessPercent).toBe(0);
  });

  it('membedakan belum dinilai dari dinilai tingkat nol', () => {
    const belum = analyzeCompetencyGap([standar('a', 2)], []);
    const nol = analyzeCompetencyGap([standar('a', 2)], [{ competencyId: 'a', currentLevel: 0 }]);

    expect(belum.gaps[0].notAssessed).toBe(true);
    expect(nol.gaps[0].notAssessed).toBe(false);
    expect(nol.gaps[0].currentLevel).toBe(0);
  });

  it('menghitung kesiapan sebagai persentase syarat yang terpenuhi', () => {
    const h = analyzeCompetencyGap(
      [standar('a', 2), standar('b', 2), standar('c', 2), standar('d', 2)],
      [
        { competencyId: 'a', currentLevel: 3 },
        { competencyId: 'b', currentLevel: 2 },
        { competencyId: 'c', currentLevel: 1 },
      ]
    );

    expect(h.totalMet).toBe(2);
    expect(h.totalRequired).toBe(4);
    expect(h.readinessPercent).toBe(50);
  });

  it('mengabaikan kompetensi yang dimiliki tapi tidak disyaratkan', () => {
    const h = analyzeCompetencyGap(
      [standar('a', 2)],
      [
        { competencyId: 'a', currentLevel: 2 },
        { competencyId: 'z', currentLevel: 4 },
      ]
    );

    expect(h.gaps).toHaveLength(1);
    expect(h.readinessPercent).toBe(100);
  });

  it('menganggap jabatan tanpa syarat sebagai siap penuh', () => {
    const h = analyzeCompetencyGap([], [{ competencyId: 'a', currentLevel: 1 }]);
    expect(h.readinessPercent).toBe(100);
    expect(h.gaps).toHaveLength(0);
  });
});

describe('validateLevel', () => {
  it('menerima tingkat dalam rentang', () => {
    expect(validateLevel(0, 4).valid).toBe(true);
    expect(validateLevel(4, 4).valid).toBe(true);
  });

  it('menolak tingkat melebihi skala', () => {
    expect(validateLevel(5, 4).valid).toBe(false);
  });

  it('menolak tingkat negatif', () => {
    expect(validateLevel(-1, 4).valid).toBe(false);
  });

  it('menolak pecahan', () => {
    expect(validateLevel(2.5, 4).valid).toBe(false);
  });
});
