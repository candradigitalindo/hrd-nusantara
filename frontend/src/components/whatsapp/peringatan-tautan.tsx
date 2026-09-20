"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Alert } from "@/components/ui/alert";
import type { TautanWhatsApp } from "@/lib/types";

export const tautanWhatsAppQuery = {
  queryKey: ["wa", "saya"] as const,
  queryFn: async () => (await api.get<TautanWhatsApp>("/whatsapp/me")).data,
};

/**
 * Peringatan di dashboard bila WhatsApp pengguna tidak tertaut.
 * Pemindaian QR hanya lewat halaman WhatsApp Saya di web ini.
 */
export const PeringatanTautanWhatsApp = () => {
  const tautan = useQuery({ ...tautanWhatsAppQuery, refetchInterval: 30_000 });
  const t = tautan.data;
  if (!t || !t.driverAktif || t.status === "connected" || t.status === "inactive") return null;
  const belum = t.status === "never_linked";
  return (
    <Alert
      tone={belum ? "warning" : "danger"}
      title={belum ? "WhatsApp belum ditautkan" : "Tautan WhatsApp terputus"}
      action={<Link href="/whatsapp-saya" className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-on-primary hover:bg-primary-hover">{belum ? "Tautkan sekarang" : "Pindai ulang"}</Link>}
    >
      {belum
        ? "Perusahaan mewajibkan WhatsApp setiap karyawan tersambung ke sistem. Pindai kode QR di halaman WhatsApp Saya."
        : "Pesan Anda tidak lagi tersinkron. Buka halaman WhatsApp Saya dan pindai ulang kode QR dengan WhatsApp di ponsel Anda."}
    </Alert>
  );
};
