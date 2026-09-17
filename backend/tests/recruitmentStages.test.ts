import {
  canTransition,
  canHire,
  daysToHire,
  CANDIDATE_STAGES,
  FUNNEL_ORDER,
  type CandidateStage,
} from '../src/utils/recruitmentStages';

describe('canTransition', () => {
  it('mengizinkan alur maju yang wajar', () => {
    const maju: [CandidateStage, CandidateStage][] = [
      ['applied', 'screening'],
      ['screening', 'interview'],
      ['interview', 'offer'],
    ];

    for (const [dari, ke] of maju) {
      expect(canTransition(dari, ke).allowed).toBe(true);
    }
  });

  it('mengizinkan mundur satu langkah, karena proses nyata memang berputar', () => {
    expect(canTransition('interview', 'screening').allowed).toBe(true);
    expect(canTransition('offer', 'interview').allowed).toBe(true);
  });

  it('mengizinkan penolakan dari tahap mana pun yang masih berjalan', () => {
    for (const dari of ['applied', 'screening', 'interview', 'offer'] as CandidateStage[]) {
      expect(canTransition(dari, 'rejected').allowed).toBe(true);
    }
  });

  it('menolak penetapan langsung ke "hired"', () => {
    // Kalau dibolehkan, akan ada pelamar berstatus diterima tanpa pernah
    // menjadi karyawan di sistem.
    const h = canTransition('offer', 'hired');
    expect(h.allowed).toBe(false);
    expect(h.reason).toContain('proses penerimaan');
  });

  it('menolak lompatan yang tidak masuk akal', () => {
    expect(canTransition('applied', 'offer').allowed).toBe(false);
  });

  it('menolak perpindahan ke tahap yang sama', () => {
    expect(canTransition('screening', 'screening').allowed).toBe(false);
  });

  it('mengunci tahap final', () => {
    expect(canTransition('hired', 'screening').allowed).toBe(false);
    expect(canTransition('withdrawn', 'screening').allowed).toBe(false);
  });

  it('mengizinkan pelamar yang ditolak dibuka kembali', () => {
    expect(canTransition('rejected', 'screening').allowed).toBe(true);
  });

  it('selalu menyertakan alasan saat menolak', () => {
    for (const dari of CANDIDATE_STAGES) {
      for (const ke of CANDIDATE_STAGES) {
        const h = canTransition(dari, ke);
        if (!h.allowed) expect(h.reason).toBeTruthy();
      }
    }
  });
});

describe('canHire', () => {
  it('hanya menerima dari tahap offer', () => {
    expect(canHire('offer').allowed).toBe(true);
  });

  it('menolak dari tahap selain offer', () => {
    for (const dari of ['applied', 'screening', 'interview', 'rejected'] as CandidateStage[]) {
      expect(canHire(dari).allowed).toBe(false);
    }
  });

  it('menolak penerimaan ganda', () => {
    expect(canHire('hired').reason).toContain('sudah diterima');
  });
});

describe('daysToHire', () => {
  const tgl = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it('menghitung selisih hari dari lamaran sampai diterima', () => {
    const hasil = daysToHire(tgl('2026-09-01'), [
      { toStage: 'screening', createdAt: tgl('2026-09-03') },
      { toStage: 'hired', createdAt: tgl('2026-09-21') },
    ]);

    expect(hasil).toBe(20);
  });

  it('mengembalikan null bila belum diterima', () => {
    expect(daysToHire(tgl('2026-09-01'), [{ toStage: 'offer', createdAt: tgl('2026-09-10') }])).toBeNull();
  });

  it('memakai kejadian "hired" yang paling awal', () => {
    const hasil = daysToHire(tgl('2026-09-01'), [
      { toStage: 'hired', createdAt: tgl('2026-09-20') },
      { toStage: 'hired', createdAt: tgl('2026-09-25') },
    ]);

    expect(hasil).toBe(19);
  });

  it('tidak menghasilkan angka negatif', () => {
    const hasil = daysToHire(tgl('2026-09-10'), [
      { toStage: 'hired', createdAt: tgl('2026-09-01') },
    ]);

    expect(hasil).toBe(0);
  });
});

describe('FUNNEL_ORDER', () => {
  it('berurutan dari lamaran sampai diterima', () => {
    expect(FUNNEL_ORDER).toEqual(['applied', 'screening', 'interview', 'offer', 'hired']);
  });

  it('tidak memuat tahap gugur', () => {
    expect(FUNNEL_ORDER).not.toContain('rejected');
    expect(FUNNEL_ORDER).not.toContain('withdrawn');
  });
});
