"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CalendarX2, Repeat, Save, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { Card } from "@/components/ui/card";
import { Button, TombolAksi } from "@/components/ui/button";
import { Input, Select, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { ResponsiveTable, type Kolom } from "@/components/ui/responsive-table";
import { Pagination } from "@/components/ui/pagination";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTanggal } from "@/lib/utils";
import type { Halaman, KaryawanDirektori, PenugasanShift } from "@/lib/types";
import { ChipJenis } from "./chip-jenis";
import { dariISO, formatHariPekan, formatPeriode, geserISO, penugasanAktif, tanggalISO } from "./util-shift";

/** Pembaruan cache setelah penugasan berubah: roster, rekap, daftar penugasan, dan hitungan di jenis shift. */
export const segarkanPenugasan = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ["shift"] });
  qc.invalidateQueries({ queryKey: ["shift-rekap"] });
  qc.invalidateQueries({ queryKey: ["shift-penugasan"] });
  qc.invalidateQueries({ queryKey: ["shift-jenis"] });
};

/**
 * Mengakhiri penugasan pada tanggal pilihan. Shift sesudahnya yang belum ada
 * presensinya (dan belum diubah manual) dihapus server; yang sebelumnya tetap.
 */
export const DialogAkhiriPenugasan = ({
  penugasan,
  tanggalAwal,
  onClose,
}: {
  penugasan: PenugasanShift;
  /** "YYYY-MM-DD" tanggal akhir yang diusulkan. */
  tanggalAwal: string;
  onClose: () => void;
}) => {
  const qc = useQueryClient();
  const minimal = geserISO(penugasan.startDate.slice(0, 10), -1);
  // Tanggal akhir hanya bisa dimajukan: server menolak memundurkan penugasan
  // yang sudah punya tanggal akhir, karena barisnya sesudah tanggal itu sudah dihapus.
  const maksimal = penugasan.endDate?.slice(0, 10) ?? null;
  const [akhir, setAkhir] = React.useState(() => {
    if (tanggalAwal < minimal) return minimal;
    if (maksimal && tanggalAwal > maksimal) return maksimal;
    return tanggalAwal;
  });
  const sah = Boolean(akhir) && akhir >= minimal && (!maksimal || akhir <= maksimal);

  const akhiri = useMutation({
    mutationFn: async () =>
      (await api.post<{ assignment: PenugasanShift; rowsDeleted: number }>(`/shifts/assignments/${penugasan.id}/end`, { endDate: akhir })).data,
    onSuccess: (r) => {
      segarkanPenugasan(qc);
      notifikasi.sukses(
        "Penugasan diakhiri",
        `${penugasan.employee.name} · ${penugasan.template.name} berakhir ${formatTanggal(dariISO(akhir))}${r.rowsDeleted > 0 ? ` · ${r.rowsDeleted} shift sesudahnya dihapus` : ""}.`
      );
      onClose();
    },
    onError: (e) => notifikasi.galat(e, "Penugasan belum diakhiri"),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Akhiri penugasan"
      description={`${penugasan.employee.name} · ${penugasan.template.name} · ${formatPeriode(penugasan.startDate, penugasan.endDate)}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={akhiri.isPending}><X className="h-4 w-4" aria-hidden /> Batal</Button>
          <Button onClick={() => akhiri.mutate()} loading={akhiri.isPending} disabled={!sah}>
            {!akhiri.isPending && <Save className="h-4 w-4" aria-hidden />} Akhiri
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Hari kerja terakhir" hint="Tanggal ini masih ikut penugasan; sesudahnya tidak.">
          <Input type="date" value={akhir} min={minimal} max={maksimal ?? undefined} onChange={(e) => setAkhir(e.target.value)} />
        </Field>
        <p className="text-sm text-muted">
          Shift sesudah tanggal ini yang belum ada presensinya dihapus. Yang sudah diubah manual atau sudah ada presensinya tetap.
        </p>
      </div>
    </Modal>
  );
};

/**
 * Daftar penugasan shift berjangka. Dari sini penugasan diakhiri lebih awal
 * (pindah shift, mutasi) atau dihapus bila keliru dibuat.
 */
export const TabPenugasan = ({
  dept,
  pemilihDept,
  karyawan,
  bolehDimuat,
  onTetapkan,
}: {
  dept: string;
  /** Pilihan departemen yang sama dengan tab Roster. */
  pemilihDept: React.ReactNode;
  karyawan: KaryawanDirektori[];
  /** Manajer tanpa departemen tidak punya apa pun untuk dimuat. */
  bolehDimuat: boolean;
  onTetapkan: () => void;
}) => {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const bolehBuat = punyaIzin(saya, "shift.buat");
  const bolehUbah = punyaIzin(saya, "shift.ubah");
  const bolehHapus = punyaIzin(saya, "shift.hapus");
  const hariIni = tanggalISO(new Date());

  const [karyawanId, setKaryawanId] = React.useState("");
  const [termasukBerakhir, setTermasukBerakhir] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [akhiri, setAkhiri] = React.useState<PenugasanShift | null>(null);
  const [hapus, setHapus] = React.useState<PenugasanShift | null>(null);

  // Saringan karyawan yang tidak lagi ada di departemen terpilih diabaikan, bukan dikirim.
  const karyawanAda = karyawanId && karyawan.some((k) => k.id === karyawanId) ? karyawanId : "";

  const params = new URLSearchParams({ page: String(page), limit: "20", active: termasukBerakhir ? "false" : "true" });
  if (dept) params.set("departmentId", dept);
  if (karyawanAda) params.set("employeeId", karyawanAda);

  const daftar = useQuery({
    queryKey: ["shift-penugasan", "daftar", params.toString()],
    queryFn: async () => (await api.get<Halaman<PenugasanShift>>(`/shifts/assignments?${params}`)).data,
    enabled: bolehDimuat,
    placeholderData: (lama) => lama,
  });

  const hapusPenugasan = useMutation({
    mutationFn: async (p: PenugasanShift) => (await api.delete<{ rowsDeleted: number; deleted: boolean }>(`/shifts/assignments/${p.id}`)).data,
    onSuccess: (r, p) => {
      segarkanPenugasan(qc);
      notifikasi.sukses(
        r.deleted ? "Penugasan dihapus" : "Penugasan diakhiri",
        `${p.employee.name} · ${p.template.name}${r.rowsDeleted > 0 ? ` · ${r.rowsDeleted} shift dihapus` : ""}${r.deleted ? "" : ". Shift yang sudah lewat tetap tersimpan."}`
      );
      setHapus(null);
    },
    onError: (e) => {
      notifikasi.galat(e, "Penugasan tidak bisa dihapus");
      setHapus(null);
    },
  });

  const kolom: Kolom<PenugasanShift>[] = [
    {
      key: "karyawan",
      header: "Karyawan",
      primary: true,
      cell: (p) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{p.employee.name}</p>
          <p className="truncate text-xs text-muted">{p.employee.nik}</p>
        </div>
      ),
    },
    {
      key: "jenis",
      header: "Jenis",
      cell: (p) => (
        <span className="inline-flex flex-wrap items-center justify-end gap-1.5 md:justify-start">
          <ChipJenis jenis={p.template} />
          <span className="text-xs text-muted tabular-nums">{p.template.startTime}–{p.template.endTime}</span>
        </span>
      ),
    },
    {
      key: "periode",
      header: "Periode",
      cell: (p) => (
        <span className="inline-flex flex-wrap items-center justify-end gap-1.5 md:justify-start">
          {formatPeriode(p.startDate, p.endDate)}
          {!penugasanAktif(p, hariIni) && <Badge>Berakhir</Badge>}
          {p.startDate.slice(0, 10) > hariIni && <Badge tone="info">Belum mulai</Badge>}
          {p.status === "tentative" && <Badge tone="warning">Sementara</Badge>}
        </span>
      ),
    },
    { key: "hari", header: "Hari", cell: (p) => formatHariPekan(p.weekdays) },
    { key: "libur", header: "Libur nasional", cell: (p) => (p.skipPublicHolidays ? "Dilewati" : <span className="text-muted">Tetap masuk</span>) },
    ...(bolehUbah || bolehHapus
      ? [
          {
            key: "aksi",
            header: "",
            className: "text-right",
            cell: (p: PenugasanShift) =>
              penugasanAktif(p, hariIni) ? (
                <div className="flex justify-end gap-1.5">
                  {bolehUbah && <TombolAksi icon={CalendarX2} label={`Akhiri penugasan ${p.employee.name}`} onClick={() => setAkhiri(p)} />}
                  {bolehHapus && <TombolAksi icon={Trash2} label={`Hapus penugasan ${p.employee.name}`} tone="bahaya" onClick={() => setHapus(p)} />}
                </div>
              ) : null,
          } satisfies Kolom<PenugasanShift>,
        ]
      : []),
  ];

  const belumMulai = hapus ? hapus.startDate.slice(0, 10) > hariIni : false;

  return (
    <>
      <Card>
        <div className="grid grid-cols-1 gap-2 border-b border-border p-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,16rem)_1fr] sm:items-center">
          {pemilihDept}
          <Select value={karyawanAda} onChange={(e) => { setKaryawanId(e.target.value); setPage(1); }} aria-label="Saring karyawan">
            <option value="">Semua karyawan</option>
            {karyawan.map((k) => <option key={k.id} value={k.id}>{k.name} · {k.nik}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-sm sm:justify-self-end">
            <input type="checkbox" checked={termasukBerakhir} onChange={(e) => { setTermasukBerakhir(e.target.checked); setPage(1); }} className="h-4 w-4 accent-[var(--primary)]" />
            Tampilkan yang sudah berakhir
          </label>
        </div>

        {!bolehDimuat ? (
          <EmptyState icon={Repeat} title="Belum ada departemen" description="Penugasan disusun per departemen. Minta HR menghubungkan akun Anda ke sebuah departemen." />
        ) : daftar.isLoading ? (
          <SkeletonBaris />
        ) : daftar.isError ? (
          <EmptyState title="Penugasan tidak bisa dimuat" description={(daftar.error as Error).message} />
        ) : !daftar.data?.data.length ? (
          <EmptyState
            icon={Repeat}
            title={termasukBerakhir ? "Belum ada penugasan" : "Tidak ada penugasan aktif"}
            description="Penugasan membuat shift otomatis untuk rentang yang dipilih — seminggu, sebulan, atau seterusnya — supaya roster tidak perlu diisi tiap hari."
            action={bolehBuat && <Button onClick={onTetapkan}><CalendarCheck className="h-4 w-4" aria-hidden /> Tetapkan Shift</Button>}
          />
        ) : (
          <>
            <ResponsiveTable columns={kolom} rows={daftar.data.data} rowKey={(p) => p.id} />
            <Pagination pagination={daftar.data.pagination} onPage={setPage} />
          </>
        )}
      </Card>

      {akhiri && <DialogAkhiriPenugasan penugasan={akhiri} tanggalAwal={hariIni} onClose={() => setAkhiri(null)} />}

      <ConfirmDialog
        open={Boolean(hapus)}
        onClose={() => setHapus(null)}
        onConfirm={() => hapus && hapusPenugasan.mutate(hapus)}
        loading={hapusPenugasan.isPending}
        danger
        title="Hapus penugasan?"
        description={
          !hapus
            ? ""
            : belumMulai
              ? `${hapus.employee.name} · ${hapus.template.name} belum mulai. Penugasan dan seluruh shift-nya dihapus.`
              : `${hapus.employee.name} · ${hapus.template.name} sudah berjalan sejak ${formatTanggal(dariISO(hapus.startDate))}. Penugasan diakhiri kemarin; shift yang sudah lewat tetap tersimpan, shift mulai hari ini yang belum ada presensinya dihapus.`
        }
        confirmLabel="Hapus"
        confirmIcon={Trash2}
      />
    </>
  );
};
