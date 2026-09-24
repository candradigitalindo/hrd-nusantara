"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut, Unplug } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { PageHeader } from "@/components/ui/page-header";
import { ConfirmDialog } from "@/components/ui/modal";
import { PanelPercakapan } from "@/components/whatsapp/percakapan";
import { PanelNomor, type SaringanNomor } from "@/components/whatsapp/daftar-nomor";
import { DialogDaftarNomor, DialogQr, DialogTarikRiwayat } from "@/components/whatsapp/dialog-nomor";
import { cn, formatRelatif, formatTanggal } from "@/lib/utils";
import type { Halaman, AkunWhatsApp, SesiWhatsApp, KepatuhanWa, Departemen, RingkasanWa } from "@/lib/types";

const SEHARI_MS = 24 * 60 * 60 * 1000;

/** "sekitar 2 jam yang lalu" → "2 jam lalu": muat di satu sel ringkasan, juga di ponsel. */
const relatifRingkas = (nilai: string) => formatRelatif(nilai).replace(/^(sekitar|kurang dari) /, "").replace(" yang lalu", " lalu");

/** Satu angka di kepala halaman. Bisa ditekan bila angka itu menunjuk ke tindakan. */
const Angka = ({
  label,
  nilai,
  keterangan,
  nada,
  onClick,
}: {
  label: string;
  nilai: React.ReactNode;
  keterangan?: React.ReactNode;
  nada?: "peringatan" | "bahaya";
  onClick?: () => void;
}) => {
  const isi = (
    <>
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("mt-0.5 text-xl font-semibold tabular-nums", nada === "peringatan" && "text-warning", nada === "bahaya" && "text-danger")}>{nilai}</p>
      {keterangan && <p className="mt-0.5 truncate text-xs text-muted">{keterangan}</p>}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="min-w-0 bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      {isi}
    </button>
  ) : (
    <div className="min-w-0 bg-surface px-4 py-3">{isi}</div>
  );
};

export default function HalamanWhatsApp() {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const bolehBuat = punyaIzin(saya, "whatsapp.buat");
  const bolehUbah = punyaIzin(saya, "whatsapp.ubah");
  // Pesan grup, berkas media, dan penarikan riwayat hanya untuk Super Admin;
  // server menyaringnya juga, ini semata supaya tombolnya tidak muncul sia-sia.
  const seluruhIsi = saya?.role === "SUPER_ADMIN";

  const [tab, setTab] = React.useState<"percakapan" | "nomor">("percakapan");
  const [saringan, setSaringan] = React.useState<SaringanNomor>("semua");
  const [accountId, setAccountId] = React.useState("");
  const [formBuka, setFormBuka] = React.useState(false);
  const [qrUntuk, setQrUntuk] = React.useState<AkunWhatsApp | null>(null);
  const [tarikUntuk, setTarikUntuk] = React.useState<AkunWhatsApp | null>(null);
  const [putus, setPutus] = React.useState<{ akun: AkunWhatsApp; logout: boolean } | null>(null);

  const akun = useQuery({
    queryKey: ["wa", "akun"],
    queryFn: async () => (await api.get<Halaman<AkunWhatsApp>>("/whatsapp/accounts?limit=100")).data.data,
    refetchInterval: 15_000,
  });
  const kepatuhan = useQuery({
    queryKey: ["wa", "kepatuhan"],
    queryFn: async () => (await api.get<KepatuhanWa>("/whatsapp/compliance")).data,
    refetchInterval: 30_000,
  });
  const ringkasan = useQuery({
    queryKey: ["wa", "ringkasan"],
    queryFn: async () => (await api.get<RingkasanWa>("/whatsapp/ringkasan")).data,
    refetchInterval: 15_000,
  });
  const departemen = useQuery({
    queryKey: ["departemen", "semua"],
    queryFn: async () => (await api.get<Halaman<Departemen>>("/departments?limit=100")).data.data,
    enabled: tab === "nomor",
  });

  const ingatkan = useMutation({
    mutationFn: async (employeeIds?: string[]) =>
      (await api.post<{ diminta: number; terkirim: number }>("/whatsapp/compliance/remind", employeeIds ? { employeeIds } : {})).data,
    onSuccess: (r) =>
      notifikasi.sukses(
        `Pengingat dikirim ke ${r.terkirim} dari ${r.diminta} karyawan`,
        r.terkirim < r.diminta ? "Sisanya belum memasang aplikasi mobile atau belum mengizinkan notifikasi." : "Semua menerima push di ponselnya."
      ),
    onError: (e) => notifikasi.galat(e, "Pengingat gagal dikirim"),
  });

  const sambungkan = useMutation({
    mutationFn: async (a: AkunWhatsApp) => (await api.post<SesiWhatsApp>(`/whatsapp/accounts/${a.id}/connect`, {})).data,
    onSuccess: (_, a) => setQrUntuk(a),
    onError: (e) => notifikasi.galat(e, "Tidak bisa membuka sesi"),
  });

  const putuskan = useMutation({
    mutationFn: async ({ akun, logout }: { akun: AkunWhatsApp; logout: boolean }) => api.post(`/whatsapp/accounts/${akun.id}/disconnect`, { logout }),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["wa"] });
      notifikasi.sukses(v.logout ? "Sesi di-logout" : "Sesi diputus", v.logout ? "Pemegang nomor harus scan QR ulang." : "Bisa disambungkan lagi tanpa scan.");
      setPutus(null);
    },
    onError: (e) => notifikasi.galat(e),
  });

  // --- Angka kepala halaman ---
  const perusahaan = (akun.data ?? []).filter((a) => a.kind === "company");
  const nomorTotal = (kepatuhan.data?.summary.total ?? 0) + perusahaan.length;
  const nomorTersambung = (kepatuhan.data?.summary.connected ?? 0) + perusahaan.filter((a) => a.sessionStatus === "connected").length;
  const perlu = nomorTotal - nomorTersambung;
  const r = ringkasan.data;
  // Nomor tercatat tersambung tapi tidak menerima apa pun sehari penuh hampir
  // pasti sudah tidak benar-benar terpantau — itu yang paling perlu terlihat.
  // Diukur terhadap waktu ringkasan diambil, bukan jam render, supaya hasil
  // render tetap sama untuk data yang sama.
  const sepi =
    Boolean(r?.pesanTerakhir) && nomorTersambung > 0 && ringkasan.dataUpdatedAt - new Date(r!.pesanTerakhir!).getTime() > SEHARI_MS;

  const bukaNomor = (s: SaringanNomor) => {
    setSaringan(s);
    setTab("nomor");
  };

  return (
    <>
      <PageHeader
        title="Pemantauan WhatsApp"
        description="Percakapan nomor karyawan dan nomor perusahaan, tersimpan terenkripsi. Membaca di sini tidak menandai pesan terbaca di ponsel."
      />

      {/* gap-px di atas latar garis: pembatas antarsel rapi di 2 maupun 4 kolom. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-4">
        <Angka
          label="Nomor tersambung"
          nilai={kepatuhan.isLoading ? "—" : `${nomorTersambung}/${nomorTotal}`}
          keterangan={nomorTotal ? `${Math.round((nomorTersambung / nomorTotal) * 100)}% terpantau` : "Belum ada nomor"}
          onClick={() => bukaNomor("tersambung")}
        />
        <Angka
          label="Perlu tindakan"
          nilai={kepatuhan.isLoading ? "—" : perlu}
          nada={perlu > 0 ? "peringatan" : undefined}
          keterangan={perlu > 0 ? "Lihat daftarnya" : "Semua nomor tersambung"}
          onClick={() => bukaNomor("perlu")}
        />
        <Angka
          label="Pesan hari ini"
          nilai={r ? r.pesanHariIni.toLocaleString("id-ID") : "—"}
          keterangan={r ? `${r.pesanTujuhHari.toLocaleString("id-ID")} dalam 7 hari · ${r.totalPesan.toLocaleString("id-ID")} total` : undefined}
        />
        <Angka
          label="Pesan terakhir"
          nilai={r?.pesanTerakhir ? relatifRingkas(r.pesanTerakhir) : "Belum ada"}
          nada={sepi ? "bahaya" : undefined}
          keterangan={sepi ? "Sepi >24 jam — periksa sambungan" : r?.pesanTerakhir ? formatTanggal(r.pesanTerakhir, "EEEE, d MMM HH:mm") : undefined}
        />
      </div>

      <div className="flex w-fit gap-1 rounded-xl bg-surface-2 p-1" role="tablist">
        {([
          ["percakapan", "Percakapan"],
          ["nomor", "Nomor"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn("inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors", tab === id ? "bg-surface shadow-sm" : "text-muted hover:text-foreground")}
          >
            {label}
            {id === "nomor" && perlu > 0 && <span className="rounded-full bg-warning-soft px-1.5 text-xs tabular-nums text-warning">{perlu}</span>}
          </button>
        ))}
      </div>

      {tab === "percakapan" ? (
        <PanelPercakapan
          akun={akun.data ?? []}
          accountId={accountId}
          onAccountId={setAccountId}
          seluruhIsi={seluruhIsi}
          nomorTersambung={nomorTersambung}
          nomorTotal={nomorTotal}
          onLihatNomor={() => bukaNomor("perlu")}
        />
      ) : (
        <PanelNomor
          kepatuhan={kepatuhan.data?.data ?? []}
          akun={akun.data ?? []}
          departemen={departemen.data ?? []}
          memuat={kepatuhan.isLoading || akun.isLoading}
          saringan={saringan}
          onSaringan={setSaringan}
          bolehBuat={bolehBuat}
          bolehUbah={bolehUbah}
          seluruhIsi={seluruhIsi}
          ingatkanUntuk={ingatkan.isPending ? (ingatkan.variables && ingatkan.variables.length === 1 ? ingatkan.variables[0] : "semua") : null}
          sambungkanUntuk={sambungkan.isPending ? (sambungkan.variables?.id ?? null) : null}
          onIngatkan={(ids) => ingatkan.mutate(ids)}
          onSambungkan={(a) => sambungkan.mutate(a)}
          onPutus={(a, logout) => setPutus({ akun: a, logout })}
          onTarik={setTarikUntuk}
          onLihatPercakapan={(id) => {
            setAccountId(id);
            setTab("percakapan");
          }}
          onDaftarkan={() => setFormBuka(true)}
        />
      )}

      <DialogDaftarNomor open={formBuka} onClose={() => setFormBuka(false)} />
      <DialogQr akun={qrUntuk} onClose={() => setQrUntuk(null)} />
      {/* key: tiap nomor membuka dialog dengan isian bersih. */}
      <DialogTarikRiwayat key={tarikUntuk?.id ?? "kosong"} akun={tarikUntuk} onClose={() => setTarikUntuk(null)} />

      <ConfirmDialog
        open={Boolean(putus)}
        onClose={() => setPutus(null)}
        onConfirm={() => putus && putuskan.mutate(putus)}
        loading={putuskan.isPending}
        danger={putus?.logout}
        title={putus?.logout ? "Logout sesi WhatsApp?" : "Putus sesi sementara?"}
        description={
          putus?.logout
            ? `${putus.akun.label}: pairing dihapus di sisi WhatsApp. Pemegang nomor harus memindai QR lagi untuk menyambungkan.`
            : `${putus?.akun.label ?? ""}: sesi ditutup tanpa menghapus pairing, bisa disambungkan lagi tanpa scan ulang.`
        }
        confirmLabel={putus?.logout ? "Logout" : "Putus"}
        confirmIcon={putus?.logout ? LogOut : Unplug}
      />
    </>
  );
}
