"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Wallet, ChevronRight, Printer } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatRupiah, formatTanggal, labelStatus, namaPeriode, LABEL_SALARY_TYPE } from "@/lib/utils";
import type { Halaman, SlipGaji } from "@/lib/types";

const Baris = ({ label, nilai, tebal, negatif }: { label: React.ReactNode; nilai: number; tebal?: boolean; negatif?: boolean }) => (
  <div className={`flex items-baseline justify-between gap-3 py-1.5 ${tebal ? "font-semibold" : ""}`}>
    <span className={tebal ? "" : "text-muted"}>{label}</span>
    <span className={`tabular-nums ${negatif ? "text-danger" : ""}`}>{negatif ? "− " : ""}{formatRupiah(nilai)}</span>
  </div>
);

/**
 * Slip gaji: angka bersih paling besar di atas, lalu rinciannya. Orang
 * membuka ini untuk satu pertanyaan — "berapa yang masuk?" — dan baru
 * kemudian "kenapa segitu?".
 */
const DetailSlip = ({ slip }: { slip: SlipGaji }) => {
  const tunjangan = slip.items.filter((i) => i.type === "allowance");
  const potongan = slip.items.filter((i) => i.type === "deduction");
  return (
    <div className="space-y-5 text-sm">
      <div className="rounded-xl bg-primary-soft p-4 text-center">
        <p className="text-xs uppercase tracking-wide text-primary">Gaji bersih diterima</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums text-primary">{formatRupiah(slip.netSalary)}</p>
        <p className="mt-1 text-xs text-muted">{namaPeriode(slip.payPeriodStart, slip.payPeriodEnd)} · {LABEL_SALARY_TYPE[slip.salaryType] ?? slip.salaryType}</p>
      </div>

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Kehadiran</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          <div><dt className="text-xs text-muted">Hari kerja</dt><dd className="tabular-nums">{slip.workedDays} / {slip.scheduledDays}</dd></div>
          <div><dt className="text-xs text-muted">Cuti tanpa gaji</dt><dd className="tabular-nums">{slip.unpaidLeaveDays} hari</dd></div>
          <div><dt className="text-xs text-muted">Lembur</dt><dd className="tabular-nums">{slip.overtimeHours} jam</dd></div>
          <div><dt className="text-xs text-muted">Upah lembur</dt><dd className="tabular-nums">{formatRupiah(slip.overtimePay)}</dd></div>
        </dl>
      </section>

      <section className="divide-y divide-border">
        <Baris label="Gaji pokok" nilai={slip.basicSalary} />
        {tunjangan.map((i) => <Baris key={i.code} label={<span title={i.calculationNote ?? undefined}>{i.name}</span>} nilai={i.amount} />)}
        {slip.overtimePay > 0 && <Baris label="Lembur" nilai={slip.overtimePay} />}
        <Baris label="Gaji kotor" nilai={slip.grossSalary} tebal />
      </section>

      {potongan.length > 0 && (
        <section className="divide-y divide-border">
          {potongan.map((i) => <Baris key={i.code} label={<span title={i.calculationNote ?? undefined}>{i.name}</span>} nilai={i.amount} negatif />)}
          <Baris label="Total potongan" nilai={slip.totalDeductions} tebal negatif />
        </section>
      )}

      <section className="divide-y divide-border border-t-2 border-border">
        <Baris label="Gaji bersih" nilai={slip.netSalary} tebal />
      </section>

      {slip.note && <p className="text-xs text-muted">{slip.note}</p>}
      <p className="text-xs text-muted">Penghasilan kena pajak: {formatRupiah(slip.taxableIncome)}. Slip dibuat {formatTanggal(slip.createdAt, "d MMM yyyy")}.</p>
    </div>
  );
};

export default function HalamanGaji() {
  const [page, setPage] = React.useState(1);
  const [detail, setDetail] = React.useState<SlipGaji | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["gaji", "saya", page],
    queryFn: async () => (await api.get<Halaman<SlipGaji>>(`/payrolls/me?page=${page}&limit=12`)).data,
    placeholderData: (prev) => prev,
  });

  return (
    <>
      <PageHeader title="Slip Gaji" description="Slip yang sudah disetujui atau dibayar. Yang masih dihitung tidak ditampilkan." />

      <Card>
        {isLoading ? <SkeletonBaris /> : !data?.data.length ? (
          <EmptyState icon={Wallet} title="Belum ada slip gaji" description="Slip muncul di sini setelah HR menyetujui penggajian periode berjalan." />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {data.data.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => setDetail(s)} className="flex w-full items-center gap-3 p-4 text-left hover:bg-surface-2 transition-colors animate-fade-up">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"><Wallet className="h-5 w-5" aria-hidden /></span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{namaPeriode(s.payPeriodStart, s.payPeriodEnd)}</p>
                      <p className="text-xs text-muted">{s.workedDays}/{s.scheduledDays} hari kerja{s.overtimeHours > 0 ? ` · ${s.overtimeHours} jam lembur` : ""}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold tabular-nums">{formatRupiah(s.netSalary)}</p>
                      <Badge tone={nadaStatus(s.status)} dot className="mt-0.5">{labelStatus(s.status)}</Badge>
                    </div>
                    <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted sm:block" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            <Pagination pagination={data.pagination} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title="Slip Gaji" description={detail ? `${detail.employee.name} · ${detail.employee.nik}` : undefined} size="lg"
        footer={<><Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden /> Cetak</Button><Button onClick={() => setDetail(null)}>Tutup</Button></>}>
        {detail && <DetailSlip slip={detail} />}
      </Modal>
    </>
  );
}
