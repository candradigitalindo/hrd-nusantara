import {
  decideRegistrationStatus,
  evaluateTraining,
  addMonths,
  assessCompliance,
  SEAT_HOLDING_STATUSES,
} from '../src/utils/trainingRules';

const tgl = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('decideRegistrationStatus', () => {
  it('menerima pendaftar selama kuota belum penuh', () => {
    expect(decideRegistrationStatus({ maxParticipants: 10, occupiedSeats: 9 })).toBe('registered');
  });

  it('memasukkan ke daftar tunggu saat kuota penuh', () => {
    // Bukan ditolak: pembatalan menjelang hari-H itu lazim, dan daftar
    // tunggu membuat kursi kosong langsung terisi.
    expect(decideRegistrationStatus({ maxParticipants: 10, occupiedSeats: 10 })).toBe('waitlisted');
  });

  it('tetap daftar tunggu bila kuota sudah terlampaui', () => {
    expect(decideRegistrationStatus({ maxParticipants: 5, occupiedSeats: 8 })).toBe('waitlisted');
  });

  it('selalu menerima bila sesi tanpa batas kuota', () => {
    expect(decideRegistrationStatus({ maxParticipants: null, occupiedSeats: 999 })).toBe('registered');
  });

  it('kursi yang dibatalkan tidak lagi terhitung', () => {
    expect(SEAT_HOLDING_STATUSES).not.toContain('cancelled');
    expect(SEAT_HOLDING_STATUSES).not.toContain('waitlisted');
  });
});

describe('addMonths', () => {
  it('menambah bulan secara wajar', () => {
    expect(addMonths(tgl('2026-01-15'), 6).toISOString().slice(0, 10)).toBe('2026-07-15');
  });

  it('menjepit tanggal yang tidak ada di bulan tujuan', () => {
    // 31 Januari + 1 bulan akan meluber ke 3 Maret bila memakai setMonth apa adanya.
    expect(addMonths(tgl('2026-01-31'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('menangani tahun kabisat', () => {
    // 2028 kabisat.
    expect(addMonths(tgl('2028-01-31'), 1).toISOString().slice(0, 10)).toBe('2028-02-29');
  });

  it('melintasi pergantian tahun', () => {
    expect(addMonths(tgl('2026-11-15'), 3).toISOString().slice(0, 10)).toBe('2027-02-15');
  });
});

describe('evaluateTraining', () => {
  const selesai = tgl('2026-09-01');

  it('meluluskan nilai di atas ambang', () => {
    const h = evaluateTraining({ score: 80, passingScore: 70, validityMonths: null, completedAt: selesai });
    expect(h).toMatchObject({ status: 'completed', passed: true });
  });

  it('meluluskan nilai tepat di ambang', () => {
    expect(
      evaluateTraining({ score: 70, passingScore: 70, validityMonths: null, completedAt: selesai }).passed
    ).toBe(true);
  });

  it('menggagalkan nilai di bawah ambang', () => {
    const h = evaluateTraining({ score: 69, passingScore: 70, validityMonths: null, completedAt: selesai });
    expect(h).toMatchObject({ status: 'failed', passed: false });
  });

  it('meluluskan pelatihan tanpa ujian hanya dari kehadiran', () => {
    const h = evaluateTraining({ score: null, passingScore: null, validityMonths: null, completedAt: selesai });
    expect(h.passed).toBe(true);
  });

  it('menggagalkan bila ada ambang tapi nilainya tidak diisi', () => {
    expect(
      evaluateTraining({ score: null, passingScore: 70, validityMonths: null, completedAt: selesai }).passed
    ).toBe(false);
  });

  it('memberi masa berlaku pada kelulusan', () => {
    const h = evaluateTraining({ score: 90, passingScore: 70, validityMonths: 12, completedAt: selesai });
    expect(h.expiresAt?.toISOString().slice(0, 10)).toBe('2027-09-01');
  });

  it('tidak memberi masa berlaku pada kegagalan', () => {
    // Yang tidak lulus tidak punya apa pun untuk kedaluwarsa.
    const h = evaluateTraining({ score: 40, passingScore: 70, validityMonths: 12, completedAt: selesai });
    expect(h.expiresAt).toBeNull();
  });

  it('tidak memberi masa berlaku bila programnya memang tidak kedaluwarsa', () => {
    const h = evaluateTraining({ score: 90, passingScore: 70, validityMonths: null, completedAt: selesai });
    expect(h.expiresAt).toBeNull();
  });
});

describe('assessCompliance', () => {
  const kini = tgl('2026-09-15');
  const PERINGATAN = 30;

  it('menandai belum pernah ikut', () => {
    expect(assessCompliance([], kini, PERINGATAN).state).toBe('never_completed');
  });

  it('menandai belum patuh bila pernah ikut tapi tidak lulus', () => {
    const h = assessCompliance(
      [{ passed: false, completedAt: tgl('2026-01-01'), expiresAt: null }],
      kini,
      PERINGATAN
    );
    expect(h.state).toBe('never_completed');
  });

  it('menandai patuh untuk kelulusan tanpa kedaluwarsa', () => {
    const h = assessCompliance(
      [{ passed: true, completedAt: tgl('2020-01-01'), expiresAt: null }],
      kini,
      PERINGATAN
    );
    expect(h).toMatchObject({ state: 'compliant', validUntil: null });
  });

  it('menandai kedaluwarsa', () => {
    const h = assessCompliance(
      [{ passed: true, completedAt: tgl('2025-01-01'), expiresAt: tgl('2026-01-01') }],
      kini,
      PERINGATAN
    );
    expect(h.state).toBe('expired');
  });

  it('memperingatkan sebelum kedaluwarsa, bukan sesudahnya', () => {
    // Berlaku sampai 1 Oktober; hari ini 15 September, ambang 30 hari.
    const h = assessCompliance(
      [{ passed: true, completedAt: tgl('2025-10-01'), expiresAt: tgl('2026-10-01') }],
      kini,
      PERINGATAN
    );
    // HR perlu menjadwalkan ulang SEBELUM sertifikatnya mati.
    expect(h.state).toBe('expiring_soon');
  });

  it('menandai patuh bila masih jauh dari kedaluwarsa', () => {
    const h = assessCompliance(
      [{ passed: true, completedAt: tgl('2026-01-01'), expiresAt: tgl('2027-01-01') }],
      kini,
      PERINGATAN
    );
    expect(h.state).toBe('compliant');
  });

  it('memakai kelulusan dengan masa berlaku terjauh', () => {
    const h = assessCompliance(
      [
        { passed: true, completedAt: tgl('2024-01-01'), expiresAt: tgl('2025-01-01') },
        { passed: true, completedAt: tgl('2026-01-01'), expiresAt: tgl('2027-06-01') },
      ],
      kini,
      PERINGATAN
    );

    // Sertifikat lama sudah mati, tapi yang baru masih berlaku.
    expect(h.state).toBe('compliant');
    expect(h.validUntil?.toISOString().slice(0, 10)).toBe('2027-06-01');
  });

  it('kelulusan tanpa kedaluwarsa mengalahkan yang sudah mati', () => {
    const h = assessCompliance(
      [
        { passed: true, completedAt: tgl('2024-01-01'), expiresAt: tgl('2025-01-01') },
        { passed: true, completedAt: tgl('2024-06-01'), expiresAt: null },
      ],
      kini,
      PERINGATAN
    );
    expect(h.state).toBe('compliant');
  });
});
