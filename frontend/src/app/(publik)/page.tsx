import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Award,
  BarChart3,
  Briefcase,
  CalendarCheck,
  CalendarOff,
  ClipboardCheck,
  Fingerprint,
  GraduationCap,
  MapPin,
  Megaphone,
  MonitorCheck,
  Smartphone,
  Wallet,
} from "lucide-react";
import { Faq } from "@/components/publik/faq";
import { KartuLowongan } from "@/components/publik/kartu-lowongan";
import { ALAMAT_SITUS, NAMA_PERUSAHAAN, ambilLowongan } from "@/lib/karier-server";

const JUDUL = "HRD Nusantara — Sistem Kepegawaian & Portal Karier F&B, Resto, dan Hotel";
const RINGKASAN =
  "Presensi wajah dan GPS, cuti, slip gaji, jadwal shift, pelatihan, penilaian kinerja, sampai tes CBT dalam satu sistem. Lihat lowongan terbuka dan lamar langsung lewat portal karier.";

export const metadata: Metadata = {
  title: JUDUL,
  description: RINGKASAN,
  keywords: [
    "lowongan kerja restoran",
    "lowongan hotel",
    "karier F&B",
    "sistem HRD",
    "aplikasi presensi karyawan",
    "portal karier",
    "HRD Nusantara",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "id_ID",
    url: ALAMAT_SITUS,
    siteName: NAMA_PERUSAHAAN,
    title: JUDUL,
    description: RINGKASAN,
    images: [{ url: "/icon.svg", width: 512, height: 512, alt: NAMA_PERUSAHAAN }],
  },
  twitter: { card: "summary", title: JUDUL, description: RINGKASAN, images: ["/icon.svg"] },
};

const FITUR = [
  { ikon: Fingerprint, judul: "Presensi wajah, GPS, dan QR", teks: "Check-in dari ponsel dengan pengenalan wajah, kunci lokasi kerja, dan QR di tiap outlet. Percobaan lokasi palsu ikut tercatat." },
  { ikon: CalendarOff, judul: "Cuti & izin transparan", teks: "Saldo cuti, pengajuan, dan persetujuan berjalan di satu alur. Cuti bersama memotong kuota otomatis." },
  { ikon: Wallet, judul: "Slip gaji digital", teks: "Rincian gaji pokok, lembur, tunjangan, dan potongan bisa dibuka kapan saja di web maupun ponsel." },
  { ikon: CalendarCheck, judul: "Jadwal shift tim", teks: "Jadwal disusun per departemen dan langsung terlihat karyawan, lengkap dengan lokasi kerjanya." },
  { ikon: GraduationCap, judul: "Pelatihan & kompetensi", teks: "Program wajib, jadwal sesi, riwayat pelatihan, sertifikat, dan peta kompetensi per jabatan." },
  { ikon: BarChart3, judul: "Penilaian kinerja 360°", teks: "Siklus penilaian dengan form KPI kustom, umpan balik rekan, dan diskusi hasil." },
  { ikon: MonitorCheck, judul: "Tes CBT daring", teks: "Uji kemampuan karyawan dan seleksi pelamar: dinilai otomatis, berbatas waktu, dengan pengawasan." },
  { ikon: Megaphone, judul: "Pengumuman & chat tim", teks: "Kebijakan baru sampai ke semua orang, lengkap dengan konfirmasi sudah membaca." },
];

const PROSES = [
  { judul: "Kirim lamaran", teks: "Buat akun pelamar, unggah CV, lalu lamar lowongan yang cocok. Satu akun untuk semua lamaran Anda." },
  { judul: "Seleksi berkas", teks: "Tim SDM meninjau CV dan pengalaman Anda. Statusnya terlihat langsung di portal pelamar." },
  { judul: "Tes kemampuan (CBT)", teks: "Sebagian posisi memakai tes daring berbatas waktu yang bisa dikerjakan dari rumah." },
  { judul: "Wawancara", teks: "Jadwal wawancara muncul di portal beserta tempat dan tahapannya." },
  { judul: "Penawaran & bergabung", teks: "Kabar diterima, penawaran, lalu berkas kepegawaian disiapkan sebelum hari pertama." },
];

const TANYA_JAWAB = [
  { tanya: "Apakah melamar di sini dipungut biaya?", jawab: "Tidak. Seluruh proses rekrutmen kami gratis. Kami tidak pernah meminta uang untuk pendaftaran, tes, seragam, maupun penempatan. Abaikan siapa pun yang mengatasnamakan kami dan meminta biaya." },
  { tanya: "Bagaimana cara mengetahui status lamaran saya?", jawab: "Masuk ke portal pelamar dengan email dan kata sandi yang Anda buat saat melamar. Setiap perpindahan tahap — seleksi berkas, tes, wawancara — terlihat di sana beserta tanggalnya." },
  { tanya: "Bisakah saya melamar lebih dari satu posisi?", jawab: "Bisa. Satu akun boleh melamar beberapa lowongan sekaligus, tetapi hanya satu lamaran untuk tiap lowongan yang sama." },
  { tanya: "Berkas apa yang perlu disiapkan?", jawab: "CV dalam format PDF atau DOCX. Anda cukup mengunggahnya sekali; lamaran berikutnya memakai berkas yang sama sampai Anda menggantinya." },
  { tanya: "Saya karyawan. Di mana aplikasinya?", jawab: "Karyawan masuk lewat tombol “Masuk Karyawan” di atas, atau memakai aplikasi Android yang bisa diunduh di halaman Aplikasi." },
  { tanya: "Bagaimana data pribadi saya dijaga?", jawab: "Data sensitif seperti nomor telepon, alamat, dan data biometrik disimpan terenkripsi. Hasil tes dan catatan penilaian hanya bisa dibuka tim SDM, tidak oleh pelamar lain." },
];

/** Landing page publik: etalase sistem sekaligus pintu masuk pelamar. */
export default async function Beranda() {
  const { data: lowongan } = await ambilLowongan();
  const terbaru = lowongan.slice(0, 6);
  const lokasi = [...new Set(lowongan.map((l) => l.location).filter(Boolean))];

  // Data terstruktur: membantu Google mengenali organisasi dan situsnya.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${ALAMAT_SITUS}/#organisasi`,
        name: NAMA_PERUSAHAAN,
        url: ALAMAT_SITUS,
        logo: `${ALAMAT_SITUS}/icon.svg`,
        description: RINGKASAN,
        address: { "@type": "PostalAddress", addressLocality: "Jakarta", addressCountry: "ID" },
        email: "hrd@nbp.co.id",
      },
      {
        "@type": "WebSite",
        "@id": `${ALAMAT_SITUS}/#situs`,
        url: ALAMAT_SITUS,
        name: NAMA_PERUSAHAAN,
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
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:py-20 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-xs font-medium text-primary shadow-sm">
              <Briefcase className="h-3.5 w-3.5" aria-hidden />
              {lowongan.length > 0 ? `${lowongan.length} lowongan sedang dibuka` : "Sistem kepegawaian terpadu"}
            </p>
            <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
              Kelola kepegawaian dan karier di satu tempat
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-muted sm:text-lg">{RINGKASAN}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/lowongan"
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 text-base font-semibold text-on-primary shadow-sm hover:bg-primary-hover"
              >
                Lihat lowongan <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                href="/unduh"
                className="inline-flex h-12 items-center gap-2 rounded-xl border border-border bg-surface px-6 text-base font-semibold hover:bg-surface-2"
              >
                <Smartphone className="h-4 w-4" aria-hidden /> Unduh aplikasi
              </Link>
            </div>
            <dl className="mt-9 grid grid-cols-3 gap-4 border-t border-border pt-6 text-center sm:max-w-md sm:text-left">
              {[
                { k: "Lowongan terbuka", v: String(lowongan.length) },
                { k: "Lokasi kerja", v: String(lokasi.length || 1) },
                { k: "Modul terpakai", v: "12" },
              ].map((s) => (
                <div key={s.k}>
                  <dt className="order-2 text-xs text-muted">{s.k}</dt>
                  <dd className="text-2xl font-bold tabular-nums text-primary">{s.v}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Lowongan terbaru</h2>
            {terbaru.length === 0 ? (
              <p className="mt-4 text-sm text-muted">
                Belum ada lowongan yang dibuka saat ini. Buat akun pelamar supaya siap saat lowongan berikutnya tayang.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {terbaru.slice(0, 3).map((l) => (
                  <li key={l.id}>
                    <Link href={`/lowongan/${l.id}`} className="flex items-start gap-3 rounded-xl p-3 hover:bg-surface-2">
                      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                        <Briefcase className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{l.title}</span>
                        <span className="block truncate text-xs text-muted">
                          {[l.position.department?.name, l.location].filter(Boolean).join(" · ") || "Lihat rincian"}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/lowongan" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              Semua lowongan <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      {/* Fitur */}
      <section id="fitur" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:py-20">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Yang dikerjakan sistem ini</h2>
        <p className="mt-3 max-w-2xl text-muted">
          Dipakai sehari-hari oleh staf dapur, pelayan, housekeeping, sampai manajemen — di web maupun aplikasi Android.
        </p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FITUR.map((f) => (
            <li key={f.judul} className="rounded-2xl border border-border bg-surface p-5">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary">
                <f.ikon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="mt-3 font-semibold">{f.judul}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.teks}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Proses rekrutmen */}
      <section id="proses" className="scroll-mt-20 border-y border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Tahap seleksi, dari lamaran sampai bergabung</h2>
          <p className="mt-3 max-w-2xl text-muted">
            Setiap tahap terlihat di portal pelamar — Anda tidak perlu menebak-nebak sudah sampai mana.
          </p>
          <ol className="mt-8 grid gap-4 md:grid-cols-5">
            {PROSES.map((p, i) => (
              <li key={p.judul} className="relative rounded-2xl border border-border bg-background p-5">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-sm font-bold text-on-primary">{i + 1}</span>
                <h3 className="mt-3 font-semibold">{p.judul}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{p.teks}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Lowongan */}
      {terbaru.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Lowongan yang sedang dibuka</h2>
              <p className="mt-2 text-muted">Lamar langsung dari sini; tidak perlu mengirim email.</p>
            </div>
            <Link href="/lowongan" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              Lihat semua <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {terbaru.map((l) => (
              <KartuLowongan key={l.id} lowongan={l} />
            ))}
          </div>
        </section>
      )}

      {/* FAQ */}
      <section className="border-t border-border bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:py-20 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Pertanyaan yang sering masuk</h2>
            <p className="mt-3 text-muted">
              Belum terjawab? Kirim surel ke{" "}
              <a href="mailto:hrd@nbp.co.id" className="text-primary hover:underline">
                hrd@nbp.co.id
              </a>
              .
            </p>
            <p className="mt-6 flex items-start gap-2 rounded-xl bg-warning-soft p-4 text-sm text-warning">
              <Award className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              Waspada penipuan: rekrutmen kami tidak pernah memungut biaya dalam bentuk apa pun.
            </p>
          </div>
          <Faq butir={TANYA_JAWAB} />
        </div>
      </section>

      {/* Ajakan akhir */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
        <div className="rounded-3xl bg-primary px-6 py-12 text-center text-on-primary sm:px-12">
          <h2 className="text-2xl font-bold sm:text-3xl">Siap bergabung dengan tim kami?</h2>
          <p className="mx-auto mt-3 max-w-xl text-base opacity-90">
            Buat akun pelamar sekali, lalu pantau seluruh proses seleksi Anda dari satu dashboard.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/karier/daftar" className="inline-flex h-12 items-center gap-2 rounded-xl bg-surface px-6 text-base font-semibold text-foreground hover:bg-surface-2">
              <ClipboardCheck className="h-4 w-4" aria-hidden /> Buat akun pelamar
            </Link>
            <Link href="/lowongan" className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/40 px-6 text-base font-semibold hover:bg-white/10">
              <MapPin className="h-4 w-4" aria-hidden /> Telusuri lowongan
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
