"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, MapPin, Power, Timer } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { useSesi, punyaIzin, bolehKelola, bolehKelolaAkun } from "@/hooks/use-sesi";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Halaman, Karyawan, PenugasanShift } from "@/lib/types";
import { ChipJenis } from "@/components/shift/chip-jenis";
import { formatHariPekan, formatPeriode } from "@/components/shift/util-shift";

type HasilFleksibel = { employee: { id: string; flexibleHours: boolean }; assignmentsEnded: number; rowsDeleted: number };

/** Sakelar hidup/mati yang terbaca pembaca layar sebagai switch. */
const Sakelar = ({ nyala, onClick, disabled, label }: { nyala: boolean; onClick: () => void; disabled?: boolean; label: string }) => (
  <button
    type="button"
    role="switch"
    aria-checked={nyala}
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
    className={cn(
      "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
      nyala ? "bg-primary" : "bg-muted/40"
    )}
  >
    <span className={cn("inline-block h-5 w-5 rounded-full bg-surface shadow transition-transform", nyala ? "translate-x-5" : "translate-x-0.5")} aria-hidden />
  </button>
);

/**
 * Cara jam kerja karyawan diatur: ikut roster shift, atau jam fleksibel
 * (umumnya manajer) yang masuk dan pulang kapan saja. Menyalakan jam fleksibel
 * mengakhiri penugasan shift dan menghapus shift ke depan, jadi dampaknya
 * dihitung server dulu dan ditunjukkan sebelum diterapkan.
 */
export const PanelJamKerja = ({ karyawan: k }: { karyawan: Karyawan }) => {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const bolehUbah = punyaIzin(saya, "karyawan.ubah") && bolehKelolaAkun(saya, k);
  const lihatShift = punyaIzin(saya, "shift.lihat") || bolehKelola(saya, "shift");
  const fleksibel = Boolean(k.flexibleHours);
  const [konfirmasi, setKonfirmasi] = React.useState<{ nyala: boolean; dampak: HasilFleksibel | null } | null>(null);

  const penugasan = useQuery({
    queryKey: ["shift-penugasan", "karyawan", k.id],
    queryFn: async () => (await api.get<Halaman<PenugasanShift>>(`/shifts/assignments?employeeId=${k.id}&active=true&limit=50`)).data.data,
    enabled: lihatShift && !fleksibel,
  });

  const ubah = useMutation({
    mutationFn: async ({ nyala, preview }: { nyala: boolean; preview: boolean }) =>
      (await api.patch<HasilFleksibel>(`/employees/${k.id}/flexible-hours`, { flexibleHours: nyala, ...(preview ? { preview: true } : {}) })).data,
    onSuccess: (r, v) => {
      if (v.preview) {
        setKonfirmasi({ nyala: v.nyala, dampak: r });
        return;
      }
      qc.invalidateQueries({ queryKey: ["karyawan"] });
      qc.invalidateQueries({ queryKey: ["shift"] });
      qc.invalidateQueries({ queryKey: ["shift-rekap"] });
      qc.invalidateQueries({ queryKey: ["shift-penugasan"] });
      qc.invalidateQueries({ queryKey: ["shift-jenis"] });
      if (k.id === saya?.id) qc.invalidateQueries({ queryKey: ["sesi"] });
      setKonfirmasi(null);
      if (v.nyala) {
        const dampak = [r.assignmentsEnded > 0 && `${r.assignmentsEnded} penugasan diakhiri`, r.rowsDeleted > 0 && `${r.rowsDeleted} shift ke depan dihapus`].filter(Boolean).join(" · ");
        notifikasi.sukses("Jam fleksibel dinyalakan", `${k.name} bisa masuk dan pulang kapan saja.${dampak ? ` ${dampak}.` : ""}`);
      } else {
        notifikasi.sukses("Jam fleksibel dimatikan", `${k.name} kembali ikut roster. Tetapkan shift-nya di halaman Jadwal Shift.`);
      }
    },
    onError: (e) => {
      setKonfirmasi(null);
      notifikasi.galat(e, "Pengaturan jam kerja belum berubah");
    },
  });

  // Menyalakan dihitung dulu dampaknya (preview); mematikan tidak menghapus apa pun.
  const ketukSakelar = () => (fleksibel ? setKonfirmasi({ nyala: false, dampak: null }) : ubah.mutate({ nyala: true, preview: true }));

  const deskripsiKonfirmasi = !konfirmasi
    ? ""
    : konfirmasi.nyala
      ? `${konfirmasi.dampak?.assignmentsEnded ?? 0} penugasan diakhiri dan ${konfirmasi.dampak?.rowsDeleted ?? 0} shift ke depan dihapus. ${k.name} bisa masuk dan pulang kapan saja tanpa hitungan terlambat maupun lembur, dan tetap wajib presensi di lokasi kerja.`
      : `${k.name} kembali ikut roster: presensi dicocokkan dengan shift, terlambat dan lembur dihitung lagi. Shift-nya perlu ditetapkan di halaman Jadwal Shift.`;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>Jam Kerja</CardTitle>
          <CardDescription>{fleksibel ? "Jam fleksibel" : "Ikut roster shift"}</CardDescription>
        </div>
        {bolehUbah && (
          <label className="flex shrink-0 items-center gap-2 text-sm">
            <span className="text-muted">Jam fleksibel</span>
            <Sakelar nyala={fleksibel} onClick={ketukSakelar} disabled={ubah.isPending} label={fleksibel ? "Matikan jam fleksibel" : "Nyalakan jam fleksibel"} />
          </label>
        )}
      </CardHeader>
      <CardContent>
        {fleksibel ? (
          <ul className="space-y-2 rounded-xl bg-surface-2 p-4 text-sm">
            <li className="flex items-start gap-2"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden /> Masuk dan pulang kapan saja; boleh lebih dari satu sesi sehari.</li>
            <li className="flex items-start gap-2"><Timer className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden /> Tanpa hitungan terlambat, pulang cepat, maupun lembur — jam kerja tetap dicatat.</li>
            <li className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden /> Tetap wajib presensi di lokasi kerja.</li>
          </ul>
        ) : !lihatShift ? (
          <p className="text-sm text-muted">Presensi dicocokkan dengan jadwal shift yang disusun atasan atau HR.</p>
        ) : penugasan.isLoading ? (
          <Skeleton className="h-16" />
        ) : !penugasan.data?.length ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted">
            Belum ada penugasan berulang — shift diatur per tanggal.{" "}
            <Link href="/shift" className="font-medium text-primary underline-offset-2 hover:underline">Buka Jadwal Shift</Link>
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {penugasan.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                <ChipJenis jenis={p.template} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{p.template.name}</span>{" "}
                  <span className="tabular-nums text-muted">{p.template.startTime}–{p.template.endTime}</span>
                  <span className="block text-xs text-muted">{formatPeriode(p.startDate, p.endDate)} · {formatHariPekan(p.weekdays)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <ConfirmDialog
        open={Boolean(konfirmasi)}
        onClose={() => setKonfirmasi(null)}
        onConfirm={() => konfirmasi && ubah.mutate({ nyala: konfirmasi.nyala, preview: false })}
        loading={ubah.isPending}
        danger={Boolean(konfirmasi?.nyala && ((konfirmasi.dampak?.assignmentsEnded ?? 0) > 0 || (konfirmasi.dampak?.rowsDeleted ?? 0) > 0))}
        title={konfirmasi?.nyala ? "Nyalakan jam fleksibel?" : "Matikan jam fleksibel?"}
        description={deskripsiKonfirmasi}
        confirmLabel={konfirmasi?.nyala ? "Nyalakan" : "Matikan"}
        confirmIcon={Power}
      />
    </Card>
  );
};
