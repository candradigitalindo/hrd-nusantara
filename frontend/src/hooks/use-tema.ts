"use client";

import { useSyncExternalStore } from "react";

/**
 * Tema sebagai external store, bukan state + effect: nilainya hidup di
 * <html data-theme> dan localStorage, React hanya berlangganan.
 *
 * Bawaan TERANG. Preferensi sistem sengaja tidak diikuti: aplikasi ini
 * dipakai di outlet dengan banyak perangkat bersama, dan tema gelap hanya
 * muncul bila pengguna sendiri yang memilihnya lewat tombol di header.
 */
type Tema = "light" | "dark";

const pendengar = new Set<() => void>();
const beriTahu = () => pendengar.forEach((p) => p());

const bacaTersimpan = (): Tema => {
  try {
    return localStorage.getItem("tema") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
};

const terapkan = (tema: Tema) => {
  if (tema === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
};

const subscribe = (cb: () => void) => {
  pendengar.add(cb);
  // Terapkan pilihan tersimpan sekali saat pertama kali ada yang berlangganan.
  terapkan(bacaTersimpan());
  return () => {
    pendengar.delete(cb);
  };
};

export const useTema = () => {
  const gelap = useSyncExternalStore(subscribe, () => bacaTersimpan() === "dark", () => false);
  const ganti = () => {
    const baru: Tema = gelap ? "light" : "dark";
    try {
      localStorage.setItem("tema", baru);
    } catch {
      /* penyimpanan bisa diblokir; tetap terapkan untuk sesi ini */
    }
    terapkan(baru);
    beriTahu();
  };
  return { gelap, ganti };
};
