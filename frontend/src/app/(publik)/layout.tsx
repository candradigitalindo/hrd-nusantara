import type { Metadata } from "next";
import { KepalaPublik } from "@/components/publik/kepala";
import { KakiPublik } from "@/components/publik/kaki";
import { ALAMAT_SITUS, NAMA_PERUSAHAAN } from "@/lib/karier-server";

export const metadata: Metadata = {
  metadataBase: new URL(ALAMAT_SITUS),
  robots: { index: true, follow: true },
};

/**
 * Kerangka halaman publik: landing, lowongan, dan portal pelamar. Terpisah
 * dari kerangka aplikasi internal — pengunjung tidak punya sidebar, menu, atau
 * sesi karyawan.
 */
export default function LayoutPublik({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <KepalaPublik />
      <main className="flex-1">{children}</main>
      <KakiPublik nama={NAMA_PERUSAHAAN} />
    </div>
  );
}
