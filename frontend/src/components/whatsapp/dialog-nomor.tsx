"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Check, History, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Button } from "@/components/ui/button";
import { Input, Field, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import type { AkunWhatsApp, Halaman, Karyawan, SesiWhatsApp } from "@/lib/types";

type FormAkun = { phoneNumber: string; label: string; assignedEmployeeId: string };

/** Mendaftarkan nomor milik perusahaan (CS outlet, reservasi hotel). */
export const DialogDaftarNomor = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const qc = useQueryClient();
  const fa = useForm<FormAkun>({ defaultValues: { phoneNumber: "", label: "", assignedEmployeeId: "" } });

  const karyawan = useQuery({
    queryKey: ["karyawan", "pilihan"],
    queryFn: async () => (await api.get<Halaman<Karyawan>>("/employees?limit=100")).data.data,
    enabled: open,
  });

  const daftarkan = useMutation({
    mutationFn: async (v: FormAkun) =>
      (await api.post<AkunWhatsApp>("/whatsapp/accounts", { phoneNumber: v.phoneNumber, label: v.label, ...(v.assignedEmployeeId ? { assignedEmployeeId: v.assignedEmployeeId } : {}) })).data,
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ["wa", "akun"] });
      notifikasi.sukses("Nomor didaftarkan", `${a.label} · ${a.phoneNumber}`);
      onClose();
      fa.reset();
    },
    onError: (e) => notifikasi.galat(e, "Gagal mendaftarkan nomor"),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Daftarkan Nomor Perusahaan"
      description="Nomor ini akan dipantau. Pastikan ini nomor milik perusahaan, bukan pribadi."
      footer={
        <>
          <Button variant="outline" onClick={onClose}><X className="h-4 w-4" aria-hidden /> Batal</Button>
          <Button form="form-akun" type="submit" loading={daftarkan.isPending}>{!daftarkan.isPending && <Plus className="h-4 w-4" aria-hidden />} Daftarkan</Button>
        </>
      }
    >
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
  );
};

/** QR untuk menautkan nomor perusahaan; diperbarui sendiri sampai tersambung. */
export const DialogQr = ({ akun, onClose }: { akun: AkunWhatsApp | null; onClose: () => void }) => {
  const qc = useQueryClient();

  // QR diperbarui WhatsApp tiap ~20 detik; poll tiap 3 detik selama dialog terbuka.
  const sesi = useQuery({
    queryKey: ["wa", "sesi", akun?.id],
    queryFn: async () => (await api.get<SesiWhatsApp>(`/whatsapp/accounts/${akun!.id}/session`)).data,
    enabled: Boolean(akun),
    refetchInterval: (q) => (q.state.data?.status === "connected" ? false : 3000),
  });

  const tersambung = Boolean(akun) && sesi.data?.status === "connected";

  // Efek ini hanya memberi tahu dan menyegarkan daftar — tidak menyetel state.
  // Penutupan dialog diserahkan ke pengguna lewat tombol "Selesai".
  React.useEffect(() => {
    if (!tersambung) return;
    notifikasi.sukses("Nomor tersambung", "Pesan mulai terarsip untuk nomor ini.");
    qc.invalidateQueries({ queryKey: ["wa", "akun"] });
  }, [tersambung, qc]);

  return (
    <Modal open={Boolean(akun)} onClose={onClose} title="Pindai QR dengan WhatsApp" description={akun ? `${akun.label}${akun.phoneNumber ? ` · +${akun.phoneNumber}` : ""}` : undefined}>
      <div className="flex flex-col items-center gap-4">
        {tersambung ? (
          <Alert tone="success" title="Tersambung" className="w-full" action={<Button size="sm" onClick={onClose}><Check className="h-4 w-4" aria-hidden /> Selesai</Button>}>
            Nomor ini kini terpantau. Pesan yang masuk akan muncul di Percakapan.
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
  );
};

/**
 * Menarik percakapan lama sebuah nomor.
 *
 * Bawaannya sistem hanya mengarsipkan percakapan sejak nomor dipantau.
 * Riwayat sebelum itu ditarik hanya kalau memang diperlukan, per nomor, dan
 * atas keputusan Super Admin — karena isinya percakapan dari masa sebelum
 * pemantauan berjalan.
 */
export const DialogTarikRiwayat = ({ akun, onClose }: { akun: AkunWhatsApp | null; onClose: () => void }) => {
  const qc = useQueryClient();
  const [jumlah, setJumlah] = React.useState("50");
  const [kontak, setKontak] = React.useState("");

  const tarik = useMutation({
    mutationFn: async () =>
      (await api.post<{ percakapan: number; jumlahPerPercakapan: number; catatan: string }>(
        `/whatsapp/accounts/${akun!.id}/riwayat`,
        { jumlah: Number(jumlah) || 50, ...(kontak.trim() ? { contactNumber: kontak.trim() } : {}) }
      )).data,
    onSuccess: (r) => {
      notifikasi.sukses(`Permintaan terkirim untuk ${r.percakapan} percakapan`, r.catatan);
      qc.invalidateQueries({ queryKey: ["wa", "utas"] });
      onClose();
    },
    onError: (e) => notifikasi.galat(e, "Riwayat gagal ditarik"),
  });

  return (
    <Modal
      open={Boolean(akun)}
      onClose={onClose}
      title="Tarik Percakapan Lama"
      description={akun ? `${akun.label}${akun.phoneNumber ? ` · +${akun.phoneNumber}` : ""}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={tarik.isPending}><X className="h-4 w-4" aria-hidden /> Batal</Button>
          <Button onClick={() => tarik.mutate()} loading={tarik.isPending}>
            {!tarik.isPending && <History className="h-4 w-4" aria-hidden />} Tarik
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="info" title="Permintaan ke WhatsApp, bukan pencarian di sistem">
          WhatsApp mengirim pesannya bertahap lewat koneksi nomor ini, jadi arsip terisi beberapa saat setelah tombol ditekan. Berkas media yang sudah lama umumnya tidak bisa diunduh lagi — yang tersisa teksnya.
        </Alert>
        <Field label="Jumlah pesan per percakapan" hint="10–500. Makin besar makin lama WhatsApp mengirimkannya.">
          <Input type="number" min={10} max={500} step={10} value={jumlah} onChange={(e) => setJumlah(e.target.value)} />
        </Field>
        <Field label="Nomor kontak tertentu (opsional)" hint="Kosongkan untuk seluruh percakapan yang sudah dikenal di nomor ini.">
          <Input inputMode="tel" placeholder="mis. 081234567890" value={kontak} onChange={(e) => setKontak(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
};
