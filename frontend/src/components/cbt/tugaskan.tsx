"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link2, Search, Send, UserPlus, X } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Button } from "@/components/ui/button";
import { Input, Field, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Halaman, Kandidat, KaryawanDirektori, PaketCbt } from "@/lib/types";

interface HasilTugas {
  dibuat: number;
  dilewati: number;
  tautan: { assignmentId: string; nama: string; token: string }[];
}

/** Tautan pengerjaan untuk pelamar; hanya bisa dilihat sekali, di sini. */
const DaftarTautan = ({ tautan }: { tautan: HasilTugas["tautan"] }) => {
  const [disalin, setDisalin] = React.useState<string | null>(null);
  const alamat = (token: string) => `${window.location.origin}/tes/${token}`;

  return (
    <div className="space-y-2">
      <Alert tone="warning" title="Salin tautan sekarang">
        Tautan hanya ditampilkan sekali. Server hanya menyimpan sidiknya, jadi tautan yang hilang harus dibuat ulang.
      </Alert>
      {tautan.map((t) => (
        <div key={t.assignmentId} className="flex items-center gap-2 rounded-lg border border-border p-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t.nama}</p>
            <p className="truncate font-mono text-xs text-muted">{alamat(t.token)}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(alamat(t.token)).then(() => {
                setDisalin(t.assignmentId);
                notifikasi.sukses("Tautan disalin", t.nama);
              });
            }}
          >
            {disalin === t.assignmentId ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} Salin
          </Button>
        </div>
      ))}
    </div>
  );
};

/** Memilih peserta lalu menugaskan paket tes kepada mereka. */
export const DialogTugaskan = ({ paket, onClose }: { paket: PaketCbt; onClose: () => void }) => {
  const qc = useQueryClient();
  const [cari, setCari] = React.useState("");
  const [karyawanId, setKaryawanId] = React.useState<string[]>([]);
  const [pelamarId, setPelamarId] = React.useState<string[]>([]);
  const [mulai, setMulai] = React.useState("");
  const [sampai, setSampai] = React.useState("");
  const [catatan, setCatatan] = React.useState("");
  const [hasil, setHasil] = React.useState<HasilTugas | null>(null);

  const untukKaryawan = paket.audience !== "pelamar";
  const untukPelamar = paket.audience !== "karyawan";

  const karyawan = useQuery({
    queryKey: ["direktori", cari],
    queryFn: async () => (await api.get<{ data: KaryawanDirektori[] }>(`/employees/directory${cari ? `?q=${encodeURIComponent(cari)}` : ""}`)).data.data,
    enabled: untukKaryawan,
  });
  const pelamar = useQuery({
    queryKey: ["kandidat", "cbt", cari],
    queryFn: async () => (await api.get<Halaman<Kandidat>>(`/candidates?limit=50${cari ? `&search=${encodeURIComponent(cari)}` : ""}`)).data.data,
    enabled: untukPelamar,
  });

  const tugaskan = useMutation({
    mutationFn: async () =>
      (
        await api.post<HasilTugas>("/cbt/penugasan", {
          testId: paket.id,
          employeeIds: karyawanId,
          candidateIds: pelamarId,
          ...(mulai && { availableFrom: new Date(mulai).toISOString() }),
          ...(sampai && { availableUntil: new Date(sampai).toISOString() }),
          ...(catatan && { note: catatan }),
        })
      ).data,
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["cbt"] });
      notifikasi.sukses(`${d.dibuat} peserta ditugaskan`, d.dilewati > 0 ? `${d.dilewati} dilewati karena masih punya tugas aktif` : undefined);
      if (d.tautan.length > 0) setHasil(d);
      else onClose();
    },
    onError: (e) => notifikasi.galat(e, "Gagal menugaskan"),
  });

  const pilih = (daftar: string[], set: (v: string[]) => void, id: string) =>
    set(daftar.includes(id) ? daftar.filter((x) => x !== id) : [...daftar, id]);

  const jumlah = karyawanId.length + pelamarId.length;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={hasil ? "Tautan ujian" : `Tugaskan: ${paket.title}`}
      description={hasil ? undefined : "Peserta yang masih punya tugas aktif pada paket ini otomatis dilewati."}
      footer={
        hasil ? (
          <Button onClick={onClose}><Check className="h-4 w-4" aria-hidden /> Selesai</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose} disabled={tugaskan.isPending}><X className="h-4 w-4" aria-hidden /> Batal</Button>
            <Button onClick={() => tugaskan.mutate()} loading={tugaskan.isPending} disabled={jumlah === 0}>
              {!tugaskan.isPending && <Send className="h-4 w-4" aria-hidden />} Tugaskan ({jumlah})
            </Button>
          </>
        )
      }
    >
      {hasil ? (
        <DaftarTautan tautan={hasil.tautan} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bisa dikerjakan mulai" hint="Kosongkan bila boleh langsung dikerjakan">
              <Input type="datetime-local" value={mulai} onChange={(e) => setMulai(e.target.value)} />
            </Field>
            <Field label="Batas akhir" hint="Setelah lewat, tes tidak bisa dimulai">
              <Input type="datetime-local" value={sampai} onChange={(e) => setSampai(e.target.value)} />
            </Field>
          </div>
          <Field label="Catatan untuk peserta (opsional)">
            <Textarea rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Kerjakan di ruang training lantai 2" />
          </Field>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input className="pl-9" placeholder="Cari nama…" value={cari} onChange={(e) => setCari(e.target.value)} aria-label="Cari peserta" />
          </div>

          {untukKaryawan && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Karyawan {karyawanId.length > 0 && <span className="text-muted">({karyawanId.length} dipilih)</span>}</legend>
              {karyawan.isLoading ? (
                <SkeletonBaris jumlah={3} />
              ) : (
                <ul className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
                  {(karyawan.data ?? []).map((k) => (
                    <li key={k.id}>
                      <label className={cn("flex cursor-pointer items-center gap-3 rounded-lg p-2 text-sm", karyawanId.includes(k.id) ? "bg-primary-soft" : "hover:bg-surface-2")}>
                        <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={karyawanId.includes(k.id)} onChange={() => pilih(karyawanId, setKaryawanId, k.id)} />
                        <span className="min-w-0 flex-1 truncate">{k.name} <span className="text-xs text-muted">{k.nik}{k.department ? ` · ${k.department.name}` : ""}</span></span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          )}

          {untukPelamar && (
            <fieldset>
              <legend className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                <UserPlus className="h-4 w-4" aria-hidden /> Pelamar {pelamarId.length > 0 && <span className="text-muted">({pelamarId.length} dipilih)</span>}
              </legend>
              <p className="mb-2 flex items-center gap-1.5 text-xs text-muted">
                <Link2 className="h-3.5 w-3.5" aria-hidden /> Pelamar menerima tautan ujian; tidak perlu akun.
              </p>
              {pelamar.isLoading ? (
                <SkeletonBaris jumlah={3} />
              ) : (
                <ul className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
                  {(pelamar.data ?? []).map((k) => (
                    <li key={k.id}>
                      <label className={cn("flex cursor-pointer items-center gap-3 rounded-lg p-2 text-sm", pelamarId.includes(k.id) ? "bg-primary-soft" : "hover:bg-surface-2")}>
                        <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={pelamarId.includes(k.id)} onChange={() => pilih(pelamarId, setPelamarId, k.id)} />
                        <span className="min-w-0 flex-1 truncate">{k.name} <span className="text-xs text-muted">{k.email}</span></span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          )}
        </div>
      )}
    </Modal>
  );
};
