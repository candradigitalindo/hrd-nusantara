"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useSesi, punyaIzin, bolehHr } from "@/hooks/use-sesi";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { TabRoster } from "@/components/shift/tab-roster";
import { TabPenugasan } from "@/components/shift/tab-penugasan";
import { TabJenisShift } from "@/components/shift/tab-jenis-shift";
import { DialogTetapkanShift } from "@/components/shift/dialog-tetapkan-shift";
import { bulanISO, seninDari, tanggalISO } from "@/components/shift/util-shift";
import type { Departemen, Halaman, KaryawanDirektori, RekapLibur } from "@/lib/types";

type Tab = "roster" | "penugasan" | "jenis";

const TAB: { kunci: Tab; label: string }[] = [
  { kunci: "roster", label: "Roster" },
  { kunci: "penugasan", label: "Penugasan" },
  { kunci: "jenis", label: "Jenis Shift" },
];

export default function HalamanShift() {
  const { data: saya } = useSesi();
  const hr = bolehHr(saya?.role);
  const bolehBuat = punyaIzin(saya, "shift.buat");

  const [tab, setTab] = React.useState<Tab>("roster");
  const [senin, setSenin] = React.useState(() => seninDari(new Date()));
  // Manajer terkunci ke departemennya sendiri; HR memilih departemen mana pun.
  // Pilihan ini dipakai bersama oleh tab Roster dan Penugasan.
  const [deptDipilih, setDeptDipilih] = React.useState("");
  const dept = hr ? deptDipilih : (saya?.departmentId ?? "");
  const perluDept = !hr && !saya?.departmentId;
  const bolehDimuat = hr || Boolean(dept);
  const [tetapkan, setTetapkan] = React.useState<{ awal?: { employeeId: string; date: string; sudahAda?: boolean } } | null>(null);

  const departemen = useQuery({
    queryKey: ["departemen", "semua"],
    queryFn: async () => (await api.get<Halaman<Departemen>>("/departments?limit=100")).data.data,
    enabled: hr,
  });

  // Direktori terbuka untuk semua peran, jadi manajer tetap bisa menyusun
  // barisnya tanpa perlu izin melihat data karyawan selengkapnya.
  const direktori = useQuery({
    queryKey: ["direktori"],
    queryFn: async () => (await api.get<{ data: KaryawanDirektori[] }>("/employees/directory")).data.data,
  });

  // Rekap sebulan: jadwal disusun sepekan demi sepekan, jadi pembagian libur
  // dan deret hari kerja yang terlalu panjang hanya kelihatan dari bulan penuh.
  // Rekap juga satu-satunya sumber penanda jam fleksibel per karyawan di sini.
  const bulan = bulanISO(senin);
  const rekap = useQuery({
    queryKey: ["shift-rekap", dept, bulan],
    queryFn: async () => (await api.get<RekapLibur>(`/shifts/rekap?month=${bulan}${dept ? `&departmentId=${dept}` : ""}`)).data,
    enabled: bolehDimuat,
  });

  const karyawan = React.useMemo(
    () => (direktori.data ?? []).filter((k) => (dept ? k.department?.id === dept : true)),
    [direktori.data, dept]
  );
  const fleksibel = React.useMemo(
    () => new Set((rekap.data?.data ?? []).filter((r) => r.flexibleHours).map((r) => r.id)),
    [rekap.data]
  );

  // Tanggal mulai bawaan dialog: hari ini bila minggu yang dilihat sedang
  // berjalan atau sudah lewat — penugasan ke belakang jarang disengaja —
  // selain itu Senin minggu yang dilihat.
  const hariIni = tanggalISO(new Date());
  const seninISO = tanggalISO(senin);
  const tanggalBawaan = seninISO < hariIni ? hariIni : seninISO;

  const pemilihDept = hr ? (
    <Select value={deptDipilih} onChange={(e) => setDeptDipilih(e.target.value)} aria-label="Departemen">
      <option value="">Semua departemen</option>
      {(departemen.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
    </Select>
  ) : (
    <p className="text-sm text-muted">Departemen: {karyawan[0]?.department?.name ?? "—"}</p>
  );

  return (
    <>
      <PageHeader
        title="Jadwal Shift"
        description={hr ? "Susun jenis shift, tetapkan berulang, dan pantau roster per departemen" : "Susun jadwal kerja tim di departemen Anda"}
        actions={
          bolehBuat && tab !== "jenis" && (
            <Button onClick={() => setTetapkan({})} disabled={!bolehDimuat}>
              <CalendarCheck className="h-4 w-4" aria-hidden /> Tetapkan Shift
            </Button>
          )
        }
      />

      {perluDept && (
        <Alert tone="warning" title="Departemen Anda belum diatur">
          Jadwal shift disusun per departemen. Minta HR menghubungkan akun Anda ke sebuah departemen lebih dulu.
        </Alert>
      )}

      <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1" role="tablist">
        {TAB.map((t) => (
          <button
            key={t.kunci}
            role="tab"
            aria-selected={tab === t.kunci}
            onClick={() => setTab(t.kunci)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === t.kunci ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "roster" && (
        <TabRoster
          senin={senin}
          setSenin={setSenin}
          dept={dept}
          pemilihDept={pemilihDept}
          karyawan={karyawan}
          direktoriMemuat={direktori.isLoading}
          rekap={rekap}
          fleksibel={fleksibel}
          perluDept={perluDept}
          onTetapkan={(awal) => setTetapkan({ awal })}
        />
      )}
      {tab === "penugasan" && (
        <TabPenugasan dept={dept} pemilihDept={pemilihDept} karyawan={karyawan} bolehDimuat={bolehDimuat} onTetapkan={() => setTetapkan({})} />
      )}
      {tab === "jenis" && <TabJenisShift departemen={departemen.data ?? []} />}

      {tetapkan && (
        <DialogTetapkanShift
          onClose={() => setTetapkan(null)}
          awal={tetapkan.awal}
          karyawan={karyawan}
          fleksibel={fleksibel}
          tanggalBawaan={tanggalBawaan}
        />
      )}
    </>
  );
}
