"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { MessageCircle, Plus, QrCode, Unplug, Search, Smartphone, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Field, Select } from "@/components/ui/input";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { SkeletonBaris, Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { formatTanggal, formatRelatif, labelStatus } from "@/lib/utils";
import type { Halaman, AkunWhatsApp, SesiWhatsApp, Percakapan, Karyawan } from "@/lib/types";

type FormAkun = { phoneNumber: string; label: string; assignedEmployeeId: string };

export default function HalamanWhatsApp() {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<"nomor" | "arsip">("nomor");
  const [formBuka, setFormBuka] = React.useState(false);
  const [qrUntuk, setQrUntuk] = React.useState<AkunWhatsApp | null>(null);
  const [putus, setPutus] = React.useState<{ akun: AkunWhatsApp; logout: boolean } | null>(null);
  const [cari, setCari] = React.useState("");
  const [cariTunda, setCariTunda] = React.useState("");
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    const t = setTimeout(() => { setCariTunda(cari.trim()); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [cari]);

  const akun = useQuery({
    queryKey: ["wa", "akun"],
    queryFn: async () => (await api.get<Halaman<AkunWhatsApp>>("/whatsapp/accounts?limit=100")).data.data,
    refetchInterval: 15_000,
  });

  const karyawan = useQuery({
    queryKey: ["karyawan", "pilihan"],
    queryFn: async () => (await api.get<Halaman<Karyawan>>("/employees?limit=100")).data.data,
    enabled: formBuka,
  });

  const paramsArsip = new URLSearchParams({ page: String(page), limit: "20" });
  if (cariTunda.length >= 2) paramsArsip.set("search", cariTunda);
  const arsip = useQuery({
    queryKey: ["wa", "arsip", paramsArsip.toString()],
    queryFn: async () => (await api.get<Halaman<Percakapan>>(`/whatsapp/conversations?${paramsArsip}`)).data,
    enabled: tab === "arsip",
    placeholderData: (prev) => prev,
  });

  // QR diperbarui WhatsApp tiap ~20 detik; poll tiap 3 detik selama modal terbuka.
  const sesi = useQuery({
    queryKey: ["wa", "sesi", qrUntuk?.id],
    queryFn: async () => (await api.get<SesiWhatsApp>(`/whatsapp/accounts/${qrUntuk!.id}/session`)).data,
    enabled: Boolean(qrUntuk),
    refetchInterval: (q) => (q.state.data?.status === "connected" ? false : 3000),
  });

  const tersambung = Boolean(qrUntuk) && sesi.data?.status === "connected";

  // Efek ini hanya memberi tahu dan menyegarkan daftar — tidak menyetel state.
  // Penutupan modal diserahkan ke pengguna lewat tombol "Selesai".
  React.useEffect(() => {
    if (!tersambung) return;
    notifikasi.sukses("Nomor tersambung", "Pesan mulai terarsip untuk nomor ini.");
    qc.invalidateQueries({ queryKey: ["wa", "akun"] });
  }, [tersambung, qc]);

  const fa = useForm<FormAkun>({ defaultValues: { phoneNumber: "", label: "", assignedEmployeeId: "" } });

  const daftarkan = useMutation({
    mutationFn: async (v: FormAkun) =>
      (await api.post<AkunWhatsApp>("/whatsapp/accounts", { phoneNumber: v.phoneNumber, label: v.label, ...(v.assignedEmployeeId ? { assignedEmployeeId: v.assignedEmployeeId } : {}) })).data,
    onSuccess: (a) => { qc.invalidateQueries({ queryKey: ["wa", "akun"] }); notifikasi.sukses("Nomor didaftarkan", `${a.label} · ${a.phoneNumber}`); setFormBuka(false); fa.reset(); },
    onError: (e) => notifikasi.galat(e, "Gagal mendaftarkan nomor"),
  });

  const sambungkan = useMutation({
    mutationFn: async (a: AkunWhatsApp) => (await api.post<SesiWhatsApp>(`/whatsapp/accounts/${a.id}/connect`, {})).data,
    onSuccess: (_, a) => setQrUntuk(a),
    onError: (e) => notifikasi.galat(e, "Tidak bisa membuka sesi"),
  });

  const putuskan = useMutation({
    mutationFn: async ({ akun, logout }: { akun: AkunWhatsApp; logout: boolean }) => api.post(`/whatsapp/accounts/${akun.id}/disconnect`, { logout }),
    onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ["wa", "akun"] }); notifikasi.sukses(v.logout ? "Sesi di-logout" : "Sesi diputus", v.logout ? "Pemegang nomor harus scan QR ulang." : "Bisa disambungkan lagi tanpa scan."); setPutus(null); },
    onError: (e) => notifikasi.galat(e),
  });

  return (
    <>
      <PageHeader
        title="Pemantauan WhatsApp"
        description="Hanya nomor WhatsApp perusahaan yang dipantau — bukan nomor pribadi karyawan"
        actions={tab === "nomor" && <Button onClick={() => setFormBuka(true)}><Plus className="h-4 w-4" aria-hidden /> Daftarkan Nomor</Button>}
      />

      <div className="flex gap-1 rounded-xl bg-surface-2 p-1 w-fit" role="tablist">
        {(["nomor", "arsip"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === t ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"}`}>
            {t === "nomor" ? "Nomor Perusahaan" : "Arsip Percakapan"}
          </button>
        ))}
      </div>

      {tab === "nomor" ? (
        akun.isLoading ? <SkeletonBaris /> : !akun.data?.length ? (
          <Card><EmptyState icon={Smartphone} title="Belum ada nomor terdaftar" description="Daftarkan nomor CS outlet atau reservasi hotel, lalu sambungkan dengan memindai QR." action={<Button onClick={() => setFormBuka(true)}>Daftarkan Nomor</Button>} /></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {akun.data.map((a) => (
              <Card key={a.id} className="animate-fade-up">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{a.label}</CardTitle>
                      <CardDescription className="tabular-nums">+{a.phoneNumber}</CardDescription>
                    </div>
                    <Badge tone={nadaStatus(a.sessionStatus)} dot>{labelStatus(a.sessionStatus)}</Badge>
                  </div>
                  <p className="text-xs text-muted">
                    {a.assignedEmployee ? `Dipegang ${a.assignedEmployee.name}` : "Belum ada pemegang"}
                    {a.lastConnectedAt ? ` · tersambung ${formatRelatif(a.lastConnectedAt)}` : ""}
                  </p>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {a.sessionStatus !== "connected" ? (
                    <Button size="sm" onClick={() => sambungkan.mutate(a)} loading={sambungkan.isPending && sambungkan.variables?.id === a.id}>
                      <QrCode className="h-4 w-4" aria-hidden /> Sambungkan
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setPutus({ akun: a, logout: false })}><Unplug className="h-4 w-4" aria-hidden /> Putus</Button>
                      <Button size="sm" variant="ghost" className="text-danger" onClick={() => setPutus({ akun: a, logout: true })}>Logout</Button>
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : (
        <Card>
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input className="pl-9" placeholder="Cari kata dalam percakapan, mis. keluhan" value={cari} onChange={(e) => setCari(e.target.value)} aria-label="Cari percakapan" />
            </div>
            <p className="mt-2 text-xs text-muted">Pencarian per kata utuh — isi pesan tersimpan terenkripsi, jadi &quot;keluhan&quot; ditemukan, &quot;keluh&quot; tidak.</p>
          </div>
          {arsip.isLoading ? <SkeletonBaris /> : !arsip.data?.data.length ? (
            <EmptyState icon={MessageCircle} title={cariTunda ? "Tidak ada yang cocok" : "Arsip masih kosong"} description={cariTunda ? "Coba kata lain, dalam bentuk kata utuh." : "Pesan akan muncul begitu ada nomor yang tersambung."} />
          ) : (
            <>
              <ul className="divide-y divide-border">
                {arsip.data.data.map((p) => (
                  <li key={p.id} className="flex gap-3 p-4 animate-fade-up">
                    <span className={`mt-0.5 shrink-0 rounded-lg p-1.5 ${p.direction === "incoming" ? "bg-info-soft text-info" : "bg-success-soft text-success"}`}>
                      {p.direction === "incoming" ? <ArrowDownLeft className="h-4 w-4" aria-hidden /> : <ArrowUpRight className="h-4 w-4" aria-hidden />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <p className="text-sm font-medium truncate">{p.direction === "incoming" ? `+${p.contactNumber} → ${p.account.label}` : `${p.account.label} → +${p.contactNumber}`}</p>
                        <time className="text-xs text-muted tabular-nums">{formatTanggal(p.timestamp, "d MMM HH:mm")}</time>
                      </div>
                      <p className="mt-1 text-sm whitespace-pre-wrap break-words">{p.messageBody || <span className="italic text-muted">[{p.messageType}]</span>}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <Pagination pagination={arsip.data.pagination} onPage={setPage} />
            </>
          )}
        </Card>
      )}

      <Modal open={formBuka} onClose={() => setFormBuka(false)} title="Daftarkan Nomor Perusahaan" description="Nomor ini akan dipantau. Pastikan ini nomor milik perusahaan, bukan pribadi."
        footer={<><Button variant="outline" onClick={() => setFormBuka(false)}>Batal</Button><Button form="form-akun" type="submit" loading={daftarkan.isPending}>Daftarkan</Button></>}>
        <form id="form-akun" onSubmit={fa.handleSubmit((v) => daftarkan.mutate(v))} className="space-y-4" noValidate>
          <Field label="Nomor WhatsApp" error={fa.formState.errors.phoneNumber?.message} hint="Format 08xx atau +62xx">
            <Input inputMode="tel" placeholder="0811 1111 111" {...fa.register("phoneNumber", { required: "Nomor wajib diisi", minLength: { value: 8, message: "Nomor terlalu pendek" } })} />
          </Field>
          <Field label="Label" error={fa.formState.errors.label?.message}>
            <Input placeholder="CS Outlet Kemang" {...fa.register("label", { required: "Label wajib diisi" })} />
          </Field>
          <Field label="Pemegang nomor" hint="Karyawan yang akan diberi tahu bila sesi terputus">
            <Select {...fa.register("assignedEmployeeId")}>
              <option value="">— Belum ditentukan —</option>
              {(karyawan.data ?? []).map((k) => <option key={k.id} value={k.id}>{k.name} · {k.nik}</option>)}
            </Select>
          </Field>
        </form>
      </Modal>

      <Modal open={Boolean(qrUntuk)} onClose={() => setQrUntuk(null)} title="Pindai QR dengan WhatsApp" description={qrUntuk ? `${qrUntuk.label} · +${qrUntuk.phoneNumber}` : undefined}>
        <div className="flex flex-col items-center gap-4">
          {tersambung ? (
            <Alert tone="success" title="Tersambung" className="w-full" action={<Button size="sm" onClick={() => setQrUntuk(null)}>Selesai</Button>}>
              Nomor ini kini terpantau. Pesan yang masuk akan muncul di arsip.
            </Alert>
          ) : sesi.data?.qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sesi.data.qr} alt="Kode QR untuk menautkan WhatsApp" className="h-64 w-64 rounded-xl border border-border bg-white p-2" />
          ) : (
            <Skeleton className="h-64 w-64 rounded-xl" />
          )}
          <Alert tone="info" title="Di ponsel perusahaan" className="w-full">
            Buka WhatsApp → Perangkat Tertaut → Tautkan perangkat, lalu arahkan kamera ke kode ini. QR diperbarui otomatis setiap ~20 detik.
          </Alert>
          {sesi.data?.catatan && <p className="text-xs text-muted">{sesi.data.catatan}</p>}
        </div>
      </Modal>

      <ConfirmDialog open={Boolean(putus)} onClose={() => setPutus(null)} onConfirm={() => putus && putuskan.mutate(putus)} loading={putuskan.isPending} danger={putus?.logout}
        title={putus?.logout ? "Logout sesi WhatsApp?" : "Putus sesi sementara?"}
        description={putus?.logout ? "Pairing dihapus di sisi WhatsApp. Pemegang nomor harus memindai QR lagi untuk menyambungkan." : "Sesi ditutup tanpa menghapus pairing, bisa disambungkan lagi tanpa scan ulang."}
        confirmLabel={putus?.logout ? "Logout" : "Putus"} />
    </>
  );
}
