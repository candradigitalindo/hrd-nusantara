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

export const bolehHr = (role: string | undefined) => role === "SUPER_ADMIN" || role === "HR_ADMIN";
export const bolehManajer = (role: string | undefined) => bolehHr(role) || role === "MANAGER";
