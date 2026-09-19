"use client";

import { toast } from "sonner";
import { ambilGalat } from "@/lib/api";

/**
 * Notifikasi dengan kata-kata yang menjelaskan, bukan sekadar "Berhasil".
 * Galat dari backend diteruskan apa adanya karena pesannya sudah berbahasa
 * Indonesia dan menyebut apa yang salah.
 */
export const notifikasi = {
  sukses: (judul: string, keterangan?: string) => toast.success(judul, { description: keterangan }),
  info: (judul: string, keterangan?: string) => toast.info(judul, { description: keterangan }),
  peringatan: (judul: string, keterangan?: string) => toast.warning(judul, { description: keterangan }),
  galat: (error: unknown, judul = "Gagal") => {
    const g = ambilGalat(error);
    const rincian = g.rincian?.map((r) => `${r.field}: ${r.message}`).join("\n");
    toast.error(judul, { description: rincian ?? g.pesan, duration: 6500 });
  },
  /** Menampilkan proses yang sedang berjalan lalu menggantinya dengan hasilnya. */
  proses: <T,>(janji: Promise<T>, pesan: { loading: string; success: string | ((d: T) => string); error?: string }) =>
    toast.promise(janji, {
      loading: pesan.loading,
      success: pesan.success,
      error: (e) => pesan.error ?? ambilGalat(e).pesan,
    }),
};
