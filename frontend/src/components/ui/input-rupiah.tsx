"use client";

import * as React from "react";
import { Input } from "./input";
import { cn } from "@/lib/utils";

/**
 * Isian nominal rupiah.
 *
 * `<input type="number">` menampilkan 5000000 tanpa pemisah apa pun, dan satu
 * nol kelebihan tidak terlihat sampai gajinya terlanjur sepuluh kali lipat.
 * Di sini yang tampil selalu berpemisah ribuan dengan awalan Rp, sedangkan
 * yang keluar tetap angka polos — jadi kode pemanggil tidak perlu berubah.
 *
 * Dipakai lewat Controller react-hook-form:
 *   <Controller control={f.control} name="baseAmount"
 *     render={({ field }) => <InputRupiah {...field} />} />
 */
export const InputRupiah = React.forwardRef<
  HTMLInputElement,
  {
    value: string | number | null | undefined;
    onChange: (nilai: string) => void;
    onBlur?: () => void;
    name?: string;
    disabled?: boolean;
    placeholder?: string;
    className?: string;
    "aria-invalid"?: boolean;
  }
>(function InputRupiah({ value, onChange, className, placeholder = "0", ...props }, ref) {
  // Sumber kebenarannya tetap angka; tampilannya diturunkan tiap render
  // supaya nilai dari luar (reset formulir, sunting) ikut terformat.
  const angka = String(value ?? "").replace(/\D/g, "");
  const tampil = angka ? new Intl.NumberFormat("id-ID").format(Number(angka)) : "";

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted" aria-hidden>
        Rp
      </span>
      <Input
        ref={ref}
        inputMode="numeric"
        // Angka murni: pemisah ribuan dipasang di sini, dan tanda minus tidak
        // berlaku untuk nominal di aplikasi ini.
        value={tampil}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 15))}
        placeholder={placeholder}
        className={cn("pl-9 tabular-nums", className)}
        {...props}
      />
    </div>
  );
});
