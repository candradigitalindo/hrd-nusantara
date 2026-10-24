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
  const tautan = useQuery({ ...tautanWhatsAppQuery, refetchInterval: 60_000 });
  const t = tautan.data;
  if (!t || !t.driverAktif || t.status === "connected" || t.status === "inactive") return null;
  if (t.status === "connecting") {
    const sambungUlang = Boolean(t.session?.sedangSambungUlang || t.account?.lastConnectedAt);
    return (
      <Alert
        tone="info"
        title={sambungUlang ? "WhatsApp sedang menyambung ulang" : "WhatsApp sedang disambungkan"}
        action={<Link href="/whatsapp-saya" className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-on-primary hover:bg-primary-hover">Lihat status</Link>}
      >
        {sambungUlang
          ? "Sistem sedang mencoba menyambungkan kembali WhatsApp. Tunggu hingga status diperbarui."
          : "Tautan sedang disiapkan. Buka WhatsApp Saya untuk melihat perkembangannya."}
      </Alert>
    );
  }
  const belum = t.status === "never_linked";
  const siapPindai = t.status === "pending_scan";
  return (
    <Alert
      tone={belum || siapPindai ? "warning" : "danger"}
      title={belum ? "WhatsApp belum ditautkan" : siapPindai ? "Kode QR WhatsApp siap dipindai" : "Tautan WhatsApp terputus"}
      action={<Link href="/whatsapp-saya" className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-on-primary hover:bg-primary-hover">{belum ? "Tautkan sekarang" : siapPindai ? "Pindai kode QR" : "Sambungkan kembali"}</Link>}
    >
      {belum
        ? "Perusahaan mewajibkan WhatsApp setiap karyawan tersambung ke sistem. Pindai kode QR di halaman WhatsApp Saya."
        : siapPindai
          ? "Buka WhatsApp Saya dan pindai kode QR dengan WhatsApp di ponsel Anda."
          : "Sinkronisasi pesan terhenti. Buka WhatsApp Saya untuk menyambungkan kembali; pindai ulang jika kode QR ditampilkan."}
    </Alert>
  );
};
