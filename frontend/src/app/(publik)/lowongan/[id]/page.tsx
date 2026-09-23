import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Banknote, Building2, CalendarClock, MapPin, Users } from "lucide-react";
import { TeksKaya } from "@/components/ui/editor-teks";
import { formatRupiah, formatTanggal, LABEL_EMPLOYMENT } from "@/lib/utils";
import { ALAMAT_SITUS, NAMA_PERUSAHAAN, ambilLowonganById } from "@/lib/karier-server";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const l = await ambilLowonganById(id);
  if (!l) return { title: "Lowongan tidak ditemukan", robots: { index: false, follow: false } };

  const ringkas = `${l.title}${l.location ? ` di ${l.location}` : ""}. ${l.description}`.slice(0, 160);
  return {
    title: `${l.title}${l.location ? ` — ${l.location}` : ""}`,
    description: ringkas,
    alternates: { canonical: `/lowongan/${l.id}` },
    openGraph: {
      type: "article",
      locale: "id_ID",
      url: `${ALAMAT_SITUS}/lowongan/${l.id}`,
      siteName: NAMA_PERUSAHAAN,
      title: l.title,
      description: ringkas,
    },
    twitter: { card: "summary", title: l.title, description: ringkas },
  };
}

/** Rincian satu lowongan, lengkap dengan data terstruktur JobPosting. */
export default async function HalamanRincianLowongan({ params }: Props) {
  const { id } = await params;
  const l = await ambilLowonganById(id);
  if (!l) notFound();

  // JobPosting schema.org: inilah yang membuat lowongan bisa muncul di
  // Google Jobs, bukan sekadar sebagai halaman biasa.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: l.title,
    description: l.descriptionHtml ?? l.description,
    datePosted: l.createdAt,
    ...(l.deadline ? { validThrough: l.deadline } : {}),
    employmentType:
      l.employmentType === "part_time" ? "PART_TIME" : l.employmentType === "contract" ? "CONTRACTOR" : l.employmentType === "internship" ? "INTERN" : "FULL_TIME",
    hiringOrganization: { "@type": "Organization", name: NAMA_PERUSAHAAN, sameAs: ALAMAT_SITUS, logo: `${ALAMAT_SITUS}/icon.svg` },
    jobLocation: {
      "@type": "Place",
      address: { "@type": "PostalAddress", addressLocality: l.location ?? "Jakarta", addressCountry: "ID" },
    },
    ...(l.salaryRangeMin || l.salaryRangeMax
      ? {
          baseSalary: {
            "@type": "MonetaryAmount",
            currency: "IDR",
            value: {
              "@type": "QuantitativeValue",
              ...(l.salaryRangeMin ? { minValue: l.salaryRangeMin } : {}),
              ...(l.salaryRangeMax ? { maxValue: l.salaryRangeMax } : {}),
              unitText: "MONTH",
            },
          },
        }
      : {}),
    totalJobOpenings: l.openings,
    directApply: true,
    url: `${ALAMAT_SITUS}/lowongan/${l.id}`,
  };

  const rincian = [
    { ikon: Building2, label: "Departemen", nilai: l.position.department?.name ?? l.position.name },
    { ikon: MapPin, label: "Lokasi", nilai: l.location ?? "Menyesuaikan penempatan" },
    { ikon: Users, label: "Dibutuhkan", nilai: `${l.openings} orang${l.employmentType ? ` · ${LABEL_EMPLOYMENT[l.employmentType] ?? l.employmentType}` : ""}` },
    {
      ikon: Banknote,
      label: "Kisaran gaji",
      nilai: l.salaryRangeMin || l.salaryRangeMax ? `${formatRupiah(l.salaryRangeMin)} – ${formatRupiah(l.salaryRangeMax)}` : "Dibicarakan saat wawancara",
    },
    { ikon: CalendarClock, label: "Batas lamaran", nilai: l.deadline ? formatTanggal(l.deadline) : "Sampai posisi terisi" },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <Link href="/lowongan" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Semua lowongan
      </Link>

      <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">{l.title}</h1>

      <dl className="mt-6 grid gap-3 rounded-2xl border border-border bg-surface p-5 sm:grid-cols-2">
        {rincian.map((r) => (
          <div key={r.label} className="flex items-start gap-3">
            <r.ikon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
            <div>
              <dt className="text-xs text-muted">{r.label}</dt>
              <dd className="text-sm font-medium">{r.nilai}</dd>
            </div>
          </div>
        ))}
      </dl>

      <div className="mt-8 space-y-8">
        <section>
          <h2 className="text-lg font-semibold">Deskripsi pekerjaan</h2>
          <TeksKaya html={l.descriptionHtml} teks={l.description} className="mt-2 text-[15px] leading-relaxed" />
        </section>
        <section>
          <h2 className="text-lg font-semibold">Persyaratan</h2>
          <TeksKaya html={l.requirementsHtml} teks={l.requirements} className="mt-2 text-[15px] leading-relaxed" />
        </section>
      </div>

      <div className="mt-10 rounded-2xl border border-border bg-primary-soft p-6 text-center">
        <p className="font-semibold">Tertarik dengan posisi ini?</p>
        <p className="mt-1 text-sm text-muted">Lamar lewat portal pelamar, dan pantau sendiri status seleksinya.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Link
            href={`/karier/daftar?lowongan=${l.id}`}
            className="inline-flex h-12 items-center rounded-xl bg-primary px-6 text-base font-semibold text-on-primary hover:bg-primary-hover"
          >
            Lamar sekarang
          </Link>
          <Link
            href={`/karier/masuk?kembali=${encodeURIComponent(`/karier/dashboard?lamar=${l.id}`)}`}
            className="inline-flex h-12 items-center rounded-xl border border-border bg-surface px-6 text-base font-semibold hover:bg-surface-2"
          >
            Sudah punya akun
          </Link>
        </div>
      </div>
    </div>
  );
}
