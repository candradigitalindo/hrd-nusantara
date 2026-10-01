"use client";

import * as React from "react";
import { keepPreviousData, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { notifikasi } from "@/hooks/use-notifikasi";
import type { Paginasi } from "@/lib/types";

interface HalamanDasar<T> {
  data: T[];
  pagination: Paginasi;
}

/** Isi cache satu daftar: semua butir yang sudah terlihat, terbaru dulu. */
interface Tumpukan<T, H> {
  butir: T[];
  /** Halaman terjauh yang sudah dimuat (1 = hanya halaman terbaru). */
  halaman: number;
  /** Respons halaman pertama yang paling akhir: total, jumlah halaman, angka per jenis. */
  terbaru: H;
}

/**
 * Daftar arsip yang dipantau: hanya halaman pertama (terbaru) yang
 * disegarkan berkala; halaman yang lebih lama dimuat atas permintaan lalu
 * disimpan. Butir digabung per kunci, jadi butir yang tergeser keluar dari
 * halaman pertama oleh pesan baru tidak hilang dari layar.
 *
 * Audit: permintaan pertama untuk sebuah kunci (orang membuka chat, mengganti
 * nomor, saringan, atau pencarian) dan permintaan halaman berikutnya dikirim
 * tanpa `pantau`, sehingga tercatat di jejak audit. Penyegaran berkala
 * sesudahnya membawa `pantau=1` supaya audit tidak bertambah tiap 15 detik.
 */
export const useArsipBertahap = <T, H extends HalamanDasar<T>>({
  queryKey,
  ambil,
  kunci,
  waktu,
  aktif = true,
  segarMs,
}: {
  queryKey: QueryKey;
  ambil: (page: number, pantau: boolean) => Promise<H>;
  kunci: (butir: T) => string;
  /** Waktu butir dalam milidetik, untuk mengurutkan terbaru dulu. */
  waktu: (butir: T) => number;
  aktif?: boolean;
  segarMs: number;
}) => {
  const qc = useQueryClient();
  const kunciTerakhir = React.useRef<string | null>(null);
  const [memuatLagi, setMemuatLagi] = React.useState(false);

  const urutkan = (daftar: T[]) => [...daftar].sort((a, b) => waktu(b) - waktu(a));

  const gabungTerbaru = (lama: Tumpukan<T, H> | undefined, h: H): Tumpukan<T, H> => {
    const awal = { butir: urutkan(h.data), halaman: 1, terbaru: h };
    // Halaman pertama yang tidak penuh berarti seluruh isinya ada di situ.
    if (!lama || h.data.length < h.pagination.limit) return awal;
    const segar = new Set(h.data.map(kunci));
    // Lebih dari satu halaman yang baru sejak penyegaran terakhir: yang lama
    // dibuang, supaya tidak ada celah tak terlihat di antara keduanya.
    if (!lama.butir.some((b) => segar.has(kunci(b)))) return awal;
    // Butir lama yang lebih baru dari batas halaman pertama tetapi tidak ada
    // di dalamnya sudah tidak berlaku (digabung, pindah saringan): dibuang.
    const batas = Math.min(...h.data.map(waktu));
    const sisa = lama.butir.filter((b) => !segar.has(kunci(b)) && waktu(b) <= batas);
    return { butir: urutkan([...h.data, ...sisa]), halaman: lama.halaman, terbaru: h };
  };

  const query = useQuery({
    queryKey,
    enabled: aktif,
    refetchInterval: segarMs,
    // Saat saringan atau pencarian berganti, daftar sebelumnya tetap tampil
    // (diredupkan) sampai hasil baru tiba, bukan berkedip kosong.
    placeholderData: keepPreviousData,
    queryFn: async ({ queryKey: k }) => {
      const id = JSON.stringify(k);
      const pantau = kunciTerakhir.current === id;
      kunciTerakhir.current = id;
      const h = await ambil(1, pantau);
      // Dibaca sesudah menunggu: halaman lama yang dimuat sementara itu ikut.
      return gabungTerbaru(qc.getQueryData<Tumpukan<T, H>>(k), h);
    },
  });

  /** Memuat halaman berikutnya; mengembalikan jumlah butir yang benar-benar baru. */
  const muatLagi = async (): Promise<number> => {
    const sekarang = qc.getQueryData<Tumpukan<T, H>>(queryKey);
    if (!sekarang || memuatLagi) return 0;
    const berikut = sekarang.halaman + 1;
    setMemuatLagi(true);
    try {
      const h = await ambil(berikut, false);
      let bertambah = 0;
      qc.setQueryData<Tumpukan<T, H>>(queryKey, (l) => {
        if (!l) return l;
        const ada = new Set(l.butir.map(kunci));
        const tambahan = h.data.filter((b) => !ada.has(kunci(b)));
        bertambah = tambahan.length;
        return { ...l, butir: urutkan([...l.butir, ...tambahan]), halaman: Math.max(l.halaman, berikut) };
      });
      return bertambah;
    } catch (e) {
      notifikasi.galat(e, "Gagal memuat yang lebih lama");
      return 0;
    } finally {
      setMemuatLagi(false);
    }
  };

  const data = query.data;
  return {
    butir: data?.butir ?? [],
    terbaru: data?.terbaru,
    /** Belum ada data sama sekali untuk ditampilkan. */
    memuat: !data && (query.isLoading || !aktif),
    galat: !data && query.isError,
    /** Data yang tampil milik saringan sebelumnya; hasil baru sedang diambil. */
    sementara: query.isPlaceholderData,
    adaLagi: Boolean(data && !query.isPlaceholderData && data.halaman < data.terbaru.pagination.totalPages),
    memuatLagi,
    muatLagi,
    ulangi: () => void query.refetch(),
  };
};
