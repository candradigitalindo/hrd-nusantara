"use client";

import * as React from "react";
import { formatRupiah, formatTanggal, namaPeriode, LABEL_SALARY_TYPE } from "@/lib/utils";
import type { SlipGaji } from "@/lib/types";

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
export const DetailSlip = ({ slip }: { slip: SlipGaji }) => {
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

