"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { ShieldAlert, MessageSquareWarning, Plus, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { useSesi, bolehManajer, bolehHr } from "@/hooks/use-sesi";
import { notifikasi } from "@/hooks/use-notifikasi";
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
import { formatTanggal, formatRelatif, labelStatus, LABEL_SP } from "@/lib/utils";
import type { Halaman, Kasus, Karyawan, JenisKasus, TingkatSP } from "@/lib/types";

type FormKeluhan = { title: string; description: string; incidentDate: string; employeeId: string };
type FormDisiplin = { employeeId: string; title: string; description: string; severity: TingkatSP; incidentDate: string };
type FormStatus = { status: "under_review" | "resolved" | "dismissed"; resolutionNotes: string };

export default function HalamanKasus() {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const manajemen = bolehManajer(saya?.role);
  const hr = bolehHr(saya?.role);

  const [jenis, setJenis] = React.useState<JenisKasus | "">("");
  const [status, setStatus] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [keluhanBuka, setKeluhanBuka] = React.useState(false);
  const [disiplinBuka, setDisiplinBuka] = React.useState(false);
  const [detail, setDetail] = React.useState<Kasus | null>(null);
  const [ubahStatus, setUbahStatus] = React.useState<Kasus | null>(null);

  const params = new URLSearchParams({ page: String(page), limit: "20" });
  if (jenis) params.set("type", jenis);
  if (status) params.set("status", status);

  const { data, isLoading } = useQuery({
    queryKey: ["kasus", params.toString()],
    queryFn: async () => (await api.get<Halaman<Kasus>>(`/cases?${params}`)).data,
    placeholderData: (prev) => prev,
  });

  const karyawan = useQuery({
    queryKey: ["karyawan", "pilihan"],
    queryFn: async () => (await api.get<Halaman<Karyawan>>("/employees?limit=100")).data.data,
    enabled: (keluhanBuka || disiplinBuka) && manajemen,
  });

  const fk = useForm<FormKeluhan>({ defaultValues: { title: "", description: "", incidentDate: "", employeeId: "" } });
  const fd = useForm<FormDisiplin>({ defaultValues: { employeeId: "", title: "", description: "", severity: "sp1", incidentDate: "" } });
  const fs = useForm<FormStatus>({ defaultValues: { status: "under_review", resolutionNotes: "" } });

  const segarkan = () => qc.invalidateQueries({ queryKey: ["kasus"] });

  const ajukanKeluhan = useMutation({
    mutationFn: async (v: FormKeluhan) =>
      (await api.post<Kasus>("/complaints", { title: v.title, description: v.description, ...(v.incidentDate ? { incidentDate: v.incidentDate } : {}), ...(v.employeeId ? { employeeId: v.employeeId } : {}) })).data,
    onSuccess: () => { segarkan(); notifikasi.sukses("Keluhan diajukan", "HR akan meninjaunya. Anda bisa memantau statusnya di halaman ini."); setKeluhanBuka(false); fk.reset(); },
    onError: (e) => notifikasi.galat(e, "Keluhan gagal diajukan"),
  });

  const beriSP = useMutation({
    mutationFn: async (v: FormDisiplin) =>
      (await api.post<Kasus>("/disciplinary-actions", { employeeId: v.employeeId, title: v.title, description: v.description, severity: v.severity, ...(v.incidentDate ? { incidentDate: v.incidentDate } : {}) })).data,
    onSuccess: (k) => {
      segarkan();
      if (k.warning) notifikasi.peringatan("Tercatat, dengan catatan", k.warning);
      else notifikasi.sukses(`${LABEL_SP[k.severity ?? ""]} tercatat`, `${k.employee.name} berhak melihat dan akan melihatnya.`);
      setDisiplinBuka(false); fd.reset();
    },
    onError: (e) => notifikasi.galat(e, "Gagal mencatat tindakan"),
  });

  const simpanStatus = useMutation({
    mutationFn: async (v: FormStatus) =>
      (await api.patch<Kasus>(`/cases/${ubahStatus!.id}/status`, { status: v.status, ...(v.resolutionNotes ? { resolutionNotes: v.resolutionNotes } : {}) })).data,
    onSuccess: (k) => { segarkan(); notifikasi.sukses(`Status: ${labelStatus(k.status)}`, k.title); setUbahStatus(null); setDetail(null); fs.reset(); },
    onError: (e) => notifikasi.galat(e, "Status gagal diubah"),
  });

  const bolehTindak = (k: Kasus) => k.status !== "resolved" && k.status !== "dismissed" && (hr || (saya?.role === "MANAGER" && k.type === "disciplinary_action" && k.employee.departmentId === saya.departmentId));

  return (
    <>
      <PageHeader
        title="Keluhan & Disiplin"
        description={manajemen ? "Keluhan yang masuk dan tindakan disiplin di lingkup Anda" : "Keluhan yang Anda ajukan dan tindakan disiplin yang ditujukan kepada Anda"}
        actions={
          <>
            <Button variant="outline" onClick={() => setKeluhanBuka(true)}><MessageSquareWarning className="h-4 w-4" aria-hidden /> Ajukan Keluhan</Button>
            {manajemen && <Button onClick={() => setDisiplinBuka(true)}><Plus className="h-4 w-4" aria-hidden /> Tindakan Disiplin</Button>}
          </>
        }
      />

      <Card>
        <div className="grid gap-2 border-b border-border p-3 sm:grid-cols-2 md:w-2/3">
          <Select value={jenis} onChange={(e) => { setJenis(e.target.value as JenisKasus | ""); setPage(1); }} aria-label="Jenis">
            <option value="">Semua jenis</option>
            <option value="complaint">Keluhan</option>
            <option value="disciplinary_action">Tindakan disiplin</option>
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            <option value="">Semua status</option>
            {["open", "under_review", "resolved", "dismissed"].map((s) => <option key={s} value={s}>{labelStatus(s)}</option>)}
          </Select>
        </div>

        {isLoading ? <SkeletonBaris /> : !data?.data.length ? (
          <EmptyState icon={ShieldAlert} title="Tidak ada kasus" description={manajemen ? "Belum ada keluhan atau tindakan disiplin pada saringan ini." : "Anda belum mengajukan keluhan, dan tidak ada tindakan disiplin yang ditujukan kepada Anda."} />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {data.data.map((k) => (
                <li key={k.id}>
                  <button type="button" onClick={() => setDetail(k)} className="flex w-full items-center gap-3 p-4 text-left hover:bg-surface-2 transition-colors animate-fade-up">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${k.type === "complaint" ? "bg-info-soft text-info" : "bg-danger-soft text-danger"}`}>
                      {k.type === "complaint" ? <MessageSquareWarning className="h-5 w-5" aria-hidden /> : <ShieldAlert className="h-5 w-5" aria-hidden />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium truncate">{k.title}</p>
                        {k.severity && <Badge tone={nadaStatus(k.severity)}>{LABEL_SP[k.severity]}</Badge>}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {k.type === "complaint" ? "Keluhan" : "Tindakan disiplin"} · {k.employee.name}{k.employee.department ? ` · ${k.employee.department.name}` : ""} · {formatRelatif(k.createdAt)}
                      </p>
                    </div>
                    <Badge tone={nadaStatus(k.status)} dot className="shrink-0">{labelStatus(k.status)}</Badge>
                    <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted sm:block" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            <Pagination pagination={data.pagination} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.title ?? ""} description={detail ? `${detail.type === "complaint" ? "Keluhan" : "Tindakan disiplin"} · ${detail.employee.name}` : undefined}
        footer={detail && bolehTindak(detail) ? <><Button variant="outline" onClick={() => setDetail(null)}>Tutup</Button><Button onClick={() => { setUbahStatus(detail); fs.reset({ status: detail.status === "open" ? "under_review" : "resolved", resolutionNotes: "" }); }}>Tindak Lanjuti</Button></> : <Button variant="outline" onClick={() => setDetail(null)}>Tutup</Button>}>
        {detail && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone={nadaStatus(detail.status)} dot>{labelStatus(detail.status)}</Badge>
              {detail.severity && <Badge tone={nadaStatus(detail.severity)}>{LABEL_SP[detail.severity]}</Badge>}
              {detail.incidentDate && <Badge tone="neutral">Kejadian {formatTanggal(detail.incidentDate)}</Badge>}
            </div>
            <p className="whitespace-pre-wrap">{detail.description}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-muted">
              <dt>Dilaporkan</dt><dd>{detail.reportedBy?.name ?? "—"} · {formatTanggal(detail.createdAt, "d MMM yyyy HH:mm")}</dd>
              {detail.handledBy && <><dt>Ditangani</dt><dd>{detail.handledBy.name}</dd></>}
              {detail.resolvedAt && <><dt>Ditutup</dt><dd>{formatTanggal(detail.resolvedAt, "d MMM yyyy HH:mm")}</dd></>}
            </dl>
            {detail.resolutionNotes && <Alert tone={detail.status === "dismissed" ? "warning" : "success"} title="Catatan penyelesaian">{detail.resolutionNotes}</Alert>}
          </div>
        )}
      </Modal>

      <Modal open={Boolean(ubahStatus)} onClose={() => setUbahStatus(null)} title="Tindak lanjuti kasus" description={ubahStatus?.title}
        footer={<><Button variant="outline" onClick={() => setUbahStatus(null)}>Batal</Button><Button form="form-status" type="submit" loading={simpanStatus.isPending}>Simpan</Button></>}>
        <form id="form-status" onSubmit={fs.handleSubmit((v) => simpanStatus.mutate(v))} className="space-y-4" noValidate>
          <Field label="Status baru">
            <Select {...fs.register("status")}>
              {ubahStatus?.status === "open" && <option value="under_review">Ditinjau</option>}
              <option value="resolved">Selesai</option>
              <option value="dismissed">Ditolak</option>
            </Select>
          </Field>
          <Field label="Catatan penyelesaian" hint="Wajib untuk Selesai/Ditolak — keluhan yang ditutup tanpa alasan sama saja tidak pernah dibaca" error={fs.formState.errors.resolutionNotes?.message}>
            <Textarea rows={3} {...fs.register("resolutionNotes", { validate: (v, f) => f.status === "under_review" || (v && v.length >= 5) || "Minimal 5 karakter" })} />
          </Field>
        </form>
      </Modal>

      <Modal open={keluhanBuka} onClose={() => setKeluhanBuka(false)} title="Ajukan Keluhan" description="Hanya HR yang bisa membaca keluhan ini. Orang yang dikeluhkan tidak akan melihatnya."
        footer={<><Button variant="outline" onClick={() => setKeluhanBuka(false)}>Batal</Button><Button form="form-keluhan" type="submit" loading={ajukanKeluhan.isPending}>Ajukan</Button></>}>
        <form id="form-keluhan" onSubmit={fk.handleSubmit((v) => ajukanKeluhan.mutate(v))} className="space-y-4" noValidate>
          <Field label="Judul" error={fk.formState.errors.title?.message}>
            <Input {...fk.register("title", { required: "Judul wajib diisi", minLength: { value: 3, message: "Minimal 3 karakter" } })} placeholder="Jadwal shift berubah mendadak" />
          </Field>
          <Field label="Uraian" error={fk.formState.errors.description?.message} hint="Ceritakan apa yang terjadi, kapan, dan siapa yang terlibat">
            <Textarea rows={4} {...fk.register("description", { required: "Uraian wajib diisi", minLength: { value: 10, message: "Minimal 10 karakter" } })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tanggal kejadian"><Input type="date" {...fk.register("incidentDate")} /></Field>
            {manajemen && (
              <Field label="Tentang karyawan" hint="Kosongkan bila tentang kondisi kerja Anda sendiri">
                <Select {...fk.register("employeeId")}>
                  <option value="">— Diri sendiri —</option>
                  {(karyawan.data ?? []).filter((k) => k.id !== saya?.id).map((k) => <option key={k.id} value={k.id}>{k.name} · {k.nik}</option>)}
                </Select>
              </Field>
            )}
          </div>
        </form>
      </Modal>

      <Modal open={disiplinBuka} onClose={() => setDisiplinBuka(false)} title="Tindakan Disiplin" description="Karyawan yang bersangkutan berhak dan akan melihat ini"
        footer={<><Button variant="outline" onClick={() => setDisiplinBuka(false)}>Batal</Button><Button variant="danger" form="form-disiplin" type="submit" loading={beriSP.isPending}>Catat</Button></>}>
        <form id="form-disiplin" onSubmit={fd.handleSubmit((v) => beriSP.mutate(v))} className="space-y-4" noValidate>
          <Field label="Karyawan" error={fd.formState.errors.employeeId?.message}>
            <Select {...fd.register("employeeId", { required: "Pilih karyawan" })}>
              <option value="">— Pilih —</option>
              {(karyawan.data ?? []).filter((k) => k.id !== saya?.id && (hr || k.departmentId === saya?.departmentId)).map((k) => <option key={k.id} value={k.id}>{k.name} · {k.nik}</option>)}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tingkat" hint="UU 13/2003 ps. 161: SP1 → SP2 → SP3">
              <Select {...fd.register("severity")}>
                {Object.entries(LABEL_SP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Tanggal kejadian"><Input type="date" {...fd.register("incidentDate")} /></Field>
          </div>
          <Field label="Judul" error={fd.formState.errors.title?.message}>
            <Input {...fd.register("title", { required: "Judul wajib diisi", minLength: { value: 3, message: "Minimal 3 karakter" } })} placeholder="Terlambat berulang" />
          </Field>
          <Field label="Uraian pelanggaran" error={fd.formState.errors.description?.message}>
            <Textarea rows={4} {...fd.register("description", { required: "Uraian wajib diisi", minLength: { value: 10, message: "Minimal 10 karakter" } })} />
          </Field>
        </form>
      </Modal>
    </>
  );
}
