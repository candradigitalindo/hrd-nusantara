import "server-only";

/**
 * Pengambilan data untuk halaman publik, dijalankan di server.
 *
 * Halaman karier harus bisa dibaca mesin pencari, jadi isinya dirender di
 * server — bukan diambil peramban setelah halaman tampil. Karena berjalan di
 * dalam jaringan Docker, ia memanggil backend langsung, bukan lewat BFF.
 */
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3000";

export type { LowonganPublik } from "./types";
import type { LowonganPublik } from "./types";

export interface DaftarLowongan {
  data: LowonganPublik[];
  saringan: { lokasi: string[]; departemen: { id: string; name: string }[] };
}

const kosong: DaftarLowongan = { data: [], saringan: { lokasi: [], departemen: [] } };

/**
 * Backend yang sedang mati tidak boleh membuat halaman utama ikut mati:
 * landing page tetap tampil, bagian lowongannya saja yang kosong.
 */
export const ambilLowongan = async (params: Record<string, string> = {}): Promise<DaftarLowongan> => {
  const q = new URLSearchParams(params).toString();
  try {
    const res = await fetch(`${BACKEND}/api/karier/lowongan${q ? `?${q}` : ""}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return kosong;
    return (await res.json()) as DaftarLowongan;
  } catch {
    return kosong;
  }
};

export const ambilLowonganById = async (id: string): Promise<LowonganPublik | null> => {
  try {
    const res = await fetch(`${BACKEND}/api/karier/lowongan/${id}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return (await res.json()) as LowonganPublik;
  } catch {
    return null;
  }
};

/** Alamat publik situs, dipakai untuk kanonik, sitemap, dan data terstruktur. */
export const ALAMAT_SITUS = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hrd.nbp.co.id";

export const NAMA_PERUSAHAAN = "HRD Nusantara";
