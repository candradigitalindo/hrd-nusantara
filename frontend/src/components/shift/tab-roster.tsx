"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  CalendarDays,
  CalendarRange,
  CalendarX2,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Pencil,
  Plus,
  Repeat,
  Save,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { api, ambilSemua } from "@/lib/api";
import { useSesi, punyaIzin, bolehHr } from "@/hooks/use-sesi";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTanggal, cn } from "@/lib/utils";
import type { Halaman, KaryawanDirektori, PenugasanShift, RekapLibur, Shift } from "@/lib/types";
import { ChipJenis } from "./chip-jenis";
import { segarkanPenugasan } from "./tab-penugasan";
import {
  dariISO,
  formatHariPekan,
  formatIstirahat,
  formatPeriode,
  geserISO,
  jamTerjadwal,
  seninDari,
  tambahHari,
  tanggalISO,
  tanggalShift,
  warnaJenis,
} from "./util-shift";

type FormShift = {
  date: string;
  startTime: string;
  endTime: string;
  breakDuration: string;
  status: Shift["status"];
  notes: string;
};

const HARI = 7;

/** Warna chip: jenis shift memberi warnanya; tanpa jenis memakai warna utama seperti sebelumnya. */
const kelasChip = (s: Shift) => {
  if (s.status === "cancelled") return "bg-surface-2 text-muted line-through";
  if (s.template) {
    // Status sementara pada chip berwarna ditandai garis putus-putus, bukan
    // warna kuning, supaya warna tetap berarti "jenis shift".
    return cn(warnaJenis(s.template.color).chip, "hover:ring-2 hover:ring-current/40", s.status === "tentative" && "border border-dashed border-current");
  }
  return s.status === "tentative" ? "bg-warning-soft text-warning" : "bg-primary-soft text-primary hover:bg-primary hover:text-on-primary";
};

/**
 * Roster mingguan: satu baris per karyawan, satu kolom per hari. Shift hasil
 * penugasan berulang ditandai ikon putar; mengetuknya menjelaskan asalnya dan
 * menawarkan mengubah satu tanggal saja atau mengakhiri penugasannya.
 */
export const TabRoster = ({
  senin,
  setSenin,
  dept,
  pemilihDept,
  karyawan,
  direktoriMemuat,
  rekap,
  fleksibel,
  perluDept,
  onTetapkan,
}: {
  senin: Date;
  setSenin: (d: Date) => void;
  dept: string;
  pemilihDept: React.ReactNode;
  karyawan: KaryawanDirektori[];
  direktoriMemuat: boolean;
  rekap: UseQueryResult<RekapLibur>;
  fleksibel: Set<string>;
  perluDept: boolean;
  /** sudahAda: sel itu sudah berisi shift, jadi "+" berarti menambah shift kedua (split) di tanggal itu. */
  onTetapkan: (awal?: { employeeId: string; date: string; sudahAda?: boolean }) => void;
}) => {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const hr = bolehHr(saya?.role);
  const bolehBuat = punyaIzin(saya, "shift.buat");
  const bolehUbah = punyaIzin(saya, "shift.ubah");
  const bolehHapus = punyaIzin(saya, "shift.hapus");

  const [ubah, setUbah] = React.useState<Shift | null>(null);
  const [asal, setAsal] = React.useState<Shift | null>(null);
  const [hapus, setHapus] = React.useState<Shift | null>(null);
  const [akhiriDari, setAkhiriDari] = React.useState<Shift | null>(null);

  const hari = React.useMemo(() => Array.from({ length: HARI }, (_, i) => tambahHari(senin, i)), [senin]);
  const mulaiISO = tanggalISO(senin);
  const selesaiISO = tanggalISO(hari[HARI - 1]);

  const shift = useQuery({
    queryKey: ["shift", dept, mulaiISO],
    queryFn: async () => ambilSemua<Shift>("/shifts", { startDate: mulaiISO, endDate: selesaiISO, ...(dept ? { departmentId: dept } : {}) }),
    enabled: hr || Boolean(dept),
  });

  // Rincian penugasan asal sebuah chip. Tidak ada GET per id, jadi diambil
  // daftar penugasan karyawan itu — yang aktif dan yang sudah berakhir — lalu dicari.
  const penugasanAsal = useQuery({
    queryKey: ["shift-penugasan", "asal", asal?.employeeId],
    queryFn: async () => {
      const ambil = async (aktif: boolean) =>
        (await api.get<Halaman<PenugasanShift>>(`/shifts/assignments?employeeId=${asal!.employeeId}&active=${aktif}&limit=100`)).data.data;
      const [a, b] = await Promise.all([ambil(true), ambil(false)]);
      return [...new Map([...a, ...b].map((p) => [p.id, p])).values()];
    },
    enabled: Boolean(asal?.assignmentId),
  });
  const rincianAsal = asal ? penugasanAsal.data?.find((p) => p.id === asal.assignmentId) : undefined;

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

  const petaRekap = React.useMemo(() => new Map((rekap.data?.data ?? []).map((r) => [r.id, r])), [rekap.data]);

  const segarkan = () => {
    qc.invalidateQueries({ queryKey: ["shift"] });
    qc.invalidateQueries({ queryKey: ["shift-rekap"] });
  };

  const simpan = useMutation({
    mutationFn: async (v: FormShift) => {
      const badan = {
        date: v.date,
        startTime: v.startTime,
        endTime: v.endTime,
        breakDuration: Number(v.breakDuration || 0),
        status: v.status,
        // null mengosongkan catatan; dulu catatan yang dihapus tetap tersimpan karena tidak dikirim.
        notes: v.notes.trim() || null,
      };
      return (await api.put<Shift>(`/shifts/${ubah!.id}`, badan)).data;
    },
    onSuccess: (s) => {
      segarkan();
      notifikasi.sukses(
        "Shift diperbarui",
        `${s.employee.name} · ${formatTanggal(s.date)} ${s.startTime}–${s.endTime}${ubah?.assignmentId ? ". Tanggal lain dari penugasannya tidak berubah." : ""}`
      );
      setUbah(null);
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
    onError: (e) => {
      notifikasi.galat(e, "Shift tidak bisa dihapus");
      setHapus(null);
    },
  });

  const akhiriPenugasan = useMutation({
    mutationFn: async (s: Shift) =>
      (await api.post<{ assignment: PenugasanShift; rowsDeleted: number }>(`/shifts/assignments/${s.assignmentId}/end`, {
        endDate: geserISO(tanggalShift(s), -1),
      })).data,
    onSuccess: (r, s) => {
      segarkanPenugasan(qc);
      notifikasi.sukses(
        "Penugasan diakhiri",
        `${s.employee.name} tidak lagi mendapat shift ${s.template?.name ?? "ini"} mulai ${formatTanggal(s.date)}${r.rowsDeleted > 0 ? ` · ${r.rowsDeleted} shift dihapus` : ""}.`
      );
      setAkhiriDari(null);
    },
    onError: (e) => {
      notifikasi.galat(e, "Penugasan belum diakhiri");
      setAkhiriDari(null);
    },
  });

  const f = useForm<FormShift>({ defaultValues: { date: "", startTime: "08:00", endTime: "16:00", breakDuration: "1", status: "confirmed", notes: "" } });

  const bukaUbah = (s: Shift) => {
    f.reset({
      date: tanggalShift(s),
      startTime: s.startTime,
      endTime: s.endTime,
      breakDuration: String(s.breakDuration),
      status: s.status,
      notes: s.notes ?? "",
    });
    setUbah(s);
  };

  const ketukChip = (s: Shift) => {
    if (s.assignmentId) setAsal(s);
    else if (bolehUbah || bolehHapus) bukaUbah(s);
  };

  const semua = React.useMemo(() => shift.data ?? [], [shift.data]);
  /**
   * Karyawan yang punya minimal satu shift di minggu ini. Sistem tidak
   * menyimpan baris "libur": tanggal kosong baru berarti libur kalau roster
   * minggunya sudah disusun — aturan yang sama dipakai perhitungan cuti.
   */
  const sudahDiroster = React.useMemo(
    () => new Set(semua.filter((s) => s.status !== "cancelled").map((s) => s.employeeId)),
    [semua]
  );
  // Karyawan berjam fleksibel memang tidak diroster: tidak dihitung "belum
  // dijadwalkan" dan tidak diberi peringatan pembagian libur.
  const tanpaShift = karyawan.filter((k) => !fleksibel.has(k.id) && !sudahDiroster.has(k.id)).length;
  const perluPerhatian = karyawan.filter((k) => {
    if (fleksibel.has(k.id)) return false;
    const r = petaRekap.get(k.id);
    return r?.beruntunLewatBatas || r?.kurangLibur;
  });
  const jumlahFleksibel = karyawan.filter((k) => fleksibel.has(k.id)).length;
  const hariIni = tanggalISO(new Date());
  const bisaKetukChip = bolehUbah || bolehHapus;

  return (
    <>
      <Card>
        {/* grid-cols-1 = minmax(0,1fr): tanpa itu kolom tunggal di ponsel selebar isi terpanjangnya dan meluber dari kartu. */}
        <div className="grid grid-cols-1 gap-2 border-b border-border p-3 sm:grid-cols-[auto_minmax(0,20rem)] sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => setSenin(tambahHari(senin, -7))} aria-label="Minggu sebelumnya">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <Button variant="outline" size="sm" className="whitespace-nowrap" onClick={() => setSenin(seninDari(new Date()))}>
              <CalendarDays className="h-4 w-4" aria-hidden /> Minggu ini
            </Button>
            <Button variant="outline" size="icon" onClick={() => setSenin(tambahHari(senin, 7))} aria-label="Minggu berikutnya">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
            <p className="ml-1 whitespace-nowrap text-sm font-medium sm:ml-2">
              {formatTanggal(senin, "d MMM")} – {formatTanggal(hari[HARI - 1], "d MMM yyyy")}
            </p>
          </div>
          {pemilihDept}
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-border px-3 py-2 text-xs text-muted">
          <span><span className="font-semibold text-foreground">{semua.filter((s) => s.status !== "cancelled").length}</span> shift</span>
          <span><span className="font-semibold text-foreground">{Math.round(jamTerjadwal(semua))}</span> jam terjadwal</span>
          <span><span className="font-semibold text-foreground">{karyawan.length}</span> karyawan</span>
          {jumlahFleksibel > 0 && <span>{jumlahFleksibel} berjam fleksibel</span>}
          {tanpaShift > 0 && <span className="text-warning">{tanpaShift} belum dijadwalkan</span>}
          <span className="inline-flex items-center gap-1"><Coffee className="h-3.5 w-3.5" aria-hidden /> sel kosong pada baris yang sudah dijadwalkan = libur</span>
          <span className="inline-flex items-center gap-1"><Repeat className="h-3.5 w-3.5" aria-hidden /> dari penugasan berulang</span>
        </div>

        {perluPerhatian.length > 0 && (
          <div className="border-b border-border px-3 py-2">
            <Alert tone="warning" title={`${perluPerhatian.length} orang perlu diperiksa pembagian liburnya`}>
              Ada yang dijadwalkan lebih dari {rekap.data?.batasBeruntun ?? 6} hari berturut-turut atau melewati satu pekan penuh tanpa libur bulan ini. Rinciannya di rekap di bawah tabel.
            </Alert>
          </div>
        )}

        {shift.isLoading || direktoriMemuat ? (
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
                {karyawan.map((k) => {
                  const fleks = fleksibel.has(k.id);
                  const r = petaRekap.get(k.id);
                  return (
                    <tr key={k.id} className="align-top">
                      <th scope="row" className="sticky left-0 z-10 w-48 max-w-48 border-b border-border bg-surface px-3 py-2 text-left font-normal">
                        <span className="block truncate text-sm font-medium">{k.name}</span>
                        <span className="block truncate text-xs text-muted">{k.nik}{k.position ? ` · ${k.position.name}` : ""}</span>
                        {fleks ? (
                          <Badge tone="info" className="mt-1" title="Masuk dan pulang kapan saja; tidak memakai roster shift">Jam fleksibel</Badge>
                        ) : (r?.beruntunLewatBatas || r?.kurangLibur) ? (
                          <Badge
                            tone="warning"
                            className="mt-1"
                            title={r.beruntunLewatBatas
                              ? `Dijadwalkan ${r.beruntunMaks} hari berturut-turut pada ${formatTanggal(senin, "MMMM yyyy")}`
                              : `Ada pekan tanpa satu pun hari libur pada ${formatTanggal(senin, "MMMM yyyy")}`}
                          >
                            <TriangleAlert className="h-3 w-3" aria-hidden />
                            {r.beruntunLewatBatas ? `${r.beruntunMaks} hari beruntun` : "Pekan tanpa libur"}
                          </Badge>
                        ) : null}
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
                                  onClick={() => ketukChip(s)}
                                  disabled={!s.assignmentId && !bisaKetukChip}
                                  className={cn("rounded-lg px-1.5 py-1 text-center text-xs font-semibold leading-tight transition", kelasChip(s))}
                                  title={[
                                    k.name,
                                    s.template?.name,
                                    `${s.startTime}–${s.endTime}`,
                                    s.breakDuration ? `istirahat ${formatIstirahat(s.breakDuration)}` : null,
                                    s.status === "tentative" ? "sementara" : s.status === "cancelled" ? "dibatalkan" : null,
                                    s.assignmentId ? (s.isOverride ? "dari penugasan, diubah manual" : "dari penugasan berulang") : null,
                                    s.notes,
                                  ].filter(Boolean).join(" · ")}
                                >
                                  {(s.template || s.assignmentId) && (
                                    <span className="flex items-center justify-center gap-1">
                                      {s.template && <span className="truncate">{s.template.code || s.template.name}</span>}
                                      {s.assignmentId && <Repeat className="h-3 w-3 shrink-0" aria-label="berulang" />}
                                    </span>
                                  )}
                                  <span className={cn("block tabular-nums", s.template && "font-medium")}>{s.startTime}–{s.endTime}</span>
                                </button>
                              ))}
                              {(() => {
                                // Karyawan fleksibel tidak diroster: tidak ada "+" maupun "Libur".
                                if (fleks) {
                                  return isi.length === 0 ? (
                                    <span className="grid flex-1 place-items-center text-xs text-muted/50" title="Jam fleksibel — tidak memakai roster shift" aria-hidden>
                                      —
                                    </span>
                                  ) : null;
                                }
                                // Tiga keadaan berbeda untuk sel tanpa shift:
                                // sudah diroster berarti libur, belum diroster
                                // berarti belum disusun, dan tanpa izin membuat
                                // keduanya hanya dibaca.
                                const libur = isi.length === 0 && sudahDiroster.has(k.id);
                                if (!bolehBuat) {
                                  return isi.length === 0 ? (
                                    <span className={cn("grid flex-1 place-items-center rounded-lg text-xs", libur ? "bg-surface-2 text-muted" : "text-muted/50")}>
                                      {libur ? "Libur" : "—"}
                                    </span>
                                  ) : null;
                                }
                                return (
                                  <button
                                    type="button"
                                    onClick={() => onTetapkan({ employeeId: k.id, date: tgl, sudahAda: isi.length > 0 })}
                                    aria-label={`${isi.length > 0 ? "Tambah shift lain" : libur ? "Libur" : "Belum dijadwalkan"} — tetapkan shift ${k.name} ${formatTanggal(d)}`}
                                    title={isi.length > 0 ? "Tambah shift lain di tanggal ini" : libur ? "Libur: tidak dijadwalkan di minggu yang sudah disusun" : "Belum dijadwalkan"}
                                    className={cn(
                                      "grid flex-1 place-items-center rounded-lg border border-dashed transition hover:border-primary hover:text-primary",
                                      libur ? "border-transparent bg-surface-2 text-xs text-muted" : "border-border text-muted/70"
                                    )}
                                  >
                                    {libur ? "Libur" : <Plus className="h-4 w-4" aria-hidden />}
                                  </button>
                                );
                              })()}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
          <div>
            <h2 className="text-sm font-semibold">Rekap libur {formatTanggal(senin, "MMMM yyyy")}</h2>
            <p className="text-xs text-muted">
              Hari libur dihitung dari tanggal yang tidak dijadwalkan pada pekan yang rosternya sudah disusun. Batas wajar {rekap.data?.batasBeruntun ?? 6} hari kerja berturut-turut.
            </p>
          </div>
          {perluPerhatian.length > 0 && (
            <Badge tone="warning"><TriangleAlert className="h-3 w-3" aria-hidden /> {perluPerhatian.length} perlu diperiksa</Badge>
          )}
        </div>

        {rekap.isLoading ? (
          <SkeletonBaris />
        ) : !rekap.data?.data.length ? (
          <EmptyState icon={Coffee} title="Belum ada data" description={hr && !dept ? "Pilih departemen untuk melihat rekapnya." : "Tidak ada karyawan aktif di departemen ini."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-muted">
                  <th scope="col" className="border-b border-border px-3 py-2 text-left font-medium">Karyawan</th>
                  <th scope="col" className="border-b border-border px-3 py-2 text-right font-medium">Hari kerja</th>
                  <th scope="col" className="border-b border-border px-3 py-2 text-right font-medium">Libur</th>
                  <th scope="col" className="border-b border-border px-3 py-2 text-right font-medium">Belum disusun</th>
                  <th scope="col" className="border-b border-border px-3 py-2 text-right font-medium">Beruntun</th>
                </tr>
              </thead>
              <tbody>
                {rekap.data.data.map((r) => {
                  const fleks = r.flexibleHours || fleksibel.has(r.id);
                  const perhatian = !fleks && (r.beruntunLewatBatas || r.kurangLibur);
                  return (
                    <tr key={r.id} className={cn("border-b border-border last:border-0", perhatian && "bg-warning-soft/40")}>
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        <span className="block truncate font-medium">{r.name}</span>
                        <span className="block truncate text-xs text-muted">
                          {r.nik}
                          {fleks ? <span className="text-info"> · jam fleksibel, tidak diroster</span> : r.kurangLibur && <span className="text-warning"> · ada pekan tanpa libur</span>}
                        </span>
                      </th>
                      {fleks ? (
                        <td colSpan={4} className="px-3 py-2 text-right text-xs text-muted">Masuk dan pulang kapan saja</td>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-right tabular-nums">{r.hariKerja}</td>
                          <td className={cn("px-3 py-2 text-right tabular-nums", r.kurangLibur && "font-semibold text-warning")}>{r.hariLibur}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted">{r.belumDisusun}</td>
                          <td className={cn("px-3 py-2 text-right tabular-nums", r.beruntunLewatBatas && "font-semibold text-warning")}>
                            {r.beruntunMaks} hari
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Asal chip hasil penugasan: satu tanggal saja, atau penugasannya. */}
      <Modal
        open={Boolean(asal)}
        onClose={() => setAsal(null)}
        title="Shift berulang"
        description={asal ? `${asal.employee.name} · ${formatTanggal(asal.date, "EEEE, d MMM yyyy")}` : undefined}
        footer={<Button variant="outline" onClick={() => setAsal(null)}><X className="h-4 w-4" aria-hidden /> Tutup</Button>}
      >
        {asal && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {asal.template && <ChipJenis jenis={asal.template} lengkap />}
              <span className="tabular-nums">{asal.startTime}–{asal.endTime}</span>
              {asal.breakDuration > 0 && <span className="text-muted">· istirahat {formatIstirahat(asal.breakDuration)}</span>}
              {asal.status === "tentative" && <Badge tone="warning">Sementara</Badge>}
              {asal.status === "cancelled" && <Badge tone="danger">Dibatalkan</Badge>}
            </div>
            <p className="flex items-start gap-2 text-sm">
              <Repeat className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
              <span>
                {rincianAsal ? (
                  <>
                    Dari penugasan <span className="font-medium">{rincianAsal.template.name}</span> ·{" "}
                    {rincianAsal.endDate ? formatPeriode(rincianAsal.startDate, rincianAsal.endDate) : `seterusnya sejak ${formatTanggal(dariISO(rincianAsal.startDate), "d MMM yyyy")}`}
                    <span className="block text-xs text-muted">
                      {formatHariPekan(rincianAsal.weekdays)}
                      {rincianAsal.skipPublicHolidays ? " · libur nasional dilewati" : ""}
                    </span>
                  </>
                ) : penugasanAsal.isLoading ? (
                  <span className="text-muted">Memuat penugasan…</span>
                ) : (
                  <>Dari penugasan {asal.template ? <span className="font-medium">{asal.template.name}</span> : "berulang"}</>
                )}
              </span>
            </p>
            {asal.isOverride && (
              <Alert tone="info" title="Sudah diubah manual">
                Tanggal ini tidak lagi ikut perubahan jam pada jenis shift atau penugasannya.
              </Alert>
            )}
            <div className="grid gap-2">
              {bolehUbah && (
                <Button variant="outline" className="justify-start" onClick={() => { const s = asal; setAsal(null); bukaUbah(s); }}>
                  <Pencil className="h-4 w-4" aria-hidden /> Ubah tanggal ini saja
                </Button>
              )}
              {bolehUbah && (
                <Button variant="outline" className="justify-start" onClick={() => { const s = asal; setAsal(null); setAkhiriDari(s); }}>
                  <CalendarX2 className="h-4 w-4" aria-hidden /> Akhiri penugasan mulai tanggal ini
                </Button>
              )}
              {bolehHapus && (
                <Button variant="outline" className="justify-start text-danger" onClick={() => { const s = asal; setAsal(null); setHapus(s); }}>
                  <Trash2 className="h-4 w-4" aria-hidden /> Hapus tanggal ini
                </Button>
              )}
              {!bolehUbah && !bolehHapus && <p className="text-sm text-muted">Anda hanya bisa melihat jadwal ini.</p>}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(ubah)}
        onClose={() => setUbah(null)}
        title="Ubah Shift"
        description={ubah ? `${ubah.employee.name} · ${formatTanggal(ubah.date)}${ubah.template ? ` · ${ubah.template.name}` : ""}` : undefined}
        footer={
          <>
            {ubah && bolehHapus && (
              <Button variant="ghost" className="mr-auto text-danger" onClick={() => { const s = ubah; setUbah(null); setHapus(s); }}>
                <Trash2 className="h-4 w-4" aria-hidden /> Hapus
              </Button>
            )}
            <Button variant="outline" onClick={() => setUbah(null)} disabled={simpan.isPending}><X className="h-4 w-4" aria-hidden /> Batal</Button>
            <Button form="form-shift" type="submit" loading={simpan.isPending} disabled={!bolehUbah}>{!simpan.isPending && <Save className="h-4 w-4" aria-hidden />} Simpan</Button>
          </>
        }
      >
        <form id="form-shift" onSubmit={f.handleSubmit((v) => simpan.mutate(v))} className="space-y-4" noValidate>
          {ubah?.assignmentId && (
            <Alert tone="info" title="Hanya tanggal ini">
              Tanggal lain dari penugasannya tidak berubah, dan tanggal ini tidak lagi mengikuti perubahan jam jenis shiftnya.
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tanggal" error={f.formState.errors.date?.message}>
              <Input type="date" {...f.register("date", { required: "Tanggal wajib diisi" })} />
            </Field>
            <Field label="Status" hint="Sementara = rencana yang belum final">
              <Select {...f.register("status")}>
                <option value="confirmed">Terjadwal</option>
                <option value="tentative">Sementara</option>
                {ubah?.status === "cancelled" && <option value="cancelled">Dibatalkan</option>}
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
        description={
          hapus
            ? `${hapus.employee.name} · ${formatTanggal(hapus.date)} ${hapus.startTime}–${hapus.endTime}. ${hapus.assignmentId ? "Hanya tanggal ini; penugasannya tetap berjalan. " : ""}Bila sudah ada presensi yang terkait, shift ditandai dibatalkan, bukan dihapus.`
            : ""
        }
        confirmLabel="Hapus"
        confirmIcon={Trash2}
      />

      <ConfirmDialog
        open={Boolean(akhiriDari)}
        onClose={() => setAkhiriDari(null)}
        onConfirm={() => akhiriDari && akhiriPenugasan.mutate(akhiriDari)}
        loading={akhiriPenugasan.isPending}
        danger
        title="Akhiri penugasan?"
        description={
          akhiriDari
            ? `${akhiriDari.employee.name} tidak lagi mendapat shift ${akhiriDari.template?.name ?? "dari penugasan ini"} mulai ${formatTanggal(akhiriDari.date, "EEEE, d MMM yyyy")}. Shift sejak tanggal itu yang belum ada presensinya dihapus; yang sebelumnya tetap.`
            : ""
        }
        confirmLabel="Akhiri"
        confirmIcon={CalendarX2}
      />

      {semua.length === 0 && karyawan.length > jumlahFleksibel && !shift.isLoading && (
        <p className="text-center text-sm text-muted">
          Belum ada jadwal minggu ini.{" "}
          {bolehBuat
            ? <>Pakai <span className="font-medium text-foreground">Tetapkan Shift</span> untuk menyusun jadwal berulang sekaligus, atau ketuk sel untuk satu karyawan. Status <Badge tone="warning">Sementara</Badge> untuk rencana yang belum final.</>
            : "Hubungi atasan Anda bila jadwalnya belum terbit."}
        </p>
      )}
    </>
  );
};
