"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { Plus, Search, UserCheck, CalendarPlus, ClipboardList, ArrowRightCircle, FileText, ExternalLink, ClipboardPen, Save, UserPlus, X } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
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
import { formatTanggal, formatRupiah, formatRelatif, LABEL_TAHAP, LABEL_HASIL_WAWANCARA, labelStatus, LABEL_STATUS } from "@/lib/utils";
import type { Halaman, Kandidat, Lowongan, Karyawan, Departemen, Jabatan, HasilPsikotes, TahapKandidat } from "@/lib/types";

const TAHAP: TahapKandidat[] = ["applied", "screening", "interview", "offer", "hired", "rejected", "withdrawn"];

type FormKandidat = { jobPostingId: string; name: string; email: string; phoneNumber: string; source: string; cvUrl: string; expectedSalary: string; notes: string };
type FormTahap = { stage: TahapKandidat; note: string; rejectionReason: string };
type FormWawancara = { interviewerId: string; stage: string; round: string; scheduledDateTime: string; durationMinutes: string; location: string; notes: string };
type FormPsikotes = { testName: string; score: string; maxScore: string; testDate: string; interpretation: string };
type FormHire = { nik: string; joinDate: string; departmentId: string; positionId: string; employeeStatus: string; note: string };

const isoLokal = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const PanelPelamar = ({ lowonganAwal }: { lowonganAwal?: string }) => {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const bolehBuat = punyaIzin(saya, "rekrutmen.buat");
  const bolehUbah = punyaIzin(saya, "rekrutmen.ubah");
  const [cari, setCari] = React.useState("");
  const [cariTunda, setCariTunda] = React.useState("");
  const [tahap, setTahap] = React.useState("");
  const [lowonganId, setLowonganId] = React.useState(lowonganAwal ?? "");
  const [page, setPage] = React.useState(1);
  const [tambahBuka, setTambahBuka] = React.useState(false);
  const [detail, setDetail] = React.useState<Kandidat | null>(null);
  const [aksi, setAksi] = React.useState<"tahap" | "wawancara" | "psikotes" | "hire" | null>(null);

  React.useEffect(() => { const t = setTimeout(() => { setCariTunda(cari.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [cari]);

  const params = new URLSearchParams({ page: String(page), limit: "20" });
  if (cariTunda) params.set("search", cariTunda);
  if (tahap) params.set("stage", tahap);
  if (lowonganId) params.set("jobPostingId", lowonganId);

  const kandidat = useQuery({ queryKey: ["kandidat", params.toString()], queryFn: async () => (await api.get<Halaman<Kandidat>>(`/candidates?${params}`)).data, placeholderData: (p) => p });
  const lowongan = useQuery({ queryKey: ["lowongan", "semua"], queryFn: async () => (await api.get<Halaman<Lowongan>>("/job-postings?limit=100")).data.data });
  const karyawan = useQuery({ queryKey: ["karyawan", "pilihan"], queryFn: async () => (await api.get<Halaman<Karyawan>>("/employees?limit=100")).data.data, enabled: aksi === "wawancara" });
  const departemen = useQuery({ queryKey: ["departemen", "semua"], queryFn: async () => (await api.get<Halaman<Departemen>>("/departments?limit=100")).data.data, enabled: aksi === "hire" });
  const jabatan = useQuery({ queryKey: ["jabatan", "semua"], queryFn: async () => (await api.get<Halaman<Jabatan>>("/positions?limit=100")).data.data, enabled: aksi === "hire" });
  const psikotes = useQuery({ queryKey: ["psikotes", detail?.id], queryFn: async () => (await api.get<Halaman<HasilPsikotes>>(`/psychometric-tests?candidateId=${detail!.id}&limit=50`)).data.data, enabled: Boolean(detail) });

  const segarkan = async () => {
    await qc.invalidateQueries({ queryKey: ["kandidat"] });
    if (detail) { const d = (await api.get<Kandidat>(`/candidates/${detail.id}`)).data; setDetail(d); }
  };

  const fk = useForm<FormKandidat>({ defaultValues: { jobPostingId: "", name: "", email: "", phoneNumber: "", source: "", cvUrl: "", expectedSalary: "", notes: "" } });
  const ft = useForm<FormTahap>({ defaultValues: { stage: "screening", note: "", rejectionReason: "" } });
  const fw = useForm<FormWawancara>({ defaultValues: { interviewerId: "", stage: "hr", round: "1", scheduledDateTime: "", durationMinutes: "60", location: "", notes: "" } });
  const fp = useForm<FormPsikotes>({ defaultValues: { testName: "DISC", score: "", maxScore: "100", testDate: "", interpretation: "" } });
  const fh = useForm<FormHire>({ defaultValues: { nik: "", joinDate: "", departmentId: "", positionId: "", employeeStatus: "probation", note: "" } });

  const tambah = useMutation({
    mutationFn: async (v: FormKandidat) => (await api.post<Kandidat>("/candidates", { jobPostingId: v.jobPostingId, name: v.name, email: v.email, ...(v.phoneNumber ? { phoneNumber: v.phoneNumber } : {}), ...(v.source ? { source: v.source } : {}), ...(v.cvUrl ? { cvUrl: v.cvUrl } : {}), ...(v.expectedSalary ? { expectedSalary: Number(v.expectedSalary) } : {}), ...(v.notes ? { notes: v.notes } : {}) })).data,
    onSuccess: (k) => { qc.invalidateQueries({ queryKey: ["kandidat"] }); notifikasi.sukses("Pelamar dicatat", `${k.name} · ${k.appliedPosition.title}`); setTambahBuka(false); fk.reset(); },
    onError: (e) => notifikasi.galat(e, "Pelamar gagal dicatat"),
  });
  const pindah = useMutation({
    mutationFn: async (v: FormTahap) => (await api.patch<{ message: string; candidate: Kandidat }>(`/candidates/${detail!.id}/stage`, { stage: v.stage, ...(v.note ? { note: v.note } : {}), ...(v.rejectionReason ? { rejectionReason: v.rejectionReason } : {}) })).data,
    onSuccess: async (r) => { await segarkan(); notifikasi.sukses(`Tahap: ${LABEL_TAHAP[r.candidate.status]}`, r.candidate.name); setAksi(null); ft.reset(); },
    onError: (e) => notifikasi.galat(e, "Tahap gagal diubah"),
  });
  const jadwalkan = useMutation({
    mutationFn: async (v: FormWawancara) => (await api.post(`/interviews`, { candidateId: detail!.id, interviewerId: v.interviewerId, stage: v.stage, round: Number(v.round), scheduledDateTime: new Date(v.scheduledDateTime).toISOString(), durationMinutes: Number(v.durationMinutes), ...(v.location ? { location: v.location } : {}), ...(v.notes ? { notes: v.notes } : {}) })).data,
    onSuccess: async () => { await segarkan(); qc.invalidateQueries({ queryKey: ["wawancara"] }); notifikasi.sukses("Wawancara dijadwalkan", "Pewawancara akan melihatnya di tab Wawancara."); setAksi(null); },
    onError: (e) => notifikasi.galat(e, "Jadwal gagal dibuat"),
  });
  const catatPsikotes = useMutation({
    mutationFn: async (v: FormPsikotes) => (await api.post(`/candidates/${detail!.id}/psychometric-tests`, { testName: v.testName, score: Number(v.score), ...(v.maxScore ? { maxScore: Number(v.maxScore) } : {}), ...(v.testDate ? { testDate: v.testDate } : {}), ...(v.interpretation ? { interpretation: v.interpretation } : {}) })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["psikotes", detail?.id] }); notifikasi.sukses("Hasil psikotes dicatat"); setAksi(null); fp.reset(); },
    onError: (e) => notifikasi.galat(e, "Hasil gagal dicatat"),
  });
  const terima = useMutation({
    mutationFn: async (v: FormHire) => (await api.post<{ candidate: Kandidat; employee: { id: string; nik: string; name: string } }>(`/candidates/${detail!.id}/hire`, { nik: v.nik, joinDate: v.joinDate, employeeStatus: v.employeeStatus, ...(v.departmentId ? { departmentId: v.departmentId } : {}), ...(v.positionId ? { positionId: v.positionId } : {}), ...(v.note ? { note: v.note } : {}) })).data,
    onSuccess: async (r) => { await segarkan(); qc.invalidateQueries({ queryKey: ["karyawan"] }); notifikasi.sukses("Kandidat diterima", `Data karyawan ${r.employee?.nik ?? ""} dibuat. Lengkapi gaji dan dokumennya di halaman Karyawan.`); setAksi(null); fh.reset(); },
    onError: (e) => notifikasi.galat(e, "Penerimaan gagal"),
  });

  const kolom: Kolom<Kandidat>[] = [
    { key: "nama", header: "Pelamar", primary: true, cell: (k) => <div><p className="font-medium">{k.name}</p><p className="text-xs text-muted">{k.email}{k.source ? ` · ${k.source}` : ""}</p></div> },
    { key: "lowongan", header: "Lowongan", cell: (k) => k.appliedPosition.title },
    { key: "tahap", header: "Tahap", cell: (k) => <Badge tone={nadaStatus(k.status)} dot>{LABEL_TAHAP[k.status]}</Badge> },
    { key: "wawancara", header: "Wawancara", cell: (k) => k.interviews.length ? `${k.interviews.filter((w) => w.status === "completed").length}/${k.interviews.length} selesai` : <span className="text-muted">—</span> },
    { key: "melamar", header: "Melamar", cell: (k) => formatRelatif(k.applicationDate) },
  ];

  const tahapBerikut = (s: TahapKandidat): TahapKandidat[] => ({ applied: ["screening", "rejected", "withdrawn"], screening: ["interview", "applied", "rejected", "withdrawn"], interview: ["offer", "screening", "rejected", "withdrawn"], offer: ["interview", "rejected", "withdrawn"], hired: [], rejected: ["applied"], withdrawn: [] } as Record<TahapKandidat, TahapKandidat[]>)[s];
  const tahapDipilih = useWatch({ control: ft.control, name: "stage" });

  return (
    <>
      <Card>
        <div className="grid gap-2 border-b border-border p-3 sm:grid-cols-[1fr_auto_auto_auto]">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden /><Input className="pl-9" placeholder="Cari nama atau email…" value={cari} onChange={(e) => setCari(e.target.value)} aria-label="Cari pelamar" /></div>
          <Select value={lowonganId} onChange={(e) => { setLowonganId(e.target.value); setPage(1); }} aria-label="Lowongan" className="sm:w-52"><option value="">Semua lowongan</option>{(lowongan.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</Select>
          <Select value={tahap} onChange={(e) => { setTahap(e.target.value); setPage(1); }} aria-label="Tahap" className="sm:w-44"><option value="">Semua tahap</option>{TAHAP.map((t) => <option key={t} value={t}>{LABEL_TAHAP[t]}</option>)}</Select>
          {bolehBuat && <Button onClick={() => setTambahBuka(true)}><Plus className="h-4 w-4" aria-hidden /> Pelamar</Button>}
        </div>
        {kandidat.isLoading ? <SkeletonBaris /> : !kandidat.data?.data.length ? (
          <EmptyState icon={UserCheck} title="Belum ada pelamar" description="Catat pelamar yang masuk dari lowongan yang sudah ditayangkan." action={bolehBuat && <Button onClick={() => setTambahBuka(true)}><ClipboardPen className="h-4 w-4" aria-hidden /> Catat Pelamar</Button>} />
        ) : (<><ResponsiveTable columns={kolom} rows={kandidat.data.data} rowKey={(k) => k.id} onRowClick={(k) => setDetail(k)} /><Pagination pagination={kandidat.data.pagination} onPage={setPage} /></>)}
      </Card>

      <Modal open={tambahBuka} onClose={() => setTambahBuka(false)} size="lg" title="Catat Pelamar"
        footer={<><Button variant="outline" onClick={() => setTambahBuka(false)}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button form="form-kandidat" type="submit" loading={tambah.isPending}>{!tambah.isPending && <ClipboardPen className="h-4 w-4" aria-hidden />} Catat</Button></>}>
        <form id="form-kandidat" onSubmit={fk.handleSubmit((v) => tambah.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Lowongan" error={fk.formState.errors.jobPostingId?.message} className="sm:col-span-2"><Select {...fk.register("jobPostingId", { required: "Pilih lowongan" })}><option value="">— Pilih —</option>{(lowongan.data ?? []).filter((l) => l.status === "open").map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</Select></Field>
          <Field label="Nama" error={fk.formState.errors.name?.message}><Input {...fk.register("name", { required: "Wajib diisi" })} /></Field>
          <Field label="Email" error={fk.formState.errors.email?.message}><Input type="email" {...fk.register("email", { required: "Wajib diisi" })} /></Field>
          <Field label="No. HP"><Input inputMode="tel" {...fk.register("phoneNumber")} /></Field>
          <Field label="Sumber" hint="referral, jobstreet, walk-in, …"><Input {...fk.register("source")} /></Field>
          <Field label="Tautan CV"><Input placeholder="https://…" {...fk.register("cvUrl")} /></Field>
          <Field label="Ekspektasi gaji (Rp)"><Input type="number" min={0} step={100000} {...fk.register("expectedSalary")} /></Field>
          <Field label="Catatan" className="sm:col-span-2"><Textarea rows={2} {...fk.register("notes")} /></Field>
        </form>
      </Modal>

      <Modal open={Boolean(detail) && !aksi} onClose={() => setDetail(null)} size="lg" title={detail?.name ?? ""} description={detail ? `${detail.appliedPosition.title} · ${detail.email}${detail.phoneNumber ? ` · ${detail.phoneNumber}` : ""}` : undefined}
        footer={detail && (
          <div className="flex flex-wrap gap-2">
            {bolehUbah && tahapBerikut(detail.status).length > 0 && <Button variant="outline" onClick={() => { ft.reset({ stage: tahapBerikut(detail.status)[0], note: "", rejectionReason: "" }); setAksi("tahap"); }}><ArrowRightCircle className="h-4 w-4" aria-hidden /> Ubah Tahap</Button>}
            {bolehBuat && !["hired", "rejected", "withdrawn"].includes(detail.status) && <Button variant="outline" onClick={() => { fw.reset({ interviewerId: "", stage: "hr", round: "1", scheduledDateTime: isoLokal(new Date(Date.now() + 86_400_000)), durationMinutes: "60", location: "", notes: "" }); setAksi("wawancara"); }}><CalendarPlus className="h-4 w-4" aria-hidden /> Jadwalkan Wawancara</Button>}
            {bolehBuat && !["hired", "rejected", "withdrawn"].includes(detail.status) && <Button variant="outline" onClick={() => { fp.reset({ testName: "DISC", score: "", maxScore: "100", testDate: new Date().toISOString().slice(0, 10), interpretation: "" }); setAksi("psikotes"); }}><ClipboardList className="h-4 w-4" aria-hidden /> Catat Psikotes</Button>}
            {bolehUbah && detail.status === "offer" && <Button onClick={() => { fh.reset({ nik: "", joinDate: new Date().toISOString().slice(0, 10), departmentId: "", positionId: detail.appliedPositionId ? "" : "", employeeStatus: "probation", note: "" }); setAksi("hire"); }}><UserCheck className="h-4 w-4" aria-hidden /> Terima</Button>}
          </div>
        )}>
        {detail && (
          <div className="space-y-5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={nadaStatus(detail.status)} dot className="text-sm">{LABEL_TAHAP[detail.status]}</Badge>
              {detail.expectedSalary && <Badge tone="neutral">Ekspektasi {formatRupiah(detail.expectedSalary)}</Badge>}
              {detail.cvUrl && <a href={detail.cvUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><FileText className="h-4 w-4" aria-hidden /> CV <ExternalLink className="h-3 w-3" aria-hidden /></a>}
            </div>
            {detail.rejectionReason && <Alert tone="danger" title="Alasan penolakan">{detail.rejectionReason}</Alert>}
            {detail.hiredEmployeeId && <Alert tone="success" title="Sudah menjadi karyawan" action={<a href={`/karyawan/${detail.hiredEmployeeId}`} className="text-sm font-medium underline">Buka data karyawan</a>} />}
            {detail.notes && <p className="text-muted">{detail.notes}</p>}

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Wawancara</h3>
              {detail.interviews.length === 0 ? <p className="text-muted">Belum ada.</p> : (
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {detail.interviews.map((w) => (
                    <li key={w.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div><p className="font-medium">{w.stage} · putaran {w.round}</p><p className="text-xs text-muted">{formatTanggal(w.scheduledDateTime, "EEE, d MMM yyyy HH:mm")}</p></div>
                      <div className="flex items-center gap-2">{w.score !== null && <span className="tabular-nums text-muted">{w.score}</span>}<Badge tone={nadaStatus(w.result ?? w.status)} dot>{w.result ? LABEL_HASIL_WAWANCARA[w.result] : labelStatus(w.status)}</Badge></div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Psikotes</h3>
              {!psikotes.data?.length ? <p className="text-muted">Belum ada.</p> : (
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {psikotes.data.map((p) => (
                    <li key={p.id} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-3"><p className="font-medium">{p.testName}</p><span className="tabular-nums">{p.score}{p.maxScore ? ` / ${p.maxScore}` : ""}</span></div>
                      {p.interpretation && <p className="mt-0.5 text-xs text-muted">{p.interpretation}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Riwayat tahap</h3>
              <ol className="space-y-1.5 border-l-2 border-border pl-3">
                {detail.stageHistory.map((h, i) => (
                  <li key={i} className="text-xs"><span className="font-medium text-foreground">{LABEL_TAHAP[h.toStage] ?? h.toStage}</span> <span className="text-muted">· {formatTanggal(h.createdAt, "d MMM yyyy HH:mm")}{h.note ? ` · ${h.note}` : ""}</span></li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </Modal>

      <Modal open={aksi === "tahap"} onClose={() => setAksi(null)} title="Ubah Tahap" description={detail?.name}
        footer={<><Button variant="outline" onClick={() => setAksi(null)}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button variant={tahapDipilih === "rejected" ? "danger" : "primary"} form="form-tahap" type="submit" loading={pindah.isPending}>{!pindah.isPending && <Save className="h-4 w-4" aria-hidden />} Simpan</Button></>}>
        <form id="form-tahap" onSubmit={ft.handleSubmit((v) => pindah.mutate(v))} className="space-y-4" noValidate>
          <Field label="Tahap baru"><Select {...ft.register("stage")}>{detail && tahapBerikut(detail.status).map((t) => <option key={t} value={t}>{LABEL_TAHAP[t]}</option>)}</Select></Field>
          {tahapDipilih === "rejected" ? (
            <Field label="Alasan penolakan" error={ft.formState.errors.rejectionReason?.message} hint="Wajib — penolakan tanpa alasan tercatat tidak bisa dipertanggungjawabkan"><Textarea rows={3} {...ft.register("rejectionReason", { required: "Penolakan harus disertai alasan" })} /></Field>
          ) : (
            <Field label="Catatan"><Textarea rows={2} {...ft.register("note")} /></Field>
          )}
          {tahapDipilih === "offer" && <Alert tone="info" title="Tahap penawaran">Setelah kandidat menerima penawaran, gunakan tombol Terima untuk membuat data karyawannya.</Alert>}
        </form>
      </Modal>

      <Modal open={aksi === "wawancara"} onClose={() => setAksi(null)} title="Jadwalkan Wawancara" description={detail?.name}
        footer={<><Button variant="outline" onClick={() => setAksi(null)}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button form="form-wawancara" type="submit" loading={jadwalkan.isPending}>{!jadwalkan.isPending && <CalendarPlus className="h-4 w-4" aria-hidden />} Jadwalkan</Button></>}>
        <form id="form-wawancara" onSubmit={fw.handleSubmit((v) => jadwalkan.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Pewawancara" error={fw.formState.errors.interviewerId?.message} className="sm:col-span-2"><Select {...fw.register("interviewerId", { required: "Pilih pewawancara" })}><option value="">— Pilih —</option>{(karyawan.data ?? []).map((k) => <option key={k.id} value={k.id}>{k.name} · {k.position?.name ?? k.nik}</option>)}</Select></Field>
          <Field label="Jenis"><Select {...fw.register("stage")}><option value="hr">HR</option><option value="user">User / atasan</option><option value="technical">Teknis / praktik</option><option value="final">Final</option></Select></Field>
          <Field label="Putaran"><Input type="number" min={1} {...fw.register("round")} /></Field>
          <Field label="Waktu" error={fw.formState.errors.scheduledDateTime?.message}><Input type="datetime-local" {...fw.register("scheduledDateTime", { required: "Wajib diisi" })} /></Field>
          <Field label="Durasi (menit)"><Input type="number" min={10} step={15} {...fw.register("durationMinutes")} /></Field>
          <Field label="Lokasi" className="sm:col-span-2"><Input placeholder="Outlet Kemang / Google Meet" {...fw.register("location")} /></Field>
        </form>
      </Modal>

      <Modal open={aksi === "psikotes"} onClose={() => setAksi(null)} title="Catat Hasil Psikotes" description={detail?.name}
        footer={<><Button variant="outline" onClick={() => setAksi(null)}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button form="form-psikotes" type="submit" loading={catatPsikotes.isPending}>{!catatPsikotes.isPending && <ClipboardPen className="h-4 w-4" aria-hidden />} Catat</Button></>}>
        <form id="form-psikotes" onSubmit={fp.handleSubmit((v) => catatPsikotes.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Nama tes" error={fp.formState.errors.testName?.message}><Input {...fp.register("testName", { required: "Wajib diisi" })} placeholder="DISC, Kraepelin, MBTI" /></Field>
          <Field label="Tanggal tes"><Input type="date" {...fp.register("testDate")} /></Field>
          <Field label="Skor" error={fp.formState.errors.score?.message}><Input type="number" min={0} step="0.1" {...fp.register("score", { required: "Wajib diisi", validate: (v, f) => !f.maxScore || Number(v) <= Number(f.maxScore) || "Melebihi skor maksimal" })} /></Field>
          <Field label="Skor maksimal" hint="Tanpa ini, angka 72 tidak berarti apa-apa"><Input type="number" min={1} {...fp.register("maxScore")} /></Field>
          <Field label="Interpretasi" className="sm:col-span-2"><Textarea rows={3} {...fp.register("interpretation")} placeholder="Kepribadian, sikap, potensi — kecocokan dengan posisi" /></Field>
        </form>
      </Modal>

      <Modal open={aksi === "hire"} onClose={() => setAksi(null)} title="Terima Kandidat" description="Data karyawan akan dibuat sekaligus. Gaji dan dokumen dilengkapi setelahnya."
        footer={<><Button variant="outline" onClick={() => setAksi(null)}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button form="form-hire" type="submit" loading={terima.isPending}>{!terima.isPending && <UserPlus className="h-4 w-4" aria-hidden />} Terima & Buat Karyawan</Button></>}>
        <form id="form-hire" onSubmit={fh.handleSubmit((v) => terima.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="NIK" error={fh.formState.errors.nik?.message}><Input {...fh.register("nik", { required: "Wajib diisi" })} placeholder="EMP-0042" /></Field>
          <Field label="Tanggal bergabung" error={fh.formState.errors.joinDate?.message}><Input type="date" {...fh.register("joinDate", { required: "Wajib diisi" })} /></Field>
          <Field label="Departemen"><Select {...fh.register("departmentId")}><option value="">— Belum ditentukan —</option>{(departemen.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Jabatan"><Select {...fh.register("positionId")}><option value="">— Belum ditentukan —</option>{(jabatan.data ?? []).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</Select></Field>
          <Field label="Status awal"><Select {...fh.register("employeeStatus")}>{["probation", "contract", "internship", "active"].map((s) => <option key={s} value={s}>{LABEL_STATUS[s]}</option>)}</Select></Field>
          <Field label="Catatan"><Input {...fh.register("note")} /></Field>
        </form>
      </Modal>
    </>
  );
};
