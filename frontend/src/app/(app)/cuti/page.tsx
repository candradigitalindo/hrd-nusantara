"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { CalendarOff, Check, X, Plus, Ban, Paperclip } from "lucide-react";
import { api } from "@/lib/api";
import { useSesi, bolehManajer } from "@/hooks/use-sesi";
import { notifikasi } from "@/hooks/use-notifikasi";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { ResponsiveTable, type Kolom } from "@/components/ui/responsive-table";
import { Pagination } from "@/components/ui/pagination";
import { SkeletonBaris, Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { formatTanggal, labelStatus, formatRelatif } from "@/lib/utils";
import type { Halaman, Cuti, SaldoCuti, TipeCuti } from "@/lib/types";

const TAB_STATUS = ["pending", "approved", "rejected", "cancelled", ""] as const;
type FormAjukan = { leaveTypeId: string; startDate: string; endDate: string; reason: string; attachmentUrl: string };

/** Saldo per jenis cuti, dengan angka sisa yang menonjol — itu yang dicari orang. */
const KartuSaldo = ({ saldo }: { saldo: SaldoCuti }) => {
  const total = saldo.entitledDays + saldo.carriedOverDays;
  // Cuti bersama ikut dihitung sebagai terpakai di bilah — itu memang kuota
  // yang hilang — tapi disebut terpisah supaya orang tahu ke mana perginya.
  const terpakai = saldo.usedDays + (saldo.collectiveLeaveDays ?? 0);
  const persen = total > 0 ? Math.min(100, Math.round((terpakai / total) * 100)) : 0;
  return (
    <Card className="p-4 animate-fade-up">
      <p className="text-sm text-muted truncate">{saldo.leaveType.name}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {saldo.remainingDays} <span className="text-sm font-normal text-muted">hari sisa</span>
      </p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={persen} aria-valuemin={0} aria-valuemax={100} aria-label={`Terpakai ${persen}%`}>
        <div className="h-full rounded-full bg-primary" style={{ width: `${persen}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-muted">
        {saldo.usedDays} dipakai{saldo.collectiveLeaveDays > 0 ? ` · ${saldo.collectiveLeaveDays} cuti bersama` : ""} dari {total}
        {saldo.carriedOverDays > 0 ? ` · ${saldo.carriedOverDays} sisa tahun lalu` : ""}
      </p>
    </Card>
  );
};

export default function HalamanCuti() {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const manajemen = bolehManajer(saya?.role);
  const tahun = new Date().getFullYear();

  const [tab, setTab] = React.useState<"saya" | "persetujuan">("saya");
  const [status, setStatus] = React.useState<(typeof TAB_STATUS)[number]>("pending");
  const [page, setPage] = React.useState(1);
  const [ajukanBuka, setAjukanBuka] = React.useState(false);
  const [batal, setBatal] = React.useState<Cuti | null>(null);
  const [keputusan, setKeputusan] = React.useState<{ cuti: Cuti; approved: boolean } | null>(null);
  const [catatan, setCatatan] = React.useState("");

  const antrean = tab === "persetujuan" && manajemen;
  const params = new URLSearchParams({ page: String(page), limit: "20" });
  if (antrean ? status : status) params.set("status", status);

  const daftar = useQuery({
    queryKey: ["cuti", antrean ? "semua" : "saya", params.toString()],
    queryFn: async () => (await api.get<Halaman<Cuti>>(`${antrean ? "/leaves" : "/leaves/me"}?${params}`)).data,
    placeholderData: (prev) => prev,
  });

  const saldo = useQuery({
    queryKey: ["saldo-cuti", tahun],
    queryFn: async () => (await api.get<{ data: SaldoCuti[] }>(`/leave-balances/me?year=${tahun}`)).data.data,
  });

  const tipe = useQuery({
    queryKey: ["tipe-cuti"],
    queryFn: async () => (await api.get<{ data: TipeCuti[] } | TipeCuti[]>("/leave-types")).data,
    select: (d) => (Array.isArray(d) ? d : d.data).filter((t) => t.isActive),
    enabled: ajukanBuka,
  });

  const fa = useForm<FormAjukan>({ defaultValues: { leaveTypeId: "", startDate: "", endDate: "", reason: "", attachmentUrl: "" } });
  const tipeDipilihId = useWatch({ control: fa.control, name: "leaveTypeId" });
  const tipeDipilih = (tipe.data ?? []).find((t) => t.id === tipeDipilihId);
  const saldoDipilih = (saldo.data ?? []).find((s) => s.leaveType.id === tipeDipilihId);

  const ajukan = useMutation({
    mutationFn: async (v: FormAjukan) =>
      (await api.post<Cuti>("/leaves", {
        leaveTypeId: v.leaveTypeId, startDate: v.startDate, endDate: v.endDate,
        ...(v.reason ? { reason: v.reason } : {}), ...(v.attachmentUrl ? { attachmentUrl: v.attachmentUrl } : {}),
      })).data,
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["cuti"] }); qc.invalidateQueries({ queryKey: ["saldo-cuti"] });
      notifikasi.sukses("Pengajuan terkirim", `${c.leaveType.name} ${c.totalDays} hari, menunggu persetujuan atasan.`);
      setAjukanBuka(false); fa.reset();
    },
    onError: (e) => notifikasi.galat(e, "Pengajuan ditolak sistem"),
  });

  const batalkan = useMutation({
    mutationFn: async (c: Cuti) => api.patch(`/leaves/${c.id}/cancel`, {}),
    onSuccess: (_, c) => {
      qc.invalidateQueries({ queryKey: ["cuti"] }); qc.invalidateQueries({ queryKey: ["saldo-cuti"] });
      notifikasi.sukses("Pengajuan dibatalkan", `${c.leaveType.name} ${formatTanggal(c.startDate, "d MMM")} · saldo dikembalikan bila sudah terpotong.`);
      setBatal(null);
    },
    onError: (e) => notifikasi.galat(e, "Tidak bisa dibatalkan"),
  });

  const putuskan = useMutation({
    mutationFn: async ({ cuti, approved }: { cuti: Cuti; approved: boolean }) =>
      api.patch(`/leaves/${cuti.id}/decision`, { approved, ...(catatan ? { note: catatan } : {}) }),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["cuti"] });
      notifikasi.sukses(v.approved ? "Cuti disetujui" : "Cuti ditolak", `${v.cuti.employee.name} · ${v.cuti.leaveType.name}, ${v.cuti.totalDays} hari`);
      setKeputusan(null); setCatatan("");
    },
    onError: (e) => notifikasi.galat(e, "Keputusan gagal disimpan"),
  });

  const kolom: Kolom<Cuti>[] = [
    {
      key: "utama", header: antrean ? "Karyawan" : "Jenis cuti", primary: true,
      cell: (c) => (
        <div>
          <p className="font-medium">{antrean ? c.employee.name : c.leaveType.name}</p>
          <p className="text-xs text-muted">{antrean ? c.leaveType.name : `Diajukan ${formatRelatif(c.createdAt)}`}</p>
        </div>
      ),
    },
    { key: "tanggal", header: "Tanggal", cell: (c) => <span className="tabular-nums">{formatTanggal(c.startDate, "d MMM")} – {formatTanggal(c.endDate, "d MMM yyyy")}</span> },
    { key: "hari", header: "Lama", cell: (c) => `${c.totalDays} hari` },
    { key: "alasan", header: "Alasan", cell: (c) => <span className="line-clamp-2 text-muted">{c.reason ?? "—"}</span> },
    {
      key: "status", header: "Status",
      cell: (c) => (
        <div>
          <Badge tone={nadaStatus(c.status)} dot>{labelStatus(c.status)}</Badge>
          {c.decisionNote && <p className="mt-1 text-xs text-muted line-clamp-2">{c.decisionNote}</p>}
        </div>
      ),
    },
    {
      key: "aksi", header: "", className: "text-right",
      cell: (c) =>
        antrean ? (
          c.status === "pending" ? (
            <div className="flex justify-end gap-1">
              <Button size="sm" onClick={() => setKeputusan({ cuti: c, approved: true })}><Check className="h-4 w-4" aria-hidden /> Setujui</Button>
              <Button size="sm" variant="outline" className="text-danger" onClick={() => setKeputusan({ cuti: c, approved: false })}><X className="h-4 w-4" aria-hidden /> Tolak</Button>
            </div>
          ) : null
        ) : c.status === "pending" ? (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => setBatal(c)}><Ban className="h-4 w-4" aria-hidden /> Batalkan</Button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Cuti & Izin"
        description={antrean ? "Pengajuan cuti yang perlu diputuskan" : `Saldo dan pengajuan cuti Anda tahun ${tahun}`}
        actions={<Button onClick={() => setAjukanBuka(true)}><Plus className="h-4 w-4" aria-hidden /> Ajukan Cuti</Button>}
      />

      {manajemen && (
        <div className="flex gap-1 rounded-xl bg-surface-2 p-1 w-fit" role="tablist">
          {(["saya", "persetujuan"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setStatus("pending"); setPage(1); }}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === t ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"}`}>
              {t === "saya" ? "Cuti Saya" : "Persetujuan"}
            </button>
          ))}
        </div>
      )}

      {!antrean && (
        saldo.isLoading ? <Skeleton className="h-28" /> : saldo.data?.length ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {saldo.data.map((s) => <KartuSaldo key={s.id} saldo={s} />)}
          </div>
        ) : (
          <Alert tone="info" title="Saldo cuti belum ditetapkan">HR belum mengisi saldo cuti Anda untuk tahun {tahun}. Pengajuan tetap bisa dikirim; persetujuannya akan mempertimbangkan ini.</Alert>
        )
      )}

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1 w-fit max-w-full" role="tablist">
        {TAB_STATUS.map((t) => (
          <button key={t || "semua"} role="tab" aria-selected={status === t} onClick={() => { setStatus(t); setPage(1); }}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${status === t ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"}`}>
            {t ? labelStatus(t) : "Semua"}
          </button>
        ))}
      </div>

      <Card>
        {daftar.isLoading ? <SkeletonBaris /> : !daftar.data?.data.length ? (
          <EmptyState icon={CalendarOff}
            title={antrean && status === "pending" ? "Tidak ada yang menunggu" : "Tidak ada pengajuan"}
            description={antrean ? "Semua pengajuan sudah diputuskan." : status === "pending" ? "Anda tidak punya pengajuan yang sedang menunggu." : undefined}
            action={!antrean && <Button onClick={() => setAjukanBuka(true)}>Ajukan Cuti</Button>} />
        ) : (
          <>
            <ResponsiveTable columns={kolom} rows={daftar.data.data} rowKey={(c) => c.id} />
            <Pagination pagination={daftar.data.pagination} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal open={ajukanBuka} onClose={() => setAjukanBuka(false)} title="Ajukan Cuti" description="Atasan Anda akan menerima pengajuan ini untuk disetujui"
        footer={<><Button variant="outline" onClick={() => setAjukanBuka(false)}>Batal</Button><Button form="form-cuti" type="submit" loading={ajukan.isPending}>Kirim Pengajuan</Button></>}>
        <form id="form-cuti" onSubmit={fa.handleSubmit((v) => ajukan.mutate(v))} className="space-y-4" noValidate>
          <Field label="Jenis cuti" error={fa.formState.errors.leaveTypeId?.message}>
            <Select {...fa.register("leaveTypeId", { required: "Pilih jenis cuti" })}>
              <option value="">— Pilih —</option>
              {(tipe.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}{t.isPaid ? "" : " (tanpa gaji)"}</option>)}
            </Select>
          </Field>
          {tipeDipilih && (
            <Alert tone={saldoDipilih && saldoDipilih.remainingDays <= 0 && tipeDipilih.deductsBalance ? "warning" : "info"} title={saldoDipilih ? `Sisa ${saldoDipilih.remainingDays} hari` : tipeDipilih.deductsBalance ? "Saldo belum ditetapkan" : "Tidak memotong saldo"}>
              {tipeDipilih.description ?? ""}
              {tipeDipilih.maxConsecutiveDays ? ` Maksimal ${tipeDipilih.maxConsecutiveDays} hari berturut-turut.` : ""}
              {tipeDipilih.requiresAttachment ? " Wajib melampirkan bukti (mis. surat dokter)." : ""}
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mulai" error={fa.formState.errors.startDate?.message}>
              <Input type="date" {...fa.register("startDate", { required: "Wajib diisi" })} />
            </Field>
            <Field label="Selesai" error={fa.formState.errors.endDate?.message}>
              <Input type="date" {...fa.register("endDate", { required: "Wajib diisi", validate: (v, f) => !f.startDate || v >= f.startDate || "Tidak boleh sebelum tanggal mulai" })} />
            </Field>
          </div>
          <Field label="Alasan" hint="Opsional, tapi membantu atasan memutuskan">
            <Textarea rows={3} {...fa.register("reason")} />
          </Field>
          {tipeDipilih?.requiresAttachment && (
            <Field label="Tautan bukti" error={fa.formState.errors.attachmentUrl?.message} hint="Alamat berkas surat dokter atau dokumen pendukung">
              <div className="relative">
                <Paperclip className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                <Input className="pl-9" placeholder="https://…" {...fa.register("attachmentUrl", { required: "Jenis cuti ini wajib melampirkan bukti" })} />
              </div>
            </Field>
          )}
        </form>
      </Modal>

      <ConfirmDialog open={Boolean(batal)} onClose={() => setBatal(null)} onConfirm={() => batal && batalkan.mutate(batal)} loading={batalkan.isPending} danger
        title="Batalkan pengajuan?" description={`${batal?.leaveType.name ?? ""} ${batal ? formatTanggal(batal.startDate, "d MMM") : ""} – ${batal ? formatTanggal(batal.endDate, "d MMM yyyy") : ""} akan dibatalkan. Anda bisa mengajukan lagi kapan saja.`} confirmLabel="Batalkan Pengajuan" />

      <Modal open={Boolean(keputusan)} onClose={() => setKeputusan(null)}
        title={keputusan?.approved ? "Setujui pengajuan cuti?" : "Tolak pengajuan cuti?"}
        description={keputusan ? `${keputusan.cuti.employee.name} · ${keputusan.cuti.leaveType.name} · ${keputusan.cuti.totalDays} hari` : undefined}
        footer={<><Button variant="outline" onClick={() => setKeputusan(null)}>Batal</Button><Button variant={keputusan?.approved ? "primary" : "danger"} loading={putuskan.isPending} onClick={() => keputusan && putuskan.mutate(keputusan)}>{keputusan?.approved ? "Setujui" : "Tolak"}</Button></>}>
        <Field label="Catatan untuk karyawan" hint={keputusan?.approved ? "Opsional" : "Sebutkan alasannya agar karyawan tahu apa yang bisa diperbaiki"}>
          <Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={3} />
        </Field>
      </Modal>
    </>
  );
}
