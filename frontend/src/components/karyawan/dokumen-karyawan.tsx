"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { FileText, Upload, Download, Trash2, AlertTriangle, Clock, X } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button, TombolAksi } from "@/components/ui/button";
import { Input, Select, Field, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { LABEL_DOKUMEN, formatTanggal, formatUkuran, sisaHari, cn } from "@/lib/utils";
import type { DokumenKaryawan, JenisDokumen } from "@/lib/types";

const MAKS_BYTE = 5_000_000;
const DITERIMA = ".pdf,.jpg,.jpeg,.png,.webp,.docx";

type FormUnggah = { type: JenisDokumen; title: string; issuedAt: string; expiresAt: string; notes: string };

const bacaBase64 = (berkas: File) =>
  new Promise<string>((selesai, gagal) => {
    const r = new FileReader();
    r.onload = () => selesai(String(r.result));
    r.onerror = () => gagal(new Error("Berkas tidak bisa dibaca"));
    r.readAsDataURL(berkas);
  });

/** Badge masa berlaku yang menyebut sisa harinya, bukan sekadar tanggalnya. */
const BadgeMasaBerlaku = ({ tanggal }: { tanggal: string | null }) => {
  const sisa = sisaHari(tanggal);
  if (sisa === null) return null;
  if (sisa < 0) return <Badge tone="danger" dot><AlertTriangle className="h-3 w-3" aria-hidden /> Kedaluwarsa {Math.abs(sisa)} hari lalu</Badge>;
  if (sisa <= 30) return <Badge tone="warning" dot><Clock className="h-3 w-3" aria-hidden /> {sisa} hari lagi</Badge>;
  return <Badge tone="neutral">Berlaku s/d {formatTanggal(tanggal)}</Badge>;
};

export const PanelDokumen = ({ employeeId, bolehUnggah, bolehHapus }: { employeeId: string; bolehUnggah: boolean; bolehHapus: boolean }) => {
  const hr = bolehUnggah || bolehHapus;
  const qc = useQueryClient();
  const [unggahBuka, setUnggahBuka] = React.useState(false);
  const [berkas, setBerkas] = React.useState<File | null>(null);
  const [hapus, setHapus] = React.useState<DokumenKaryawan | null>(null);
  const [seret, setSeret] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["dokumen", employeeId],
    queryFn: async () => (await api.get<{ data: DokumenKaryawan[] }>(`/employees/${employeeId}/documents`)).data.data,
  });

  const fu = useForm<FormUnggah>({ defaultValues: { type: "cv", title: "", issuedAt: "", expiresAt: "", notes: "" } });

  const pilihBerkas = (f: File | null) => {
    if (!f) return;
    if (f.size > MAKS_BYTE) {
      notifikasi.peringatan("Berkas terlalu besar", `${formatUkuran(f.size)} — maksimal ${formatUkuran(MAKS_BYTE)}.`);
      return;
    }
    setBerkas(f);
    if (!fu.getValues("title")) fu.setValue("title", f.name.replace(/\.[^.]+$/, ""));
  };

  const unggah = useMutation({
    mutationFn: async (v: FormUnggah) => {
      if (!berkas) throw new Error("Pilih berkas terlebih dahulu");
      const file = await bacaBase64(berkas);
      return (
        await api.post<DokumenKaryawan>(`/employees/${employeeId}/documents`, {
          type: v.type,
          title: v.title,
          fileName: berkas.name,
          file,
          ...(v.issuedAt ? { issuedAt: v.issuedAt } : {}),
          ...(v.expiresAt ? { expiresAt: v.expiresAt } : {}),
          ...(v.notes ? { notes: v.notes } : {}),
        })
      ).data;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["dokumen", employeeId] });
      notifikasi.sukses("Dokumen tersimpan", `${LABEL_DOKUMEN[d.type]} · ${d.originalName} (${formatUkuran(d.sizeBytes)})`);
      setUnggahBuka(false);
      setBerkas(null);
      fu.reset();
    },
    onError: (e) => notifikasi.galat(e, "Unggahan gagal"),
  });

  const hapusDok = useMutation({
    mutationFn: async (d: DokumenKaryawan) => api.delete(`/documents/${d.id}`),
    onSuccess: (_, d) => {
      qc.invalidateQueries({ queryKey: ["dokumen", employeeId] });
      notifikasi.sukses("Dokumen dihapus", `${d.title} disembunyikan. Berkasnya tetap tersimpan untuk keperluan audit.`);
      setHapus(null);
    },
    onError: (e) => notifikasi.galat(e),
  });

  const kedaluwarsa = (data ?? []).filter((d) => (sisaHari(d.expiresAt) ?? 1) <= 30).length;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Dokumen</CardTitle>
          <CardDescription>
            {data ? `${data.length} berkas` : "CV, ijazah, kontrak, NPWP, BPJS"}
            {kedaluwarsa > 0 && <span className="text-warning"> · {kedaluwarsa} perlu diperbarui</span>}
          </CardDescription>
        </div>
        {bolehUnggah && (
          <Button size="sm" onClick={() => setUnggahBuka(true)}>
            <Upload className="h-4 w-4" aria-hidden /> Unggah
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {isLoading ? (
          <SkeletonBaris jumlah={3} />
        ) : !data?.length ? (
          <EmptyState icon={FileText} title="Belum ada dokumen" description={hr ? "Unggah CV, kontrak kerja, atau dokumen lain untuk karyawan ini." : "HR belum mengunggah dokumen untuk Anda."} />
        ) : (
          <ul className="divide-y divide-border">
            {data.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3 sm:px-5 animate-fade-up">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                  <FileText className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{d.title}</p>
                  <p className="truncate text-xs text-muted">
                    {LABEL_DOKUMEN[d.type]} · {formatUkuran(d.sizeBytes)} · {formatTanggal(d.createdAt)}
                  </p>
                  <div className="mt-1"><BadgeMasaBerlaku tanggal={d.expiresAt} /></div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <a
                    href={`/api/backend/documents/${d.id}/download`}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground"
                    aria-label={`Unduh ${d.title}`}
                    download
                  >
                    <Download className="h-4 w-4" aria-hidden />
                  </a>
                  {bolehHapus && (
                    <TombolAksi icon={Trash2} label={`Hapus ${d.title}`} tone="bahaya" onClick={() => setHapus(d)} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Modal open={unggahBuka} onClose={() => { setUnggahBuka(false); setBerkas(null); }} title="Unggah Dokumen" description="PDF, JPG, PNG, WebP, atau DOCX — maksimal 5 MB"
        footer={<><Button variant="outline" onClick={() => { setUnggahBuka(false); setBerkas(null); }}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button form="form-unggah" type="submit" loading={unggah.isPending} disabled={!berkas}>{!unggah.isPending && <Upload className="h-4 w-4" aria-hidden />} Unggah</Button></>}>
        <form id="form-unggah" onSubmit={fu.handleSubmit((v) => unggah.mutate(v))} className="space-y-4" noValidate>
          <label
            onDragOver={(e) => { e.preventDefault(); setSeret(true); }}
            onDragLeave={() => setSeret(false)}
            onDrop={(e) => { e.preventDefault(); setSeret(false); pilihBerkas(e.dataTransfer.files[0] ?? null); }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
              seret ? "border-primary bg-primary-soft" : "border-border hover:border-primary/60"
            )}
          >
            <Upload className="h-6 w-6 text-muted" aria-hidden />
            {berkas ? (
              <span className="text-sm font-medium break-all">{berkas.name} <span className="text-muted">({formatUkuran(berkas.size)})</span></span>
            ) : (
              <span className="text-sm text-muted">Seret berkas ke sini, atau <span className="text-primary font-medium">pilih dari perangkat</span></span>
            )}
            <input type="file" accept={DITERIMA} className="sr-only" onChange={(e) => pilihBerkas(e.target.files?.[0] ?? null)} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Jenis dokumen">
              <Select {...fu.register("type")}>
                {Object.entries(LABEL_DOKUMEN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Judul" error={fu.formState.errors.title?.message}>
              <Input {...fu.register("title", { required: "Judul wajib diisi", minLength: { value: 2, message: "Minimal 2 karakter" } })} placeholder="Kontrak Kerja 2026" />
            </Field>
            <Field label="Tanggal terbit"><Input type="date" {...fu.register("issuedAt")} /></Field>
            <Field label="Berlaku sampai" hint="Untuk kontrak, SKCK, sertifikat"><Input type="date" {...fu.register("expiresAt")} /></Field>
            <Field label="Catatan" className="sm:col-span-2"><Textarea rows={2} {...fu.register("notes")} /></Field>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={Boolean(hapus)} onClose={() => setHapus(null)} onConfirm={() => hapus && hapusDok.mutate(hapus)} loading={hapusDok.isPending} danger
        title="Hapus dokumen?" description={`"${hapus?.title}" akan disembunyikan dari daftar. Berkasnya tidak benar-benar dihapus — kontrak dan dokumen legal tetap tersimpan sebagai bukti.`} confirmLabel="Hapus" confirmIcon={Trash2} />
    </Card>
  );
};
