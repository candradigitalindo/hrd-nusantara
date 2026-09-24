"use client";

import * as React from "react";
import { BellRing, Building2, History, LogOut, MessagesSquare, Plus, QrCode, Smartphone, Unplug } from "lucide-react";
import { Button, TombolAksi } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { cn, formatRelatif } from "@/lib/utils";
import type { AkunWhatsApp, BarisKepatuhanWa, Departemen, StatusTautanWa } from "@/lib/types";

export type SaringanNomor = "semua" | "perlu" | "tersambung";

interface BarisNomor {
  kunci: string;
  jenis: "karyawan" | "perusahaan";
  nama: string;
  keterangan: string;
  nomor: string | null;
  status: StatusTautanWa;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  grupAbsensi: string | null;
  employeeId: string | null;
  akun: AkunWhatsApp | null;
}

const STATUS: Record<StatusTautanWa, { label: string; titik: string; teks: string }> = {
  connected: { label: "Tersambung", titik: "bg-success", teks: "text-success" },
  pending_scan: { label: "Perlu scan ulang", titik: "bg-warning", teks: "text-warning" },
  disconnected: { label: "Terputus", titik: "bg-danger", teks: "text-danger" },
  never_linked: { label: "Belum ditautkan", titik: "bg-danger", teks: "text-danger" },
};

/** Status sesi nomor perusahaan dibakukan ke empat keadaan yang sama dengan nomor karyawan. */
const statusAkun = (s: string): StatusTautanWa =>
  s === "connected" ? "connected" : s === "disconnected" ? "disconnected" : "pending_scan";

/** Kalimat waktu yang paling berguna untuk keadaan itu. */
const waktuStatus = (b: BarisNomor) => {
  if (b.status === "connected") return b.lastConnectedAt ? `sejak ${formatRelatif(b.lastConnectedAt)}` : null;
  if (b.status === "never_linked") return null;
  const putus = b.lastDisconnectedAt ?? b.lastConnectedAt;
  return putus ? `sejak ${formatRelatif(putus)}` : null;
};

/**
 * Seluruh nomor yang dipantau dalam satu daftar: nomor karyawan dan nomor
 * perusahaan. Keadaannya dibaca dari satu titik warna dan satu kalimat, dan
 * aksi yang muncul hanya yang masuk akal untuk keadaan itu.
 */
export const PanelNomor = ({
  kepatuhan,
  akun,
  departemen,
  memuat,
  saringan,
  onSaringan,
  bolehBuat,
  bolehUbah,
  seluruhIsi,
  ingatkanUntuk,
  sambungkanUntuk,
  onIngatkan,
  onSambungkan,
  onPutus,
  onTarik,
  onLihatPercakapan,
  onDaftarkan,
}: {
  kepatuhan: BarisKepatuhanWa[];
  akun: AkunWhatsApp[];
  departemen: Departemen[];
  memuat: boolean;
  saringan: SaringanNomor;
  onSaringan: (s: SaringanNomor) => void;
  bolehBuat: boolean;
  bolehUbah: boolean;
  seluruhIsi: boolean;
  ingatkanUntuk: string | "semua" | null;
  sambungkanUntuk: string | null;
  onIngatkan: (employeeIds?: string[]) => void;
  onSambungkan: (a: AkunWhatsApp) => void;
  onPutus: (a: AkunWhatsApp, logout: boolean) => void;
  onTarik: (a: AkunWhatsApp) => void;
  onLihatPercakapan: (accountId: string) => void;
  onDaftarkan: () => void;
}) => {
  const [dept, setDept] = React.useState("");

  const baris = React.useMemo<BarisNomor[]>(() => {
    const petaAkun = new Map(akun.map((a) => [a.id, a]));
    const karyawan: BarisNomor[] = kepatuhan
      .filter((b) => !dept || b.employee.department?.id === dept)
      .map((b) => ({
        kunci: `k:${b.employee.id}`,
        jenis: "karyawan",
        nama: b.employee.name,
        keterangan: [b.employee.nik, b.employee.department?.name].filter(Boolean).join(" · "),
        nomor: b.phoneNumber,
        status: b.status,
        lastConnectedAt: b.lastConnectedAt,
        lastDisconnectedAt: b.lastDisconnectedAt,
        grupAbsensi: b.attendanceGroupName,
        employeeId: b.employee.id,
        akun: b.accountId ? (petaAkun.get(b.accountId) ?? null) : null,
      }));
    // Nomor perusahaan tidak melekat pada departemen karyawan, jadi ikut
    // tersembunyi saat daftar sedang dipersempit ke satu departemen.
    const perusahaan: BarisNomor[] = dept
      ? []
      : akun
          .filter((a) => a.kind === "company")
          .map((a) => ({
            kunci: `p:${a.id}`,
            jenis: "perusahaan",
            nama: a.label,
            keterangan: a.assignedEmployee ? `Dipegang ${a.assignedEmployee.name}` : "Belum ada pemegang",
            nomor: a.phoneNumber,
            status: statusAkun(a.sessionStatus),
            lastConnectedAt: a.lastConnectedAt,
            lastDisconnectedAt: a.lastDisconnectedAt,
            grupAbsensi: null,
            employeeId: null,
            akun: a,
          }));
    return [...perusahaan, ...karyawan];
  }, [kepatuhan, akun, dept]);

  const jumlah = {
    semua: baris.length,
    perlu: baris.filter((b) => b.status !== "connected").length,
    tersambung: baris.filter((b) => b.status === "connected").length,
  };
  const tampil = baris.filter((b) => (saringan === "semua" ? true : saringan === "perlu" ? b.status !== "connected" : b.status === "connected"));
  const karyawanBelum = baris.filter((b) => b.jenis === "karyawan" && b.status !== "connected");

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="flex gap-1 rounded-xl bg-surface-2 p-1" role="group" aria-label="Saring keadaan">
          {([
            ["semua", "Semua"],
            ["perlu", "Perlu tindakan"],
            ["tersambung", "Tersambung"],
          ] as const).map(([kode, label]) => (
            <button
              key={kode}
              type="button"
              aria-pressed={saringan === kode}
              onClick={() => onSaringan(kode)}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                saringan === kode ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"
              )}
            >
              {label}
              <span className={cn("rounded-full px-1.5 text-xs tabular-nums", kode === "perlu" && jumlah.perlu > 0 ? "bg-warning-soft text-warning" : "bg-surface-2 text-muted")}>
                {jumlah[kode]}
              </span>
            </button>
          ))}
        </div>
        <div className="w-full sm:w-52">
          <Select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Departemen">
            <option value="">Semua departemen</option>
            {departemen.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </div>
        <div className="ml-auto flex gap-2">
          {bolehUbah && karyawanBelum.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => onIngatkan(karyawanBelum.map((b) => b.employeeId!))} loading={ingatkanUntuk === "semua"}>
              {ingatkanUntuk !== "semua" && <BellRing className="h-4 w-4" aria-hidden />} Ingatkan {karyawanBelum.length}
            </Button>
          )}
          {bolehBuat && (
            <Button size="sm" onClick={onDaftarkan}><Plus className="h-4 w-4" aria-hidden /> Nomor perusahaan</Button>
          )}
        </div>
      </div>

      {memuat ? (
        <SkeletonBaris />
      ) : tampil.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-muted">
          {saringan === "perlu" ? "Semua nomor tersambung. Tidak ada yang perlu ditindaklanjuti." : "Tidak ada nomor untuk saringan ini."}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {tampil.map((b) => {
            const st = STATUS[b.status];
            const waktu = waktuStatus(b);
            const tersambung = b.status === "connected";
            return (
              <li key={b.kunci} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden>
                  {b.jenis === "perusahaan" ? <Building2 className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
                  <span className={cn("absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-surface", st.titik)} />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {b.nama}
                    {b.jenis === "perusahaan" && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">Perusahaan</span>}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {b.keterangan}
                    {b.nomor ? <span className="tabular-nums"> · +{b.nomor}</span> : ""}
                  </p>
                  <p className="mt-0.5 truncate text-xs">
                    <span className={cn("font-medium", st.teks)}>{st.label}</span>
                    {waktu && <span className="text-muted"> {waktu}</span>}
                    {tersambung && b.jenis === "karyawan" && (
                      <span className="text-muted"> · {b.grupAbsensi ? `foto absensi → ${b.grupAbsensi}` : "grup foto absensi belum dipilih"}</span>
                    )}
                  </p>
                </div>

                <div className="flex shrink-0 gap-1.5">
                  {b.akun && <TombolAksi icon={MessagesSquare} label="Lihat percakapan" onClick={() => onLihatPercakapan(b.akun!.id)} />}
                  {bolehUbah && b.jenis === "karyawan" && !tersambung && (
                    <TombolAksi
                      icon={BellRing}
                      label="Ingatkan lewat notifikasi ponsel"
                      onClick={() => onIngatkan([b.employeeId!])}
                      disabled={ingatkanUntuk === b.employeeId}
                    />
                  )}
                  {bolehUbah && b.jenis === "perusahaan" && !tersambung && b.akun && (
                    <TombolAksi icon={QrCode} label="Sambungkan (pindai QR)" onClick={() => onSambungkan(b.akun!)} disabled={sambungkanUntuk === b.akun.id} />
                  )}
                  {seluruhIsi && tersambung && b.akun && <TombolAksi icon={History} label="Tarik riwayat lama" onClick={() => onTarik(b.akun!)} />}
                  {bolehUbah && tersambung && b.akun && (
                    <>
                      <TombolAksi icon={Unplug} label="Putus sementara" onClick={() => onPutus(b.akun!, false)} />
                      <TombolAksi icon={LogOut} label="Logout — wajib scan ulang" tone="bahaya" onClick={() => onPutus(b.akun!, true)} />
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
