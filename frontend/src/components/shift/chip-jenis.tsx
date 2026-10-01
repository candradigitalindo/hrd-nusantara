import { cn } from "@/lib/utils";
import type { JenisShiftRingkas } from "@/lib/types";
import { warnaJenis } from "./util-shift";

/**
 * Penanda jenis shift: kode pendek di atas warna jenisnya. Kode dipakai
 * karena sel roster sempit; nama lengkapnya ikut sebagai title.
 */
export const ChipJenis = ({ jenis, lengkap, className }: { jenis: JenisShiftRingkas; lengkap?: boolean; className?: string }) => (
  <span
    className={cn("inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold leading-tight", warnaJenis(jenis.color).chip, className)}
    title={jenis.name}
  >
    <span className="truncate">{lengkap ? jenis.name : (jenis.code || jenis.name)}</span>
  </span>
);

/** Bulatan warna kecil, untuk daftar yang sudah menulis nama jenisnya. */
export const TitikWarna = ({ warna, className }: { warna: string; className?: string }) => (
  <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", warnaJenis(warna).titik, className)} aria-hidden />
);
