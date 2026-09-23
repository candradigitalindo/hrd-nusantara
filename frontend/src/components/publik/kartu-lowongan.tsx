import Link from "next/link";
import { ArrowRight, Banknote, Building2, CalendarClock, MapPin, Users } from "lucide-react";
import { formatRupiah, formatTanggal, LABEL_EMPLOYMENT } from "@/lib/utils";
import type { LowonganPublik } from "@/lib/karier-server";

/** Kartu ringkas satu lowongan, dipakai di landing page dan halaman lowongan. */
export const KartuLowongan = ({ lowongan }: { lowongan: LowonganPublik }) => (
  <article className="flex h-full flex-col rounded-2xl border border-border bg-surface p-5 transition-shadow hover:shadow-md">
    <h3 className="text-base font-semibold">
      <Link href={`/lowongan/${lowongan.id}`} className="hover:text-primary">
        {lowongan.title}
      </Link>
    </h3>

    <dl className="mt-3 space-y-1.5 text-sm text-muted">
      {lowongan.position.department && (
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 shrink-0" aria-hidden />
          <dt className="sr-only">Departemen</dt>
          <dd>{lowongan.position.department.name}</dd>
        </div>
      )}
      {lowongan.location && (
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0" aria-hidden />
          <dt className="sr-only">Lokasi</dt>
          <dd>{lowongan.location}</dd>
        </div>
      )}
      {(lowongan.salaryRangeMin || lowongan.salaryRangeMax) && (
        <div className="flex items-center gap-2">
          <Banknote className="h-4 w-4 shrink-0" aria-hidden />
          <dt className="sr-only">Kisaran gaji</dt>
          <dd className="tabular-nums">
            {formatRupiah(lowongan.salaryRangeMin)} – {formatRupiah(lowongan.salaryRangeMax)}
          </dd>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 shrink-0" aria-hidden />
        <dt className="sr-only">Jumlah dibutuhkan</dt>
        <dd>
          {lowongan.openings} posisi{lowongan.employmentType ? ` · ${LABEL_EMPLOYMENT[lowongan.employmentType] ?? lowongan.employmentType}` : ""}
        </dd>
      </div>
      {lowongan.deadline && (
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
          <dt className="sr-only">Batas lamaran</dt>
          <dd>Lamaran ditutup {formatTanggal(lowongan.deadline)}</dd>
        </div>
      )}
    </dl>

    <p className="mt-3 line-clamp-2 text-sm text-muted">{lowongan.description}</p>

    <Link
      href={`/lowongan/${lowongan.id}`}
      className="mt-auto inline-flex items-center gap-1.5 pt-4 text-sm font-medium text-primary hover:underline"
    >
      Lihat rincian & lamar <ArrowRight className="h-4 w-4" aria-hidden />
    </Link>
  </article>
);
