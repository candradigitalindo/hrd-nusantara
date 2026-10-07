"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { cn, formatTanggal } from "@/lib/utils";
import { tanggalISO, tambahHari, tanggalShift, lintasMalam } from "@/components/shift/util-shift";
import { ChipJenis } from "@/components/shift/chip-jenis";
import type { Halaman, Shift } from "@/lib/types";

const HARI_KE_DEPAN = 14;

/**
 * Jadwal shift pengguna sendiri dua pekan ke depan, dari /shifts/me — jalur
 * yang sama dengan layar Jadwal di aplikasi mobile. Izin presensi.lihat
 * menjanjikan "jadwal shift sendiri"; sebelumnya hanya aplikasi mobile yang
 * menampilkannya, di web karyawan tidak punya tempat melihatnya.
 */
export const JadwalSaya = () => {
  const hariIni = new Date();
  const mulai = tanggalISO(hariIni);
  const sampai = tanggalISO(tambahHari(hariIni, HARI_KE_DEPAN - 1));
  const jadwal = useQuery({
    queryKey: ["shift", "saya", mulai, sampai],
    queryFn: async () => (await api.get<Halaman<Shift> & { flexibleHours?: boolean }>(`/shifts/me?startDate=${mulai}&endDate=${sampai}&limit=100`)).data,
  });
  // Server baru sudah membuang yang dibatalkan; disaring lagi untuk respons lama.
  const daftar = (jadwal.data?.data ?? []).filter((s) => s.status !== "cancelled");
  const fleksibel = jadwal.data?.flexibleHours === true;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jadwal Shift Saya</CardTitle>
        <CardDescription>{HARI_KE_DEPAN} hari ke depan; tanggal yang tidak tercantum berarti libur{fleksibel ? "" : " atau roster belum terbit"}</CardDescription>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {jadwal.isLoading ? (
          <div className="p-4"><SkeletonBaris jumlah={3} /></div>
        ) : jadwal.isError ? (
          <p className="px-4 pb-4 text-sm text-muted">Jadwal tidak bisa dimuat saat ini.</p>
        ) : fleksibel ? (
          <p className="px-4 pb-4 text-sm text-muted">Jam kerja Anda fleksibel: masuk dan pulang kapan saja, tanpa roster.</p>
        ) : daftar.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">Belum ada shift terjadwal untuk dua pekan ke depan. Hubungi atasan bila seharusnya ada.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {daftar.map((s) => {
              const hariIniKah = tanggalShift(s) === mulai;
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                  <span className={cn("w-40 shrink-0 tabular-nums", hariIniKah && "font-semibold text-primary")}>
                    {formatTanggal(s.date, "EEE, d MMM")}{hariIniKah ? " · hari ini" : ""}
                  </span>
                  {s.template && <ChipJenis jenis={s.template} />}
                  <span className="tabular-nums">
                    {s.startTime}–{s.endTime}
                    {lintasMalam(s.startTime, s.endTime) && <Badge tone="info" className="ml-1.5 px-1.5">+1 hari</Badge>}
                  </span>
                  {s.status === "tentative" && <Badge tone="warning">Sementara</Badge>}
                  {s.notes && <span className="text-xs text-muted">{s.notes}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};
