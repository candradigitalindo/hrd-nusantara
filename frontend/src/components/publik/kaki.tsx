import Link from "next/link";
import { Logo } from "@/components/ui/logo";

/** Kaki halaman publik. Tautannya sengaja sedikit: yang benar-benar dicari orang. */
export const KakiPublik = ({ nama }: { nama: string }) => (
  <footer className="border-t border-border bg-surface">
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
      <div className="sm:col-span-2 lg:col-span-1">
        <div className="flex items-center gap-2.5">
          <Logo className="h-9 w-9" />
          <span className="font-bold">{nama}</span>
        </div>
        <p className="mt-3 max-w-xs text-sm text-muted">
          Sistem kepegawaian untuk industri F&amp;B, restoran, dan hotel: presensi, cuti, penggajian, pelatihan, sampai rekrutmen.
        </p>
      </div>

      <nav aria-label="Karier">
        <h2 className="text-sm font-semibold">Karier</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted">
          <li><Link href="/lowongan" className="hover:text-foreground">Lowongan terbuka</Link></li>
          <li><Link href="/karier/daftar" className="hover:text-foreground">Daftar akun pelamar</Link></li>
          <li><Link href="/karier/masuk" className="hover:text-foreground">Masuk portal pelamar</Link></li>
          <li><Link href="/#proses" className="hover:text-foreground">Tahap seleksi</Link></li>
        </ul>
      </nav>

      <nav aria-label="Karyawan">
        <h2 className="text-sm font-semibold">Karyawan</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted">
          <li><Link href="/login" className="hover:text-foreground">Masuk aplikasi web</Link></li>
          <li><Link href="/unduh" className="hover:text-foreground">Unduh aplikasi Android</Link></li>
          <li><Link href="/#fitur" className="hover:text-foreground">Fitur untuk karyawan</Link></li>
        </ul>
      </nav>

      <div>
        <h2 className="text-sm font-semibold">Kontak</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted">
          <li>Bagian SDM</li>
          <li><a href="mailto:hrd@nbp.co.id" className="hover:text-foreground">hrd@nbp.co.id</a></li>
          <li>Jakarta, Indonesia</li>
        </ul>
      </div>
    </div>

    <div className="border-t border-border">
      <p className="mx-auto max-w-6xl px-4 py-4 text-center text-xs text-muted">
        © {new Date().getFullYear()} {nama}. Seluruh lowongan yang tayang di situs ini gratis — kami tidak pernah memungut biaya apa pun dari pelamar.
      </p>
    </div>
  </footer>
);
