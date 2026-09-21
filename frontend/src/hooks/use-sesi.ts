"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
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
    await fetch("/api/session", { method: "DELETE" });
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

/** Apakah pengguna memegang salah satu izin ini (peran dinamis). */
export const punyaIzin = (saya: PenggunaSesi | undefined, ...izin: string[]) =>
  saya !== undefined && izin.some((k) => saya.permissions.includes(k));
