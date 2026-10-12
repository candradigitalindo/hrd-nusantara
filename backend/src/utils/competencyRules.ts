// src/utils/competencyRules.ts

export type CertificationState = 'valid' | 'expiring_soon' | 'expired' | 'revoked';

export interface CertificationInput {
  expiryDate: Date | null;
  revokedAt: Date | null;
}

/**
 * Akhir masa berlaku sertifikat yang "berlaku sampai" suatu tanggal: sertifikat
 * masih sah sepanjang hari itu dan baru kedaluwarsa pada pergantian hari
 * berikutnya. Begitu pula sertifikat fisiknya dibaca — Food Handler yang
 * tertulis "berlaku s.d. 7 Okt" masih berlaku pada 7 Okt.
 *
 * Tanggal kedaluwarsa disimpan sebagai tanggal UTC (date-only dari HR, atau
 * turunan tanggal selesai pelatihan), jadi batas harinya diambil dari
 * komponen tanggal UTC-nya.
 */
export const akhirMasaBerlaku = (expiryDate: Date): number =>
  Date.UTC(expiryDate.getUTCFullYear(), expiryDate.getUTCMonth(), expiryDate.getUTCDate() + 1);

/**
 * Status sertifikat, DIHITUNG bukan disimpan.
 *
 * Status tersimpan akan tetap berbunyi "valid" setelah tanggalnya lewat,
 * kecuali ada proses terjadwal yang memperbaruinya — dan proses semacam itu
 * pasti akan gagal atau terlupa suatu saat. Menghitungnya dari expiryDate
 * membuat jawabannya selalu benar.
 */
export const certificationState = (
  cert: CertificationInput,
  now: Date,
  warningDays: number
): CertificationState => {
  // Pencabutan mengalahkan segalanya: sertifikat yang dicabut tidak berlaku
  // walaupun tanggalnya masih jauh.
  if (cert.revokedAt !== null) return 'revoked';

  if (cert.expiryDate === null) return 'valid';

  const akhir = akhirMasaBerlaku(cert.expiryDate);
  if (akhir <= now.getTime()) return 'expired';

  const ambang = now.getTime() + warningDays * 24 * 60 * 60 * 1000;
  return akhir <= ambang ? 'expiring_soon' : 'valid';
};

export interface StandardInput {
  competencyId: string;
  competencyCode: string;
  competencyName: string;
  requiredLevel: number;
  maxLevel: number;
}

export interface PenilaiRingkas {
  id: string;
  name: string;
}

export interface HeldCompetency {
  competencyId: string;
  currentLevel: number;
  /** Kapan, oleh siapa, dan atas bukti apa tingkat ini dinilai — bila ikut dimuat. */
  assessedAt?: Date | null;
  assessedBy?: PenilaiRingkas | null;
  note?: string | null;
  evidenceUrl?: string | null;
}

export interface CompetencyGap {
  competencyId: string;
  competencyCode: string;
  competencyName: string;
  requiredLevel: number;
  currentLevel: number | null;
  /** Berapa tingkat yang masih kurang. 0 berarti syarat terpenuhi. */
  gap: number;
  meets: boolean;
  /** Belum pernah dinilai sama sekali. */
  notAssessed: boolean;
  assessedAt: Date | null;
  assessedBy: PenilaiRingkas | null;
  note: string | null;
  evidenceUrl: string | null;
}

export interface GapAnalysis {
  gaps: CompetencyGap[];
  totalRequired: number;
  totalMet: number;
  /**
   * Persen kesiapan terhadap seluruh syarat jabatan, 0-100. null bila jabatan
   * belum punya syarat sama sekali: "belum ada standar" bukan "100% siap".
   */
  readinessPercent: number | null;
}

/**
 * Membandingkan kompetensi yang dimiliki terhadap syarat jabatan.
 *
 * Kompetensi yang belum pernah dinilai diperlakukan sebagai tingkat 0, bukan
 * diabaikan: kalau dilewati, seorang karyawan yang belum pernah dinilai sama
 * sekali akan tampak seratus persen siap.
 */
export const analyzeCompetencyGap = (
  standards: StandardInput[],
  held: HeldCompetency[]
): GapAnalysis => {
  const dimiliki = new Map(held.map((h) => [h.competencyId, h]));

  const gaps = standards.map((standar) => {
    const punya = dimiliki.get(standar.competencyId);
    const notAssessed = punya === undefined;
    const currentLevel = punya?.currentLevel ?? 0;
    const gap = Math.max(0, standar.requiredLevel - currentLevel);

    return {
      competencyId: standar.competencyId,
      competencyCode: standar.competencyCode,
      competencyName: standar.competencyName,
      requiredLevel: standar.requiredLevel,
      currentLevel: notAssessed ? null : currentLevel,
      gap,
      meets: gap === 0,
      notAssessed,
      assessedAt: punya?.assessedAt ?? null,
      assessedBy: punya?.assessedBy ?? null,
      note: punya?.note ?? null,
      evidenceUrl: punya?.evidenceUrl ?? null,
    };
  });

  const totalMet = gaps.filter((g) => g.meets).length;

  return {
    gaps,
    totalRequired: standards.length,
    totalMet,
    readinessPercent:
      standards.length === 0 ? null : Math.round((totalMet / standards.length) * 1000) / 10,
  };
};

/** Memastikan tingkat yang diisi masuk akal terhadap skala kompetensinya. */
export const validateLevel = (
  level: number,
  maxLevel: number
): { valid: boolean; reason?: string } => {
  if (!Number.isInteger(level)) {
    return { valid: false, reason: 'Tingkat kompetensi harus bilangan bulat' };
  }
  if (level < 0 || level > maxLevel) {
    return { valid: false, reason: `Tingkat harus antara 0 dan ${maxLevel}` };
  }
  return { valid: true };
};
