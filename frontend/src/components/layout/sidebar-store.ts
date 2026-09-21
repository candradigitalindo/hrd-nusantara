/**
 * Lipatan kategori sidebar yang diingat per browser. Disimpan di localStorage
 * lewat store kecil agar bisa dibaca dengan useSyncExternalStore: snapshot
 * server kosong (semua terlipat), klien membaca simpanannya setelah hidrasi
 * tanpa memicu setState di dalam effect.
 */
const KUNCI = "hrd_sidebar_terbuka";
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

export const berlanggananSidebar = (cb: () => void) => {
  pendengar.add(cb);
  return () => {
    pendengar.delete(cb);
  };
};

/** Snapshot berupa string (stabil untuk perbandingan): id kategori dipisah koma. */
export const snapshotSidebar = () => baca();
export const snapshotSidebarServer = () => "";

export const kategoriTerbuka = (snapshot: string) => new Set(snapshot.split(",").filter(Boolean));

export const ubahLipatan = (id: string, buka: boolean) => {
  const set = kategoriTerbuka(baca());
  if (buka) set.add(id);
  else set.delete(id);
  cache = [...set].join(",");
  try {
    window.localStorage.setItem(KUNCI, cache);
  } catch {
    // Penyimpanan diblokir (mode privat): lipatan hanya hidup selama sesi.
  }
  for (const cb of pendengar) cb();
};
