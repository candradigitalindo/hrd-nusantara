// src/utils/competencyRules.ts

export type CertificationState = 'valid' | 'expiring_soon' | 'expired' | 'revoked';

export interface CertificationInput {
  expiryDate: Date | null;
  revokedAt: Date | null;
}

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

  if (cert.expiryDate.getTime() <= now.getTime()) return 'expired';

  const ambang = new Date(now.getTime() + warningDays * 24 * 60 * 60 * 1000);
  return cert.expiryDate.getTime() <= ambang.getTime() ? 'expiring_soon' : 'valid';
};

export interface StandardInput {
  competencyId: string;
  competencyCode: string;
  competencyName: string;
  requiredLevel: number;
  maxLevel: number;
}

export interface HeldCompetency {
  competencyId: string;
  currentLevel: number;
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
}

export interface GapAnalysis {
  gaps: CompetencyGap[];
  totalRequired: number;
  totalMet: number;
  /** Persen kesiapan terhadap seluruh syarat jabatan, 0-100. */
  readinessPercent: number;
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
  const dimiliki = new Map(held.map((h) => [h.competencyId, h.currentLevel]));

  const gaps = standards.map((standar) => {
    const tingkat = dimiliki.get(standar.competencyId);
    const notAssessed = tingkat === undefined;
    const currentLevel = tingkat ?? 0;
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
    };
  });

  const totalMet = gaps.filter((g) => g.meets).length;

  return {
    gaps,
    totalRequired: standards.length,
    totalMet,
    readinessPercent:
      standards.length === 0 ? 100 : Math.round((totalMet / standards.length) * 1000) / 10,
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
