"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  Briefcase,
  CalendarClock,
  Check,
  ClipboardCheck,
  Download,
  FileUp,
  KeyRound,
  LogOut,
  MonitorCheck,
  Play,
  Save,
  Send,
  UserRound,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { Input, Field, Textarea } from "@/components/ui/input";
import { InputRupiah } from "@/components/ui/input-rupiah";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, formatRupiah, formatTanggal, LABEL_TAHAP } from "@/lib/utils";
import type { LamaranSaya, LowonganPublik, ProfilPelamar } from "@/lib/types";

type Tab = "lamaran" | "lowongan" | "profil";

const LABEL_WAWANCARA: Record<string, string> = { hr: "Wawancara HR", user: "Wawancara user", final: "Wawancara akhir" };

/** Perjalanan satu lamaran, dari masuk sampai tahap terakhir. */
const Perjalanan = ({ lamaran }: { lamaran: LamaranSaya }) => {
  const titik = [
    { label: "Lamaran masuk", waktu: lamaran.applicationDate },
    ...lamaran.stageHistory.map((h) => ({ label: LABEL_TAHAP[h.toStage] ?? h.toStage, waktu: h.createdAt })),
  ];
  return (
    <ol className="mt-4 space-y-3">
      {titik.map((t, i) => {
        const terakhir = i === titik.length - 1;
        return (
          <li key={`${t.label}-${t.waktu}`} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full", terakhir ? "bg-primary text-on-primary" : "bg-surface-2 text-muted")}>
                <Check className="h-3.5 w-3.5" aria-hidden />
              </span>
              {i < titik.length - 1 && <span className="mt-1 w-px flex-1 bg-border" aria-hidden />}
            </div>
            <div className="pb-1">
              <p className={cn("text-sm", terakhir ? "font-medium" : "text-muted")}>{t.label}</p>
              <p className="text-xs text-muted">{formatTanggal(t.waktu, "d MMM yyyy HH:mm")}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
};

const KartuLamaran = ({ lamaran }: { lamaran: LamaranSaya }) => (
  <Card className="animate-fade-up p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="font-semibold">{lamaran.appliedPosition.title}</h3>
        <p className="text-sm text-muted">
          {[lamaran.appliedPosition.location, lamaran.expectedSalary ? `Ekspektasi ${formatRupiah(lamaran.expectedSalary)}` : null]
            .filter(Boolean)
            .join(" · ") || "Dilamar lewat portal"}
        </p>
      </div>
      <Badge tone={nadaStatus(lamaran.status)} dot>{LABEL_TAHAP[lamaran.status] ?? lamaran.status}</Badge>
    </div>

    <Perjalanan lamaran={lamaran} />

    {lamaran.interviews.length > 0 && (
      <div className="mt-4 rounded-xl border border-border p-3">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <CalendarClock className="h-4 w-4" aria-hidden /> Jadwal wawancara
        </p>
        <ul className="mt-2 space-y-1.5 text-sm text-muted">
          {lamaran.interviews.map((w) => (
            <li key={w.id}>
              {formatTanggal(w.scheduledDateTime, "EEEE, d MMM yyyy HH:mm")} · {LABEL_WAWANCARA[w.stage] ?? w.stage} (putaran {w.round})
              {w.location ? ` · ${w.location}` : ""}
            </li>
          ))}
        </ul>
      </div>
    )}

    {lamaran.cbtAssignments.length > 0 && (
      <div className="mt-3 space-y-2">
        {lamaran.cbtAssignments.map((t) => {
          const bisa = t.status === "assigned" || t.status === "in_progress";
          return (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <MonitorCheck className="h-4 w-4" aria-hidden /> {t.test.title}
                </p>
                <p className="text-xs text-muted">
                  {t.test.durationMinutes} menit · {t.test._count.questions} soal
                  {t.availableUntil ? ` · sampai ${formatTanggal(t.availableUntil, "d MMM yyyy HH:mm")}` : ""}
                </p>
              </div>
              {bisa ? (
                <Link href={`/karier/tes/${t.id}`}>
                  <Button size="sm">
                    <Play className="h-4 w-4" aria-hidden /> {t.status === "in_progress" ? "Lanjutkan" : "Kerjakan"}
                  </Button>
                </Link>
              ) : (
                <span className="text-xs text-muted">{t.status === "submitted" ? "Menunggu penilaian" : t.status === "graded" ? "Selesai" : "Kedaluwarsa"}</span>
              )}
            </div>
          );
        })}
      </div>
    )}
  </Card>
);

/**
 * Dashboard calon karyawan.
 *
 * Isinya dibungkus Suspense karena membaca parameter URL (?lamar=…); tanpa
 * batas itu, Next menolak merender halaman ini saat build.
 */
export default function DashboardPelamar() {
  return (
    <React.Suspense fallback={<div className="mx-auto max-w-5xl p-4"><Skeleton className="h-96" /></div>}>
      <IsiDashboard />
    </React.Suspense>
  );
}

function IsiDashboard() {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const params2 = params.get("lamar");
  // Tab awal mengikuti asal kedatangan: dari sebuah lowongan berarti orangnya
  // datang untuk melamar, bukan untuk melihat riwayat.
  const [tab, setTab] = React.useState<Tab>(params2 ? "lowongan" : "lamaran");
  /** null = ikuti parameter URL; string = pilihan pengguna; "" = sudah ditutup. */
  const [pilihanLamar, setPilihanLamar] = React.useState<string | null>(null);

  const profil = useQuery({
    queryKey: ["pelamar", "saya"],
    queryFn: async () => (await api.get<ProfilPelamar>("/karier/saya")).data,
    retry: false,
  });
  const lowongan = useQuery({
    queryKey: ["pelamar", "lowongan"],
    queryFn: async () => (await api.get<{ data: LowonganPublik[] }>("/karier/lowongan")).data.data,
  });

  // Datang dari halaman lowongan dengan ?lamar=<id>: formulirnya terbuka
  // sendiri, tanpa effect yang menyalin data ke state.
  const idLamar = pilihanLamar ?? params.get("lamar") ?? "";
  const lamarUntuk = (lowongan.data ?? []).find((l) => l.id === idLamar) ?? null;
  const setLamarUntuk = (l: LowonganPublik | null) => setPilihanLamar(l?.id ?? "");

  const keluar = async () => {
    await fetch("/api/backend/karier-keluar", { method: "DELETE" });
    qc.clear();
    router.replace("/");
  };

  if (profil.isLoading) return <div className="mx-auto max-w-5xl p-4"><Skeleton className="h-96" /></div>;
  if (profil.isError || !profil.data) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Alert tone="danger" title="Sesi berakhir">Silakan masuk lagi untuk melihat lamaran Anda.</Alert>
        <Link href="/karier/masuk"><Button className="mt-4 w-full">Masuk</Button></Link>
      </div>
    );
  }

  const p = profil.data;
  const dalamProses = p.applications.filter((l) => !["hired", "rejected", "withdrawn"].includes(l.status)).length;
  const tesMenunggu = p.applications.flatMap((l) => l.cbtAssignments).filter((t) => t.status === "assigned" || t.status === "in_progress").length;
  const sudahDilamar = new Set(p.applications.map((l) => l.appliedPosition.id));

  const TABS: { id: Tab; label: string }[] = [
    { id: "lamaran", label: `Lamaran saya (${p.applications.length})` },
    { id: "lowongan", label: "Lowongan terbuka" },
    { id: "profil", label: "Profil & CV" },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Halo, {p.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-muted">{p.email}</p>
        </div>
        <Button variant="outline" onClick={keluar}>
          <LogOut className="h-4 w-4" aria-hidden /> Keluar
        </Button>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { k: "Lamaran", v: p.applications.length, ikon: Briefcase },
          { k: "Dalam proses", v: dalamProses, ikon: ClipboardCheck },
          { k: "Tes menunggu", v: tesMenunggu, ikon: MonitorCheck },
          { k: "Lowongan terbuka", v: lowongan.data?.length ?? 0, ikon: Send },
        ].map((s) => (
          <Card key={s.k} className="flex items-center gap-3 p-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
              <s.ikon className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <dd className="text-xl font-bold tabular-nums">{s.v}</dd>
              <dt className="text-xs text-muted">{s.k}</dt>
            </div>
          </Card>
        ))}
      </dl>

      <div className="mt-8 flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              tab === t.id ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-4">
        {tab === "lamaran" &&
          (p.applications.length === 0 ? (
            <Card>
              <EmptyState
                icon={Briefcase}
                title="Belum ada lamaran"
                description="Telusuri lowongan yang sedang dibuka, lalu lamar langsung dari sini."
                action={<Button onClick={() => setTab("lowongan")}><Send className="h-4 w-4" aria-hidden /> Lihat lowongan</Button>}
              />
            </Card>
          ) : (
            p.applications.map((l) => <KartuLamaran key={l.id} lamaran={l} />)
          ))}

        {tab === "lowongan" && (
          <div className="grid gap-3 sm:grid-cols-2">
            {(lowongan.data ?? []).map((l) => (
              <Card key={l.id} className="flex flex-col p-5">
                <h3 className="font-semibold">{l.title}</h3>
                <p className="mt-1 text-sm text-muted">
                  {[l.position.department?.name, l.location].filter(Boolean).join(" · ")}
                </p>
                {(l.salaryRangeMin || l.salaryRangeMax) && (
                  <p className="mt-1 text-sm tabular-nums text-muted">
                    {formatRupiah(l.salaryRangeMin)} – {formatRupiah(l.salaryRangeMax)}
                  </p>
                )}
                <div className="mt-auto flex flex-wrap gap-2 pt-4">
                  <Link href={`/lowongan/${l.id}`}><Button size="sm" variant="outline">Rincian</Button></Link>
                  {sudahDilamar.has(l.id) ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-success"><Check className="h-4 w-4" aria-hidden /> Sudah dilamar</span>
                  ) : (
                    <Button size="sm" onClick={() => setLamarUntuk(l)}><Send className="h-4 w-4" aria-hidden /> Lamar</Button>
                  )}
                </div>
              </Card>
            ))}
            {(lowongan.data?.length ?? 0) === 0 && (
              <Card className="sm:col-span-2">
                <EmptyState icon={Briefcase} title="Belum ada lowongan terbuka" description="Kami akan menayangkan lowongan baru di halaman ini." />
              </Card>
            )}
          </div>
        )}

        {tab === "profil" && <PanelProfil profil={p} />}
      </div>

      {/* Dipasang hanya saat dibuka: satu kali pakai, isinya selalu mulai
          dari nol tanpa effect pereset. */}
      {lamarUntuk && <DialogLamar key={lamarUntuk.id} lowongan={lamarUntuk} punyaCv={p.punyaCv} onClose={() => setLamarUntuk(null)} />}
    </div>
  );
}

/** Formulir lamaran: ekspektasi gaji, surat lamaran, dan CV. */
const DialogLamar = ({ lowongan, punyaCv, onClose }: { lowongan: LowonganPublik; punyaCv: boolean; onClose: () => void }) => {
  const qc = useQueryClient();
  const [gaji, setGaji] = React.useState("");
  const [surat, setSurat] = React.useState("");
  const [berkas, setBerkas] = React.useState<File | null>(null);

  const kirim = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { jobPostingId: lowongan.id, situs: "" };
      if (gaji) body.expectedSalary = Number(gaji);
      if (surat.trim()) body.coverLetter = surat.trim();
      if (berkas) {
        body.cv = await bacaSebagaiDataUri(berkas);
        body.cvFileName = berkas.name;
      }
      return (await api.post("/karier/lamar", body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pelamar"] });
      notifikasi.sukses("Lamaran terkirim", "Statusnya bisa Anda pantau di tab Lamaran saya.");
      onClose();
    },
    onError: (e) => notifikasi.galat(e, "Lamaran gagal dikirim"),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Lamar: ${lowongan.title}`}
      description="Lengkapi seperlunya. CV yang pernah Anda unggah dipakai otomatis."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={kirim.isPending}><X className="h-4 w-4" aria-hidden /> Batal</Button>
          <Button onClick={() => kirim.mutate()} loading={kirim.isPending}>
            {!kirim.isPending && <Send className="h-4 w-4" aria-hidden />} Kirim lamaran
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Ekspektasi gaji (opsional)">
          <InputRupiah value={gaji} onChange={setGaji} />
        </Field>
        <Field label="Surat lamaran singkat (opsional)" hint="Ceritakan pengalaman yang paling relevan, 3–5 kalimat cukup.">
          <Textarea rows={5} value={surat} onChange={(e) => setSurat(e.target.value)} maxLength={5000} />
        </Field>
        <Field label={punyaCv ? "Ganti CV (opsional)" : "Unggah CV"} hint="PDF atau DOCX, maksimal 5 MB.">
          <input
            type="file"
            accept=".pdf,.docx,application/pdf"
            onChange={(e) => setBerkas(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary-soft file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary"
          />
        </Field>
        {punyaCv && !berkas && (
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <Check className="h-4 w-4 text-success" aria-hidden /> CV yang tersimpan akan dilampirkan.
          </p>
        )}
      </div>
    </Modal>
  );
};

const bacaSebagaiDataUri = (berkas: File) =>
  new Promise<string>((selesai, gagal) => {
    const pembaca = new FileReader();
    pembaca.onload = () => selesai(String(pembaca.result));
    pembaca.onerror = () => gagal(new Error("Berkas tidak bisa dibaca"));
    pembaca.readAsDataURL(berkas);
  });

/** Profil, CV, dan kata sandi. */
const PanelProfil = ({ profil }: { profil: ProfilPelamar }) => {
  const qc = useQueryClient();
  const fp = useForm<{ name: string; phoneNumber: string }>({
    defaultValues: { name: profil.name, phoneNumber: profil.phoneNumber ?? "" },
  });
  const fs = useForm<{ passwordLama: string; passwordBaru: string }>({ defaultValues: { passwordLama: "", passwordBaru: "" } });

  const simpanProfil = useMutation({
    mutationFn: async (v: { name: string; phoneNumber: string }) =>
      (await api.put("/karier/saya", { name: v.name, phoneNumber: v.phoneNumber || null })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pelamar"] });
      notifikasi.sukses("Profil diperbarui");
    },
    onError: (e) => notifikasi.galat(e, "Gagal menyimpan profil"),
  });

  const gantiSandi = useMutation({
    mutationFn: async (v: { passwordLama: string; passwordBaru: string }) => (await api.put("/karier/saya/sandi", v)).data,
    onSuccess: () => {
      fs.reset({ passwordLama: "", passwordBaru: "" });
      notifikasi.sukses("Kata sandi diperbarui");
    },
    onError: (e) => notifikasi.galat(e, "Gagal mengganti kata sandi"),
  });

  const unggahCv = useMutation({
    mutationFn: async (berkas: File) =>
      (await api.post("/karier/saya/cv", { cv: await bacaSebagaiDataUri(berkas), cvFileName: berkas.name })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pelamar"] });
      notifikasi.sukses("CV tersimpan", "Dipakai otomatis untuk lamaran berikutnya.");
    },
    onError: (e) => notifikasi.galat(e, "CV gagal diunggah"),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-semibold"><UserRound className="h-4 w-4" aria-hidden /> Data diri</h2>
        <form onSubmit={fp.handleSubmit((v) => simpanProfil.mutate(v))} className="mt-4 space-y-4" noValidate>
          <Field label="Nama lengkap" error={fp.formState.errors.name?.message}>
            <Input {...fp.register("name", { required: "Wajib diisi" })} />
          </Field>
          <Field label="No. HP / WhatsApp">
            <Input inputMode="tel" {...fp.register("phoneNumber")} />
          </Field>
          <Field label="Email" hint="Email tidak bisa diubah; ini identitas akun Anda.">
            <Input value={profil.email} disabled />
          </Field>
          <Button type="submit" loading={simpanProfil.isPending}>
            {!simpanProfil.isPending && <Save className="h-4 w-4" aria-hidden />} Simpan
          </Button>
        </form>
      </Card>

      <div className="space-y-4">
        <Card className="p-5">
          <h2 className="flex items-center gap-2 font-semibold"><FileUp className="h-4 w-4" aria-hidden /> CV</h2>
          {profil.punyaCv ? (
            <p className="mt-2 text-sm text-muted">
              Tersimpan: <span className="font-medium text-foreground">{profil.cvFileName}</span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted">Belum ada CV tersimpan.</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".pdf,.docx,application/pdf"
              aria-label="Pilih berkas CV"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) unggahCv.mutate(f);
              }}
              className="block text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary-soft file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary"
            />
            {profil.punyaCv && (
              <a
                href="/api/backend/karier/saya/cv"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-surface-2"
              >
                <Download className="h-4 w-4" aria-hidden /> Lihat CV
              </a>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4" aria-hidden /> Kata sandi</h2>
          <form onSubmit={fs.handleSubmit((v) => gantiSandi.mutate(v))} className="mt-4 space-y-4" noValidate>
            <Field label="Kata sandi saat ini" error={fs.formState.errors.passwordLama?.message}>
              <Input type="password" autoComplete="current-password" {...fs.register("passwordLama", { required: "Wajib diisi" })} />
            </Field>
            <Field label="Kata sandi baru" hint="Minimal 8 karakter" error={fs.formState.errors.passwordBaru?.message}>
              <Input type="password" autoComplete="new-password" {...fs.register("passwordBaru", { required: "Wajib diisi", minLength: { value: 8, message: "Minimal 8 karakter" } })} />
            </Field>
            <Button type="submit" loading={gantiSandi.isPending}>
              {!gantiSandi.isPending && <KeyRound className="h-4 w-4" aria-hidden />} Ganti kata sandi
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
};
