"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarOff, Pencil, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button, TombolAksi } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { FormSaldoCuti } from "./form-saldo";
import type { SaldoCuti } from "@/lib/types";

/** Pilihan tahun di sekitar tahun berjalan: cukup untuk menutup sisa tahun lalu dan menyiapkan tahun depan. */
export const pilihanTahun = (tahunIni: number) => [tahunIni - 1, tahunIni, tahunIni + 1];

/** Satu baris saldo: angka sisa yang menonjol, rinciannya kecil di bawahnya. */
export const BarisSaldo = ({ saldo, onUbah }: { saldo: SaldoCuti; onUbah?: () => void }) => {
  const total = saldo.entitledDays + saldo.carriedOverDays;
  const terpakai = saldo.usedDays + (saldo.collectiveLeaveDays ?? 0);
  const persen = total > 0 ? Math.min(100, Math.round((terpakai / total) * 100)) : 0;
  return (
    <li className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate font-medium">{saldo.leaveType.name}</p>
          <p className="shrink-0 text-sm tabular-nums">
            <span className="text-lg font-semibold">{saldo.remainingDays}</span> <span className="text-muted">hari sisa</span>
          </p>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={persen} aria-valuemin={0} aria-valuemax={100} aria-label={`Terpakai ${persen}%`}>
          <div className="h-full rounded-full bg-primary" style={{ width: `${persen}%` }} />
        </div>
        <p className="mt-1 text-xs text-muted">
          Jatah {saldo.entitledDays}{saldo.carriedOverDays > 0 ? ` + ${saldo.carriedOverDays} sisa tahun lalu` : ""} · dipakai {saldo.usedDays}
          {saldo.collectiveLeaveDays > 0 ? ` · cuti bersama ${saldo.collectiveLeaveDays}` : ""}
          {saldo.note ? ` · ${saldo.note}` : ""}
        </p>
      </div>
      {onUbah && (
        <TombolAksi icon={Pencil} label={`Ubah saldo ${saldo.leaveType.name}`} onClick={onUbah} />
      )}
    </li>
  );
};

/** Saldo cuti satu karyawan, untuk halaman detail. HR bisa menetapkan dan mengubahnya di sini. */
export const PanelSaldoCuti = ({ employeeId, employeeName, bolehKelola }: { employeeId: string; employeeName: string; bolehKelola: boolean }) => {
  const tahunIni = new Date().getFullYear();
  const [tahun, setTahun] = React.useState(tahunIni);
  const [form, setForm] = React.useState<{ open: boolean; awal: SaldoCuti | null }>({ open: false, awal: null });
  // Objek stabil: formulir me-reset isinya saat prop ini berubah identitas.
  const karyawan = React.useMemo(() => ({ id: employeeId, name: employeeName }), [employeeId, employeeName]);

  const saldo = useQuery({
    queryKey: ["saldo-cuti", "karyawan", employeeId, tahun],
    queryFn: async () => (await api.get<{ data: SaldoCuti[] }>(`/employees/${employeeId}/leave-balances?year=${tahun}`)).data.data,
  });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Saldo Cuti</CardTitle>
          <CardDescription>Jatah per jenis cuti tahun {tahun}; yang terpakai dihitung dari cuti yang disetujui</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(tahun)} onChange={(e) => setTahun(Number(e.target.value))} aria-label="Tahun saldo" className="w-28">
            {pilihanTahun(tahunIni).map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          {bolehKelola && (
            <Button size="sm" onClick={() => setForm({ open: true, awal: null })}>
              <Plus className="h-4 w-4" aria-hidden /> Tetapkan
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {saldo.isLoading ? (
          <div className="p-4"><SkeletonBaris jumlah={2} /></div>
        ) : !saldo.data?.length ? (
          <EmptyState
            icon={CalendarOff}
            title={`Belum ada saldo tahun ${tahun}`}
            description={bolehKelola ? "Tanpa saldo, karyawan ini tidak bisa mengajukan cuti yang memotong jatah (mis. Cuti Tahunan)." : "HR belum menetapkan jatah cuti untuk tahun ini."}
            action={bolehKelola ? <Button onClick={() => setForm({ open: true, awal: null })}><Plus className="h-4 w-4" aria-hidden /> Tetapkan Saldo</Button> : undefined}
          />
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {saldo.data.map((s) => <BarisSaldo key={s.id} saldo={s} onUbah={bolehKelola ? () => setForm({ open: true, awal: s }) : undefined} />)}
          </ul>
        )}
      </CardContent>

      <FormSaldoCuti open={form.open} onClose={() => setForm({ open: false, awal: null })} awal={form.awal} karyawan={karyawan} tahun={tahun} />
    </Card>
  );
};
