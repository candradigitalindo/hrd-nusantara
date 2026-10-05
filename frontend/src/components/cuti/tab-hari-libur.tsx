"use client";

import * as React from "react";
import axios from "axios";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { CalendarDays, ClipboardPaste, Plus, Save, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { Card } from "@/components/ui/card";
import { Button, TombolAksi } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Centang } from "@/components/ui/centang";
import { Badge } from "@/components/ui/badge";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { ResponsiveTable, type Kolom } from "@/components/ui/responsive-table";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, formatTanggal } from "@/lib/utils";
import { parseKalenderLibur, type BarisLibur } from "@/lib/kalender-libur";
import type { Halaman, HariLibur } from "@/lib/types";

type RingkasanPotongan = { deducted: number; skippedShift: number; skippedNoBalance: number };
type HasilTambah = HariLibur & { collectiveLeave: RingkasanPotongan; shiftsRemoved: number };
type HasilMassal = { created: number; collectiveLeave: RingkasanPotongan; shiftsRemoved: number };
type HasilHapus = { message: string; restoredBalances: number; shiftsRestored: number };
type FormLibur = { date: string; name: string; isCollectiveLeave: boolean };

const KOSONG: FormLibur = { date: "", name: "", isCollectiveLeave: false };

const CONTOH = `2026-01-01; Tahun Baru Masehi
2026-02-16; Cuti Bersama Tahun Baru Imlek
17/08/2026; Proklamasi Kemerdekaan RI`;

/** Dampak yang dilaporkan backend; hanya bagian yang bukan nol. */
const ringkasDampak = (r: RingkasanPotongan | undefined, shiftsRemoved: number) =>
  [
    r && r.deducted > 0 && `${r.deducted} saldo cuti tahunan dipotong`,
    r && r.skippedShift > 0 && `${r.skippedShift} staf shift dilewati`,
    r && r.skippedNoBalance > 0 && `${r.skippedNoBalance} belum punya saldo`,
    shiftsRemoved > 0 && `${shiftsRemoved} shift pada tanggal itu dihapus`,
  ]
    .filter(Boolean)
    .join(" · ");

const tahunDari = (iso: string) => Number(iso.slice(0, 4));

/** Tahun yang paling banyak muncul — untuk memindahkan tampilan ke kalender yang baru ditempel. */
const tahunTerbanyak = (baris: BarisLibur[]) => {
  const hitung = new Map<number, number>();
  for (const b of baris) hitung.set(tahunDari(b.date), (hitung.get(tahunDari(b.date)) ?? 0) + 1);
  return [...hitung.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/**
 * Kalender hari libur dan cuti bersama. Dipakai saat menghitung hari cuti
 * yang memotong saldo (pola kerja yang menghormati libur melewatinya) dan
 * untuk mengosongkan shift penugasan pada tanggal itu. Cuti bersama langsung
 * memotong kuota cuti tahunan karyawan berpola tetap begitu disimpan, dan
 * dipulihkan bila dihapus — backend melaporkan jumlahnya, ditampilkan di toast.
 */
export const TabHariLibur = () => {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const bolehBuat = punyaIzin(saya, "pengaturan_cuti.buat");
  const bolehHapus = punyaIzin(saya, "pengaturan_cuti.hapus");
  const tahunIni = new Date().getFullYear();
  const [tahun, setTahun] = React.useState(tahunIni);
  const [tambahBuka, setTambahBuka] = React.useState(false);
  const [massalBuka, setMassalBuka] = React.useState(false);
  const [teksMassal, setTeksMassal] = React.useState("");
  const [konflik, setKonflik] = React.useState<string[]>([]);
  const [hapus, setHapus] = React.useState<HariLibur | null>(null);

  const pilihan = React.useMemo(
    () => Array.from(new Set([tahunIni - 1, tahunIni, tahunIni + 1, tahunIni + 2, tahun])).sort((a, b) => a - b),
    [tahunIni, tahun]
  );

  const libur = useQuery({
    queryKey: ["hari-libur", tahun],
    queryFn: async () => (await api.get<Halaman<HariLibur>>(`/holidays?year=${tahun}&limit=100`)).data.data,
  });

  // Libur mengubah hitungan hari kerja, saldo cuti bersama, dan shift terjadwal.
  const segarkan = () => {
    qc.invalidateQueries({ queryKey: ["hari-libur"] });
    qc.invalidateQueries({ queryKey: ["saldo-cuti"] });
    qc.invalidateQueries({ queryKey: ["shift"] });
    qc.invalidateQueries({ queryKey: ["shift-penugasan"] });
  };

  const f = useForm<FormLibur>({ defaultValues: KOSONG });
  const { errors } = f.formState;
  const bersamaDipilih = useWatch({ control: f.control, name: "isCollectiveLeave" });

  const tambah = useMutation({
    mutationFn: async (v: FormLibur) =>
      (await api.post<HasilTambah>("/holidays", { date: v.date, name: v.name.trim(), isCollectiveLeave: v.isCollectiveLeave })).data,
    onSuccess: (h) => {
      segarkan();
      const dampak = ringkasDampak(h.isCollectiveLeave ? h.collectiveLeave : undefined, h.shiftsRemoved);
      notifikasi.sukses(
        h.isCollectiveLeave ? "Cuti bersama ditambahkan" : "Hari libur ditambahkan",
        `${h.name} · ${formatTanggal(h.date, "EEEE, d MMM yyyy")}${dampak ? ` · ${dampak}` : ""}`
      );
      setTambahBuka(false);
      if (tahunDari(h.date) !== tahun) setTahun(tahunDari(h.date));
    },
    onError: (e) => notifikasi.galat(e, "Hari libur belum tersimpan"),
  });

  const hasilParse = React.useMemo(() => parseKalenderLibur(teksMassal), [teksMassal]);
  const massal = useMutation({
    mutationFn: async (baris: BarisLibur[]) =>
      (await api.post<HasilMassal>("/holidays/bulk", { holidays: baris.map(({ date, name, isCollectiveLeave }) => ({ date, name, isCollectiveLeave })) })).data,
    onSuccess: (r, baris) => {
      segarkan();
      const dampak = ringkasDampak(r.collectiveLeave, r.shiftsRemoved);
      notifikasi.sukses(`${r.created} tanggal ditambahkan ke kalender`, dampak || "Hari kerja dihitung ulang mulai sekarang.");
      setMassalBuka(false);
      setTeksMassal("");
      setKonflik([]);
      const target = tahunTerbanyak(baris);
      if (target !== undefined && target !== tahun) setTahun(target);
    },
    onError: (e) => {
      // Backend menolak seluruh batch bila ada yang sudah terdaftar, dan
      // menyebut tanggalnya — ditandai di pratinjau supaya tinggal dihapus.
      if (axios.isAxiosError(e)) {
        const data = e.response?.data as { conflicts?: string[]; duplicates?: string[] } | undefined;
        const daftar = data?.conflicts ?? data?.duplicates;
        if (daftar?.length) {
          setKonflik(daftar);
          notifikasi.peringatan("Sebagian tanggal sudah terdaftar", "Hapus baris yang ditandai, lalu kirim lagi.");
          return;
        }
      }
      notifikasi.galat(e, "Kalender belum tersimpan");
    },
  });

  const hapusLibur = useMutation({
    mutationFn: async (h: HariLibur) => (await api.delete<HasilHapus>(`/holidays/${h.id}`)).data,
    onSuccess: (r, h) => {
      segarkan();
      const dampak = [r.restoredBalances > 0 && `${r.restoredBalances} saldo dipulihkan`, r.shiftsRestored > 0 && `${r.shiftsRestored} shift dikembalikan`]
        .filter(Boolean)
        .join(" · ");
      notifikasi.sukses("Hari libur dihapus", `${h.name} · ${formatTanggal(h.date, "d MMM yyyy")}${dampak ? ` · ${dampak}` : ""}`);
      setHapus(null);
    },
    onError: (e) => {
      setHapus(null);
      notifikasi.galat(e, "Tidak bisa dihapus");
    },
  });

  const bersama = (libur.data ?? []).filter((h) => h.isCollectiveLeave).length;
  const ringkasan = libur.data ? `${libur.data.length} tanggal · ${libur.data.length - bersama} hari libur · ${bersama} cuti bersama` : "";

  const kolom: Kolom<HariLibur>[] = [
    {
      key: "tanggal",
      header: "Tanggal",
      primary: true,
      cell: (h) => <span className="font-medium tabular-nums">{formatTanggal(h.date, "EEEE, d MMM yyyy")}</span>,
    },
    {
      key: "nama",
      header: "Nama",
      cell: (h) => (
        <div className="flex flex-wrap items-center gap-2">
          <span>{h.name}</span>
          {h.isCollectiveLeave ? <Badge tone="primary">Cuti bersama</Badge> : <Badge>Hari libur</Badge>}
        </div>
      ),
    },
    ...(bolehHapus
      ? [
          {
            key: "aksi",
            header: "",
            className: "text-right",
            cell: (h: HariLibur) => (
              <div className="flex justify-end">
                <TombolAksi icon={Trash2} label={`Hapus ${h.name}`} tone="bahaya" onClick={() => setHapus(h)} />
              </div>
            ),
          } satisfies Kolom<HariLibur>,
        ]
      : []),
  ];

  const bukaTambah = () => {
    f.reset({ ...KOSONG, date: tahun === tahunIni ? "" : `${tahun}-01-01` });
    setTambahBuka(true);
  };
  const bukaMassal = () => {
    setKonflik([]);
    setMassalBuka(true);
  };

  const jumlahBaris = hasilParse.baris.length;
  const bisaKirim = jumlahBaris > 0 && jumlahBaris <= 100 && hasilParse.galat.length === 0 && konflik.length === 0;

  return (
    <>
      <Card>
        <div className="grid gap-2 border-b border-border p-3 sm:grid-cols-[7rem_1fr_auto_auto] sm:items-center">
          <Select value={String(tahun)} onChange={(e) => setTahun(Number(e.target.value))} aria-label="Tahun">
            {pilihan.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          <p className="text-sm text-muted">{ringkasan}</p>
          {bolehBuat && (
            <Button variant="outline" onClick={bukaMassal}>
              <ClipboardPaste className="h-4 w-4" aria-hidden /> Tempel Kalender
            </Button>
          )}
          {bolehBuat && (
            <Button onClick={bukaTambah}>
              <Plus className="h-4 w-4" aria-hidden /> Hari Libur
            </Button>
          )}
        </div>

        {libur.isLoading ? (
          <SkeletonBaris />
        ) : libur.isError ? (
          <EmptyState title="Kalender tidak bisa dimuat" description={(libur.error as Error).message} />
        ) : !libur.data?.length ? (
          <EmptyState
            icon={CalendarDays}
            title={`Belum ada hari libur tahun ${tahun}`}
            description="Tanpa kalender, setiap hari kerja dihitung penuh saat cuti memotong saldo, dan cuti bersama tidak terpotong. Tempel daftar libur nasional setahun sekaligus, atau tambah satu per satu."
            action={bolehBuat ? <Button onClick={bukaMassal}><ClipboardPaste className="h-4 w-4" aria-hidden /> Tempel Kalender</Button> : undefined}
          />
        ) : (
          <ResponsiveTable columns={kolom} rows={libur.data} rowKey={(h) => h.id} />
        )}
      </Card>

      <Modal
        open={tambahBuka}
        onClose={() => setTambahBuka(false)}
        title="Hari Libur Baru"
        description="Tanggal ini tidak dihitung hari kerja bagi pola yang menghormati hari libur, dan shift penugasan pada tanggal itu dikosongkan."
        footer={
          <>
            <Button variant="outline" onClick={() => setTambahBuka(false)} disabled={tambah.isPending}><X className="h-4 w-4" aria-hidden /> Batal</Button>
            <Button form="form-hari-libur" type="submit" loading={tambah.isPending}>
              {!tambah.isPending && <Save className="h-4 w-4" aria-hidden />} Simpan
            </Button>
          </>
        }
      >
        <form id="form-hari-libur" onSubmit={f.handleSubmit((v) => tambah.mutate(v))} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
            <Field label="Tanggal" error={errors.date?.message}>
              <Input type="date" {...f.register("date", { required: "Wajib diisi" })} aria-invalid={Boolean(errors.date)} />
            </Field>
            <Field label="Nama" error={errors.name?.message}>
              <Input
                {...f.register("name", { required: "Nama wajib diisi", validate: (v) => v.trim().length > 0 || "Nama wajib diisi", maxLength: { value: 150, message: "Maksimal 150 karakter" } })}
                placeholder="Hari Buruh Internasional"
                maxLength={150}
                aria-invalid={Boolean(errors.name)}
              />
            </Field>
          </div>
          <Centang label="Cuti bersama" hint="Memotong kuota cuti tahunan karyawan berpola kerja tetap; staf shift tidak dipotong" {...f.register("isCollectiveLeave")} />
          {bersamaDipilih && (
            <Alert tone="warning" title="Saldo langsung terpotong saat disimpan">
              Hanya jenis cuti yang ditandai “kuota dipotong cuti bersama” yang terpotong. Karyawan yang saldonya belum ditetapkan dilewati dan dilaporkan jumlahnya.
            </Alert>
          )}
        </form>
      </Modal>

      <Modal
        open={massalBuka}
        onClose={() => setMassalBuka(false)}
        size="lg"
        title="Tempel Kalender Libur"
        description="Satu baris satu tanggal: tanggal lalu nama, dipisah titik koma, koma, atau tab. Baris yang namanya memuat “cuti bersama” otomatis ditandai; atau akhiri baris dengan *."
        footer={
          <>
            <Button variant="outline" onClick={() => setMassalBuka(false)} disabled={massal.isPending}><X className="h-4 w-4" aria-hidden /> Batal</Button>
            <Button onClick={() => massal.mutate(hasilParse.baris)} loading={massal.isPending} disabled={!bisaKirim}>
              {!massal.isPending && <Save className="h-4 w-4" aria-hidden />} Tambahkan {jumlahBaris > 0 ? `${jumlahBaris} Tanggal` : ""}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Daftar tanggal" hint="Maksimal 100 baris sekali kirim; baris kosong dan yang diawali # dilewati">
            <Textarea
              rows={7}
              value={teksMassal}
              onChange={(e) => { setTeksMassal(e.target.value); setKonflik([]); }}
              placeholder={CONTOH}
              className="font-mono text-xs"
              spellCheck={false}
            />
          </Field>

          {hasilParse.galat.length > 0 && (
            <Alert tone="warning" title={`${hasilParse.galat.length} baris tidak terbaca`}>
              <ul className="list-disc space-y-0.5 pl-4">
                {hasilParse.galat.map((g) => (
                  <li key={g.nomor}>Baris {g.nomor}: {g.alasan} — <code className="rounded bg-surface-2 px-1 text-xs">{g.teks}</code></li>
                ))}
              </ul>
            </Alert>
          )}
          {konflik.length > 0 && (
            <Alert tone="warning" title="Sudah terdaftar di kalender">
              {konflik.map((k) => formatTanggal(k, "d MMM yyyy")).join(", ")}. Hapus baris itu dari daftar, lalu kirim lagi.
            </Alert>
          )}
          {jumlahBaris > 100 && <Alert tone="warning" title="Terlalu banyak">Maksimal 100 tanggal sekali kirim; bagi menjadi dua kali.</Alert>}

          {jumlahBaris > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-xl border border-border">
              <table className="w-full text-sm" aria-label="Pratinjau kalender">
                <thead className="sticky top-0 bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Tanggal</th>
                    <th className="px-3 py-2 font-medium">Nama</th>
                    <th className="px-3 py-2 font-medium">Jenis</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {hasilParse.baris.map((b) => (
                    <tr key={b.nomor} className={cn(konflik.includes(b.date) && "bg-warning-soft")}>
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{formatTanggal(b.date, "EEE, d MMM yyyy")}</td>
                      <td className="px-3 py-1.5">{b.name}</td>
                      <td className="px-3 py-1.5">{b.isCollectiveLeave ? <Badge tone="primary">Cuti bersama</Badge> : <span className="text-muted">Hari libur</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(hapus)}
        onClose={() => setHapus(null)}
        onConfirm={() => hapus && hapusLibur.mutate(hapus)}
        loading={hapusLibur.isPending}
        danger
        title="Hapus hari libur?"
        description={
          hapus
            ? `${hapus.name} (${formatTanggal(hapus.date, "EEEE, d MMM yyyy")}) kembali menjadi hari kerja.${hapus.isCollectiveLeave ? " Potongan cuti bersama di saldo karyawan dikembalikan." : ""} Shift penugasan yang tadinya dikosongkan pada tanggal itu dibuat lagi.`
            : ""
        }
        confirmLabel="Hapus"
        confirmIcon={Trash2}
      />
    </>
  );
};
