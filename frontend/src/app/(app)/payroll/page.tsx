"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Banknote, Plus, Calculator, Check, Undo2, ChevronRight, Users, X } from "lucide-react";
import { api, ambilSemua } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { Pagination } from "@/components/ui/pagination";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ResponsiveTable, type Kolom } from "@/components/ui/responsive-table";
import { DetailSlip } from "@/components/gaji/detail-slip";
import { formatRupiah, formatTanggal, labelStatus, namaPeriode } from "@/lib/utils";
import type { Halaman, BatchGaji, HasilHitung, SlipGaji } from "@/lib/types";

type FormBatch = { code: string; name: string; periodStart: string; periodEnd: string; note: string };

const bulanIni = () => {
  const d = new Date();
  const y = d.getFullYear(), m = d.getMonth();
  const awal = new Date(y, m, 1), akhir = new Date(y, m + 1, 0);
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { code: `GAJI-${y}-${String(m + 1).padStart(2, "0")}`, name: `Gaji ${formatTanggal(awal, "MMMM yyyy")}`, periodStart: iso(awal), periodEnd: iso(akhir) };
};

export default function HalamanPayroll() {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const bolehBuat = punyaIzin(saya, "payroll.buat");
  const bolehUbah = punyaIzin(saya, "payroll.ubah");
  const [status, setStatus] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [buatBuka, setBuatBuka] = React.useState(false);
  const [hasilHitung, setHasilHitung] = React.useState<HasilHitung | null>(null);
  const [keputusan, setKeputusan] = React.useState<{ run: BatchGaji; approved: boolean } | null>(null);
  const [catatan, setCatatan] = React.useState("");
  const [rincian, setRincian] = React.useState<BatchGaji | null>(null);
  const [slip, setSlip] = React.useState<SlipGaji | null>(null);

  const params = new URLSearchParams({ page: String(page), limit: "12" });
  if (status) params.set("status", status);

  const runs = useQuery({
    queryKey: ["payroll-runs", params.toString()],
    queryFn: async () => (await api.get<Halaman<BatchGaji>>(`/payroll-runs?${params}`)).data,
    placeholderData: (prev) => prev,
  });

  const slips = useQuery({
    queryKey: ["payrolls", rincian?.id],
    queryFn: async () => ({ data: await ambilSemua<SlipGaji>("/payrolls", { payrollRunId: rincian!.id }) }),
    enabled: Boolean(rincian),
  });

  const fb = useForm<FormBatch>({ defaultValues: { ...bulanIni(), note: "" } });
  const segarkan = () => qc.invalidateQueries({ queryKey: ["payroll-runs"] });

  const buat = useMutation({
    mutationFn: async (v: FormBatch) => (await api.post<BatchGaji>("/payroll-runs", { code: v.code, name: v.name, periodStart: v.periodStart, periodEnd: v.periodEnd, ...(v.note ? { note: v.note } : {}) })).data,
    onSuccess: (r) => { segarkan(); notifikasi.sukses("Batch dibuat", `${r.name} · masih draft, belum dihitung.`); setBuatBuka(false); fb.reset({ ...bulanIni(), note: "" }); },
    onError: (e) => notifikasi.galat(e, "Batch gagal dibuat"),
  });

  const hitung = useMutation({
    mutationFn: async (r: BatchGaji) => (await api.post<HasilHitung>(`/payroll-runs/${r.id}/calculate`, {})).data,
    onSuccess: (h) => {
      segarkan(); setHasilHitung(h);
      if (h.skipped.length) notifikasi.peringatan(`${h.calculated} dihitung, ${h.skipped.length} dilewati`, "Lihat alasannya di bawah daftar batch.");
      else notifikasi.sukses(`${h.calculated} slip dihitung`, "Periksa rinciannya sebelum disetujui.");
    },
    onError: (e) => notifikasi.galat(e, "Perhitungan gagal"),
  });

  const putuskan = useMutation({
    mutationFn: async ({ run, approved }: { run: BatchGaji; approved: boolean }) => (await api.patch(`/payroll-runs/${run.id}/decision`, { approved, ...(catatan ? { note: catatan } : {}) })).data,
    onSuccess: (_, v) => {
      segarkan(); qc.invalidateQueries({ queryKey: ["gaji"] });
      notifikasi.sukses(v.approved ? "Batch disetujui" : "Batch dikembalikan ke draft", v.approved ? "Slip kini terlihat oleh masing-masing karyawan." : "Perhitungan bisa diulang setelah data diperbaiki.");
      setKeputusan(null); setCatatan("");
    },
    onError: (e) => notifikasi.galat(e, "Keputusan gagal disimpan"),
  });

  const kolomSlip: Kolom<SlipGaji>[] = [
    { key: "karyawan", header: "Karyawan", primary: true, cell: (s) => <div><p className="font-medium">{s.employee.name}</p><p className="text-xs text-muted">{s.employee.nik}</p></div> },
    { key: "hadir", header: "Hadir", cell: (s) => <span className="tabular-nums">{s.workedDays}/{s.scheduledDays}</span> },
    { key: "kotor", header: "Kotor", cell: (s) => <span className="tabular-nums">{formatRupiah(s.grossSalary)}</span> },
    { key: "potongan", header: "Potongan", cell: (s) => <span className="tabular-nums text-danger">− {formatRupiah(s.totalDeductions)}</span> },
    { key: "bersih", header: "Bersih", cell: (s) => <span className="font-semibold tabular-nums">{formatRupiah(s.netSalary)}</span> },
  ];

  const totalBersih = (slips.data?.data ?? []).reduce((a, s) => a + s.netSalary, 0);

  return (
    <>
      <PageHeader title="Payroll" description="Batch penggajian: buat, hitung dari presensi, periksa, lalu setujui"
        actions={bolehBuat && <Button onClick={() => setBuatBuka(true)}><Plus className="h-4 w-4" aria-hidden /> Batch Baru</Button>} />

      {hasilHitung && (
        <Alert tone={hasilHitung.skipped.length ? "warning" : "success"} title={`${hasilHitung.payrollRun.name}: ${hasilHitung.calculated} slip dihitung${hasilHitung.skipped.length ? `, ${hasilHitung.skipped.length} dilewati` : ""}`}
          action={<Button size="sm" variant="outline" onClick={() => setHasilHitung(null)}><X className="h-4 w-4" aria-hidden /> Tutup</Button>}>
          {hasilHitung.skipped.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {hasilHitung.skipped.map((s) => <li key={s.employeeId}><span className="font-medium">{s.name}</span> ({s.nik}) — {s.reason}</li>)}
            </ul>
          )}
        </Alert>
      )}

      <Card>
        <div className="border-b border-border p-3">
          <Select className="sm:w-56" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status batch">
            <option value="">Semua status</option>
            {["draft", "calculated", "approved", "paid", "cancelled"].map((s) => <option key={s} value={s}>{labelStatus(s)}</option>)}
          </Select>
        </div>
        {runs.isLoading ? <SkeletonBaris /> : !runs.data?.data.length ? (
          <EmptyState icon={Banknote} title="Belum ada batch penggajian" description="Buat batch untuk satu periode, hitung dari data presensi, periksa, lalu setujui." action={bolehBuat && <Button onClick={() => setBuatBuka(true)}><Plus className="h-4 w-4" aria-hidden /> Batch Baru</Button>} />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {runs.data.data.map((r) => (
                <li key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center animate-fade-up">
                  <button type="button" onClick={() => setRincian(r)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"><Banknote className="h-5 w-5" aria-hidden /></span>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{r.name} <span className="font-mono text-xs text-muted">{r.code}</span></p>
                      <p className="text-xs text-muted">{namaPeriode(r.periodStart, r.periodEnd)}{r._count ? ` · ${r._count.payrolls} slip` : ""}{r.approvedAt ? ` · disetujui ${formatTanggal(r.approvedAt)}` : ""}</p>
                    </div>
                    <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted sm:block" aria-hidden />
                  </button>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Badge tone={nadaStatus(r.status)} dot>{labelStatus(r.status)}</Badge>
                    {bolehUbah && (r.status === "draft" || r.status === "calculated") && (
                      <Button size="sm" variant="outline" onClick={() => hitung.mutate(r)} loading={hitung.isPending && hitung.variables?.id === r.id}>
                        {!(hitung.isPending && hitung.variables?.id === r.id) && <Calculator className="h-4 w-4" aria-hidden />} {r.status === "draft" ? "Hitung" : "Hitung Ulang"}
                      </Button>
                    )}
                    {bolehUbah && r.status === "calculated" && (
                      <>
                        <Button size="sm" onClick={() => setKeputusan({ run: r, approved: true })}><Check className="h-4 w-4" aria-hidden /> Setujui</Button>
                        <Button size="sm" variant="ghost" onClick={() => setKeputusan({ run: r, approved: false })}><Undo2 className="h-4 w-4" aria-hidden /> Kembalikan</Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <Pagination pagination={runs.data.pagination} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal open={buatBuka} onClose={() => setBuatBuka(false)} title="Batch Penggajian Baru" description="Satu batch untuk satu periode. Perhitungan dilakukan terpisah setelah batch dibuat."
        footer={<><Button variant="outline" onClick={() => setBuatBuka(false)}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button form="form-batch" type="submit" loading={buat.isPending}>{!buat.isPending && <Plus className="h-4 w-4" aria-hidden />} Buat</Button></>}>
        <form id="form-batch" onSubmit={fb.handleSubmit((v) => buat.mutate(v))} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kode" error={fb.formState.errors.code?.message} hint="Huruf, angka, garis bawah, strip">
              <Input {...fb.register("code", { required: "Kode wajib diisi", pattern: { value: /^[A-Za-z0-9_-]{4,40}$/, message: "4–40 karakter: huruf, angka, _ atau -" } })} className="font-mono" />
            </Field>
            <Field label="Nama" error={fb.formState.errors.name?.message}>
              <Input {...fb.register("name", { required: "Nama wajib diisi" })} />
            </Field>
            <Field label="Periode mulai" error={fb.formState.errors.periodStart?.message}>
              <Input type="date" {...fb.register("periodStart", { required: "Wajib diisi" })} />
            </Field>
            <Field label="Periode selesai" error={fb.formState.errors.periodEnd?.message}>
              <Input type="date" {...fb.register("periodEnd", { required: "Wajib diisi", validate: (v, f) => v >= f.periodStart || "Tidak boleh sebelum tanggal mulai" })} />
            </Field>
          </div>
          <Field label="Catatan"><Textarea rows={2} {...fb.register("note")} /></Field>
        </form>
      </Modal>

      <Modal open={Boolean(rincian)} onClose={() => setRincian(null)} size="lg" title={rincian?.name ?? ""} description={rincian ? `${namaPeriode(rincian.periodStart, rincian.periodEnd)} · ${labelStatus(rincian.status)}` : undefined}>
        {slips.isLoading ? <SkeletonBaris /> : !slips.data?.data.length ? (
          <EmptyState icon={Users} title="Belum ada slip" description={rincian?.status === "draft" ? "Batch ini belum dihitung." : "Tidak ada karyawan yang masuk perhitungan."} />
        ) : (
          <div className="-mx-4 sm:-mx-5">
            <ResponsiveTable columns={kolomSlip} rows={slips.data.data} rowKey={(s) => s.id} onRowClick={(s) => setSlip(s)} />
            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm sm:px-5">
              <span className="text-muted">{slips.data.data.length} karyawan</span>
              <span className="font-semibold tabular-nums">Total bersih {formatRupiah(totalBersih)}</span>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(slip)} onClose={() => setSlip(null)} size="lg" title="Rincian Slip" description={slip ? `${slip.employee.name} · ${slip.employee.nik}` : undefined} footer={<Button onClick={() => setSlip(null)}><X className="h-4 w-4" aria-hidden /> Tutup</Button>}>
        {slip && <DetailSlip slip={slip} />}
      </Modal>

      <Modal open={Boolean(keputusan)} onClose={() => setKeputusan(null)}
        title={keputusan?.approved ? "Setujui batch penggajian?" : "Kembalikan ke draft?"}
        description={keputusan ? `${keputusan.run.name} · ${keputusan.run._count?.payrolls ?? "?"} slip` : undefined}
        footer={<><Button variant="outline" onClick={() => setKeputusan(null)}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button variant={keputusan?.approved ? "primary" : "danger"} loading={putuskan.isPending} onClick={() => keputusan && putuskan.mutate(keputusan)}>{!putuskan.isPending && (keputusan?.approved ? <Check className="h-4 w-4" aria-hidden /> : <Undo2 className="h-4 w-4" aria-hidden />)} {keputusan?.approved ? "Setujui" : "Kembalikan"}</Button></>}>
        {keputusan?.approved && <Alert tone="warning" title="Angka akan terkunci" className="mb-4">Setelah disetujui, slip terlihat oleh masing-masing karyawan dan tidak bisa dihitung ulang. Pastikan rinciannya sudah diperiksa.</Alert>}
        <Field label="Catatan" hint="Opsional, tercatat di batch">
          <Textarea rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} />
        </Field>
      </Modal>

    </>
  );
}
