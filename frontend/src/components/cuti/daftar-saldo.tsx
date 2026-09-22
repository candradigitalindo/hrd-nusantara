"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarOff, Pencil, Plus, Search, Users } from "lucide-react";
import { api, ambilSemua } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { Pagination } from "@/components/ui/pagination";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ResponsiveTable, type Kolom } from "@/components/ui/responsive-table";
import { FormSaldoCuti } from "./form-saldo";
import { pilihanTahun } from "./panel-saldo";
import type { Halaman, SaldoCuti, TipeCuti, Karyawan } from "@/lib/types";

const SUDAH_KELUAR = new Set(["inactive", "resign", "terminated"]);

/**
 * Saldo cuti seluruh karyawan untuk HR: menetapkan satu per satu, atau
 * menerapkan jatah bawaan jenis cuti ke semua karyawan aktif yang belum punya
 * saldo tahun itu — pekerjaan rutin tiap awal tahun.
 */
export const DaftarSaldoCuti = () => {
  const qc = useQueryClient();
  const tahunIni = new Date().getFullYear();
  const [tahun, setTahun] = React.useState(tahunIni);
  const [tipeId, setTipeId] = React.useState("");
  const [cari, setCari] = React.useState("");
  const [cariTunda, setCariTunda] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [form, setForm] = React.useState<{ open: boolean; awal: SaldoCuti | null }>({ open: false, awal: null });
  const [massalBuka, setMassalBuka] = React.useState(false);
  const [tipeMassal, setTipeMassal] = React.useState("");

  React.useEffect(() => {
    const t = setTimeout(() => { setCariTunda(cari.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [cari]);

  const tipe = useQuery({
    queryKey: ["tipe-cuti"],
    queryFn: async () => (await api.get<{ data: TipeCuti[] } | TipeCuti[]>("/leave-types")).data,
    select: (d) => (Array.isArray(d) ? d : d.data).filter((t) => t.isActive),
  });

  const params = new URLSearchParams({ page: String(page), limit: "20", year: String(tahun) });
  if (tipeId) params.set("leaveTypeId", tipeId);
  if (cariTunda) params.set("search", cariTunda);
  const daftar = useQuery({
    queryKey: ["saldo-cuti", "semua", params.toString()],
    queryFn: async () => (await api.get<Halaman<SaldoCuti>>(`/leave-balances?${params}`)).data,
    placeholderData: (prev) => prev,
  });

  // Jenis yang punya kuota bawaan saja yang bisa diterapkan massal.
  const tipeBerkuota = (tipe.data ?? []).filter((t) => t.defaultQuotaDays !== null);
  const tipeUntukMassal = tipeBerkuota.find((t) => t.id === (tipeMassal || tipeId)) ?? tipeBerkuota.find((t) => t.deductsBalance) ?? tipeBerkuota[0];

  const terapkanMassal = useMutation({
    mutationFn: async (t: TipeCuti) => {
      const semua = await ambilSemua<Karyawan>("/employees");
      const aktif = semua.filter((k) => !SUDAH_KELUAR.has(k.status));
      const sudahAda = new Set((await ambilSemua<SaldoCuti>("/leave-balances", { year: String(tahun), leaveTypeId: t.id })).map((b) => b.employeeId));
      const target = aktif.filter((k) => !sudahAda.has(k.id));
      let berhasil = 0;
      const gagal: string[] = [];
      for (const k of target) {
        try {
          await api.post("/leave-balances", { employeeId: k.id, leaveTypeId: t.id, year: tahun, entitledDays: t.defaultQuotaDays, carriedOverDays: 0 });
          berhasil++;
        } catch {
          gagal.push(k.name);
        }
      }
      return { berhasil, dilewati: aktif.length - target.length, gagal };
    },
    onSuccess: (r, t) => {
      qc.invalidateQueries({ queryKey: ["saldo-cuti"] });
      const rincian = [`${r.dilewati} sudah punya saldo`, r.gagal.length ? `gagal: ${r.gagal.join(", ")}` : ""].filter(Boolean).join(" · ");
      if (r.gagal.length) notifikasi.peringatan(`${r.berhasil} saldo ${t.name} ${tahun} ditetapkan`, rincian);
      else notifikasi.sukses(`${r.berhasil} saldo ${t.name} ${tahun} ditetapkan`, rincian);
      setMassalBuka(false);
    },
    onError: (e) => notifikasi.galat(e, "Penerapan massal gagal"),
  });

  const kolom: Kolom<SaldoCuti>[] = [
    {
      key: "karyawan", header: "Karyawan", primary: true,
      cell: (s) => (
        <div>
          <p className="font-medium">{s.employee?.name ?? s.employeeId}</p>
          <p className="text-xs text-muted">{s.employee?.nik}{s.employee?.department ? ` · ${s.employee.department.name}` : ""}</p>
        </div>
      ),
    },
    { key: "jenis", header: "Jenis cuti", cell: (s) => s.leaveType.name },
    { key: "jatah", header: "Jatah", cell: (s) => <span className="tabular-nums">{s.entitledDays}{s.carriedOverDays > 0 ? <span className="text-muted"> + {s.carriedOverDays}</span> : null}</span> },
    { key: "dipakai", header: "Dipakai", cell: (s) => <span className="tabular-nums">{s.usedDays}{s.collectiveLeaveDays > 0 ? <span className="text-xs text-muted"> · cuti bersama {s.collectiveLeaveDays}</span> : null}</span> },
    { key: "sisa", header: "Sisa", cell: (s) => <span className={`font-semibold tabular-nums ${s.remainingDays <= 0 ? "text-danger" : ""}`}>{s.remainingDays} hari</span> },
    { key: "catatan", header: "Catatan", cell: (s) => <span className="line-clamp-2 text-muted">{s.note ?? "—"}</span> },
    {
      key: "aksi", header: "", className: "text-right",
      cell: (s) => (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setForm({ open: true, awal: s })} aria-label={`Ubah saldo ${s.employee?.name ?? ""} ${s.leaveType.name}`}>
            <Pencil className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Ubah</span>
          </Button>
        </div>
      ),
    },
  ];

  const adaSaringan = Boolean(tipeId || cariTunda);

  return (
    <>
      <Card>
        <div className="grid gap-2 border-b border-border p-3 sm:grid-cols-[7rem_auto_1fr_auto_auto] sm:items-center">
          <Select value={String(tahun)} onChange={(e) => { setTahun(Number(e.target.value)); setPage(1); }} aria-label="Tahun">
            {pilihanTahun(tahunIni).map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Select value={tipeId} onChange={(e) => { setTipeId(e.target.value); setPage(1); }} aria-label="Jenis cuti" className="sm:w-56">
            <option value="">Semua jenis cuti</option>
            {(tipe.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input className="pl-9" placeholder="Cari nama atau NIK…" value={cari} onChange={(e) => setCari(e.target.value)} aria-label="Cari karyawan" />
          </div>
          <Button variant="outline" onClick={() => { setTipeMassal(tipeId); setMassalBuka(true); }} disabled={tipeBerkuota.length === 0}>
            <Users className="h-4 w-4" aria-hidden /> Terapkan Jatah Bawaan
          </Button>
          <Button onClick={() => setForm({ open: true, awal: null })}>
            <Plus className="h-4 w-4" aria-hidden /> Tetapkan Saldo
          </Button>
        </div>

        {daftar.isLoading ? (
          <SkeletonBaris />
        ) : !daftar.data?.data.length ? (
          <EmptyState
            icon={CalendarOff}
            title={adaSaringan ? "Tidak ada yang cocok" : `Belum ada saldo tahun ${tahun}`}
            description={adaSaringan ? "Coba ubah kata kunci atau saringan." : "Tetapkan satu per satu, atau terapkan jatah bawaan ke semua karyawan aktif sekaligus."}
            action={!adaSaringan && tipeBerkuota.length > 0 ? <Button onClick={() => setMassalBuka(true)}>Terapkan Jatah Bawaan</Button> : undefined}
          />
        ) : (
          <>
            <ResponsiveTable columns={kolom} rows={daftar.data.data} rowKey={(s) => s.id} />
            <Pagination pagination={daftar.data.pagination} onPage={setPage} />
          </>
        )}
      </Card>

      <FormSaldoCuti open={form.open} onClose={() => setForm({ open: false, awal: null })} awal={form.awal} tahun={tahun} />

      <Modal
        open={massalBuka}
        onClose={() => setMassalBuka(false)}
        title="Terapkan jatah bawaan"
        description={`Semua karyawan aktif yang belum punya saldo tahun ${tahun} akan diberi jatah bawaan jenis cuti yang dipilih. Yang sudah punya saldo tidak disentuh.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setMassalBuka(false)} disabled={terapkanMassal.isPending}>Batal</Button>
            <Button onClick={() => tipeUntukMassal && terapkanMassal.mutate(tipeUntukMassal)} loading={terapkanMassal.isPending} disabled={!tipeUntukMassal}>
              Terapkan ke Semua
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Jenis cuti" hint="Hanya jenis yang punya kuota bawaan yang bisa diterapkan massal">
            <Select value={tipeUntukMassal?.id ?? ""} onChange={(e) => setTipeMassal(e.target.value)} aria-label="Jenis cuti massal">
              {tipeBerkuota.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.defaultQuotaDays} hari</option>)}
            </Select>
          </Field>
          {tipeUntukMassal && (
            <Alert tone="info" title={`${tipeUntukMassal.defaultQuotaDays} hari untuk tahun ${tahun}`}>
              Karyawan yang bergabung di tengah tahun tetap mendapat jatah penuh; sesuaikan prorata-nya satu per satu setelah ini bila perlu.
            </Alert>
          )}
        </div>
      </Modal>
    </>
  );
};
