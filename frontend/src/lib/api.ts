import axios, { AxiosError } from "axios";

/**
 * Semua panggilan ke backend lewat /api/backend/* di Next, bukan langsung ke
 * Express. Route handler di sana yang menempelkan token dari cookie httpOnly,
 * jadi token tidak pernah bisa dibaca JavaScript di browser — XSS di satu
 * komponen tidak otomatis berarti sesi seluruh HR bocor.
 */
export const api = axios.create({
  baseURL: "/api/backend",
  headers: { "Content-Type": "application/json" },
  timeout: 20_000,
});

/**
 * Mengambil seluruh isi daftar yang memang harus tampil utuh (rincian slip
 * satu batch, peserta satu sesi). Backend membatasi limit maksimal 100 per
 * halaman, jadi halaman diambil berurutan sampai habis.
 */
export const ambilSemua = async <T,>(jalur: string, params: Record<string, string> = {}): Promise<T[]> => {
  const semua: T[] = [];
  const limit = 100;
  for (let page = 1; page <= 50; page++) {
    const q = new URLSearchParams({ ...params, page: String(page), limit: String(limit) });
    const { data } = await api.get<{ data: T[] }>(`${jalur}?${q}`);
    semua.push(...data.data);
    if (data.data.length < limit) break;
  }
  return semua;
};

export interface GalatApi {
  status: number;
  pesan: string;
  rincian?: { field: string; message: string }[];
}

/** Menyeragamkan galat jaringan dan galat backend menjadi satu bentuk. */
export const ambilGalat = (error: unknown): GalatApi => {
  if (axios.isAxiosError(error)) {
    const e = error as AxiosError<{ error?: string; details?: { field: string; message: string }[] }>;
    if (!e.response) return { status: 0, pesan: "Tidak bisa menghubungi server. Periksa koneksi Anda." };
    return {
      status: e.response.status,
      pesan: e.response.data?.error ?? e.message,
      rincian: e.response.data?.details,
    };
  }
  return { status: 0, pesan: error instanceof Error ? error.message : "Terjadi kesalahan tak terduga" };
};

// Sesi habis: 401 dari mana pun berarti kembali ke halaman login.
api.interceptors.response.use(
  (r) => r,
  (error: AxiosError) => {
    if (typeof window !== "undefined" && error.response?.status === 401) {
      const disini = window.location.pathname;
      if (!disini.startsWith("/login")) {
        // Muat ulang penuh, bukan router.push: sesi habis berarti seluruh
        // cache query dan state komponen harus ikut dibuang.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = `/login?kembali=${encodeURIComponent(disini)}`;
      }
    }
    return Promise.reject(error);
  }
);
