import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarCheck,
  ClipboardList,
  FileText,
  GraduationCap,
  HeartHandshake,
  IdCard,
  MessageSquareWarning,
  ScrollText,
  Search,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Faq } from "@/components/publik/faq";
import { KartuLowongan } from "@/components/publik/kartu-lowongan";
import { ALAMAT_SITUS, NAMA_PERUSAHAAN, ambilLowongan } from "@/lib/karier-server";

const JUDUL = "Karier & Lowongan Kerja — Restoran dan Hotel";
const RINGKASAN =
  "Lowongan kerja terbaru di jaringan restoran dan hotel kami: waiter, kitchen, housekeeping, sampai posisi manajemen. Lamar gratis lewat portal karier dan pantau sendiri status seleksi Anda.";

export const metadata: Metadata = {
  title: JUDUL,
  description: RINGKASAN,
  keywords: [
    "lowongan kerja restoran",
    "lowongan kerja hotel",
    "loker F&B",
    "karier restoran",
    "lowongan waiter",
    "lowongan kitchen",
    "lowongan housekeeping",
    "lamaran kerja online",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "id_ID",
    url: ALAMAT_SITUS,
    siteName: NAMA_PERUSAHAAN,
    title: `${JUDUL} · ${NAMA_PERUSAHAAN}`,
    description: RINGKASAN,
    images: [{ url: "/icon.svg", width: 512, height: 512, alt: NAMA_PERUSAHAAN }],
  },
  twitter: { card: "summary", title: JUDUL, description: RINGKASAN, images: ["/icon.svg"] },
};

/**
 * Alasan bergabung yang semuanya bisa dibuktikan dari cara kerja perusahaan
 * sehari-hari — bukan janji yang tidak bisa ditagih pelamar di kemudian hari.
 */
const ALASAN = [
  {
    ikon: CalendarCheck,
    judul: "Jadwal shift diumumkan di muka",
    teks: "Jadwal disusun per departemen dan bisa dilihat karyawan dari ponselnya, bukan ditempel mendadak di papan.",
  },
  {
    ikon: Wallet,
    judul: "Slip gaji rinci tiap periode",
    teks: "Gaji pokok, lembur, tunjangan, dan potongan tercantum satu per satu, bisa dibuka kapan saja.",
  },
  {
    ikon: GraduationCap,
    judul: "Pelatihan yang terjadwal",
    teks: "Higiene, keselamatan kerja, dan SOP pelayanan diberikan rutin — lengkap dengan catatan sertifikatnya.",
  },
  {
    ikon: TrendingUp,
    judul: "Penilaian kinerja yang jelas kriterianya",
    teks: "Penilaian berkala memakai indikator yang diketahui sejak awal, bukan penilaian yang muncul tiba-tiba.",
  },
  {
    ikon: ScrollText,
    judul: "Cuti dan izin yang transparan",
    teks: "Sisa cuti terlihat sendiri oleh karyawan, dan pengajuannya berjalan lewat satu alur yang tercatat.",
  },
  {
    ikon: MessageSquareWarning,
    judul: "Jalur keluhan yang aman",
    teks: "Keluhan bisa disampaikan lewat jalur resmi dan hanya dibaca tim SDM — tidak oleh orang yang dikeluhkan.",
  },
];

const PROSES = [
  { judul: "Kirim lamaran", teks: "Buat akun pelamar, unggah CV, lalu lamar posisi yang cocok. Satu akun untuk semua lamaran Anda." },
  { judul: "Seleksi berkas", teks: "Tim SDM meninjau pengalaman dan kecocokan Anda dengan posisinya. Statusnya langsung terlihat di portal." },
  { judul: "Tes kemampuan", teks: "Sebagian posisi memakai tes daring berbatas waktu yang bisa dikerjakan dari rumah." },
  { judul: "Wawancara", teks: "Jadwal, tempat, dan tahapan wawancara muncul di portal — tidak perlu menunggu kabar lewat telepon." },
  { judul: "Penawaran & bergabung", teks: "Kabar diterima, penawaran, lalu berkas kepegawaian disiapkan sebelum hari pertama Anda." },
];

const SIAPKAN = [
  { ikon: FileText, judul: "CV terbaru", teks: "Format PDF atau DOCX. Cukup diunggah sekali; lamaran berikutnya memakai berkas yang sama." },
  { ikon: IdCard, judul: "Data diri", teks: "Nama sesuai KTP, nomor HP aktif yang terhubung WhatsApp, dan alamat email yang Anda pakai sehari-hari." },
  { ikon: ClipboardList, judul: "Riwayat pengalaman", teks: "Nama tempat kerja, posisi, dan lama bekerja. Belum berpengalaman pun tetap kami pertimbangkan untuk posisi tertentu." },
];

const TANYA_JAWAB = [
  {
    tanya: "Apakah melamar di sini dipungut biaya?",
    jawab:
      "Tidak, dan tidak akan pernah. Seluruh proses rekrutmen kami gratis: tidak ada biaya pendaftaran, tes, seragam, maupun penempatan. Bila ada yang mengatasnamakan kami dan meminta uang, itu penipuan — laporkan ke hrd@nbp.co.id.",
  },
  {
    tanya: "Bagaimana cara mengetahui status lamaran saya?",
    jawab:
      "Masuk ke portal pelamar dengan email dan kata sandi yang Anda buat saat melamar. Setiap perpindahan tahap — seleksi berkas, tes, wawancara — terlihat di sana beserta tanggalnya, jadi Anda tidak perlu menebak-nebak.",
  },
  {
    tanya: "Berapa lama proses seleksinya?",
    jawab:
      "Bergantung posisi dan jumlah pelamar. Yang pasti, setiap perubahan tahap langsung tercatat di portal Anda, dan undangan wawancara selalu disertai tanggal dan tempatnya.",
  },
  {
    tanya: "Bisakah saya melamar lebih dari satu posisi?",
    jawab: "Bisa. Satu akun boleh melamar beberapa lowongan sekaligus, tetapi hanya satu lamaran untuk tiap lowongan yang sama.",
  },
  {
    tanya: "Saya belum punya pengalaman kerja. Boleh melamar?",
    jawab:
      "Boleh. Sebagian posisi memang menuntut pengalaman, tetapi ada pula yang dibuka untuk pemula dan dilatih dari awal. Syarat tiap posisi ditulis apa adanya di halaman lowongannya.",
  },
  {
    tanya: "Bagaimana data pribadi saya diperlakukan?",
    jawab:
      "Data lamaran Anda hanya dipakai untuk proses seleksi dan hanya bisa dibuka tim SDM. Nomor telepon dan alamat disimpan terenkripsi, dan pelamar lain tidak pernah bisa melihat data Anda.",
  },
];

/** Halaman karier untuk calon pelamar: lowongan, cara melamar, dan apa yang menanti. */
export default async function Beranda() {
  const { data: lowongan, saringan } = await ambilLowongan();
  const sorotan = lowongan.slice(0, 6);

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${ALAMAT_SITUS}/#organisasi`,
        name: NAMA_PERUSAHAAN,
        url: ALAMAT_SITUS,
        logo: `${ALAMAT_SITUS}/icon.svg`,
        description: "Jaringan restoran dan hotel di Indonesia.",
        address: { "@type": "PostalAddress", addressLocality: "Jakarta", addressCountry: "ID" },
        email: "hrd@nbp.co.id",
      },
      {
        "@type": "WebSite",
        "@id": `${ALAMAT_SITUS}/#situs`,
        url: ALAMAT_SITUS,
        name: `Karier ${NAMA_PERUSAHAAN}`,
        inLanguage: "id-ID",
        publisher: { "@id": `${ALAMAT_SITUS}/#organisasi` },
      },
      {
        "@type": "FAQPage",
        "@id": `${ALAMAT_SITUS}/#faq`,
        mainEntity: TANYA_JAWAB.map((t) => ({
          "@type": "Question",
          name: t.tanya,
          acceptedAnswer: { "@type": "Answer", text: t.jawab },
        })),
      },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Hero */}
      <section className="border-b border-border bg-gradient-to-b from-primary-soft/60 to-background">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-xs font-medium text-primary shadow-sm">
              <Building2 className="h-3.5 w-3.5" aria-hidden />
              {lowongan.length > 0
                ? `${lowongan.length} lowongan sedang dibuka${saringan.lokasi.length > 1 ? ` di ${saringan.lokasi.length} lokasi` : ""}`
                : "Belum ada lowongan dibuka saat ini"}
            </p>
            <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
              Bangun karier Anda di dapur, restoran, dan hotel kami
            </h1>
            <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
              Kami mencari orang yang senang melayani tamu dan mau tumbuh bersama. Lamar gratis, lalu pantau sendiri
              setiap tahap seleksinya dari satu portal.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/lowongan"
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 text-base font-semibold text-on-primary shadow-sm hover:bg-primary-hover"
              >
                <Search className="h-4 w-4" aria-hidden /> Lihat lowongan
              </Link>
              <Link
                href="/karier/daftar"
                className="inline-flex h-12 items-center gap-2 rounded-xl border border-border bg-surface px-6 text-base font-semibold hover:bg-surface-2"
              >
                Buat akun pelamar
              </Link>
            </div>
            <p className="mt-4 flex items-center gap-2 text-sm text-muted">
              <HeartHandshake className="h-4 w-4 shrink-0" aria-hidden />
              Gratis, tanpa biaya apa pun, dari melamar sampai diterima.
            </p>
          </div>
        </div>
      </section>

      {/* Lowongan */}
      <section id="lowongan" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:py-20">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Lowongan yang sedang dibuka</h2>
            <p className="mt-2 text-muted">Lamar langsung dari sini — tidak perlu mengirim email atau datang ke kantor.</p>
          </div>
          {lowongan.length > 0 && (
            <Link href="/lowongan" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              Semua lowongan <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
        </div>

        {sorotan.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-border p-10 text-center">
            <p className="font-medium">Belum ada lowongan yang dibuka saat ini</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              Buat akun pelamar sekarang dan unggah CV Anda. Begitu lowongan berikutnya tayang, Anda tinggal menekan
              tombol lamar — tidak perlu mengisi apa pun dari awal lagi.
            </p>
            <Link
              href="/karier/daftar"
              className="mt-5 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-on-primary"
            >
              Buat akun pelamar
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sorotan.map((l) => (
              <KartuLowongan key={l.id} lowongan={l} />
            ))}
          </div>
        )}
      </section>

      {/* Kenapa bergabung */}
      <section id="kenapa" className="scroll-mt-20 border-y border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Bekerja di sini, seperti apa?</h2>
          <p className="mt-3 max-w-2xl text-muted">
            Enam hal di bawah ini bukan janji — begitulah cara kami menjalankan operasional sehari-hari.
          </p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ALASAN.map((a) => (
              <li key={a.judul} className="rounded-2xl border border-border bg-background p-5">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary">
                  <a.ikon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="mt-3 font-semibold">{a.judul}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{a.teks}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Proses seleksi */}
      <section id="proses" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:py-20">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Tahap seleksi, dari lamaran sampai bergabung</h2>
        <p className="mt-3 max-w-2xl text-muted">
          Setiap tahap terlihat di portal pelamar Anda, lengkap dengan tanggalnya.
        </p>
        <ol className="mt-8 grid gap-4 md:grid-cols-5">
          {PROSES.map((p, i) => (
            <li key={p.judul} className="rounded-2xl border border-border bg-surface p-5">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-sm font-bold text-on-primary">{i + 1}</span>
              <h3 className="mt-3 font-semibold">{p.judul}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{p.teks}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Yang perlu disiapkan */}
      <section className="border-y border-border bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:py-20 lg:grid-cols-[1fr_1.3fr] lg:items-start">
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Yang perlu Anda siapkan</h2>
            <p className="mt-3 text-muted">
              Tiga hal ini cukup untuk mulai melamar. Sisanya kami tanyakan pada tahap berikutnya.
            </p>
            <Link
              href="/karier/daftar"
              className="mt-6 inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 text-base font-semibold text-on-primary hover:bg-primary-hover"
            >
              Mulai melamar <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            {SIAPKAN.map((s) => (
              <li key={s.judul} className="flex gap-4 rounded-2xl border border-border bg-background p-5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                  <s.ikon className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <h3 className="font-semibold">{s.judul}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{s.teks}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Peringatan penipuan */}
      <section className="mx-auto max-w-6xl px-4 pt-14 sm:pt-20">
        <div className="flex flex-col gap-4 rounded-2xl border border-warning/40 bg-warning-soft p-6 sm:flex-row sm:items-start">
          <AlertTriangle className="h-6 w-6 shrink-0 text-warning" aria-hidden />
          <div>
            <h2 className="font-semibold text-warning">Rekrutmen kami tidak pernah memungut biaya</h2>
            <p className="mt-1.5 text-sm leading-relaxed">
              Tidak ada biaya pendaftaran, tes, seragam, transportasi, maupun “uang jaminan”. Kami juga tidak pernah
              meminta transfer ke rekening pribadi atau meminta dokumen asli disimpan pihak lain. Bila menemukan hal
              seperti itu atas nama kami, hentikan dan laporkan ke{" "}
              <a href="mailto:hrd@nbp.co.id" className="font-medium underline">
                hrd@nbp.co.id
              </a>
              .
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:py-20">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Pertanyaan yang sering masuk</h2>
            <p className="mt-3 text-muted">
              Belum terjawab? Kirim surel ke{" "}
              <a href="mailto:hrd@nbp.co.id" className="text-primary hover:underline">
                hrd@nbp.co.id
              </a>{" "}
              dan sebutkan posisi yang Anda minati.
            </p>
          </div>
          <Faq butir={TANYA_JAWAB} />
        </div>
      </section>

      {/* Untuk karyawan yang sudah bergabung */}
      <section className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8">
          <p className="text-sm text-muted">
            Sudah bekerja di sini? Presensi, slip gaji, dan cuti ada di aplikasi karyawan.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/login" className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-surface-2">
              Masuk aplikasi karyawan
            </Link>
            <Link href="/unduh" className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-surface-2">
              Unduh aplikasi Android
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
