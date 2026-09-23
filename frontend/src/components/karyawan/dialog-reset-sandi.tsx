"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Copy, KeyRound, X } from "lucide-react";
import { api } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import type { Karyawan } from "@/lib/types";

type Hasil = { temporaryPassword?: string; message: string };

/**
 * HR mengatur ulang kata sandi karyawan yang lupa. Bawaan: server membuat
 * sandi sementara yang tampil sekali di sini; karyawan wajib menggantinya
 * saat login berikutnya, jadi HR tidak pernah memegang sandi tetap karyawan.
 */
export const DialogResetSandi = ({ karyawan, open, onClose }: { karyawan: Karyawan | null; open: boolean; onClose: () => void }) => {
  // Isi dialog di-mount ulang setiap dibuka, jadi state-nya selalu bersih tanpa efek penyetel ulang.
  if (!open || !karyawan) return null;
  return <IsiResetSandi key={karyawan.id} karyawan={karyawan} onClose={onClose} />;
};

const IsiResetSandi = ({ karyawan, onClose }: { karyawan: Karyawan; onClose: () => void }) => {
  const [mode, setMode] = React.useState<"otomatis" | "sendiri">("otomatis");
  const [sandi, setSandi] = React.useState("");
  const [hasil, setHasil] = React.useState<Hasil | null>(null);
  const [tersalin, setTersalin] = React.useState(false);

  const reset = useMutation({
    mutationFn: async () => (await api.post<Hasil>(`/employees/${karyawan.id}/reset-password`, mode === "sendiri" ? { password: sandi } : {})).data,
    onSuccess: (r) => {
      setHasil(r);
      notifikasi.sukses("Kata sandi diatur ulang", `${karyawan.name} wajib menggantinya saat login berikutnya.`);
    },
    onError: (e) => notifikasi.galat(e, "Kata sandi belum diatur ulang"),
  });

  const salin = async () => {
    if (!hasil?.temporaryPassword) return;
    try {
      await navigator.clipboard.writeText(hasil.temporaryPassword);
      setTersalin(true);
      setTimeout(() => setTersalin(false), 2000);
    } catch {
      notifikasi.peringatan("Tidak bisa menyalin otomatis", "Salin sandi secara manual.");
    }
  };

  const bolehKirim = mode === "otomatis" || sandi.length >= 8;

  return (
    <Modal
      open
      onClose={onClose}
      title={hasil ? "Sandi sementara dibuat" : "Atur ulang kata sandi"}
      description={`${karyawan.name} · ${karyawan.nik}`}
      footer={
        hasil ? (
          <Button onClick={onClose}><Check className="h-4 w-4" aria-hidden /> Selesai</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose} disabled={reset.isPending}><X className="h-4 w-4" aria-hidden /> Batal</Button>
            <Button onClick={() => reset.mutate()} loading={reset.isPending} disabled={!bolehKirim}>
              {!reset.isPending && <KeyRound className="h-4 w-4" aria-hidden />} Atur ulang
            </Button>
          </>
        )
      }
    >
      {hasil ? (
        <div className="space-y-4">
          {hasil.temporaryPassword ? (
            <>
              <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 p-3">
                <code className="flex-1 select-all text-center font-mono text-2xl tracking-widest" data-testid="sandi-sementara">{hasil.temporaryPassword}</code>
                <Button variant="outline" size="sm" onClick={salin} aria-label="Salin sandi sementara">
                  {tersalin ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                  {tersalin ? "Tersalin" : "Salin"}
                </Button>
              </div>
              <Alert tone="warning" title="Hanya tampil sekali">
                Sampaikan langsung ke {karyawan.name} (tatap muka atau WhatsApp pribadi). Setelah jendela ini ditutup, sandi ini tidak bisa dilihat lagi — bila hilang, atur ulang sekali lagi.
              </Alert>
            </>
          ) : (
            <Alert tone="success" title="Kata sandi diganti">Sampaikan sandi yang Anda tentukan ke {karyawan.name}.</Alert>
          )}
          <p className="text-sm text-muted">Saat login berikutnya, {karyawan.name} diminta membuat sandi baru yang hanya ia ketahui.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">Sandi lama langsung tidak berlaku. Karyawan wajib membuat sandi baru saat login berikutnya, di web maupun aplikasi Android.</p>
          <fieldset className="space-y-2">
            <legend className="sr-only">Cara menentukan sandi</legend>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft/40">
              <input type="radio" name="mode-sandi" className="mt-1" checked={mode === "otomatis"} onChange={() => setMode("otomatis")} />
              <span>
                <span className="block text-sm font-medium">Buat sandi sementara otomatis</span>
                <span className="block text-xs text-muted">10 karakter acak yang mudah dibaca; tampil sekali setelah ini. Disarankan.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft/40">
              <input type="radio" name="mode-sandi" className="mt-1" checked={mode === "sendiri"} onChange={() => setMode("sendiri")} />
              <span>
                <span className="block text-sm font-medium">Tentukan sendiri</span>
                <span className="block text-xs text-muted">Misalnya disepakati langsung dengan karyawan di tempat.</span>
              </span>
            </label>
          </fieldset>
          {mode === "sendiri" && (
            <Field label="Kata sandi sementara" hint="Minimal 8 karakter">
              <Input type="text" autoComplete="off" value={sandi} onChange={(e) => setSandi(e.target.value)} placeholder="mis. Outlet2026" />
            </Field>
          )}
        </div>
      )}
    </Modal>
  );
};
