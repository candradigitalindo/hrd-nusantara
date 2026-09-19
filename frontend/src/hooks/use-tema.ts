"use client";

import { useSyncExternalStore } from "react";

/**
 * Tema sebagai external store, bukan state + effect: nilainya hidup di
 * <html data-theme> dan localStorage, React hanya berlangganan. Ini juga
 * menghindari kedipan — server dan klien sama-sama mulai dari "system".
 */
type Tema = "light" | "dark" | "system";

const pendengar = new Set<() => void>();
const beriTahu = () => pendengar.forEach((p) => p());

const bacaTersimpan = (): Tema => {
  try {
    const t = localStorage.getItem("tema");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
};

const terapkan = (tema: Tema) => {
  if (tema === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = tema;
};

const gelapEfektif = (): boolean => {
  const t = bacaTersimpan();
  if (t !== "system") return t === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
};

const subscribe = (cb: () => void) => {
  pendengar.add(cb);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  // Terapkan pilihan tersimpan sekali saat pertama kali ada yang berlangganan.
  terapkan(bacaTersimpan());
  return () => {
    pendengar.delete(cb);
    mq.removeEventListener("change", cb);
  };
};

export const useTema = () => {
  const gelap = useSyncExternalStore(subscribe, gelapEfektif, () => false);
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
