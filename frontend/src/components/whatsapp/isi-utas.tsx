"use client";

import * as React from "react";
import { isToday, isYesterday } from "date-fns";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatAngka, formatNomorWa, formatTanggal, formatWaktu, tampakLid } from "@/lib/utils";
import { MediaPesan } from "./media-pesan";
import { useArsipBertahap } from "./arsip-bertahap";
import {
  AvatarWa,
  LABEL_TIPE,
  LencanaKaryawan,
  LencanaLid,
  SEGAR_MS,
  judulUtas,
  nomorAsliUtas,
  utasBernama,
  warnaOrang,
} from "./util-wa";
import type { Halaman, PengirimWa, Percakapan, Utas } from "@/lib/types";

/** Jarak dari dasar (px) yang masih dianggap "sedang membaca pesan terbaru". */
const AMBANG_BAWAH = 120;

interface Orang extends PengirimWa {
  /** Pembeda rangkaian dan warna: nomor, LID, atau nama. */
  kunci: string;
}

/** Pengirim pesan grup yang masuk; null bila tidak tercatat. */
const orangDari = (p: Percakapan): Orang | null => {
  // Backend lama belum mengirim `pengirim`: pakai nomor peserta apa adanya.
  if (p.pengirim === undefined) {
    const d = p.participantNumber;
    if (!d) return null;
    const lid = tampakLid(d);
    return { kunci: d, nama: null, nomor: lid ? null : d, lid: lid ? d : null, karyawan: null };
  }
  const s = p.pengirim;
  if (!s) return null;
  const nomor = s.nomor && !tampakLid(s.nomor, s.lid) ? s.nomor : null;
  const nama = s.nama ?? s.karyawan?.name ?? null;
  const kunci = nomor ?? s.lid ?? nama;
  return kunci ? { ...s, nama, nomor, kunci } : null;
};

const labelHari = (nilai: string) => {
  const d = new Date(nilai);
  return isToday(d) ? "Hari ini" : isYesterday(d) ? "Kemarin" : formatTanggal(d, "EEEE, d MMMM yyyy");
};

/**
 * Panel ketiga: isi satu chat. Pesan keluar (dikirim pemegang nomor) di
 * kanan, pesan masuk di kiri. Di grup, nama dan nomor pengirim ditulis pada
 * pesan pertama tiap rangkaian beruntun, dengan warna tetap per orang.
 */
export const IsiUtas = ({
  utas,
  pemegang,
  seluruhIsi,
  onKembali,
}: {
  utas: Utas;
  /** Nama pemegang nomor yang dipantau: pengirim gelembung kanan. */
  pemegang: string;
  seluruhIsi: boolean;
  onKembali: () => void;
}) => {
  const grup = utas.jenis === "grup";
  const judul = judulUtas(utas);
  const bernama = utasBernama(utas);
  const nomorAsli = nomorAsliUtas(utas);
  const gulir = React.useRef<HTMLDivElement>(null);
  const dekatBawah = React.useRef(true);
  // Pesan tertua yang tampil sebelum memuat yang lebih lama, dan jaraknya
  // dari dasar: dipulihkan setelah pesan lama disisipkan di atas.
  const jangkar = React.useRef<{ id: string; jarak: number } | null>(null);

  const pesan = useArsipBertahap<Percakapan, Halaman<Percakapan>>({
    queryKey: ["wa", "utas-pesan", utas.kunci],
    segarMs: SEGAR_MS,
    ambil: async (page, pantau) => {
      const p = new URLSearchParams({ page: String(page), limit: "40", accountId: utas.accountId, contactNumber: utas.contactNumber });
      if (utas.groupJid) p.set("groupJid", utas.groupJid);
      if (pantau) p.set("pantau", "1");
      return (await api.get<Halaman<Percakapan>>(`/whatsapp/conversations?${p}`)).data;
    },
    kunci: (p) => p.id,
    waktu: (p) => new Date(p.timestamp).getTime(),
  });

  // Server mengirim terbaru dulu; percakapan dibaca dari atas ke bawah.
  const baris = React.useMemo(() => {
    const urut = [...pesan.butir].reverse();
    return urut.map((p, i) => {
      const sebelum = urut[i - 1];
      const hariBaru = !sebelum || formatTanggal(sebelum.timestamp, "yyyy-MM-dd") !== formatTanggal(p.timestamp, "yyyy-MM-dd");
      const masukGrup = grup && p.direction !== "outgoing";
      const orang = masukGrup ? orangDari(p) : null;
      // Pengirim yang tidak tercatat ditulis di setiap pesan: bisa saja orang yang berbeda-beda.
      const awalRangkaian =
        masukGrup &&
        (hariBaru || !orang || !sebelum || sebelum.direction === "outgoing" || orangDari(sebelum)?.kunci !== orang.kunci);
      return { p, hariBaru, orang, tulisPengirim: awalRangkaian };
    });
  }, [pesan.butir, grup]);

  const pertama = baris[0]?.p.id;
  const terakhir = baris.at(-1)?.p.id;

  // Saat dibuka dan saat pesan baru masuk: turun ke pesan terbaru, kecuali
  // orang sedang membaca pesan lama. Saat pesan lama disisipkan di atas:
  // posisi baca dipertahankan.
  React.useLayoutEffect(() => {
    const el = gulir.current;
    if (!el || !pertama) return;
    const j = jangkar.current;
    if (j) {
      if (pertama !== j.id) {
        el.scrollTop = el.scrollHeight - j.jarak;
        jangkar.current = null;
      }
      return;
    }
    if (dekatBawah.current) el.scrollTop = el.scrollHeight;
  }, [pertama, terakhir]);

  const muatLama = async () => {
    const el = gulir.current;
    if (el && pertama) jangkar.current = { id: pertama, jarak: el.scrollHeight - el.scrollTop };
    const bertambah = await pesan.muatLagi();
    if (bertambah === 0) jangkar.current = null;
  };

  const total = pesan.terbaru?.pagination.total ?? utas.jumlahPesan;

  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2.5">
        <button type="button" onClick={onKembali} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 md:hidden" aria-label="Kembali ke daftar chat">
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <AvatarWa nama={bernama ? judul : null} grup={grup} kunciWarna={utas.kontak?.nomor ?? utas.kontak?.lid ?? utas.contactNumber} kecil />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5">
            <span className={cn("truncate text-sm font-semibold", !bernama && "text-muted")}>{judul}</span>
            {utas.kontak?.karyawan && <LencanaKaryawan />}
          </p>
          <p className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted">
            {grup ? <span>Grup</span> : nomorAsli ? <span className="tabular-nums">{formatNomorWa(nomorAsli)}</span> : <LencanaLid />}
            <span className="tabular-nums">· {formatAngka(total)} pesan</span>
          </p>
        </div>
      </div>
      <p className="shrink-0 truncate border-b border-border px-3 py-1 text-[11px] text-muted">
        Kanan = dikirim {pemegang}
        {grup ? " · kiri = peserta grup" : ""}
      </p>

      <div
        ref={gulir}
        onScroll={(e) => {
          const el = e.currentTarget;
          dekatBawah.current = el.scrollHeight - el.scrollTop - el.clientHeight < AMBANG_BAWAH;
        }}
        role="log"
        aria-label={`Isi chat ${judul}`}
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-surface-2/50 px-3 py-4 sm:px-6"
      >
        {pesan.adaLagi && (
          <div className="pb-2 text-center">
            <Button variant="ghost" size="sm" onClick={() => void muatLama()} loading={pesan.memuatLagi}>Muat pesan lebih lama</Button>
          </div>
        )}
        {pesan.memuat ? (
          <div className="space-y-3">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className={cn("h-12 w-2/3", i % 2 && "ml-auto")} />)}</div>
        ) : pesan.galat ? (
          <div className="space-y-3 py-10 text-center">
            <p className="text-sm text-muted">Isi chat gagal dimuat.</p>
            <Button size="sm" variant="outline" onClick={pesan.ulangi}>Coba lagi</Button>
          </div>
        ) : baris.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">Belum ada pesan terarsip di chat ini.</p>
        ) : (
          baris.map(({ p, hariBaru, orang, tulisPengirim }) => {
            const keluar = p.direction === "outgoing";
            return (
              <React.Fragment key={p.id}>
                {hariBaru && (
                  <div className="py-2 text-center">
                    <span className="rounded-full bg-surface px-3 py-1 text-[11px] font-medium text-muted shadow-sm">{labelHari(p.timestamp)}</span>
                  </div>
                )}
                <div className={cn("flex", keluar ? "justify-end" : "justify-start", tulisPengirim && !hariBaru && "pt-1.5")}>
                  <div className={cn("min-w-0 max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[70%]", keluar ? "rounded-br-md bg-primary-soft" : "rounded-bl-md bg-surface")}>
                    {tulisPengirim &&
                      (orang ? (
                        // Teks sebaris (bukan flex) supaya lebar gelembung mengikuti isinya dan baru melipat bila perlu.
                        <p className="mb-0.5 text-xs [overflow-wrap:anywhere]">
                          <span className={cn("font-semibold", warnaOrang(orang.kunci).teks)}>
                            {orang.nama ?? (orang.nomor ? formatNomorWa(orang.nomor) : "Tanpa nama")}
                          </span>
                          {orang.nama && orang.nomor && <span className="whitespace-nowrap tabular-nums text-muted"> · {formatNomorWa(orang.nomor)}</span>}
                          {!orang.nomor && <span className="text-muted"> · nomor disembunyikan</span>}
                          {orang.karyawan && (
                            <>
                              {" "}
                              <LencanaKaryawan />
                            </>
                          )}
                        </p>
                      ) : (
                        <p className="mb-0.5 text-xs italic text-muted">Pengirim tidak tercatat</p>
                      ))}
                    {p.messageBody ? (
                      <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{p.messageBody}</p>
                    ) : (
                      !p.mediaTersedia && <p className="italic text-muted">{LABEL_TIPE[p.messageType] ?? p.messageType}</p>
                    )}
                    <MediaPesan pesan={p} bolehBuka={seluruhIsi} />
                    <p className="mt-0.5 text-right text-[10px] tabular-nums text-muted">{formatWaktu(p.timestamp)}</p>
                  </div>
                </div>
              </React.Fragment>
            );
          })
        )}
      </div>
    </>
  );
};
