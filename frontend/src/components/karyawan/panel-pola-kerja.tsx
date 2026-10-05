"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { RingkasanPola } from "@/components/cuti/tab-pola-kerja";
import type { Departemen, Halaman, Karyawan, PolaKerja } from "@/lib/types";

/** Pola terakhir backend bila tidak ada yang dikonfigurasi sama sekali. */
const POLA_SISTEM = { name: "Kantor (Senin–Sabtu)", type: "fixed" as const, workingWeekdays: [1, 2, 3, 4, 5, 6], observesPublicHolidays: true };

/**
 * Pola hari kerja yang berlaku untuk satu karyawan, beserta asalnya: pola
 * sendiri, pola departemen, atau bawaan perusahaan. HR memberi pengecualian
 * di sini; pola departemen dan bawaan diatur di Cuti & Izin › Pola Kerja.
 */
export const PanelPolaKerja = ({ karyawan: k, bolehUbah }: { karyawan: Karyawan; bolehUbah: boolean }) => {
  const qc = useQueryClient();

  const pola = useQuery({
    queryKey: ["pola-kerja", "aktif"],
    queryFn: async () => (await api.get<Halaman<PolaKerja>>("/work-patterns?includeInactive=false&limit=100")).data.data,
  });
  const dept = useQuery({
    queryKey: ["departemen", k.departmentId],
    queryFn: async () => (await api.get<Departemen>(`/departments/${k.departmentId}`)).data,
    enabled: Boolean(k.departmentId),
  });

  const ubah = useMutation({
    mutationFn: async (polaId: string | null) =>
      (await api.patch<{ id: string; name: string; workPatternId: string | null }>(`/employees/${k.id}/work-pattern`, { workPatternId: polaId })).data,
    onSuccess: (_, polaId) => {
      qc.invalidateQueries({ queryKey: ["karyawan"] });
      const nama = polaId ? (pola.data ?? []).find((p) => p.id === polaId)?.name : null;
      notifikasi.sukses("Pola kerja diperbarui", `${k.name} ${nama ? `memakai ${nama}` : "kembali mengikuti pola departemen atau bawaan perusahaan"}.`);
    },
    onError: (e) => notifikasi.galat(e, "Pola kerja belum berubah"),
  });

  const aktif = pola.data ?? [];
  const bawaan = aktif.find((p) => p.isDefault) ?? null;
  // Jenjang yang sama dengan backend: karyawan → departemen → bawaan → sistem.
  const sendiri = k.workPatternId ? aktif.find((p) => p.id === k.workPatternId) ?? null : null;
  const dariDept = dept.data?.workPatternId ? aktif.find((p) => p.id === dept.data?.workPatternId) ?? null : null;
  const efektif = sendiri ?? dariDept ?? bawaan;
  const sumber = sendiri
    ? "pola sendiri"
    : k.workPatternId
      ? "pola sendiri nonaktif, jatuh ke jenjang berikutnya"
      : dariDept
        ? `mengikuti departemen ${dept.data?.name ?? ""}`
        : bawaan
          ? "mengikuti bawaan perusahaan"
          : "bawaan sistem, belum ada pola yang ditandai bawaan";
  const menunggu = pola.isLoading || (Boolean(k.departmentId) && dept.isLoading);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>Pola Hari Kerja</CardTitle>
          <CardDescription>Hari yang dihitung saat cuti memotong saldo</CardDescription>
        </div>
        {bolehUbah && (
          <Select
            value={k.workPatternId ?? ""}
            onChange={(e) => ubah.mutate(e.target.value || null)}
            disabled={ubah.isPending || pola.isLoading}
            aria-label="Pola kerja karyawan"
            className="sm:w-64"
          >
            <option value="">Ikut departemen / bawaan</option>
            {aktif.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            {k.workPatternId && !sendiri && <option value={k.workPatternId}>{k.workPattern?.name ?? "Pola"} (nonaktif)</option>}
          </Select>
        )}
      </CardHeader>
      <CardContent>
        {menunggu ? (
          <Skeleton className="h-10" />
        ) : (
          <div className="rounded-xl bg-surface-2 px-4 py-3 text-sm">
            <p>
              <span className="font-medium">{efektif?.name ?? POLA_SISTEM.name}</span> <span className="text-muted">· {sumber}</span>
            </p>
            <p className="mt-0.5 text-muted"><RingkasanPola pola={efektif ?? POLA_SISTEM} /></p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
