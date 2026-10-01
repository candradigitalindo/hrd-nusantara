"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Check, Loader2, Search, X } from "lucide-react";
import { api, ambilGalat } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { cn, formatTanggal } from "@/lib/utils";
import type { DurasiPenugasan, HasilPenugasan, JenisShift, KaryawanDirektori } from "@/lib/types";
import {
  HARI_PEKAN,
  akhirEfektif,
  dariISO,
  formatIstirahat,
  formatPeriode,
  geserISO,
  labelAlasan,
  lintasMalam,
  menitShift,
} from "./util-shift";

const KUSTOM = "__kustom__";
const MAKS_KARYAWAN = 100;

const PILIHAN_DURASI: { nilai: DurasiPenugasan; label: string }[] = [
  { nilai: "hari", label: "1 hari" },
  { nilai: "minggu", label: "1 minggu" },
  { nilai: "bulan", label: "1 bulan" },
  { nilai: "seterusnya", label: "Seterusnya" },
  { nilai: "sampai", label: "Sampai tanggal…" },
];

/** "3 bentrok, 2 libur nasional" dari semua tanggal yang dilewati. */
const rincianAlasan = (hasil: HasilPenugasan) => {
  const hitung = new Map<string, number>();
  for (const r of hasil.results) for (const s of r.skipped) hitung.set(s.reason, (hitung.get(s.reason) ?? 0) + 1);
  return [...hitung.entries()].map(([k, n]) => `${n} ${labelAlasan(k)}`).join(", ");
};

/** Ringkasan pratinjau/hasil: berapa shift jadi, apa yang dilewati, siapa yang gagal. */
const RingkasanHasil = ({ hasil, pratinjau }: { hasil: HasilPenugasan; pratinjau: boolean }) => {
  const { totals } = hasil;
  const berhasil = totals.employees - totals.failed;
  const diganti = hasil.results.reduce((n, r) => n + r.replacedAssignments, 0);
  const gagal = hasil.results.filter((r) => r.error);
  const adaLewati = hasil.results.filter((r) => r.skipped.length > 0);
  return (
    <div className="space-y-2 text-sm">
      <p>
        <span className="font-semibold">{totals.created} shift</span> {pratinjau ? "akan dibuat" : "dibuat"} untuk{" "}
        <span className="font-semibold">{berhasil} karyawan</span>
        {totals.skipped > 0 && (
          <>
            {" · "}
            <span className="text-warning">{totals.skipped} tanggal dilewati</span> <span className="text-muted">({rincianAlasan(hasil)})</span>
          </>
        )}
      </p>
      {diganti > 0 && <p className="text-muted">{diganti} penugasan lama {pratinjau ? "akan diakhiri" : "diakhiri"} karena tumpang tindih.</p>}
      {gagal.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-danger-soft p-2 text-danger">
          {gagal.map((r) => (
            <li key={r.employeeId}>
              <span className="font-medium">{r.employeeName}</span> — {r.error}
            </li>
          ))}
        </ul>
      )}
      {adaLewati.length > 0 && (
        <details className="rounded-lg border border-border px-3 py-2">
          <summary className="cursor-pointer text-muted">Rincian tanggal yang dilewati</summary>
          <ul className="mt-2 space-y-1.5">
            {adaLewati.map((r) => (
              <li key={r.employeeId}>
                <span className="font-medium">{r.employeeName}</span>:{" "}
                <span className="text-muted">
                  {r.skipped.map((s) => `${formatTanggal(dariISO(s.date), "EEE d MMM")} (${labelAlasan(s.reason)})`).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

/**
 * Menetapkan satu jenis shift kepada satu atau banyak karyawan untuk sehari,
 * seminggu, sebulan, sampai tanggal tertentu, atau seterusnya — pengganti
 * mengisi roster tanggal demi tanggal. Server yang membuat baris jadwalnya;
 * dialog ini menampilkan pratinjau hitungan server sebelum disimpan.
 *
 * Dirender hanya saat terbuka, jadi isian awal cukup dari useState.
 */
export const DialogTetapkanShift = ({
  onClose,
  awal,
  karyawan,
  fleksibel,
  tanggalBawaan,
}: {
  onClose: () => void;
  /** Dari sel roster: satu karyawan dan tanggalnya sudah terisi. */
  awal?: { employeeId: string; date: string; sudahAda?: boolean };
  /** Calon yang bisa dipilih (karyawan aktif di departemen yang sedang dilihat). */
  karyawan: KaryawanDirektori[];
  /** Karyawan berjam fleksibel: ditampilkan tapi tidak bisa dipilih. */
  fleksibel: Set<string>;
  tanggalBawaan: string;
}) => {
  const qc = useQueryClient();
  const [cari, setCari] = React.useState("");
  const [dipilih, setDipilih] = React.useState<string[]>(awal ? [awal.employeeId] : []);
  const [jenisId, setJenisId] = React.useState("");
  const [jamMulai, setJamMulai] = React.useState("08:00");
  const [jamSelesai, setJamSelesai] = React.useState("16:00");
  const [istirahat, setIstirahat] = React.useState("1");
  const [mulai, setMulai] = React.useState(awal?.date ?? tanggalBawaan);
  // "+" di sel yang sudah berisi shift berarti menambah shift kedua hari itu.
  // Bawaan "1 minggu" + "ganti penugasan lain" di sana justru mengakhiri
  // penugasan yang sedang berjalan, jadi bawaannya cukup tanggal itu saja.
  const [durasi, setDurasi] = React.useState<DurasiPenugasan>(awal?.sudahAda ? "hari" : "minggu");
  const [sampai, setSampai] = React.useState("");
  const [hari, setHari] = React.useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [lewatiLibur, setLewatiLibur] = React.useState(false);
  const [ganti, setGanti] = React.useState(true);
  const [status, setStatus] = React.useState<"confirmed" | "tentative">("confirmed");
  const [catatan, setCatatan] = React.useState("");
  const [hasil, setHasil] = React.useState<HasilPenugasan | null>(null);

  const jenis = useQuery({
    queryKey: ["shift-jenis", "aktif"],
    queryFn: async () => (await api.get<{ data: JenisShift[] }>("/shifts/templates?includeInactive=false")).data.data,
  });
  const daftarJenis = React.useMemo(() => (jenis.data ?? []).filter((j) => j.isActive), [jenis.data]);
  const jenisDipilih = daftarJenis.find((j) => j.id === jenisId);
  const kustom = jenisId === KUSTOM;
  const sehari = durasi === "hari";

  const satuKaryawan = awal ? karyawan.find((k) => k.id === awal.employeeId) : undefined;
  const tersaring = React.useMemo(() => {
    const q = cari.trim().toLowerCase();
    return q ? karyawan.filter((k) => k.name.toLowerCase().includes(q) || k.nik.toLowerCase().includes(q)) : karyawan;
  }, [karyawan, cari]);
  const bisaDipilih = tersaring.filter((k) => !fleksibel.has(k.id));
  const semuaTerpilih = bisaDipilih.length > 0 && bisaDipilih.every((k) => dipilih.includes(k.id));

  const pilih = (id: string) => setDipilih((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  const pilihSemua = () => {
    const ids = bisaDipilih.map((k) => k.id);
    setDipilih((d) => (semuaTerpilih ? d.filter((x) => !ids.includes(x)) : [...new Set([...d, ...ids])]));
  };

  const ubahDurasi = (d: DurasiPenugasan) => {
    setDurasi(d);
    // Jam kustom hanya untuk satu hari: penugasan berulang selalu memakai jenis
    // shift supaya perubahan jamnya bisa diteruskan ke tanggal-tanggal berikutnya.
    if (d !== "hari" && jenisId === KUSTOM) setJenisId("");
  };

  const akhir = akhirEfektif(mulai, durasi, sampai);

  /** Pesan pertama yang menghalangi; null = siap dipratinjau dan disimpan. */
  const galat = React.useMemo(() => {
    if (dipilih.length === 0) return "Pilih minimal satu karyawan.";
    if (dipilih.length > MAKS_KARYAWAN) return `Paling banyak ${MAKS_KARYAWAN} karyawan sekali tetapkan.`;
    if (!jenisId) return "Pilih jenis shift.";
    if (kustom) {
      if (!jamMulai || !jamSelesai) return "Isi jam mulai dan selesai.";
      if (jamMulai === jamSelesai) return "Jam selesai tidak boleh sama dengan jam mulai.";
      const ist = Number(istirahat || 0);
      if (ist < 0 || ist > 12) return "Istirahat 0–12 jam.";
      if (ist * 60 >= menitShift(jamMulai, jamSelesai)) return "Istirahat harus lebih pendek dari panjang shift.";
    }
    if (!mulai) return "Isi tanggal mulai.";
    if (durasi === "sampai") {
      if (!sampai) return "Isi tanggal akhir.";
      if (sampai < mulai) return "Tanggal akhir tidak boleh sebelum tanggal mulai.";
      if (sampai > geserISO(mulai, 366)) return "Paling lama 366 hari dari tanggal mulai — pilih Seterusnya bila tanpa batas.";
    }
    if (!sehari && hari.length === 0) return "Pilih minimal satu hari kerja.";
    return null;
  }, [dipilih, jenisId, kustom, jamMulai, jamSelesai, istirahat, mulai, durasi, sampai, sehari, hari]);

  // Badan permintaan tanpa kunci yang tidak relevan: skema server ketat dan
  // menolak bidang asing (mis. weekdays untuk satu hari).
  const badan = React.useMemo(() => {
    if (galat) return null;
    return {
      employeeIds: dipilih,
      ...(kustom ? { startTime: jamMulai, endTime: jamSelesai, breakDuration: Number(istirahat || 0) } : { templateId: jenisId }),
      startDate: mulai,
      durasi,
      ...(durasi === "sampai" ? { endDate: sampai } : {}),
      ...(sehari ? {} : { weekdays: [...hari].sort((a, b) => a - b), skipPublicHolidays: lewatiLibur, replaceExisting: ganti }),
      status,
      ...(catatan.trim() ? { notes: catatan.trim() } : {}),
    };
  }, [galat, dipilih, kustom, jamMulai, jamSelesai, istirahat, jenisId, mulai, durasi, sampai, sehari, hari, lewatiLibur, ganti, status, catatan]);

  // Pratinjau ditunda sebentar supaya mencentang lima karyawan berturut-turut
  // tidak menjadi lima perhitungan di server.
  const kunci = badan ? JSON.stringify(badan) : null;
  const [kunciTunda, setKunciTunda] = React.useState(kunci);
  React.useEffect(() => {
    const t = setTimeout(() => setKunciTunda(kunci), 450);
    return () => clearTimeout(t);
  }, [kunci]);

  const pratinjau = useQuery({
    queryKey: ["shift-pratinjau", kunciTunda],
    queryFn: async () => (await api.post<HasilPenugasan>("/shifts/assignments", { ...JSON.parse(kunciTunda!), preview: true })).data,
    enabled: Boolean(kunciTunda) && !hasil,
    retry: false,
    staleTime: 15_000,
    gcTime: 60_000,
    // Angka lama tetap tampil (diredupkan) selama hitungan baru berjalan, supaya ringkasannya tidak berkedip.
    placeholderData: (lama) => lama,
  });
  const menunggu = kunci !== kunciTunda || pratinjau.isFetching;

  const simpan = useMutation({
    mutationFn: async () => (await api.post<HasilPenugasan>("/shifts/assignments", badan)).data,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["shift"] });
      qc.invalidateQueries({ queryKey: ["shift-rekap"] });
      qc.invalidateQueries({ queryKey: ["shift-penugasan"] });
      qc.invalidateQueries({ queryKey: ["shift-jenis"] });
      qc.removeQueries({ queryKey: ["shift-pratinjau"] });
      const { totals } = r;
      if (totals.failed > 0) {
        // Yang gagal perlu dibaca satu per satu, jadi hasilnya tetap di layar.
        setHasil(r);
        notifikasi.peringatan(`${totals.failed} karyawan tidak ditetapkan`, "Rinciannya ada di dialog.");
        return;
      }
      if (totals.created === 0) {
        notifikasi.peringatan("Tidak ada shift baru", totals.skipped > 0 ? `Semua tanggal dilewati: ${rincianAlasan(r)}.` : undefined);
      } else {
        notifikasi.sukses(
          `${totals.created} shift ditetapkan`,
          `${totals.employees} karyawan${totals.skipped > 0 ? ` · ${totals.skipped} tanggal dilewati (${rincianAlasan(r)})` : ""}`
        );
      }
      onClose();
    },
    onError: (e) => notifikasi.galat(e, "Shift belum ditetapkan"),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={hasil ? "Hasil penetapan shift" : "Tetapkan Shift"}
      description={hasil ? undefined : "Satu jenis shift untuk satu atau banyak karyawan, sekali atur untuk rentang yang dipilih."}
      footer={
        hasil ? (
          <Button onClick={onClose}><Check className="h-4 w-4" aria-hidden /> Selesai</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose} disabled={simpan.isPending}><X className="h-4 w-4" aria-hidden /> Batal</Button>
            <Button onClick={() => simpan.mutate()} loading={simpan.isPending} disabled={Boolean(galat)}>
              {!simpan.isPending && <CalendarCheck className="h-4 w-4" aria-hidden />} Tetapkan
            </Button>
          </>
        )
      }
    >
      {hasil ? (
        <RingkasanHasil hasil={hasil} pratinjau={false} />
      ) : (
        <div className="space-y-5">
          {/* Karyawan */}
          {awal ? (
            <div className="rounded-xl border border-border p-3 text-sm">
              <p className="text-xs text-muted">Karyawan</p>
              <p className="font-medium">{satuKaryawan?.name ?? "—"}</p>
              {satuKaryawan && <p className="text-xs text-muted">{satuKaryawan.nik}{satuKaryawan.department ? ` · ${satuKaryawan.department.name}` : ""}</p>}
            </div>
          ) : (
            <fieldset className="min-w-0 space-y-2">
              <legend className="mb-2 text-sm font-medium">
                Karyawan {dipilih.length > 0 && <span className="text-muted">({dipilih.length} dipilih)</span>}
              </legend>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                  <Input className="pl-9" placeholder="Cari nama atau NIK…" value={cari} onChange={(e) => setCari(e.target.value)} aria-label="Cari karyawan" />
                </div>
                <label className="flex items-center gap-2 text-sm whitespace-nowrap">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={semuaTerpilih} onChange={pilihSemua} disabled={bisaDipilih.length === 0} />
                  Pilih semua{cari ? " yang tampil" : ""}
                </label>
              </div>
              {karyawan.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted">Tidak ada karyawan aktif di departemen ini.</p>
              ) : (
                <ul className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
                  {tersaring.length === 0 && <li className="p-3 text-center text-sm text-muted">Tidak ada yang cocok.</li>}
                  {tersaring.map((k) => {
                    const fleks = fleksibel.has(k.id);
                    const aktif = dipilih.includes(k.id);
                    return (
                      <li key={k.id}>
                        <label
                          className={cn(
                            "flex items-center gap-3 rounded-lg p-2 text-sm",
                            fleks ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                            aktif ? "bg-primary-soft" : !fleks && "hover:bg-surface-2"
                          )}
                        >
                          <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={aktif} disabled={fleks} onChange={() => pilih(k.id)} />
                          <span className="min-w-0 flex-1 truncate">
                            {k.name} <span className="text-xs text-muted">{k.nik}{k.department ? ` · ${k.department.name}` : ""}</span>
                          </span>
                          {fleks && <Badge tone="info" className="shrink-0">Jam fleksibel</Badge>}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </fieldset>
          )}

          {/* Jenis & rentang */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Jenis shift"
              hint={
                jenisDipilih
                  ? `${jenisDipilih.startTime}–${jenisDipilih.endTime}${lintasMalam(jenisDipilih.startTime, jenisDipilih.endTime) ? " (+1 hari)" : ""} · istirahat ${formatIstirahat(jenisDipilih.breakDuration)}`
                  : !jenis.isLoading && daftarJenis.length === 0
                    ? "Belum ada jenis shift — buat dulu di tab Jenis Shift."
                    : "Jam kustom hanya untuk 1 hari"
              }
            >
              <Select value={jenisId} onChange={(e) => setJenisId(e.target.value)} disabled={jenis.isLoading}>
                <option value="">{jenis.isLoading ? "Memuat…" : "Pilih jenis shift"}</option>
                {daftarJenis.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name} · {j.startTime}–{j.endTime}{j.department ? ` · ${j.department.name}` : ""}
                  </option>
                ))}
                <option value={KUSTOM} disabled={!sehari}>Jam kustom{sehari ? "" : " (hanya 1 hari)"}</option>
              </Select>
            </Field>
            <Field label="Mulai">
              <Input type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} />
            </Field>
          </div>

          {kustom && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Jam mulai"><Input type="time" value={jamMulai} onChange={(e) => setJamMulai(e.target.value)} /></Field>
              <Field label="Jam selesai"><Input type="time" value={jamSelesai} onChange={(e) => setJamSelesai(e.target.value)} /></Field>
              <Field label="Istirahat (jam)" className="col-span-2 sm:col-span-1">
                <Input type="number" step="0.5" min={0} max={12} value={istirahat} onChange={(e) => setIstirahat(e.target.value)} />
              </Field>
            </div>
          )}

          <fieldset className="min-w-0">
            <legend className="mb-1.5 text-sm font-medium">Berlaku</legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Berlaku">
              {PILIHAN_DURASI.map((p) => (
                <button
                  key={p.nilai}
                  type="button"
                  role="radio"
                  aria-checked={durasi === p.nilai}
                  onClick={() => ubahDurasi(p.nilai)}
                  className={cn(
                    "h-9 rounded-lg border px-3 text-sm font-medium transition-colors",
                    durasi === p.nilai ? "border-primary bg-primary text-on-primary" : "border-border bg-surface hover:bg-surface-2"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {durasi === "sampai" && (
              <Field label="Sampai" className="mt-3 sm:w-1/2">
                <Input type="date" value={sampai} min={mulai} max={mulai ? geserISO(mulai, 366) : undefined} onChange={(e) => setSampai(e.target.value)} />
              </Field>
            )}
            {mulai && (durasi !== "sampai" || sampai) && (
              <p className="mt-2 text-xs text-muted">
                {durasi === "seterusnya"
                  ? `Mulai ${formatTanggal(dariISO(mulai), "EEEE, d MMM yyyy")} tanpa tanggal akhir. Shift dibuat sampai sekitar dua bulan ke depan dan diperpanjang otomatis.`
                  : `Berlaku ${formatPeriode(mulai, akhir)}.`}
              </p>
            )}
          </fieldset>

          {!sehari && (
            <fieldset className="min-w-0">
              <legend className="mb-1.5 text-sm font-medium">Hari kerja</legend>
              <div className="flex flex-wrap gap-1.5">
                {HARI_PEKAN.map((h) => {
                  const aktif = hari.includes(h.nilai);
                  return (
                    <button
                      key={h.nilai}
                      type="button"
                      aria-pressed={aktif}
                      aria-label={h.panjang}
                      title={h.panjang}
                      onClick={() => setHari((d) => (aktif ? d.filter((x) => x !== h.nilai) : [...d, h.nilai]))}
                      className={cn(
                        "h-9 min-w-11 rounded-lg border px-2 text-sm font-medium transition-colors",
                        aktif ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface text-muted hover:bg-surface-2"
                      )}
                    >
                      {h.pendek}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-muted">Hari yang tidak dipilih menjadi hari libur pada pekan itu.</p>
            </fieldset>
          )}

          {!sehari && (
            <div className="space-y-3">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={lewatiLibur} onChange={(e) => setLewatiLibur(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
                <span>
                  Lewati libur nasional
                  <span className="block text-xs text-muted">Tanggal merah tidak dibuatkan shift.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={ganti} onChange={(e) => setGanti(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
                <span>
                  Ganti penugasan lain mulai tanggal ini
                  <span className="block text-xs text-muted">Penugasan lama yang bertumpuk diakhiri sehari sebelumnya; shift-nya yang belum ada presensi dihapus.</span>
                </span>
              </label>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
            <Field label="Status" hint="Sementara = rencana yang belum final">
              <Select value={status} onChange={(e) => setStatus(e.target.value as "confirmed" | "tentative")}>
                <option value="confirmed">Terjadwal</option>
                <option value="tentative">Sementara</option>
              </Select>
            </Field>
            <Field label="Catatan (opsional)">
              <Textarea rows={2} maxLength={500} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Mis. buka outlet, tutup outlet" className="min-h-10" />
            </Field>
          </div>

          {/* Pratinjau dari server */}
          <section aria-live="polite" className="rounded-xl bg-surface-2 p-3">
            <p className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
              Pratinjau {badan && menunggu && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Menghitung" />}
            </p>
            {galat ? (
              <p className="text-sm text-muted">{galat}</p>
            ) : pratinjau.isError ? (
              <Alert tone="danger" title="Tidak bisa dipratinjau">{ambilGalat(pratinjau.error).pesan}</Alert>
            ) : pratinjau.data ? (
              <div className={cn(menunggu && "opacity-60")}>
                <RingkasanHasil hasil={pratinjau.data} pratinjau />
              </div>
            ) : (
              <p className="text-sm text-muted">Menghitung…</p>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
};
