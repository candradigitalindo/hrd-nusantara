"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { formatDurasiPanjang, formatJam, type Linimasa, type Segmen } from "@/lib/linimasa";

const LABEL_JAM = ["00", "06", "12", "18", "24"];

const judulBlok = (s: Segmen) => {
  const rentang = `${formatJam(s.mulai)}–${s.berlangsung ? "sekarang" : formatJam(s.selesai, true)}`;
  if (s.jenis === "singgah") return `${s.urutan}. ${s.tempat.nama} · ${rentang}`;
  if (s.jenis === "perjalanan") return `Perjalanan · ${rentang}`;
  if (s.jenis === "jeda") return `Tidak ada data · ${rentang}`;
  return `Terlihat · ${rentang}`;
};

/**
 * Pita 24 jam: blok singgah (warna sama dengan penanda peta), batang tipis
 * perjalanan, arsiran jeda, kurung jam presensi di atasnya, dan garis
 * "sekarang" untuk hari ini. Klik blok = pilih segmennya. Pita tidak masuk
 * urutan Tab — daftar linimasa di bawahnya adalah jalur keyboard-nya.
 */
export default function PitaHari({
  linimasa,
  dipilihId,
  onPilih,
  onSorot,
}: {
  linimasa: Linimasa;
  dipilihId: string | null;
  onPilih: (id: string) => void;
  /** Arahkan penunjuk ke blok = sorot segmennya di peta tanpa menggeser kamera. */
  onSorot?: (id: string | null) => void;
}) {
  const { awalHari, akhirHari, ringkasan } = linimasa;
  const rentang = akhirHari - awalHari;
  const pos = (t: number) => ((Math.min(Math.max(t, awalHari), akhirHari) - awalHari) / rentang) * 100;
  const gaya = (a: number, b: number): React.CSSProperties => ({ left: `${pos(a)}%`, width: `max(2px, ${pos(b) - pos(a)}%)` });

  const dipilih = linimasa.segmen.find((s) => s.id === dipilihId) ?? null;
  const palsu = linimasa.disaring.filter((d) => d.alasan === "palsu").slice(0, 40);
  const jp = ringkasan.jamPresensi;
  const ada = {
    kerja: linimasa.segmen.some((s) => s.jenis === "singgah" && s.tempat.jenis === "lokasi_kerja"),
    lain: linimasa.segmen.some((s) => s.jenis === "singgah" && s.tempat.jenis === "lain"),
    jalan: linimasa.segmen.some((s) => s.jenis === "perjalanan"),
    jeda: linimasa.segmen.some((s) => s.jenis === "jeda"),
  };
  const ringkas = `Diam ${formatDurasiPanjang(ringkasan.diamMs)}, bergerak ${formatDurasiPanjang(ringkasan.bergerakMs)}, tanpa data ${formatDurasiPanjang(ringkasan.tanpaDataMs)}`;

  return (
    <div>
      <div className="relative pt-3.5" role="img" aria-label={`Pita 24 jam. ${ringkas}${jp ? `. Jam presensi ${formatJam(jp.mulai)} sampai ${jp.terbuka ? "sekarang" : formatJam(jp.selesai)}` : ""}`}>
        {jp && (
          <span
            className={cn("absolute top-0.5 h-2.5 rounded-t-[4px] border-x-2 border-t-2 border-jenis-violet", jp.terbuka && "rounded-tr-none border-r-0")}
            style={gaya(jp.mulai, jp.selesai)}
            title={`Jam presensi ${formatJam(jp.mulai)}–${jp.terbuka ? "belum check-out" : formatJam(jp.selesai)}`}
            aria-hidden
          />
        )}
        <div className="relative h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          {linimasa.segmen.map((s) => {
            const umum = {
              title: judulBlok(s),
              onClick: () => onPilih(s.id),
              onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && onSorot?.(s.id),
              onPointerLeave: (e: React.PointerEvent) => e.pointerType === "mouse" && onSorot?.(null),
              style: gaya(s.mulai, s.selesai),
            };
            if (s.jenis === "singgah") {
              const lama = s.selesai - s.mulai || 1;
              return (
                <span key={s.id} {...umum} className={cn("absolute inset-y-0 cursor-pointer", s.tempat.jenis === "lokasi_kerja" ? "bg-primary" : "bg-secondary")}>
                  {s.jedaDalam.map((j) => (
                    <span
                      key={j.mulai}
                      className="arsir-dalam absolute inset-y-0"
                      style={{ left: `${((j.mulai - s.mulai) / lama) * 100}%`, width: `${((j.selesai - j.mulai) / lama) * 100}%` }}
                    />
                  ))}
                </span>
              );
            }
            if (s.jenis === "perjalanan") {
              return (
                <span key={s.id} {...umum} className="absolute inset-y-0 cursor-pointer">
                  <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-peta-jalur" />
                </span>
              );
            }
            if (s.jenis === "jeda") {
              return <span key={s.id} {...umum} className={cn("arsir-jeda absolute inset-y-0 cursor-pointer", s.luarJamPantau && "opacity-50")} />;
            }
            return <span key={s.id} {...umum} className="absolute inset-y-0 cursor-pointer bg-foreground" />;
          })}
        </div>
        {dipilih && (
          <span
            className="pointer-events-none absolute top-[11px] h-[18px] rounded-[6px] border-2 border-foreground"
            style={{ left: `calc(${pos(dipilih.mulai)}% - 2px)`, width: `calc(max(2px, ${pos(dipilih.selesai) - pos(dipilih.mulai)}%) + 4px)` }}
            aria-hidden
          />
        )}
        {palsu.map((d) => (
          <span
            key={d.id}
            className="pointer-events-none absolute top-[9px] h-2 w-2 -translate-x-1/2 rotate-45 rounded-[2px] bg-danger ring-2 ring-surface"
            style={{ left: `${pos(d.t)}%` }}
            title={`Lokasi palsu ${formatJam(d.t)}`}
            aria-hidden
          />
        ))}
        {linimasa.hariIni && (
          <span className="pointer-events-none absolute top-[10px] h-5 w-0.5 -translate-x-1/2 rounded-full bg-info" style={{ left: `${pos(linimasa.sekarang)}%` }} aria-hidden />
        )}
        <div className="relative mt-1.5 h-3 text-[10px] leading-3 text-muted tabular-nums" aria-hidden>
          {LABEL_JAM.map((j, i) => (
            <span key={j} className={cn("absolute", i === 0 ? "left-0" : i === LABEL_JAM.length - 1 ? "right-0" : "-translate-x-1/2")} style={i > 0 && i < LABEL_JAM.length - 1 ? { left: `${i * 25}%` } : undefined}>
              {j}
            </span>
          ))}
        </div>
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted" aria-hidden>
        {ada.kerja && (
          <li className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-primary" /> Lokasi kerja
          </li>
        )}
        {ada.lain && (
          <li className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-secondary" /> Tempat lain
          </li>
        )}
        {ada.jalan && (
          <li className="inline-flex items-center gap-1.5">
            <span className="h-1 w-3 rounded-full bg-peta-jalur" /> Perjalanan
          </li>
        )}
        {ada.jeda && (
          <li className="inline-flex items-center gap-1.5">
            <span className="arsir-jeda h-2.5 w-3 rounded-[3px] bg-surface-2" /> Tanpa data
          </li>
        )}
        {jp && (
          <li className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-3 rounded-t-[2px] border-x-2 border-t-2 border-jenis-violet" /> Jam presensi
          </li>
        )}
      </ul>
    </div>
  );
}
