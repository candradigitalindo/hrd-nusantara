"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { MessagesSquare, Plus, Send, ArrowLeft, UserPlus, Trash2, Lock, Users, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useSesi, bolehHr, punyaIzin } from "@/hooks/use-sesi";
import { notifikasi } from "@/hooks/use-notifikasi";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatWaktu, formatTanggal, formatRelatif, LABEL_RUANG, cn } from "@/lib/utils";
import type { Halaman, RuangChat, PesanChat, KaryawanDirektori, JenisRuang } from "@/lib/types";

type FormRuang = { name: string; description: string; type: JenisRuang; isPrivate: boolean };
type FormAnggota = { employeeId: string; role: "member" | "moderator" };

export default function HalamanChat() {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const hr = bolehHr(saya?.role);
  const bolehBuatRuang = punyaIzin(saya, "chat.buat");
  const bolehHapusPesan = punyaIzin(saya, "chat.hapus");
  const [aktif, setAktif] = React.useState<string | null>(null);
  const [teks, setTeks] = React.useState("");
  const [buatBuka, setBuatBuka] = React.useState(false);
  const [anggotaBuka, setAnggotaBuka] = React.useState(false);
  const [cariAnggota, setCariAnggota] = React.useState("");
  const [terpilih, setTerpilih] = React.useState<string[]>([]);
  const [hapus, setHapus] = React.useState<PesanChat | null>(null);
  const daftarRef = React.useRef<HTMLDivElement>(null);

  const ruang = useQuery({ queryKey: ["chat", "ruang"], queryFn: async () => (await api.get<{ data: RuangChat[] }>("/chat/rooms")).data.data, refetchInterval: 15000 });
  const pesan = useQuery({ queryKey: ["chat", "pesan", aktif], queryFn: async () => (await api.get<Halaman<PesanChat>>(`/chat/rooms/${aktif}/messages?limit=100`)).data, enabled: Boolean(aktif), refetchInterval: 5000 });
  const direktori = useQuery({ queryKey: ["direktori"], queryFn: async () => (await api.get<{ data: KaryawanDirektori[] }>("/employees/directory")).data.data, enabled: buatBuka || anggotaBuka });
  const ruangAktif = (ruang.data ?? []).find((r) => r.id === aktif) ?? null;
  const urut = React.useMemo(() => [...(pesan.data?.data ?? [])].reverse(), [pesan.data]);

  // Gulir ke pesan terbaru setiap ada pesan baru atau ganti ruang — hanya DOM, tanpa state.
  React.useEffect(() => { const el = daftarRef.current; if (el) el.scrollTop = el.scrollHeight; }, [urut.length, aktif]);

  const fr = useForm<FormRuang>({ defaultValues: { name: "", description: "", type: "general", isPrivate: false } });
  const fa = useForm<FormAnggota>({ defaultValues: { employeeId: "", role: "member" } });

  const segarkan = () => { qc.invalidateQueries({ queryKey: ["chat", "ruang"] }); if (aktif) qc.invalidateQueries({ queryKey: ["chat", "pesan", aktif] }); };
  const kirim = useMutation({
    mutationFn: async (message: string) => (await api.post<PesanChat>(`/chat/rooms/${aktif}/messages`, { message })).data,
    onSuccess: () => { setTeks(""); segarkan(); },
    onError: (e) => notifikasi.galat(e, "Pesan tidak terkirim"),
  });
  const buat = useMutation({
    mutationFn: async (v: FormRuang) => (await api.post<RuangChat>("/chat/rooms", { name: v.name, type: v.type, isPrivate: v.isPrivate, ...(v.description ? { description: v.description } : {}), ...(terpilih.length ? { memberIds: terpilih } : {}) })).data,
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["chat", "ruang"] }); notifikasi.sukses("Ruang dibuat", `${r.name} · ${terpilih.length + 1} anggota. Anda moderatornya.`); setBuatBuka(false); setTerpilih([]); setCariAnggota(""); fr.reset(); setAktif(r.id); },
    onError: (e) => notifikasi.galat(e, "Ruang gagal dibuat"),
  });
  const tambah = useMutation({
    mutationFn: async (v: FormAnggota) => (await api.post(`/chat/rooms/${aktif}/members`, v)).data,
    onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ["chat", "ruang"] }); notifikasi.sukses("Anggota ditambahkan", `${(direktori.data ?? []).find((k) => k.id === v.employeeId)?.name ?? "Karyawan"} kini bisa membaca dan menulis di ruang ini.`); setAnggotaBuka(false); fa.reset(); },
    onError: (e) => notifikasi.galat(e, "Anggota gagal ditambahkan"),
  });
  const hapusPesan = useMutation({
    mutationFn: async (p: PesanChat) => api.delete(`/chat/messages/${p.id}`),
    onSuccess: () => { segarkan(); notifikasi.sukses("Pesan dihapus", "Isinya disembunyikan; jejaknya tetap ada untuk audit."); setHapus(null); },
    onError: (e) => notifikasi.galat(e),
  });

  const kirimTeks = () => { const t = teks.trim(); if (t && aktif && !kirim.isPending) kirim.mutate(t); };
  const bolehKelola = (ruangAktif?.myRole === "moderator" || hr) && bolehBuatRuang;
  const kandidat = (direktori.data ?? []).filter((k) => k.id !== saya?.id && (!cariAnggota || `${k.name} ${k.nik} ${k.department?.name ?? ""}`.toLowerCase().includes(cariAnggota.toLowerCase())));

  return (
    <>
      <PageHeader title="Chat Tim" description="Koordinasi antar departemen atau tim — tercatat, bisa dibaca anggota ruang" actions={bolehBuatRuang && <Button onClick={() => setBuatBuka(true)}><Plus className="h-4 w-4" aria-hidden /> Ruang</Button>} />

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card className={cn("overflow-hidden", aktif && "hidden lg:block")}>
          {ruang.isLoading ? <SkeletonBaris /> : !ruang.data?.length ? (
            <EmptyState icon={MessagesSquare} title="Belum ada ruang" description="Buat ruang untuk tim atau departemen Anda, lalu tambahkan anggotanya." action={bolehBuatRuang && <Button onClick={() => setBuatBuka(true)}>Buat Ruang</Button>} />
          ) : (
            <ul className="divide-y divide-border lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto">
              {ruang.data.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setAktif(r.id)} aria-current={aktif === r.id ? "true" : undefined} className={cn("flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-surface-2", aktif === r.id && "bg-primary-soft")}>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-sm font-semibold uppercase" aria-hidden>{r.name.slice(0, 2)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5"><p className="truncate font-medium">{r.name}</p>{r.isPrivate && <Lock className="h-3.5 w-3.5 shrink-0 text-muted" aria-label="Ruang tertutup" />}</div>
                      <p className="truncate text-xs text-muted">{r.lastMessage ? (r.lastMessage.isDeleted ? "Pesan dihapus" : `${r.lastMessage.senderName.split(" ")[0]}: ${r.lastMessage.message}`) : `${r._count.members} anggota · belum ada pesan`}</p>
                    </div>
                    {r.lastMessage && <span className="shrink-0 text-[11px] text-muted">{formatRelatif(r.lastMessage.timestamp)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className={cn("flex min-h-[60vh] flex-col overflow-hidden lg:h-[calc(100dvh-13rem)]", !aktif && "hidden lg:flex")}>
          {!ruangAktif ? (
            <EmptyState icon={MessagesSquare} title="Pilih ruang" description="Percakapan akan tampil di sini." />
          ) : (
            <>
              <header className="flex items-center gap-2 border-b border-border p-3">
                <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setAktif(null)} aria-label="Kembali ke daftar ruang"><ArrowLeft className="h-5 w-5" aria-hidden /></Button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="truncate font-semibold">{ruangAktif.name}</h2><Badge tone="neutral">{LABEL_RUANG[ruangAktif.type]}</Badge>{ruangAktif.myRole === "moderator" && <Badge tone="info">Moderator</Badge>}</div>
                  <p className="truncate text-xs text-muted"><Users className="mr-1 inline h-3 w-3" aria-hidden />{ruangAktif._count.members} anggota{ruangAktif.description ? ` · ${ruangAktif.description}` : ""}</p>
                </div>
                {bolehKelola && <Button variant="outline" size="sm" onClick={() => setAnggotaBuka(true)}><UserPlus className="h-4 w-4" aria-hidden /><span className="hidden sm:inline"> Anggota</span></Button>}
              </header>

              <div ref={daftarRef} className="flex-1 space-y-2 overflow-y-auto p-3" role="log" aria-live="polite" aria-label="Pesan">
                {pesan.isLoading ? <SkeletonBaris /> : urut.length === 0 ? <p className="py-10 text-center text-sm text-muted">Belum ada pesan. Mulai percakapan.</p> : (
                  <>
                    {(pesan.data?.pagination.total ?? 0) > urut.length && <p className="text-center text-xs text-muted">Hanya {urut.length} pesan terakhir yang ditampilkan.</p>}
                    {urut.map((m, i) => {
                      const milikku = m.senderId === saya?.id;
                      const gantiHari = i === 0 || formatTanggal(urut[i - 1].timestamp) !== formatTanggal(m.timestamp);
                      const bolehHapus = bolehHapusPesan && !m.isDeleted && (milikku || ruangAktif?.myRole === "moderator" || hr);
                      return (
                        <React.Fragment key={m.id}>
                          {gantiHari && <p className="py-2 text-center text-[11px] uppercase tracking-wide text-muted">{formatTanggal(m.timestamp, "EEEE, d MMM yyyy")}</p>}
                          <div className={cn("group flex items-end gap-1.5", milikku ? "justify-end" : "justify-start")}>
                            {milikku && bolehHapus && <button type="button" onClick={() => setHapus(m)} className="rounded p-1 text-muted opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100" aria-label="Hapus pesan"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>}
                            <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm sm:max-w-[70%]", milikku ? "rounded-br-md bg-primary text-on-primary" : "rounded-bl-md bg-surface-2")}>
                              {!milikku && <p className="mb-0.5 text-xs font-semibold text-primary">{m.sender.name}</p>}
                              {m.isDeleted ? <p className="italic opacity-70">Pesan dihapus</p> : <p className="whitespace-pre-wrap break-words">{m.message}</p>}
                              <p className={cn("mt-1 text-right text-[10px]", milikku ? "text-on-primary/70" : "text-muted")}>{formatWaktu(m.timestamp)}</p>
                            </div>
                            {!milikku && bolehHapus && <button type="button" onClick={() => setHapus(m)} className="rounded p-1 text-muted opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100" aria-label="Hapus pesan"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>}
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </>
                )}
              </div>

              <form onSubmit={(e) => { e.preventDefault(); kirimTeks(); }} className="flex items-end gap-2 border-t border-border p-3 pb-safe">
                <Textarea rows={1} value={teks} onChange={(e) => setTeks(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); kirimTeks(); } }} placeholder="Tulis pesan… (Enter kirim, Shift+Enter baris baru)" aria-label="Pesan" className="max-h-32 min-h-10 flex-1 resize-none" maxLength={5000} />
                <Button type="submit" size="icon" loading={kirim.isPending} disabled={!teks.trim()} aria-label="Kirim"><Send className="h-4 w-4" aria-hidden /></Button>
              </form>
            </>
          )}
        </Card>
      </div>

      <Modal open={buatBuka} onClose={() => setBuatBuka(false)} size="lg" title="Ruang Baru" description="Anda otomatis menjadi moderator dan bisa menambah anggota kapan saja"
        footer={<><Button variant="outline" onClick={() => setBuatBuka(false)}>Batal</Button><Button form="form-ruang" type="submit" loading={buat.isPending}>Buat Ruang</Button></>}>
        <form id="form-ruang" onSubmit={fr.handleSubmit((v) => buat.mutate(v))} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nama ruang" error={fr.formState.errors.name?.message}><Input {...fr.register("name", { required: "Wajib diisi" })} placeholder="Kitchen Shift Malam" /></Field>
            <Field label="Jenis"><Select {...fr.register("type")}>{Object.entries(LABEL_RUANG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Deskripsi" className="sm:col-span-2"><Input {...fr.register("description")} placeholder="Koordinasi stok dan handover shift" /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...fr.register("isPrivate")} className="h-4 w-4 accent-[var(--color-primary)]" /> Ruang tertutup — hanya anggota yang ditambahkan</label>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Anggota awal <span className="font-normal text-muted">({terpilih.length} dipilih)</span></legend>
            <div className="relative mb-2"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden /><Input value={cariAnggota} onChange={(e) => setCariAnggota(e.target.value)} placeholder="Cari nama, NIK, departemen…" className="pl-9" aria-label="Cari karyawan" /></div>
            <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-xl border border-border">
              {direktori.isLoading ? <li className="p-3 text-sm text-muted">Memuat…</li> : kandidat.length === 0 ? <li className="p-3 text-sm text-muted">Tidak ada yang cocok.</li> : kandidat.map((k) => (
                <li key={k.id}><label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-2"><input type="checkbox" className="h-4 w-4 accent-[var(--color-primary)]" checked={terpilih.includes(k.id)} onChange={(e) => setTerpilih((t) => (e.target.checked ? [...t, k.id] : t.filter((x) => x !== k.id)))} /><span className="min-w-0 flex-1 truncate">{k.name}</span><span className="shrink-0 text-xs text-muted">{k.department?.name ?? k.nik}</span></label></li>
              ))}
            </ul>
          </fieldset>
        </form>
      </Modal>

      <Modal open={anggotaBuka} onClose={() => setAnggotaBuka(false)} title="Tambah Anggota" description={ruangAktif ? `Ke ruang ${ruangAktif.name}` : undefined}
        footer={<><Button variant="outline" onClick={() => setAnggotaBuka(false)}>Batal</Button><Button form="form-anggota" type="submit" loading={tambah.isPending}>Tambahkan</Button></>}>
        <form id="form-anggota" onSubmit={fa.handleSubmit((v) => tambah.mutate(v))} className="space-y-4" noValidate>
          <Field label="Karyawan" error={fa.formState.errors.employeeId?.message}><Select {...fa.register("employeeId", { required: "Pilih karyawan" })}><option value="">— Pilih —</option>{(direktori.data ?? []).filter((k) => k.id !== saya?.id).map((k) => <option key={k.id} value={k.id}>{k.name}{k.department ? ` · ${k.department.name}` : ""}</option>)}</Select></Field>
          <Field label="Peran"><Select {...fa.register("role")}><option value="member">Anggota</option><option value="moderator">Moderator — bisa menambah anggota dan menghapus pesan</option></Select></Field>
        </form>
      </Modal>

      <Modal open={Boolean(hapus)} onClose={() => setHapus(null)} title="Hapus pesan?" description="Isinya disembunyikan dari semua anggota, tapi jejak bahwa ada pesan yang dihapus tetap terlihat."
        footer={<><Button variant="outline" onClick={() => setHapus(null)}>Batal</Button><Button variant="danger" onClick={() => hapus && hapusPesan.mutate(hapus)} loading={hapusPesan.isPending}>Hapus</Button></>}>
        {hapus && <blockquote className="rounded-lg bg-surface-2 px-3 py-2 text-sm"><p className="mb-1 text-xs font-semibold text-muted">{hapus.sender.name} · {formatWaktu(hapus.timestamp)}</p><p className="whitespace-pre-wrap">{hapus.message}</p></blockquote>}
      </Modal>
    </>
  );
}
