import type { LingkupCbt, PenugasanCbt, TahapKandidat } from "./types";

export const halamanTesCbt = (scope: LingkupCbt) => scope === "recruitment" ? "/rekrutmen/tes" : "/cbt";
export const tautanHasilCbt = (scope: LingkupCbt, id: string) => `${halamanTesCbt(scope)}/hasil/${encodeURIComponent(id)}`;
export const kandidatBisaDites = (status: TahapKandidat) => ["applied", "screening", "interview", "offer"].includes(status);

/** Penyelesaian, penilaian, dan tinjauan HR merupakan tahap terpisah. */
export function statusTinjauanSeleksi(t: Pick<PenugasanCbt, "status" | "reviewedAt">, submittedAt: string | null) {
  if (!submittedAt) return { label: "Belum selesai", tone: "neutral", dapatDitinjau: false } as const;
  if (t.status !== "graded") return { label: "Menunggu penilaian", tone: "warning", dapatDitinjau: false } as const;
  if (t.reviewedAt) return { label: "Sudah ditinjau HR", tone: "success", dapatDitinjau: false } as const;
  return { label: "Menunggu tinjauan HR", tone: "warning", dapatDitinjau: true } as const;
}

/** Versi yang ditolak tidak boleh disetujui ulang, termasuk saat pemuatan ulang gagal. */
export const versiHasilBisaDitinjau = (versi: string | undefined, versiDitolak: string | null, sedangMemuat: boolean) =>
  Boolean(versi) && versi !== versiDitolak && !sedangMemuat;

/** Konflik kelengkapan tes dan tahap pelamar tetap memakai pesan server. */
export const konflikVersiHasilCbt = (statusHttp: number | undefined, kode: unknown) =>
  statusHttp === 409 && kode === "CBT_RESULT_CHANGED";
