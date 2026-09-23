"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { CalendarRange, ChevronLeft, ChevronRight, Copy, Plus, Trash2, CalendarDays, Save, X } from "lucide-react";
import { api, ambilSemua } from "@/lib/api";
import { useSesi, punyaIzin, bolehHr } from "@/hooks/use-sesi";
import { notifikasi } from "@/hooks/use-notifikasi";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/alert";
import { formatTanggal, cn } from "@/lib/utils";
import type { Departemen, KaryawanDirektori, Shift } from "@/lib/types";

type FormShift = {
  employeeId: string;
  date: string;
  startTime: string;
  endTime: string;
  breakDuration: string;
  status: Shift["status"];
  notes: string;
};

const HARI = 7;

/** "YYYY-MM-DD" dari komponen tanggal lokal — tanpa pergeseran zona waktu. */
const tanggalISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Senin pada minggu tanggal ini. Minggu kerja di sini Senin–Minggu. */
const seninDari = (d: Date) => {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const geser = (t.getDay() + 6) % 7;
  t.setDate(t.getDate() - geser);
  return t;
};

const tambahHari = (d: Date, n: number) => {
  const t = new Date(d);
  t.setDate(t.getDate() + n);
  return t;
};

/** Tanggal shift dari server ("2026-09-22T00:00:00.000Z") sebagai "YYYY-MM-DD". */
const tanggalShift = (s: Shift) => s.date.slice(0, 10);

/** Panjang shift dalam menit, termasuk yang melewati tengah malam. */
const menitShift = (mulai: string, selesai: string) => {
  const [jm, mm] = mulai.split(":").map(Number);
  const [js, ms] = selesai.split(":").map(Number);
  const awal = jm * 60 + mm;
  const akhir = js * 60 + ms;
  return akhir > awal ? akhir - awal : akhir + 24 * 60 - awal;
};

const jamTerjadwal = (daftar: Shift[]) =>
  daftar
    .filter((s) => s.status !== "cancelled")
    .reduce((total, s) => total + menitShift(s.startTime, s.endTime) / 60 - s.breakDuration, 0);

export default function HalamanShift() {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const hr = bolehHr(saya?.role);
  const bolehBuat = punyaIzin(saya, "shift.buat");
  const bolehUbah = punyaIzin(saya, "shift.ubah");
  const bolehHapus = punyaIzin(saya, "shift.hapus");

  const [senin, setSenin] = React.useState(() => seninDari(new Date()));
  // Manajer terkunci ke departemennya sendiri; HR memilih departemen mana pun.
  const [deptDipilih, setDeptDipilih] = React.useState("");
  const dept = hr ? deptDipilih : (saya?.departmentId ?? "");

  const [form, setForm] = React.useState<{ open: boolean; shift: Shift | null; awal?: { employeeId: string; date: string } }>({ open: false, shift: null });
  const [hapus, setHapus] = React.useState<Shift | null>(null);

  const hari = React.useMemo(() => Array.from({ length: HARI }, (_, i) => tambahHari(senin, i)), [senin]);
  const mulaiISO = tanggalISO(senin);
  const selesaiISO = tanggalISO(hari[HARI - 1]);

  const departemen = useQuery({
    queryKey: ["departemen"],
    queryFn: async () => (await api.get<{ data: Departemen[] }>("/departments")).data.data,
    enabled: hr,
  });

  // Direktori terbuka untuk semua peran, jadi manajer tetap bisa menyusun
  // barisnya tanpa perlu izin melihat data karyawan selengkapnya.
  const direktori = useQuery({
    queryKey: ["direktori"],
    queryFn: async () => (await api.get<{ data: KaryawanDirektori[] }>("/employees/directory")).data.data,
  });

  const shift = useQuery({
    queryKey: ["shift", dept, mulaiISO],
    queryFn: async () => ambilSemua<Shift>("/shifts", { startDate: mulaiISO, endDate: selesaiISO, ...(dept ? { departmentId: dept } : {}) }),
    enabled: hr || Boolean(dept),
  });

  const karyawan = React.useMemo(
    () => (direktori.data ?? []).filter((k) => (dept ? k.department?.id === dept : true)),
    [direktori.data, dept]
  );

  /** Shift per karyawan per tanggal; satu sel bisa berisi lebih dari satu (split shift). */
  const peta = React.useMemo(() => {
    const m = new Map<string, Shift[]>();
    for (const s of shift.data ?? []) {
      const kunci = `${s.employeeId}|${tanggalShift(s)}`;
      m.set(kunci, [...(m.get(kunci) ?? []), s]);
    }
    for (const daftar of m.values()) daftar.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return m;
  }, [shift.data]);

  const segarkan = () => qc.invalidateQueries({ queryKey: ["shift"] });

  const simpan = useMutation({
    mutationFn: async (v: FormShift) => {
      const badan = {
        date: v.date,
        startTime: v.startTime,
        endTime: v.endTime,
        breakDuration: Number(v.breakDuration || 0),
        status: v.status,
        ...(v.notes.trim() ? { notes: v.notes.trim() } : {}),
      };
      return form.shift
        ? (await api.put<Shift>(`/shifts/${form.shift.id}`, badan)).data
        : (await api.post<Shift>("/shifts", { employeeId: v.employeeId, ...badan })).data;
    },
    onSuccess: (s) => {
      segarkan();
      notifikasi.sukses(form.shift ? "Shift diperbarui" : "Shift ditambahkan", `${s.employee.name} · ${formatTanggal(s.date)} ${s.startTime}–${s.endTime}`);
      setForm({ open: false, shift: null });
    },
    onError: (e) => notifikasi.galat(e, "Shift belum tersimpan"),
  });

  const hapusShift = useMutation({
    mutationFn: async (s: Shift) => api.delete(`/shifts/${s.id}`),
    onSuccess: (_, s) => {
      segarkan();
      notifikasi.sukses("Shift dihapus", `${s.employee.name} · ${formatTanggal(s.date)}`);
      setHapus(null);
    },
    onError: (e) => { notifikasi.galat(e, "Shift tidak bisa dihapus"); setHapus(null); },
  });

  /**
   * Menyalin jadwal minggu sebelumnya ke minggu ini. Yang sudah punya shift
   * pada jam yang sama dilewati, supaya tombol ini aman ditekan dua kali.
   */
  const salinMingguLalu = useMutation({
    mutationFn: async () => {
      const laluMulai = tanggalISO(tambahHari(senin, -7));
      const laluSelesai = tanggalISO(tambahHari(senin, -1));
      const lalu = await ambilSemua<Shift>("/shifts", { startDate: laluMulai, endDate: laluSelesai, ...(dept ? { departmentId: dept } : {}) });
      const sudahAda = new Set((shift.data ?? []).map((s) => `${s.employeeId}|${tanggalShift(s)}|${s.startTime}`));

      const baru = lalu
        .filter((s) => s.status !== "cancelled")
        .map((s) => {
          const tanggal = tanggalISO(tambahHari(new Date(`${tanggalShift(s)}T00:00:00`), 7));
          return {
            employeeId: s.employeeId,
            date: tanggal,
            startTime: s.startTime,
            endTime: s.endTime,
            breakDuration: s.breakDuration,
            status: s.status,
            ...(s.notes ? { notes: s.notes } : {}),
          };
        })
        .filter((s) => !sudahAda.has(`${s.employeeId}|${s.date}|${s.startTime}`));

      if (baru.length === 0) return { created: 0, sumber: lalu.length };
      const { data } = await api.post<{ created: number }>("/shifts/bulk", { shifts: baru.slice(0, 200) });
      return { created: data.created, sumber: lalu.length };
    },
    onSuccess: (r) => {
      segarkan();
      if (r.sumber === 0) notifikasi.peringatan("Minggu lalu belum ada jadwal", "Tidak ada yang bisa disalin.");
      else if (r.created === 0) notifikasi.peringatan("Tidak ada yang perlu disalin", "Semua jadwal minggu lalu sudah ada di minggu ini.");
      else notifikasi.sukses(`${r.created} shift disalin`, "Dari minggu sebelumnya; periksa lalu sesuaikan bila perlu.");
    },
    onError: (e) => notifikasi.galat(e, "Penyalinan gagal"),
  });

  const f = useForm<FormShift>({ defaultValues: { employeeId: "", date: "", startTime: "08:00", endTime: "16:00", breakDuration: "1", status: "confirmed", notes: "" } });

  React.useEffect(() => {
    if (!form.open) return;
    const s = form.shift;
    f.reset({
      employeeId: s?.employeeId ?? form.awal?.employeeId ?? "",
      date: s ? tanggalShift(s) : (form.awal?.date ?? mulaiISO),
      startTime: s?.startTime ?? "08:00",
      endTime: s?.endTime ?? "16:00",
      breakDuration: String(s?.breakDuration ?? 1),
      status: s?.status ?? "confirmed",
      notes: s?.notes ?? "",
    });
  }, [form, f, mulaiISO]);

  const bukaSel = (employeeId: string, date: string) => {
    if (!bolehBuat) return;
    setForm({ open: true, shift: null, awal: { employeeId, date } });
  };

  const semua = shift.data ?? [];
  const tanpaShift = karyawan.filter((k) => !semua.some((s) => s.employeeId === k.id && s.status !== "cancelled")).length;
  const hariIni = tanggalISO(new Date());
  const perluDept = !hr && !saya?.departmentId;

  return (
    <>
      <PageHeader
        title="Jadwal Shift"
        description={hr ? "Susun jadwal kerja per departemen, satu minggu sekaligus" : "Susun jadwal kerja tim di departemen Anda"}
        actions={
          bolehBuat && (
            <Button onClick={() => setForm({ open: true, shift: null })} disabled={!dept && !hr}>
              <Plus className="h-4 w-4" aria-hidden /> Tambah Shift
            </Button>
          )
        }
      />

      {perluDept && (
        <Alert tone="warning" title="Departemen Anda belum diatur">
          Jadwal shift disusun per departemen. Minta HR menghubungkan akun Anda ke sebuah departemen lebih dulu.
        </Alert>
      )}

      <Card>
        <div className="grid gap-2 border-b border-border p-3 sm:grid-cols-[auto_1fr_auto] sm:items-center">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => setSenin(tambahHari(senin, -7))} aria-label="Minggu sebelumnya">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <Button variant="outline" size="sm" className="whitespace-nowrap" onClick={() => setSenin(seninDari(new Date()))}><CalendarDays className="h-4 w-4" aria-hidden /> Minggu ini</Button>
            <Button variant="outline" size="icon" onClick={() => setSenin(tambahHari(senin, 7))} aria-label="Minggu berikutnya">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
            <p className="ml-2 whitespace-nowrap text-sm font-medium">
              {formatTanggal(senin, "d MMM")} – {formatTanggal(hari[HARI - 1], "d MMM yyyy")}
            </p>
          </div>

          {hr ? (
            <Select value={deptDipilih} onChange={(e) => setDeptDipilih(e.target.value)} aria-label="Departemen" className="sm:max-w-xs">
              <option value="">Semua departemen</option>
              {(departemen.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          ) : (
            <p className="text-sm text-muted">Departemen: {karyawan[0]?.department?.name ?? "—"}</p>
          )}

          {bolehBuat && (
            <Button variant="outline" onClick={() => salinMingguLalu.mutate()} loading={salinMingguLalu.isPending} disabled={perluDept}>
              {!salinMingguLalu.isPending && <Copy className="h-4 w-4" aria-hidden />} Salin Minggu Lalu
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-border px-3 py-2 text-xs text-muted">
          <span><span className="font-semibold text-foreground">{semua.filter((s) => s.status !== "cancelled").length}</span> shift</span>
          <span><span className="font-semibold text-foreground">{Math.round(jamTerjadwal(semua))}</span> jam terjadwal</span>
          <span><span className="font-semibold text-foreground">{karyawan.length}</span> karyawan</span>
          {tanpaShift > 0 && <span className="text-warning">{tanpaShift} belum dijadwalkan</span>}
        </div>

        {shift.isLoading || direktori.isLoading ? (
          <SkeletonBaris />
        ) : karyawan.length === 0 ? (
          <EmptyState
            icon={CalendarRange}
            title={perluDept ? "Belum ada departemen" : "Belum ada karyawan"}
            description={hr && !dept ? "Pilih departemen untuk menyusun jadwalnya." : "Tidak ada karyawan aktif di departemen ini."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 w-48 border-b border-border bg-surface px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">
                    Karyawan
                  </th>
                  {hari.map((d) => {
                    const ini = tanggalISO(d) === hariIni;
                    return (
                      <th key={tanggalISO(d)} scope="col" className={cn("border-b border-border px-2 py-2 text-center text-xs font-medium", ini ? "bg-primary-soft text-primary" : "text-muted")}>
                        <span className="block uppercase tracking-wide">{formatTanggal(d, "EEE")}</span>
                        <span className="block text-sm font-semibold text-foreground">{d.getDate()}</span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {karyawan.map((k) => (
                  <tr key={k.id} className="align-top">
                    <th scope="row" className="sticky left-0 z-10 border-b border-border bg-surface px-3 py-2 text-left font-normal">
                      <span className="block truncate text-sm font-medium">{k.name}</span>
                      <span className="block truncate text-xs text-muted">{k.nik}{k.position ? ` · ${k.position.name}` : ""}</span>
                    </th>
                    {hari.map((d) => {
                      const tgl = tanggalISO(d);
                      const isi = peta.get(`${k.id}|${tgl}`) ?? [];
                      return (
                        <td key={tgl} className="border-b border-l border-border p-1">
                          <div className="flex min-h-14 flex-col gap-1">
                            {isi.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => (bolehUbah || bolehHapus) && setForm({ open: true, shift: s })}
                                disabled={!bolehUbah && !bolehHapus}
                                className={cn(
                                  "rounded-lg px-2 py-1 text-center text-xs font-semibold leading-tight",
                                  s.status === "cancelled"
                                    ? "bg-surface-2 text-muted line-through"
                                    : s.status === "tentative"
                                      ? "bg-warning-soft text-warning"
                                      : "bg-primary-soft text-primary hover:bg-primary hover:text-white"
                                )}
                                title={`${k.name} · ${s.startTime}–${s.endTime}${s.breakDuration ? ` · istirahat ${s.breakDuration} jam` : ""}${s.notes ? ` · ${s.notes}` : ""}`}
                              >
                                {s.startTime}–{s.endTime}
                              </button>
                            ))}
                            {bolehBuat && (
                              <button
                                type="button"
                                onClick={() => bukaSel(k.id, tgl)}
                                aria-label={`Tambah shift ${k.name} ${formatTanggal(d)}`}
                                className="grid flex-1 place-items-center rounded-lg border border-dashed border-border text-muted/70 transition hover:border-primary hover:text-primary"
                              >
                                <Plus className="h-4 w-4" aria-hidden />
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={form.open}
        onClose={() => setForm({ open: false, shift: null })}
        title={form.shift ? "Ubah Shift" : "Tambah Shift"}
        description={form.shift ? `${form.shift.employee.name} · ${formatTanggal(form.shift.date)}` : "Shift malam yang melewati tengah malam ditulis apa adanya, mis. 22:00–06:00."}
        footer={
          <>
            {form.shift && bolehHapus && (
              <Button
                variant="ghost"
                className="mr-auto text-danger"
                onClick={() => { const s = form.shift!; setForm({ open: false, shift: null }); setHapus(s); }}
              >
                <Trash2 className="h-4 w-4" aria-hidden /> Hapus
              </Button>
            )}
            <Button variant="outline" onClick={() => setForm({ open: false, shift: null })} disabled={simpan.isPending}><X className="h-4 w-4" aria-hidden /> Batal</Button>
            <Button form="form-shift" type="submit" loading={simpan.isPending} disabled={form.shift ? !bolehUbah : !bolehBuat}>{!simpan.isPending && <Save className="h-4 w-4" aria-hidden />} Simpan</Button>
          </>
        }
      >
        <form id="form-shift" onSubmit={f.handleSubmit((v) => simpan.mutate(v))} className="space-y-4" noValidate>
          {!form.shift && (
            <Field label="Karyawan" error={f.formState.errors.employeeId?.message}>
              <Select {...f.register("employeeId", { required: "Pilih karyawan" })}>
                <option value="">Pilih karyawan</option>
                {karyawan.map((k) => <option key={k.id} value={k.id}>{k.name} · {k.nik}</option>)}
              </Select>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tanggal" error={f.formState.errors.date?.message}>
              <Input type="date" {...f.register("date", { required: "Tanggal wajib diisi" })} />
            </Field>
            <Field label="Status" hint="Sementara = rencana yang belum final">
              <Select {...f.register("status")}>
                <option value="confirmed">Terjadwal</option>
                <option value="tentative">Sementara</option>
              </Select>
            </Field>
            <Field label="Jam mulai" error={f.formState.errors.startTime?.message}>
              <Input type="time" {...f.register("startTime", { required: "Wajib diisi" })} />
            </Field>
            <Field label="Jam selesai" error={f.formState.errors.endTime?.message}>
              <Input type="time" {...f.register("endTime", { required: "Wajib diisi" })} />
            </Field>
            <Field label="Istirahat (jam)" error={f.formState.errors.breakDuration?.message} hint="Tidak boleh sepanjang shiftnya">
              <Input type="number" step="0.5" min={0} max={12} {...f.register("breakDuration", { min: { value: 0, message: "Tidak boleh negatif" } })} />
            </Field>
          </div>
          <Field label="Catatan" hint="Mis. buka outlet, tutup outlet, atau pengganti rekan">
            <Textarea rows={2} {...f.register("notes")} />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(hapus)}
        onClose={() => setHapus(null)}
        onConfirm={() => hapus && hapusShift.mutate(hapus)}
        loading={hapusShift.isPending}
        danger
        title="Hapus shift?"
        description={hapus ? `${hapus.employee.name} · ${formatTanggal(hapus.date)} ${hapus.startTime}–${hapus.endTime}. Bila sudah ada presensi yang terkait, shift ditandai dibatalkan, bukan dihapus.` : ""}
        confirmLabel="Hapus"
        confirmIcon={Trash2}
      />

      {semua.length === 0 && karyawan.length > 0 && !shift.isLoading && (
        <p className="text-center text-sm text-muted">
          Belum ada jadwal minggu ini.{" "}
          {bolehBuat ? <>Ketuk sel pada tabel untuk menambah shift, atau salin jadwal minggu lalu. Status <Badge tone="warning">Sementara</Badge> untuk rencana yang belum final.</> : "Hubungi atasan Anda bila jadwalnya belum terbit."}
        </p>
      )}
    </>
  );
}
