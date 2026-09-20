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
import { formatRupiah, labelStatus, namaPeriode } from "@/lib/utils";
import { DetailSlip } from "@/components/gaji/detail-slip";
import type { Halaman, SlipGaji } from "@/lib/types";

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
