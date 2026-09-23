import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase, Filter } from "lucide-react";
import { KartuLowongan } from "@/components/publik/kartu-lowongan";
import { ALAMAT_SITUS, NAMA_PERUSAHAAN, ambilLowongan } from "@/lib/karier-server";

const JUDUL = "Lowongan Kerja Terbuka";
const RINGKASAN =
  "Daftar lowongan kerja yang sedang dibuka di jaringan restoran dan hotel kami: posisi, lokasi, kisaran gaji, dan batas lamaran. Lamar langsung lewat portal karier.";

export const metadata: Metadata = {
  title: JUDUL,
  description: RINGKASAN,
  alternates: { canonical: "/lowongan" },
  openGraph: {
    type: "website",
    locale: "id_ID",
    url: `${ALAMAT_SITUS}/lowongan`,
    siteName: NAMA_PERUSAHAAN,
    title: `${JUDUL} · ${NAMA_PERUSAHAAN}`,
    description: RINGKASAN,
  },
};

/** Halaman daftar lowongan, dengan saringan sederhana lewat parameter URL. */
export default async function HalamanLowongan({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; lokasi?: string; departemen?: string }>;
}) {
  const sp = await searchParams;
  const { data, saringan } = await ambilLowongan({
    ...(sp.q ? { q: sp.q } : {}),
    ...(sp.lokasi ? { lokasi: sp.lokasi } : {}),
    ...(sp.departemen ? { departemen: sp.departemen } : {}),
  });

  const adaSaringan = Boolean(sp.q || sp.lokasi || sp.departemen);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
      <h1 className="text-3xl font-bold tracking-tight">Lowongan terbuka</h1>
      <p className="mt-3 max-w-2xl text-muted">{RINGKASAN}</p>

      {/* Saringan berbasis tautan: tetap bekerja tanpa JavaScript dan bisa
          dibagikan sebagai URL. */}
      <form method="get" className="mt-8 grid gap-3 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-[1fr_auto_auto_auto]">
        <label className="sr-only" htmlFor="cari">Cari posisi</label>
        <input
          id="cari"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Cari posisi, mis. waiter atau cook"
          className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
        />
        <label className="sr-only" htmlFor="lokasi">Lokasi</label>
        <select id="lokasi" name="lokasi" defaultValue={sp.lokasi ?? ""} className="h-11 rounded-lg border border-border bg-background px-3 text-sm sm:w-48">
          <option value="">Semua lokasi</option>
          {saringan.lokasi.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="departemen">Departemen</label>
        <select id="departemen" name="departemen" defaultValue={sp.departemen ?? ""} className="h-11 rounded-lg border border-border bg-background px-3 text-sm sm:w-52">
          <option value="">Semua departemen</option>
          {saringan.departemen.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <button type="submit" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-on-primary hover:bg-primary-hover">
          <Filter className="h-4 w-4" aria-hidden /> Saring
        </button>
      </form>

      <p className="mt-6 text-sm text-muted" aria-live="polite">
        {data.length} lowongan ditemukan{adaSaringan ? " untuk saringan ini" : ""}.
        {adaSaringan && (
          <>
            {" "}
            <Link href="/lowongan" className="text-primary hover:underline">Hapus saringan</Link>
          </>
        )}
      </p>

      {data.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border p-10 text-center">
          <Briefcase className="mx-auto h-8 w-8 text-muted" aria-hidden />
          <p className="mt-3 font-medium">Belum ada lowongan yang cocok</p>
          <p className="mt-1 text-sm text-muted">
            Buat akun pelamar supaya Anda siap melamar begitu lowongan berikutnya tayang.
          </p>
          <Link href="/karier/daftar" className="mt-5 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-on-primary">
            Buat akun pelamar
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((l) => (
            <KartuLowongan key={l.id} lowongan={l} />
          ))}
        </div>
      )}
    </div>
  );
}
