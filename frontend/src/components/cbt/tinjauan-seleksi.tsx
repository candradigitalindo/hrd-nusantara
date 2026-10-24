"use client";

import * as React from "react";
import { isAxiosError } from "axios";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Save, X } from "lucide-react";
import { api } from "@/lib/api";
import { statusTinjauanSeleksi, versiHasilBisaDitinjau, konflikVersiHasilCbt } from "@/lib/lingkup-cbt";
import { formatTanggal } from "@/lib/utils";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import type { PenugasanCbt } from "@/lib/types";

export const BadgeTinjauanSeleksi = ({ tugas }: { tugas: PenugasanCbt }) => {
  const status = statusTinjauanSeleksi(tugas, tugas.attempt?.submittedAt ?? null);
  return <Badge tone={status.tone} dot>{status.label}</Badge>;
};

/** HR menandai tinjauan setelah membaca hasil lengkap; ini bukan keputusan lulus/gagal. */
export const TinjauanSeleksi = ({ tugas, submittedAt, attemptId, attemptUpdatedAt, sedangMemuat, adaPerubahanNilai = false }: {
  tugas: PenugasanCbt; submittedAt: string | null; attemptId: string; attemptUpdatedAt: string; sedangMemuat: boolean; adaPerubahanNilai?: boolean;
}) => {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const status = statusTinjauanSeleksi(tugas, submittedAt);
  const [versiDitolak, setVersiDitolak] = React.useState<string | null>(null);
  const versiSiap = versiHasilBisaDitinjau(attemptUpdatedAt, versiDitolak, sedangMemuat);
  const muatUlang = () => qc.invalidateQueries({ queryKey: ["cbt", "hasil", "recruitment", attemptId], exact: true });
  const tinjau = useMutation({
    mutationFn: async (versi: string) => api.post(`/cbt/penugasan/${tugas.id}/review?scope=recruitment`, { scope: "recruitment", attemptUpdatedAt: versi }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cbt"] });
      qc.invalidateQueries({ queryKey: ["kandidat"] });
      setVersiDitolak(null);
      notifikasi.sukses("Tinjauan HR tercatat");
    },
    onError: (e, versi) => {
      if (isAxiosError(e) && konflikVersiHasilCbt(e.response?.status, e.response?.data?.code)) {
        setVersiDitolak(versi);
        void muatUlang();
        notifikasi.peringatan("Hasil berubah; tinjau ulang", "Tinjauan belum disimpan. Baca hasil terbaru sebelum menandai tinjauan HR lagi.");
        return;
      }
      notifikasi.galat(e, "Tinjauan belum tersimpan");
    },
  });
  return (
    <div className="space-y-3">
    {versiDitolak && <Alert tone="warning" title="Hasil berubah; tinjau ulang"
      action={!sedangMemuat && !versiSiap && <Button size="sm" variant="outline" onClick={() => void muatUlang()}>Muat ulang hasil</Button>}>
      {sedangMemuat ? "Tinjauan belum disimpan. Memuat hasil terbaru…" : versiSiap ? "Hasil terbaru ditampilkan di bawah. Baca kembali sebelum menandai tinjauan HR; tinjauan sebelumnya belum disimpan." : "Hasil terbaru belum tersedia. Muat ulang hasil sebelum menandai tinjauan HR."}
    </Alert>}
    <Alert tone={status.tone === "success" ? "success" : "info"} title={status.label}
      action={status.dapatDitinjau && punyaIzin(saya, "rekrutmen.ubah") && punyaIzin(saya, "cbt_hasil.lihat") && (
        <Button size="sm" onClick={() => tinjau.mutate(attemptUpdatedAt)} loading={tinjau.isPending} disabled={adaPerubahanNilai || !versiSiap}>
          <Check className="h-4 w-4" aria-hidden /> Tandai sudah ditinjau HR
        </Button>
      )}>
      {tugas.reviewedAt ? `Ditinjau ${tugas.reviewedBy?.name ?? "HR"} pada ${formatTanggal(tugas.reviewedAt, "d MMM yyyy HH:mm")}.` :
        adaPerubahanNilai ? "Simpan perubahan penilaian sebelum menandai tinjauan HR." :
        status.dapatDitinjau ? "Baca hasil dan catatan pengawasan sebelum menandai tinjauan. Tinjauan tidak otomatis menerima pelamar." :
        "Pelamar harus menyelesaikan tes dan seluruh jawaban harus dinilai sebelum HR meninjau hasil."}
    </Alert>
    </div>
  );
};

export const DialogSyaratSeleksi = ({ tugas, onClose }: { tugas: PenugasanCbt; onClose: () => void }) => {
  const qc = useQueryClient();
  const [alasan, setAlasan] = React.useState("");
  const simpan = useMutation({
    mutationFn: async () => api.patch(`/cbt/penugasan/${tugas.id}/selection?scope=recruitment`, { scope: "recruitment", required: !tugas.required, reason: alasan.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cbt"] });
      qc.invalidateQueries({ queryKey: ["kandidat"] });
      notifikasi.sukses("Syarat tes diperbarui");
      onClose();
    },
    onError: (e) => notifikasi.galat(e, "Syarat tes belum diperbarui"),
  });
  return <Modal open onClose={onClose} title={tugas.required ? "Jadikan tes opsional" : "Jadikan tes wajib"} description={tugas.test.title}
    footer={<><Button variant="outline" onClick={onClose} disabled={simpan.isPending}><X className="h-4 w-4" aria-hidden /> Batal</Button><Button onClick={() => simpan.mutate()} loading={simpan.isPending} disabled={alasan.trim().length < 5}><Save className="h-4 w-4" aria-hidden /> Simpan</Button></>}>
    <div className="space-y-4">
      <Alert tone="info" title="Riwayat tes tetap tersimpan">Perubahan dicatat dan tinjauan HR tes ini perlu diulang. Penerimaan tetap memerlukan setidaknya satu tes wajib yang selesai dan sudah ditinjau HR.</Alert>
      <Field label="Alasan perubahan" hint="Minimal 5 karakter; misalnya digantikan oleh penugasan tes ulang."><Textarea rows={3} maxLength={500} value={alasan} onChange={(e) => setAlasan(e.target.value)} /></Field>
    </div>
  </Modal>;
};
