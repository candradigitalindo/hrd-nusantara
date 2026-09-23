"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { notifikasi } from "./use-notifikasi";
import type { PenggunaSesi } from "@/lib/types";

/** Pengguna yang sedang login, dari /auth/me. */
export const useSesi = () =>
  useQuery({
    queryKey: ["sesi"],
    queryFn: async () => (await api.get<PenggunaSesi>("/auth/me")).data,
    staleTime: 5 * 60_000,
  });

export const useLogout = () => {
  const router = useRouter();
  const qc = useQueryClient();
  return async () => {
    // Harus lewat /api/backend/: di produksi nginx mengirim /api/* lainnya ke
    // backend Express yang tidak punya rute ini.
    const jawaban = await fetch("/api/backend/keluar", { method: "DELETE" });
    // Tanpa pemeriksaan ini, kegagalan menghapus cookie berakhir sebagai
    // "tombol tidak bereaksi": halaman login memantulkan balik ke dashboard
    // karena sesinya masih ada.
    if (!jawaban.ok) {
      notifikasi.galat(new Error(`Server menolak permintaan keluar (HTTP ${jawaban.status}).`), "Gagal keluar");
      return;
    }
    qc.clear();
    router.replace("/login");
  };
};

/**
 * Lingkup data, bukan izin: HR melihat seluruh perusahaan, manajer melihat
 * departemennya. Dipakai hanya untuk UI yang memang soal cakupan data.
 */
export const bolehHr = (role: string | undefined) => role === "SUPER_ADMIN" || role === "HR_ADMIN";
export const bolehManajer = (role: string | undefined) => bolehHr(role) || role === "MANAGER";

/** Lingkup data dari yang paling sempit ke paling luas. */
const PERINGKAT_LINGKUP: Record<string, number> = { EMPLOYEE: 0, MANAGER: 1, HR_ADMIN: 2, SUPER_ADMIN: 3 };

/**
 * Akun berlingkup lebih luas tidak boleh disentuh dari bawah: hanya Super Admin
 * yang boleh menyunting, menonaktifkan, atau mengatur ulang sandi akun Super
 * Admin. Server menolaknya juga — ini supaya tombolnya tidak ditawarkan.
 */
export const bolehKelolaAkun = (saya: PenggunaSesi | undefined, target: { role: string }) =>
  saya !== undefined && (PERINGKAT_LINGKUP[target.role] ?? 0) <= (PERINGKAT_LINGKUP[saya.role] ?? 0);

/** Apakah pengguna memegang salah satu izin ini (peran dinamis). */
export const punyaIzin = (saya: PenggunaSesi | undefined, ...izin: string[]) =>
  saya !== undefined && izin.some((k) => saya.permissions.includes(k));

/** Boleh mengelola halaman: memegang salah satu dari buat / ubah / hapus-nya. */
export const bolehKelola = (saya: PenggunaSesi | undefined, halaman: string) =>
  punyaIzin(saya, `${halaman}.buat`, `${halaman}.ubah`, `${halaman}.hapus`);
