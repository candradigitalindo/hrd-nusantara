import { useSyncExternalStore } from "react";

/**
 * Nomor yang terakhir dibuka di tab Percakapan, diingat per peramban. Pola
 * sama dengan layout/sidebar-store.ts: snapshot server kosong, klien membaca
 * localStorage setelah hidrasi, tanpa setState di dalam effect. Bila
 * penyimpanan diblokir (mode privat), pilihan hanya hidup selama halaman
 * terbuka.
 */
const KUNCI = "hrd_wa_nomor";
const pendengar = new Set<() => void>();
let cache: string | null = null;

const baca = (): string => {
  if (cache !== null) return cache;
  try {
    cache = typeof window === "undefined" ? "" : (window.localStorage.getItem(KUNCI) ?? "");
  } catch {
    cache = "";
  }
  return cache;
};

const berlangganan = (cb: () => void) => {
  pendengar.add(cb);
  return () => {
    pendengar.delete(cb);
  };
};

/** id akun WhatsApp terpilih, "" bila belum ada. */
export const useNomorTerpilih = () => useSyncExternalStore(berlangganan, baca, () => "");

export const pilihNomorWa = (id: string) => {
  cache = id;
  try {
    if (id) window.localStorage.setItem(KUNCI, id);
    else window.localStorage.removeItem(KUNCI);
  } catch {
    // Penyimpanan diblokir: cukup diingat di memori.
  }
  for (const cb of pendengar) cb();
};
